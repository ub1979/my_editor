import { readFileSync, writeFileSync } from 'fs';
import * as path from 'path';
import { MAX_SOURCE_LINES, sourceLines } from '../quality/sourcePolicy';
import { checkSummary } from './baseline';
import { screenParsed } from './fixScreen';
import type { FixChoice, StepRecord } from './fixState';
import type { Prompt, RefactorBuild, RefactorHooks, RefactorTarget } from './language';
import { chunkShapeProblems, parseChunks } from './refactorPlan';
import { refactorBody, refactorSubject } from './refactorText';
import { retryText } from './splitPlan';
import { runChecks, type StepContext, type StepOutcome } from './steps';
import { changedFiles, commit, restore } from './worktree';

const NOT_A_PLAN = 'The reply was not a JSON array of {"name", "from", "to"}.';

/** The model's plan attempts and why each rejected one was rejected, as the step records them. */
interface Attempts {
	asked: number;
	readonly rejected: string[];
}

/** One step's fixed inputs. */
interface Refactor {
	readonly ctx: StepContext;
	readonly hooks: RefactorHooks;
	readonly fix: FixChoice;
	readonly target: RefactorTarget;
	readonly attempts: Attempts;
}

const first = (problems: readonly string[]) => problems.slice(0, 5).join(' ');

/**
 * One refactor: the model chooses runs of statements and names (one retry), the language builds the helpers without
 * AI, its extract check reads the written file, the checks are compared with the baseline, then commit or restore.
 * A committed refactor asks for the split of the same file next when it is still over the limit.
 */
export async function runRefactor(ctx: StepContext, fix: FixChoice): Promise<StepOutcome> {
	const attempts: Attempts = { asked: 0, rejected: [] };
	const done = (status: StepRecord['status'], reason: string): StepRecord =>
		({ file: fix.file, kind: 'refactor', status, reason, ...(attempts.asked ? { plan: { attempts: attempts.asked, rejected: attempts.rejected } } : {}) });
	const hooks = ctx.adapter.refactor;
	if (!hooks) { return done('skipped', 'This language has no refactor.'); }
	const info = await ctx.adapter.parse(fix.file);
	const early = screenParsed(ctx.adapter, ctx.worktree, ctx.baseline, fix, info);
	if (early) { return early.step; }
	const target = hooks.target(info);
	if (typeof target === 'string') { return done('refused', `${target[0].toUpperCase()}${target.slice(1)}.`); }
	const step: Refactor = { ctx, hooks, fix, target, attempts };
	try {
		const prompt = await hooks.prompt(fix.file, target);
		if (typeof prompt === 'string') { return done('refused', prompt); }
		const built = await plan(step, prompt);
		if (built === 'stopped') { return 'stopped'; }
		if (built.problems.length || !built.text) {
			attempts.rejected.push(first(built.problems));
			return done('refused', `The refactor plan was rejected twice: ${first(built.problems)}`);
		}
		const outcome = await apply(step, built);
		if (outcome === 'stopped') { return 'stopped'; }
		return typeof outcome === 'string' ? done('refused', outcome) : outcome;
	} catch (error) {
		if (ctx.cancelled()) { return 'stopped'; }
		return done('refused', error instanceof Error ? error.message : String(error));
	} finally {
		hooks.abandon?.(fix.file);
	}
}

/** Asks for a plan and builds it; one retry with the problems shown. */
async function plan({ ctx, hooks, fix, target, attempts }: Refactor, prompt: Prompt): Promise<RefactorBuild | 'stopped'> {
	const build = async (reply: string): Promise<RefactorBuild> => {
		const chunks = parseChunks(reply);
		if (!chunks) { return { problems: [NOT_A_PLAN] }; }
		const shape = chunkShapeProblems(chunks);
		return shape.length ? { problems: shape } : hooks.build(fix.file, target, chunks);
	};
	ctx.progress(`Planning how to refactor \`${target.name}\` in ${fix.file}…`);
	let reply = await ctx.ask(prompt.system, prompt.text);
	attempts.asked++;
	if (ctx.cancelled()) { return 'stopped'; }
	let built = await build(reply);
	if (built.problems.length && !ctx.cancelled()) {
		attempts.rejected.push(first(built.problems));
		reply = await ctx.ask(prompt.system, retryText(prompt, reply, built.problems));
		attempts.asked++;
		if (ctx.cancelled()) { return 'stopped'; }
		built = await build(reply);
	}
	return ctx.cancelled() ? 'stopped' : built;
}

/** Writes the built file, checks it, and commits it; the file is restored on every other outcome. A string is why it was refused. */
async function apply({ ctx, hooks, fix, target, attempts }: Refactor, built: RefactorBuild): Promise<StepRecord | 'stopped' | string> {
	const { adapter, worktree } = ctx;
	const file = path.join(worktree, fix.file);
	const before = readFileSync(file);
	const formatted = !(await adapter.unformatted([fix.file])).length;
	let committed = false;
	try {
		writeFileSync(file, built.text!);
		ctx.progress(`Checking the extract in ${fix.file}…`);
		const problems = await hooks.check(fix.file, before, target, built);
		if (problems.length) { return `The extract check failed: ${first(problems)}`; }
		if (formatted && (await adapter.unformatted([fix.file])).length) { return `The formatter would change ${fix.file}.`; }
		const checks = await runChecks(ctx, fix.file, []);
		if (checks.stopped) { return 'stopped'; }
		if (checks.problems.length) { return `Checks differ from before: ${checks.problems.join(' ')}`; }
		const other = (await changedFiles(worktree)).filter(name => name !== fix.file);
		if (other.length) { return `Other tracked files changed: ${other.join(', ')}.`; }
		const summary = checkSummary(checks.results, ctx.flaky, ctx.baseline);
		const helpers = built.helpers ?? [];
		const ran = ctx.coverage?.[fix.file];
		const sha = await commit(worktree, [fix.file], refactorSubject(fix.file, target.name, helpers.length),
			refactorBody(helpers, target.name, ran, summary));
		committed = true;
		const lines = sourceLines(built.text!.toString('utf8'));
		return {
			file: fix.file, kind: 'refactor', status: 'committed', commit: sha, checks: summary,
			plan: { attempts: attempts.asked, rejected: attempts.rejected },
			refactor: { target: target.name, helpers, lines: built.functionLines ?? target.lines, ...(ran !== undefined ? { ran } : {}) },
			...(lines > MAX_SOURCE_LINES ? { followUp: { file: fix.file, kind: 'split' as const, lines } } : {}),
		};
	} finally {
		if (!committed) { await restore(worktree, []); }
	}
}
