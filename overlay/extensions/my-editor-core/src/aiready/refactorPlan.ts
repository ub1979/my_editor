import type { ExtractChunk } from './language';

/** More helpers than this in one plan is not a refactor anyone can review. */
const MAX_HELPERS = 12;

/** A helper name the core accepts; the language checks the rest (Go: unexported, fresh, not a keyword). */
const NAME = /^[a-z][A-Za-z0-9_]*$/;

/** The first JSON array of {"name", "from", "to"} in a reply; undefined when there is none. */
export function parseChunks(reply: string): ExtractChunk[] | undefined {
	const start = reply.indexOf('[');
	const end = reply.lastIndexOf(']');
	if (start < 0 || end <= start) { return undefined; }
	try {
		const value: unknown = JSON.parse(reply.slice(start, end + 1));
		if (!Array.isArray(value)) { return undefined; }
		return value.map(item => {
			const chunk = item as { name?: unknown; from?: unknown; to?: unknown };
			if (typeof chunk.name !== 'string' || !Number.isInteger(chunk.from) || !Number.isInteger(chunk.to)) { throw new Error('bad chunk'); }
			return { name: chunk.name, from: chunk.from as number, to: chunk.to as number };
		});
	} catch {
		return undefined;
	}
}

/** Problems the core can see without the language: names, ranges, overlaps; at most 12 helpers. */
export function chunkShapeProblems(chunks: readonly ExtractChunk[]): string[] {
	if (!chunks.length) { return ['The plan names no helper.']; }
	const problems = chunks.length > MAX_HELPERS ? [`At most ${MAX_HELPERS} helpers per plan.`] : [];
	for (const chunk of chunks) {
		if (!NAME.test(chunk.name)) {
			problems.push(`${JSON.stringify(chunk.name).slice(0, 60)} must start with a lower-case letter and use only letters, digits and underscores.`);
		}
		if (chunk.from > chunk.to) { problems.push(`${chunk.name}: from ${chunk.from} is after to ${chunk.to}.`); }
	}
	const ordered = chunks.filter(chunk => chunk.from <= chunk.to).sort((a, b) => a.from - b.from);
	for (const [i, a] of ordered.entries()) {
		for (const b of ordered.slice(i + 1).filter(later => later.from <= a.to)) {
			problems.push(`${a.name} (${a.from}–${a.to}) overlaps ${b.name} (${b.from}–${b.to}).`);
		}
	}
	const names = chunks.map(chunk => chunk.name);
	for (const name of new Set(names.filter((name, i) => names.indexOf(name) !== i))) { problems.push(`${name} is named twice.`); }
	return problems;
}
