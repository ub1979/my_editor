/** A changed region of a file, as 1-based line numbers in the new text. */
export interface Hunk {
	readonly start: number;
	readonly end: number;
}

/**
 * Finds the changed line ranges between two versions of a file (a small LCS diff over lines, bounded so
 * very large edits fall back to "everything changed").
 */
export function changedHunks(before: string, after: string, maxCells = 4_000_000): Hunk[] {
	const a = before.split('\n');
	const b = after.split('\n');
	let prefix = 0;
	while (prefix < a.length && prefix < b.length && a[prefix] === b[prefix]) {
		prefix++;
	}
	let suffix = 0;
	while (suffix < a.length - prefix && suffix < b.length - prefix && a[a.length - 1 - suffix] === b[b.length - 1 - suffix]) {
		suffix++;
	}
	const midA = a.slice(prefix, a.length - suffix);
	const midB = b.slice(prefix, b.length - suffix);
	if (!midB.length) {
		return []; // Only deletions: nothing new to look at.
	}
	if (midA.length * midB.length > maxCells) {
		return [{ start: prefix + 1, end: prefix + midB.length }];
	}
	// LCS table over the middle section; mark lines of B that are not part of the LCS as changed.
	const rows = midA.length + 1;
	const cols = midB.length + 1;
	const table = new Uint32Array(rows * cols);
	for (let i = midA.length - 1; i >= 0; i--) {
		for (let j = midB.length - 1; j >= 0; j--) {
			table[i * cols + j] = midA[i] === midB[j]
				? table[(i + 1) * cols + j + 1] + 1
				: Math.max(table[(i + 1) * cols + j], table[i * cols + j + 1]);
		}
	}
	const changed: boolean[] = new Array(midB.length).fill(true);
	for (let i = 0, j = 0; i < midA.length && j < midB.length;) {
		if (midA[i] === midB[j]) {
			changed[j] = false;
			i++;
			j++;
		} else if (table[(i + 1) * cols + j] >= table[i * cols + j + 1]) {
			i++;
		} else {
			j++;
		}
	}
	const hunks: Hunk[] = [];
	changed.forEach((isChanged, j) => {
		if (!isChanged) {
			return;
		}
		const line = prefix + j + 1;
		const last = hunks[hunks.length - 1];
		if (last && last.end >= line - 1) {
			hunks[hunks.length - 1] = { start: last.start, end: line };
		} else {
			hunks.push({ start: line, end: line });
		}
	});
	return hunks;
}

export interface Finding {
	readonly line: number;
	readonly severity: 'warning' | 'info';
	readonly message: string;
}

/** Pulls findings out of a model reply: the first JSON array, validated, at most `limit` items. */
export function parseFindings(reply: string, lineCount: number, limit = 3): Finding[] {
	const start = reply.indexOf('[');
	const end = reply.lastIndexOf(']');
	if (start < 0 || end <= start) {
		return [];
	}
	let raw: unknown;
	try {
		raw = JSON.parse(reply.slice(start, end + 1));
	} catch {
		return [];
	}
	if (!Array.isArray(raw)) {
		return [];
	}
	return raw
		.filter((f): f is { line: unknown; severity?: unknown; message: unknown } => !!f && typeof f === 'object')
		.map(f => ({
			line: Math.min(Math.max(1, Math.round(Number(f.line)) || 1), Math.max(1, lineCount)),
			severity: f.severity === 'warning' ? 'warning' as const : 'info' as const,
			message: String(f.message ?? '').trim().slice(0, 300),
		}))
		.filter(f => f.message)
		.slice(0, limit);
}
