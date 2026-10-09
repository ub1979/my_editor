import { MAX_SOURCE_LINES, sourceLines } from '../quality/sourcePolicy';
import type { Declaration, FileInfo, LanguageAdapter, Prompt, SplitPlan, SplitResult } from './language';

/** The model's split plan from its reply: a JSON array of `{ file, declarations }`, or undefined. */
export function parsePlan(reply: string): SplitPlan | undefined {
	const start = reply.indexOf('[');
	const end = reply.lastIndexOf(']');
	if (start < 0 || end <= start) { return undefined; }
	try {
		const value: unknown = JSON.parse(reply.slice(start, end + 1));
		if (!Array.isArray(value)) { return undefined; }
		const plan = value.map(item => {
			const group = item as { file?: unknown; declarations?: unknown };
			if (typeof group.file !== 'string' || !Array.isArray(group.declarations)
				|| !group.declarations.every(id => Number.isInteger(id))) { throw new Error('bad group'); }
			return { file: group.file, declarations: group.declarations as number[] };
		});
		return plan;
	} catch {
		return undefined;
	}
}

/** Tells the model why its plan was rejected, for its one retry. */
export function retryText(prompt: Prompt, reply: string, problems: readonly string[]): string {
	return `${prompt.text}\n\nYour previous plan:\n${reply.slice(0, 4_000)}\n\nIt was rejected:\n${problems.map(p => `- ${p}`).join('\n')}\n\nReply with a corrected JSON array only.`;
}

export interface PlanInput {
	readonly source: Buffer;
	readonly info: FileInfo;
	/** File names already in the folder. */
	readonly existing: readonly string[];
}

/** Every reason the plan cannot be used; empty means the plan may be applied. */
export function planProblems(adapter: LanguageAdapter, input: PlanInput, plan: SplitPlan): string[] {
	const problems: string[] = [];
	const byId = new Map(input.info.declarations.map(d => [d.id, d]));
	const seen = new Set<number>();
	const names = new Set<string>();
	const existing = new Set(input.existing.map(name => name.toLowerCase()));
	if (!plan.length) { problems.push('The plan moves nothing.'); }
	for (const group of plan) {
		if (!group.declarations.length) { problems.push(`${group.file} has no declarations.`); }
		for (const id of group.declarations) {
			const declaration = byId.get(id);
			if (!declaration) { problems.push(`Declaration ${id} does not exist.`); }
			else if (seen.has(id)) { problems.push(`Declaration ${id} is listed twice.`); }
			else if (!declaration.movable) { problems.push(`Declaration ${id} (${label(declaration)}) may not move: ${declaration.reason ?? 'not movable'}.`); }
			seen.add(id);
		}
		problems.push(...adapter.fileNameProblems(group.file).map(problem => `${group.file}: ${problem}`));
		if (existing.has(group.file.toLowerCase())) { problems.push(`${group.file} already exists in the folder.`); }
		if (names.has(group.file.toLowerCase())) { problems.push(`${group.file} appears twice in the plan.`); }
		names.add(group.file.toLowerCase());
	}
	if (problems.length) { return problems; }
	let result: SplitResult;
	try { result = adapter.buildSplit(input.source, input.info, plan); }
	catch (error) { return [error instanceof Error ? error.message : String(error)]; }
	const moved = new Set(plan.flatMap(group => group.declarations));
	const left = input.info.declarations.filter(d => !moved.has(d.id));
	if (!lineLimitAllowed(result.original, left)) {
		problems.push(`${input.info.path} would still have ${lines(result.original)} lines; the limit is ${MAX_SOURCE_LINES}.`);
	}
	for (const [index, file] of result.files.entries()) {
		const group = plan[index].declarations.map(id => byId.get(id)!);
		if (!lineLimitAllowed(file.text, group)) {
			problems.push(`${file.name} would have ${lines(file.text)} lines; the limit is ${MAX_SOURCE_LINES}.`);
		}
	}
	return problems;
}

/**
 * A file may exceed the limit only when one declaration in it is itself over the limit and nothing else in it could
 * move out: it holds that declaration plus unmovable ones only.
 */
function lineLimitAllowed(text: Buffer, declarations: readonly Declaration[]): boolean {
	if (lines(text) <= MAX_SOURCE_LINES) { return true; }
	const big = declarations.filter(d => d.lines > MAX_SOURCE_LINES);
	return big.length === 1 && declarations.every(d => d === big[0] || !d.movable);
}

/** Files left over the limit by a single long declaration, for the change note. */
export function oversizeNotes(result: SplitResult, info: FileInfo, plan: SplitPlan): string[] {
	const moved = new Set(plan.flatMap(group => group.declarations));
	const notes: string[] = [];
	const note = (name: string, text: Buffer, declarations: readonly Declaration[]) => {
		const big = declarations.find(d => d.lines > MAX_SOURCE_LINES);
		if (lines(text) > MAX_SOURCE_LINES && big) {
			notes.push(`${name} stays at ${lines(text)} lines: ${label(big)} alone is ${big.lines} lines and needs a real refactor.`);
		}
	};
	const byId = new Map(info.declarations.map(d => [d.id, d]));
	note(info.path, result.original, info.declarations.filter(d => !moved.has(d.id)));
	result.files.forEach((file, index) => note(file.name, file.text, plan[index].declarations.map(id => byId.get(id)!)));
	return notes;
}

export function label(declaration: Declaration): string {
	const name = declaration.names.join(', ') || '(unnamed)';
	return declaration.receiver ? `${declaration.kind} (${declaration.receiver}) ${name}` : `${declaration.kind} ${name}`;
}

function lines(text: Buffer): number {
	return sourceLines(text.toString('utf8'));
}
