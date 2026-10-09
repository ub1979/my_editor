import { existsSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'fs';
import * as path from 'path';
import { fileFromReply } from '../pair/codeBlock';
import { sourceLines } from '../quality/sourcePolicy';
import { CheckResult, checkSummary, compareWithBaseline, noVerifyingCheck, unverified } from './baseline';
import type { FixChoice, StepRecord } from './fixState';
import type { FileInfo, LanguageAdapter, SplitPlan } from './language';
import { checkMove } from './moveCheck';
import { oversizeNotes, parsePlan, planProblems, retryText } from './splitPlan';
import { changedFiles, commit, restore } from './worktree';

/** What a step needs from the run; the model call and command runner are passed in. */
export interface StepContext {
	/** The language adapter, created for the worktree. */
	readonly adapter: LanguageAdapter;
	readonly worktree: string;
	readonly ask: (system: string, text: string) => Promise<string>;
	/** Runs one approved command in the worktree and parses its output. */
	readonly check: (command: string, label: string, env?: Readonly<Record<string, string>>) => Promise<CheckResult>;
	readonly baseline: Readonly<Record<string, readonly [CheckResult, CheckResult]>>;
	readonly flaky: readonly string[];
	readonly cancelled: () => boolean;
	readonly progress: (text: string) => void;
}

/** A step either records an outcome or stops (Stop pressed); a stopped step is undone and runs again on Continue. */
export type StepOutcome = StepRecord | 'stopped';

interface ChecksOutcome {
	readonly results: CheckResult[];
	readonly problems: string[];
	readonly newFailing: string[];
	readonly stopped: boolean;
}

/** Runs the file's checks in order and compares each with the baseline; stops at the first that differs. */
async function runChecks(ctx: StepContext, file: string, allowNew: readonly string[], only?: 'test'): Promise<ChecksOutcome> {
	const results: CheckResult[] = [];
	const newFailing: string[] = [];
	for (const check of ctx.adapter.checks(file).filter(c => !only || c.label === only)) {
		ctx.progress(`Running \`${check.command}\`…`);
		const result = await ctx.check(check.command, check.label, check.env);
		if (ctx.cancelled()) { return { results, problems: [], newFailing, stopped: true }; }
		const baseline = ctx.baseline[check.command];
		if (!baseline) { return { results, problems: [`No baseline for \`${check.command}\`.`], newFailing, stopped: false }; }
		const comparison = compareWithBaseline(baseline, result, allowNew);
		results.push(result);
		newFailing.push(...comparison.newFailing);
		if (comparison.problems.length) {
			return { results, problems: [...comparison.problems, ...(result.tail ? [`Output:\n${result.tail}`] : [])], newFailing, stopped: false };
		}
	}
	return { results, problems: [], newFailing, stopped: false };
}

function relative(dir: string, name: string): string {
	return dir === '.' ? name : `${dir}/${name}`;
}

/** One split: plan with the model (one retry), apply without AI, move check, build and tests, then commit or restore. */
export async function runSplit(ctx: StepContext, fix: FixChoice): Promise<StepOutcome> {
	const { adapter, worktree } = ctx;
	const abs = (file: string) => path.join(worktree, file);
	const rejected: string[] = [];
	let asked = 0;
	const done = (status: StepRecord['status'], reason: string): StepRecord =>
		({ file: fix.file, kind: 'split', status, reason, ...(asked ? { plan: { attempts: asked, rejected } } : {}) });
	const info = await adapter.parse(fix.file);
	if (info.skip) { return done('skipped', `Never split: ${info.skip}.`); }
	if (!info.declarations.some(d => d.movable)) { return done('refused', 'Nothing in it may move.'); }
	const dir = path.posix.dirname(fix.file);
	const blocked = noVerifyingCheck(adapter.checks(fix.file), ctx.baseline, dir === '.' ? '.' : `./${dir}`);
	if (blocked) { return done('skipped', blocked); }
	const source = readFileSync(abs(fix.file));
	const input = { source, info, existing: readdirSync(path.dirname(abs(fix.file))) };
	const prompt = adapter.splitPrompt(info, sourceLines(source.toString('utf8')));
	ctx.progress(`Planning how to split ${fix.file}…`);
	let reply = await ctx.ask(prompt.system, prompt.text);
	asked++;
	let plan = parsePlan(reply);
	let problems = plan ? planProblems(adapter, input, plan) : ['The reply was not a JSON array of {"file", "declarations"}.'];
	if (problems.length && !ctx.cancelled()) {
		rejected.push(problems.slice(0, 5).join(' '));
		reply = await ctx.ask(prompt.system, retryText(prompt, reply, problems));
		asked++;
		plan = parsePlan(reply);
		problems = plan ? planProblems(adapter, input, plan) : ['The reply was not a JSON array of {"file", "declarations"}.'];
	}
	if (ctx.cancelled()) { return 'stopped'; }
	if (problems.length || !plan) {
		rejected.push(problems.slice(0, 5).join(' '));
		return done('refused', `The split plan was rejected twice: ${problems.slice(0, 5).join(' ')}`);
	}
	const unitBefore = await Promise.all((await adapter.unitFiles(fix.file)).map(file => adapter.parse(file)));
	const formatted = !(await adapter.unformatted([fix.file])).length;
	const result = adapter.buildSplit(source, info, plan);
	const newFiles = result.files.map(file => relative(dir, file.name));
	try {
		writeFileSync(abs(fix.file), result.original);
		result.files.forEach((file, index) => writeFileSync(abs(newFiles[index]), file.text));
		ctx.progress(`Checking the move in ${fix.file}…`);
		const moveProblems = await checkSplit(ctx, fix.file, newFiles, { source, info, plan, unitBefore, formatted });
		if (moveProblems.length) {
			await restore(worktree, newFiles);
			return done('refused', `The move check failed: ${moveProblems.slice(0, 5).join(' ')}`);
		}
		const checks = await runChecks(ctx, fix.file, []);
		const changed = (await changedFiles(worktree)).filter(file => file !== fix.file);
		if (checks.stopped || checks.problems.length || changed.length) {
			await restore(worktree, newFiles);
			if (checks.stopped) { return 'stopped'; }
			return done('skipped', checks.problems.length ? `Checks differ from before: ${checks.problems.join(' ')}`
				: `Other tracked files changed: ${changed.join(', ')}.`);
		}
		const byId = new Map(info.declarations.map(d => [d.id, d]));
		const moved = plan.map(group => ({ file: group.file, names: group.declarations.map(id => byId.get(id)!.names.join(', ')) }));
		const summary = checkSummary(checks.results, ctx.flaky, ctx.baseline);
		const body = ['Moved whole declarations byte for byte; nothing else changed.', '',
			...moved.map(m => `${m.file}: ${m.names.join('; ')}`), '', `Move check: passed. Checks: ${summary}`].join('\n');
		const sha = await commit(worktree, [fix.file, ...newFiles],
			`my_editor: split into ${newFiles.length} file${newFiles.length === 1 ? '' : 's'} (${fix.file})`, body);
		const notes = oversizeNotes(result, info, plan);
		return { file: fix.file, kind: 'split', status: 'committed', commit: sha, moved, checks: summary, notes, plan: { attempts: asked, rejected } };
	} catch (error) {
		await restore(worktree, newFiles);
		return done('skipped', error instanceof Error ? error.message : String(error));
	}
}

interface SplitFacts {
	readonly source: Buffer;
	readonly info: FileInfo;
	readonly plan: SplitPlan;
	readonly unitBefore: readonly FileInfo[];
	readonly formatted: boolean;
}

/** Move rules 1–5 and the formatter, on the files as written. */
async function checkSplit(ctx: StepContext, file: string, newFiles: readonly string[], facts: SplitFacts): Promise<string[]> {
	const { adapter, worktree } = ctx;
	const read = async (name: string) => ({ text: readFileSync(path.join(worktree, name)), info: await adapter.parse(name) });
	const after = await read(file);
	const files = await Promise.all(newFiles.map(read));
	const unitAfter = await Promise.all((await adapter.unitFiles(file)).map(name => adapter.parse(name)));
	const problems = [
		...checkMove({
			before: { text: facts.source, info: facts.info }, after, files, plan: facts.plan, header: adapter.splitHeader(file),
			importProblems: adapter.importProblems, blankLines: adapter.blankLines,
		}),
		...adapter.sameDeclarations(facts.unitBefore, unitAfter),
	];
	const other = (await changedFiles(worktree)).filter(name => name !== file);
	if (other.length) { problems.push(`Rule 5: other tracked files changed: ${other.join(', ')}.`); }
	if (facts.formatted) {
		const unformatted = await adapter.unformatted([file, ...newFiles]);
		if (unformatted.length) { problems.push(`The formatter would change ${unformatted.join(', ')}.`); }
	}
	return problems;
}

/** Top-level test names from test keys (`<package> <Test>/<subtest>`). */
function topLevel(keys: readonly string[]): string[] {
	return [...new Set(keys.map(key => key.slice(key.indexOf(' ') + 1).split('/')[0]))];
}

/**
 * One add-tests fix: the model writes the adapter's test file (one retry with the error shown); it must build, pass
 * twice, not touch the network, and change nothing else. Failing tests are dropped with a note.
 */
export async function runAddTests(ctx: StepContext, fix: FixChoice): Promise<StepOutcome> {
	const { adapter, worktree } = ctx;
	const testFile = adapter.testFileName(fix.file);
	const abs = (file: string) => path.join(worktree, file);
	const done = (status: StepRecord['status'], reason: string): StepRecord => ({ file: fix.file, kind: 'tests', status, reason, testFile });
	const info = await adapter.parse(fix.file);
	if (info.skip) { return done('skipped', `No tests added: ${info.skip}.`); }
	if (existsSync(abs(testFile))) { return done('skipped', `${testFile} already exists.`); }
	const prompt = adapter.testPrompt(fix.file, readFileSync(abs(fix.file), 'utf8'), info);
	let feedback = '';
	for (let attempt = 0; attempt < 2; attempt++) {
		ctx.progress(`Writing tests for ${fix.file}…`);
		const reply = await ctx.ask(prompt.system,
			feedback ? `${prompt.text}\n\nYour previous file failed:\n${feedback.slice(0, 6_000)}\n\nReply with a corrected file.` : prompt.text);
		if (ctx.cancelled()) { return 'stopped'; }
		const code = fileFromReply(reply);
		if (!code) { feedback = `The reply had no ${adapter.codeFence ? `\`\`\`${adapter.codeFence} ` : ''}code block.`; continue; }
		writeFileSync(abs(testFile), code.endsWith('\n') ? code : `${code}\n`);
		// Until the commit lands, a throw anywhere (a check, git) must not leave the test file behind.
		let committed = false;
		try {
			const outcome = await checkNewTests(ctx, fix.file, testFile, info);
			if (outcome === 'stopped' || typeof outcome === 'string') {
				await restore(worktree, [testFile]);
				if (outcome === 'stopped') { return 'stopped'; }
				feedback = outcome;
				continue;
			}
			const summary = checkSummary(outcome.results, ctx.flaky, ctx.baseline);
			const dropped = outcome.dropped.length ? `\nDropped failing tests: ${outcome.dropped.join(', ')}` : '';
			const body = `Adds ${testFile}; no source file changed.\n\nChecks: ${summary}${dropped}`;
			const sha = await commit(worktree, [testFile], `my_editor: add tests for ${path.posix.basename(fix.file)} (${fix.file})`, body);
			committed = true;
			return { file: fix.file, kind: 'tests', status: 'committed', commit: sha, testFile, dropped: outcome.dropped, checks: summary };
		} finally {
			if (!committed) {
				// Unstages a file a failed commit left staged, then deletes it.
				try { await restore(worktree, [testFile]); } catch { rmSync(abs(testFile), { force: true }); }
			}
		}
	}
	return done('skipped', `The tests did not work: ${feedback.split('\n')[0]}`);
}

/** Checks a written test file; returns the passing result, a failure to show the model, or 'stopped'. */
async function checkNewTests(ctx: StepContext, file: string, testFile: string, source: FileInfo):
	Promise<string | 'stopped' | { results: CheckResult[]; dropped: string[] }> {
	const { adapter, worktree } = ctx;
	let testInfo: FileInfo;
	try { testInfo = await adapter.parse(testFile); } catch (error) { return error instanceof Error ? error.message : String(error); }
	const problems = adapter.testProblems(readFileSync(path.join(worktree, testFile), 'utf8'), testInfo, source);
	if (problems.length) { return `The test file was refused: ${problems.join('; ')}.`; }
	const dropped: string[] = [];
	for (let round = 0; round < 2; round++) {
		const names = adapter.testNames(testInfo);
		if (!names.length) { return 'No test passed.'; }
		const first = await runChecks(ctx, file, names);
		if (first.stopped) { return 'stopped'; }
		if (first.problems.length) { return first.problems.join('\n'); }
		const second = await runChecks(ctx, file, names, 'test');
		if (second.stopped) { return 'stopped'; }
		if (second.problems.length) { return second.problems.join('\n'); }
		const testRun = (outcome: ChecksOutcome) => [...outcome.results].reverse().find(result => result.tests)?.tests;
		const failing = [...new Set([...topLevel([...first.newFailing, ...second.newFailing]),
			...unverified(names, testRun(first)), ...unverified(names, testRun(second))])];
		const other = await changedFiles(worktree);
		if (other.length) { return `Running the tests changed tracked files: ${other.join(', ')}.`; }
		if (!failing.length) { return { results: [...first.results, ...second.results], dropped }; }
		dropped.push(...failing);
		const ids = testInfo.declarations.filter(d => failing.includes(d.names[0])).map(d => d.id);
		const text = readFileSync(path.join(worktree, testFile));
		const kept = adapter.buildSplit(text, testInfo, [{ file: `dropped${adapter.extensions[0]}`, declarations: ids }]).original;
		writeFileSync(path.join(worktree, testFile), kept);
		testInfo = await adapter.parse(testFile);
	}
	return `Tests kept failing after dropping ${dropped.join(', ')}.`;
}
