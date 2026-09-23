/** Pure planning for "Analyse this project": batching, parsing model output, grouping and the file map. */

export interface SourceFile {
	readonly path: string;
	readonly text: string;
}

/** One item's share of a request: a whole short file, or one piece of a long one plus its header. */
const MAX_FILE_CHARS = 10_200;

/** Groups files into batches small enough for one request; long files contribute only their beginning. */
export function batchFiles(files: readonly SourceFile[], budgetChars = 40_000, maxPerBatch = 12): SourceFile[][] {
	const batches: SourceFile[][] = [];
	let current: SourceFile[] = [];
	let used = 0;
	for (const file of files) {
		const clipped = { path: file.path, text: file.text.slice(0, MAX_FILE_CHARS) };
		if (current.length && (used + clipped.text.length > budgetChars || current.length >= maxPerBatch)) {
			batches.push(current);
			current = [];
			used = 0;
		}
		current.push(clipped);
		used += clipped.text.length;
	}
	if (current.length) {
		batches.push(current);
	}
	return batches;
}

/**
 * Reads `{ "path": "one line" }` from a model reply. Only paths that were asked about are kept; each summary
 * becomes one short line, so a reply cannot inject anything else into the brain.
 */
export function parseSummaries(reply: string, askedPaths: readonly string[], maxChars = 200): Record<string, string> {
	const start = reply.indexOf('{');
	const end = reply.lastIndexOf('}');
	if (start < 0 || end <= start) {
		return {};
	}
	let raw: unknown;
	try {
		raw = JSON.parse(reply.slice(start, end + 1));
	} catch {
		return {};
	}
	if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
		return {};
	}
	const asked = new Set(askedPaths);
	const out: Record<string, string> = {};
	for (const [path, value] of Object.entries(raw as Record<string, unknown>)) {
		if (asked.has(path) && typeof value === 'string') {
			const line = value.replace(/\s+/g, ' ').trim().slice(0, maxChars);
			if (line) {
				out[path] = line;
			}
		}
	}
	return out;
}

/** The part of the project a file belongs to: its top folder, or two levels for `src/`-style roots. */
export function moduleOf(path: string): string {
	const parts = path.split('/');
	if (parts.length === 1) {
		return '.';
	}
	return ['src', 'lib', 'app', 'packages', 'internal', 'pkg', 'cmd'].includes(parts[0]) && parts.length > 2
		? `${parts[0]}/${parts[1]}`
		: parts[0];
}

/** A stable anchor for a module's architecture section, e.g. `src/api` → `src-api`, `.` → `root`. */
export function anchorFor(module: string): string {
	return module === '.' ? 'root' : module.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'root';
}

export function groupByModule(paths: readonly string[]): Map<string, string[]> {
	const groups = new Map<string, string[]>();
	for (const path of [...paths].sort()) {
		const module = moduleOf(path);
		groups.set(module, [...(groups.get(module) ?? []), path]);
	}
	return groups;
}

export interface TreeEntry {
	path: string;
	role?: string;
	section: string;
	status: string;
	requirements?: string[];
}

/**
 * The file map for an existing project: every file as done, linked to its module's architecture section.
 * Entries already in the tree keep their status, requirements and role.
 */
export function treeFromFiles(files: Readonly<Record<string, string | undefined>>, existing: readonly TreeEntry[] = []): TreeEntry[] {
	const byPath = new Map(existing.map(entry => [entry.path, entry]));
	const merged: TreeEntry[] = Object.keys(files).sort().map(path => {
		const previous = byPath.get(path);
		return previous
			? { ...previous, role: previous.role ?? files[path], section: previous.section || anchorFor(moduleOf(path)) }
			: { path, ...(files[path] ? { role: files[path] } : {}), section: anchorFor(moduleOf(path)), status: 'done' };
	});
	const known = new Set(Object.keys(files));
	// Planned files that do not exist yet stay in the tree.
	return [...merged, ...existing.filter(entry => !known.has(entry.path))];
}

/** What the notes and the outline need from a brain map entry. */
export interface FileInfo {
	readonly lines: number;
	readonly imports: readonly string[];
	readonly importedBy: readonly string[];
	readonly exports: readonly string[];
	readonly note?: string;
	readonly role?: string;
	readonly summary?: string;
}

function describe(info: FileInfo | undefined): string {
	return info?.note ?? info?.summary ?? info?.role ?? '';
}

/** Which other parts a set of files uses (by import count), most used first. */
function partsLinked(paths: readonly string[], files: Readonly<Record<string, FileInfo>>, direction: 'imports' | 'importedBy'): [string, number][] {
	const own = new Set(paths);
	const counts = new Map<string, number>();
	for (const path of paths) {
		for (const other of files[path]?.[direction] ?? []) {
			if (!own.has(other)) {
				const module = moduleOf(other);
				counts.set(module, (counts.get(module) ?? 0) + 1);
			}
		}
	}
	return [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
}

/** The generated part of `brain/modules/<anchor>.md`: every file with its summary, and what the part uses and serves. */
export function moduleNote(module: string, paths: readonly string[], files: Readonly<Record<string, FileInfo>>, summary?: string): string {
	const lines = paths.reduce((n, p) => n + (files[p]?.lines ?? 0), 0);
	const out = [
		`Part \`${module}\` · ${paths.length} file${paths.length === 1 ? '' : 's'} · ${lines} lines · architecture section #${anchorFor(module)}`,
		'',
		...(summary ? [summary, ''] : []),
		'## Files',
		'',
		...paths.map(path => {
			const info = files[path];
			const exports = info?.exports.length ? ` Exports: ${info.exports.slice(0, 8).join(', ')}${info.exports.length > 8 ? ', …' : ''}.` : '';
			const what = describe(info);
			return `- \`${path}\`${what ? ` — ${what}` : ''}${exports}`;
		}),
	];
	const uses = partsLinked(paths, files, 'imports');
	const usedBy = partsLinked(paths, files, 'importedBy');
	if (uses.length) {
		out.push('', '## Uses', '', ...uses.map(([m, n]) => `- \`${m}\` (${n} import${n === 1 ? '' : 's'})`));
	}
	if (usedBy.length) {
		out.push('', '## Used by', '', ...usedBy.map(([m, n]) => `- \`${m}\` (${n} import${n === 1 ? '' : 's'})`));
	}
	return out.join('\n');
}

/** A compact outline of the whole project for the architecture draft, bounded so any project fits one request. */
export function projectOutline(files: Readonly<Record<string, FileInfo>>, budgetChars = 40_000, parts: Readonly<Record<string, string>> = {}): string {
	const groups = groupByModule(Object.keys(files));
	// Big projects: fewer files listed per part, most-used files first.
	const perPart = Math.max(3, Math.floor(budgetChars / 140 / Math.max(1, groups.size)));
	const sections: string[] = [];
	for (const [module, paths] of groups) {
		const ranked = [...paths].sort((a, b) => (files[b]?.importedBy.length ?? 0) - (files[a]?.importedBy.length ?? 0) || a.localeCompare(b));
		const shown = ranked.slice(0, perPart).sort();
		const uses = partsLinked(paths, files, 'imports').map(([m]) => m);
		sections.push([
			`### ${module} {#${anchorFor(module)}} — ${paths.length} file${paths.length === 1 ? '' : 's'}${uses.length ? `; uses ${uses.slice(0, 6).join(', ')}` : ''}`,
			...(parts[module] ? [parts[module]] : []),
			...shown.map(path => `- ${path}${describe(files[path]) ? ` — ${describe(files[path])}` : ''}`),
			...(paths.length > shown.length ? [`- … and ${paths.length - shown.length} more`] : []),
		].join('\n'));
	}
	const text = sections.join('\n\n');
	return text.length > budgetChars ? `${text.slice(0, budgetChars)}\n…` : text;
}

/** Adds a plain section for every part the draft left out, so each file's `section` points at a real heading. */
export function ensureSections(doc: string, modules: ReadonlyMap<string, readonly string[]>): string {
	const present = new Set([...doc.matchAll(/^#{1,6} .*\{#([\w-]+)\}\s*$/gm)].map(m => m[1]));
	const missing = [...modules].filter(([module]) => !present.has(anchorFor(module)));
	if (!missing.length) {
		return doc;
	}
	const added = missing.map(([module, paths]) =>
		`## ${module === '.' ? 'Top-level files' : module} {#${anchorFor(module)}}\n\nFiles: ${paths.slice(0, 12).map(p => `\`${p}\``).join(', ')}${paths.length > 12 ? ', …' : ''}.`);
	return `${doc.trimEnd()}\n\n${added.join('\n\n')}\n`;
}

/** The first sentence of the first plain paragraph of a Markdown document (the draft's overview), cut at a word. */
export function firstParagraph(doc: string, maxChars = 200): string | undefined {
	const paragraph = doc.split(/\n\s*\n/).map(p => p.trim()).find(p => p && !/^(#|[-*>|]|```|<)/.test(p));
	if (!paragraph) {
		return undefined;
	}
	const flat = paragraph.replace(/\s+/g, ' ');
	const end = flat.search(/[.!?](\s|$)/);
	const sentence = end >= 0 ? flat.slice(0, end + 1) : flat;
	return sentence.length <= maxChars ? sentence : `${sentence.slice(0, maxChars).replace(/\s+\S*$/, '')}…`;
}

/** One piece of a long file, cut where a top-level definition starts. Lines are 1-based and inclusive. */
export interface FilePiece {
	readonly start: number;
	readonly end: number;
	readonly text: string;
}

/** A top-level line that starts something new: not indented, not a closing bracket, after a blank line or comment. */
function isBoundary(lines: readonly string[], i: number): boolean {
	const line = lines[i];
	if (!line || /^\s/.test(line) || /^[})\]]/.test(line)) {
		return false;
	}
	const previous = lines[i - 1] ?? '';
	return !previous.trim() || /^\s*(\/\/|#|\*|\/\*|\*\/|""")/.test(previous) || /^[})\]];?\s*$/.test(previous);
}

/**
 * Splits a long file into pieces of at most `maxChars`, cutting between top-level definitions where it can, so
 * each piece can be summarised on its own. Stops after `maxParts`; `complete` says whether the whole file fits.
 */
export function splitAtDefinitions(text: string, maxChars = 10_000, maxParts = 30): { pieces: FilePiece[]; complete: boolean } {
	const lines = text.split('\n');
	const pieces: FilePiece[] = [];
	let start = 0;
	while (start < lines.length && pieces.length < maxParts) {
		let size = 0;
		let end = start;
		let lastBoundary = -1;
		while (end < lines.length && size + lines[end].length + 1 <= maxChars) {
			if (end > start && isBoundary(lines, end)) {
				lastBoundary = end;
			}
			size += lines[end].length + 1;
			end++;
		}
		if (end === start) {
			end = start + 1; // One line longer than a piece: take it alone (clipped).
		} else if (end < lines.length && lastBoundary > start + (end - start) / 3) {
			end = lastBoundary; // Cut before the last definition that fits, unless that leaves a tiny piece.
		}
		pieces.push({ start: start + 1, end, text: lines.slice(start, end).join('\n').slice(0, maxChars) });
		start = end;
	}
	return { pieces, complete: start >= lines.length };
}

/** What an analysis could not fully cover; every part of it is said out loud. */
export interface Coverage {
	/** Files too large to read (likely generated or bundled). */
	readonly tooLarge: readonly string[];
	/** The project has more code files than the brain reads. */
	readonly fileLimitHit: boolean;
	readonly secretFiles: number;
	/** Long files summarised in pieces. */
	readonly inPieces: number;
	/** Files so long that only their beginning was summarised. */
	readonly partlyRead: readonly string[];
	/** Files left for the next run because of the per-run limit. */
	readonly leftForLater: number;
	readonly failed: number;
}

function list(paths: readonly string[], max = 3): string {
	return paths.slice(0, max).map(p => `\`${p}\``).join(', ') + (paths.length > max ? ` and ${paths.length - max} more` : '');
}

/** The report lines for the chat, one per gap; empty when everything was covered. */
export function coverageLines(c: Coverage, maxFiles: number): string[] {
	const n = (count: number, word: string) => `${count.toLocaleString('en')} ${word}${count === 1 ? '' : 's'}`;
	return [
		c.fileLimitHit ? `- **Very big project:** I read the first ${maxFiles.toLocaleString('en')} code files only.` : '',
		c.tooLarge.length ? `- **Too large to read:** ${list(c.tooLarge)} (over 400 KB, usually generated or bundled code).` : '',
		c.leftForLater ? `- **Not summarised yet:** ${n(c.leftForLater, 'file')}. I started with the most-used files. Run Analyse again to continue from here.` : '',
		c.partlyRead.length ? `- **Only partly read:** ${list(c.partlyRead)}. Very long, so only the beginning is summarised.` : '',
		c.failed ? `- **No summary:** ${n(c.failed, 'file')}, because the model did not answer for them. Run Analyse again to retry.` : '',
		c.secretFiles ? `- **Not sent on purpose:** ${n(c.secretFiles, 'file')} that look like secrets or keys.` : '',
		c.inPieces ? `- **Read in pieces:** ${n(c.inPieces, 'long file')}, summarised part by part and then as a whole.` : '',
	].filter(Boolean);
}
