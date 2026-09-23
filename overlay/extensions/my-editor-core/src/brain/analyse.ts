import { createHash } from 'crypto';
import * as vscode from 'vscode';
import type { Sink } from '../chat/engine';
import { Proposals } from '../chat/proposals';
import { loadCatalog, pickDefault, pickQuickModel } from '../models/catalog';
import { ApiKeys } from '../models/secrets';
import { streamModel } from '../models/stream';
import { ModelEntry } from '../models/types';
import { parseTree } from '../project/stubs';
import { redact } from '../records/redact';
import { isSensitiveFile } from '../records/sensitive';
import {
	anchorFor, batchFiles, coverageLines, ensureSections, FilePiece, firstParagraph, groupByModule, moduleNote, parseSummaries, projectOutline,
	SourceFile, splitAtDefinitions, treeFromFiles,
} from './analysisPlan';
import { buildBrain, describeEntry, describeProject, FileSummary, MAX_FILES, readText, saveSummaries, writeBrainNote } from './brain';

/** Files summarised per run; the most-used first. Running Analyse again continues with the rest. */
const MAX_SUMMARISED = 1_500;
/** A file longer than one request's share is summarised piece by piece, then as a whole. */
const PIECE_CHARS = 10_000;
const MAX_PIECES = 30;
const PARALLEL = 3;
const BATCH_TIMEOUT_MS = 180_000;
const ARCHITECTURE = '.my_editor/specs/architecture.md';
const TREE = '.my_editor/specs/tree.json';

const SUMMARY_SYSTEM = `You summarise source files for a project map. For each item you are given, write one plain sentence
(at most 25 words) saying what it is responsible for, as a teammate would explain it. An item named like "path#3" is one
piece of a longer file: summarise what that piece does. No Markdown, no code.
Reply with only a JSON object mapping each item name exactly as given to its sentence.`;

const COMBINE_SYSTEM = `You are given, for each source file, one-line summaries of its pieces in order. Write one plain sentence
(at most 25 words) saying what the whole file is responsible for. No Markdown, no code.
Reply with only a JSON object mapping each file path exactly as given to its sentence.`;

const PART_SYSTEM = `You are given the parts of a software project, each with its files and one-line summaries. For each part write
two or three plain sentences: what the part is for and how it is organised. No Markdown, no code.
Reply with only a JSON object mapping each part name exactly as given to its sentences.`;
const ARCHITECTURE_SYSTEM = `You write the architecture document of an existing project from an outline of its files. Describe what
the code shows; where something is unclear, say so under "Open questions" instead of guessing. Write Markdown:
- "# <project name>", then one short paragraph: what the project is and who it seems to be for.
- "## Stack": languages, frameworks and tools visible in the files.
- One section per part in the outline, using exactly the heading anchor given there, e.g. "## API client {#src-api}".
  Say what the part does, its main files and how it connects to the other parts. Merge nothing, skip nothing.
- "## How it fits together": the main flow through the parts, in a few sentences.
- "## Decisions": design choices visible in the code, each with why it was probably made.
- "## Open questions": what a newcomer cannot tell from the code.
Keep it short: a few sentences per section. Reply with only the document.`;

/** Asks one model and returns its whole reply, giving up after a while so one stuck request cannot stall the run. */
async function ask(entry: ModelEntry, keys: ApiKeys, system: string, text: string, token: vscode.CancellationToken, timeoutMs: number): Promise<string> {
	const source = new vscode.CancellationTokenSource();
	const cancel = token.onCancellationRequested(() => source.cancel());
	const timer = setTimeout(() => source.cancel(), timeoutMs);
	let reply = '';
	try {
		await streamModel(entry, keys, { system, turns: [{ role: 'user', text }], token: source.token, onText: chunk => reply += chunk });
	} finally {
		clearTimeout(timer);
		cancel.dispose();
		source.dispose();
	}
	return reply;
}

function hashOf(text: string): string {
	return createHash('sha1').update(text).digest('hex').slice(0, 12);
}

function plural(n: number, word: string): string {
	return `${n.toLocaleString('en')} ${word}${n === 1 ? '' : 's'}`;
}

/**
 * Sends items to the model in batches, a few at a time, and collects one summary per item.
 * Items the model did not answer for are simply missing from the result.
 */
async function summarise(
	items: readonly SourceFile[], system: string, model: ModelEntry, keys: ApiKeys, token: vscode.CancellationToken,
	onBatch: (done: number) => void, maxChars = 200,
): Promise<Record<string, string>> {
	const found: Record<string, string> = {};
	let done = 0;
	const pass = async (batches: SourceFile[][]) => {
		let next = 0;
		const worker = async () => {
			while (next < batches.length && !token.isCancellationRequested) {
				const batch = batches[next++];
				const names = batch.map(f => f.path);
				// Naming the keys matters: given one file, models otherwise summarise each function in it.
				const text = `${batch.map(f => `=== ${f.path} ===\n${f.text}`).join('\n\n')}\n\nReply with a JSON object with exactly these keys: ${JSON.stringify(names)}`;
				try {
					Object.assign(found, parseSummaries(await ask(model, keys, system, text, token, BATCH_TIMEOUT_MS), names, maxChars));
				} catch {
					// Retried once below, then counted as missing by the caller.
				}
				done += batch.length;
				onBatch(Math.min(done, items.length));
			}
		};
		await Promise.all(Array.from({ length: Math.min(PARALLEL, batches.length) }, worker));
	};
	await pass(batchFiles(items));
	const missing = items.filter(item => !found[item.path]);
	if (missing.length && !token.isCancellationRequested) {
		done = items.length - missing.length;
		await pass(batchFiles(missing));
	}
	return found;
}

/**
 * "Analyse this project": builds the brain from the code, summarises every file (long files piece by piece),
 * then each part, writes a note per part, and proposes an architecture document and a file map to keep.
 * Only `.my_editor/brain/` is written directly (the user asked for it); the code is never touched.
 * Files whose summary is still current are skipped, so running it again continues where it stopped.
 */
export async function analyseProject(keys: ApiKeys, proposals: Proposals, sink: Sink, token: vscode.CancellationToken): Promise<void> {
	const folder = vscode.workspace.workspaceFolders?.[0];
	if (!folder) {
		sink.error('Open a project first.');
		return;
	}
	sink.progress('Reading the code…');
	const built = await buildBrain();
	const paths = Object.keys(built?.files ?? {});
	if (!built || !paths.length) {
		sink.text('I could not find any code files here yet, so there is nothing to analyse. Start with **Requirements** instead.');
		return;
	}

	const catalog = await loadCatalog(keys);
	const quick = pickQuickModel(catalog, vscode.workspace.getConfiguration('myEditor').get<string>('navigator.model'));
	const main = pickDefault(catalog);
	if (!quick || !main) {
		sink.error('No model is set up yet. Choose one with "my_editor: Choose Model", then try again.');
		return;
	}

	// Which files need a summary: new or changed since the last analysis, most-used first, secrets never sent.
	const secretFiles = paths.filter(path => isSensitiveFile(path)).length;
	const stale: { path: string; text: string; hash: string }[] = [];
	for (const path of paths.filter(p => !isSensitiveFile(p))) {
		const raw = await readText(vscode.Uri.joinPath(folder.uri, path));
		if (!raw?.trim()) {
			continue;
		}
		const hash = hashOf(raw);
		if (built.files[path].summaryHash !== hash || !built.files[path].summary) {
			stale.push({ path, text: redact(raw), hash });
		}
	}
	stale.sort((a, b) => built.files[b.path].importedBy.length - built.files[a.path].importedBy.length || a.path.localeCompare(b.path));
	const todo = stale.slice(0, MAX_SUMMARISED);
	const upToDate = paths.length - secretFiles - stale.length;

	// Short files go whole; long files go as pieces cut between definitions.
	const items: SourceFile[] = [];
	const piecesOf = new Map<string, FilePiece[]>();
	const partlyRead: string[] = [];
	for (const file of todo) {
		if (file.text.length <= PIECE_CHARS) {
			items.push({ path: file.path, text: file.text });
			continue;
		}
		const { pieces, complete } = splitAtDefinitions(file.text, PIECE_CHARS, MAX_PIECES);
		piecesOf.set(file.path, pieces);
		if (!complete) {
			partlyRead.push(file.path);
		}
		pieces.forEach((piece, i) => items.push({ path: `${file.path}#${i + 1}`, text: `(lines ${piece.start}–${piece.end})\n${piece.text}` }));
	}
	const pieceNote = piecesOf.size ? ` (${plural(piecesOf.size, 'long file')} in ${plural(items.length - (todo.length - piecesOf.size), 'piece')})` : '';
	sink.progress(todo.length ? `Summarising ${plural(todo.length, 'file')}${pieceNote} with ${quick.label}…` : 'Every file summary is up to date…');
	const found = await summarise(items, SUMMARY_SYSTEM, quick, keys, token, done => sink.progress(`Summarised ${done} of ${items.length}…`));

	// Long files: combine their pieces into one line for the whole file.
	const combineItems: SourceFile[] = [];
	for (const [path, pieces] of piecesOf) {
		const lines = pieces.map((p, i) => found[`${path}#${i + 1}`] ? `Lines ${p.start}–${p.end}: ${found[`${path}#${i + 1}`]}` : '').filter(Boolean);
		if (lines.length) {
			combineItems.push({ path, text: lines.join('\n') });
		}
	}
	const combined = combineItems.length && !token.isCancellationRequested
		? await summarise(combineItems, COMBINE_SYSTEM, quick, keys, token, () => sink.progress('Putting the long files together…'))
		: {};
	const summaries: Record<string, FileSummary> = {};
	for (const file of todo) {
		const pieces = piecesOf.get(file.path);
		if (!pieces) {
			if (found[file.path]) {
				summaries[file.path] = { summary: found[file.path], hash: file.hash };
			}
			continue;
		}
		const pieceSummaries = pieces.flatMap((p, i) => found[`${file.path}#${i + 1}`] ? [{ start: p.start, end: p.end, summary: found[`${file.path}#${i + 1}`] }] : []);
		const whole = combined[file.path];
		if (whole) {
			summaries[file.path] = { summary: whole, hash: file.hash, pieces: pieceSummaries };
		}
	}
	const failed = todo.length - Object.keys(summaries).length;
	let map = await saveSummaries(summaries) ?? built;
	if (token.isCancellationRequested) {
		sink.text(`Stopped. I summarised ${plural(Object.keys(summaries).length, 'file')} and kept them. Run **Analyse** again to continue from here.`);
		sink.action('Continue', 'myEditor.analyseProject', []);
		return;
	}

	// A few sentences per part: for parts with new file summaries, or none yet.
	const groups = groupByModule(paths);
	const partItems: SourceFile[] = [...groups]
		.filter(([module, files]) => !map.modules?.[module] || files.some(f => summaries[f]))
		.map(([module, files]) => ({ path: module, text: files.map(f => `- ${f}${describeEntry(map.files[f]) ? `: ${describeEntry(map.files[f])}` : ''}`).join('\n') }));
	if (partItems.length) {
		sink.progress(`Summarising ${plural(partItems.length, 'part')} of the project…`);
		const parts = await summarise(partItems, PART_SYSTEM, quick, keys, token, () => undefined, 500);
		map = await saveSummaries({}, parts) ?? map;
	}

	// A note per part of the project.
	sink.progress('Writing a note for each part…');
	for (const [module, files] of groups) {
		await writeBrainNote(`modules/${anchorFor(module)}.md`, module === '.' ? 'Top-level files' : module, moduleNote(module, files, map.files, map.modules?.[module]));
	}

	const gaps = coverageLines({
		tooLarge: built.tooLarge ?? [], fileLimitHit: !!built.fileLimitHit, secretFiles, inPieces: piecesOf.size, partlyRead,
		leftForLater: stale.length - todo.length, failed,
	}, MAX_FILES);

	// Architecture and file map: proposals the user keeps or undoes.
	const architectureUri = vscode.Uri.joinPath(folder.uri, ARCHITECTURE);
	const existing = await readText(architectureUri);
	// On a re-run, only parts with changed files (or no section yet) are rewritten; the rest stays word for word.
	const changedParts = [...groups.keys()].filter(module =>
		groups.get(module)!.some(f => summaries[f]) || !existing?.includes(`{#${anchorFor(module)}}`));
	let architecture = '';
	if (!existing || changedParts.length) {
		sink.progress(`${existing ? 'Updating' : 'Drafting'} the architecture with ${main.label}…`);
		const request = [
			`Project: ${folder.name}`,
			'',
			'Outline (parts, their anchors, files and one-line summaries):',
			projectOutline(map.files, 40_000, map.modules),
			existing ? [
				'\nThe current architecture document follows. It may contain the user\'s own words.',
				`Only these parts changed: ${changedParts.join(', ')}. Update their sections, and anything elsewhere that is now`,
				'wrong because of them. Keep every other sentence exactly as it is.\n',
				existing,
			].join('\n') : '',
		].join('\n');
		try {
			architecture = (await ask(main, keys, ARCHITECTURE_SYSTEM, request, token, 300_000)).trim();
		} catch (err) {
			sink.error(`The architecture draft failed: ${err instanceof Error ? err.message : String(err)}`);
		}
	}
	architecture = architecture.replace(/^```(?:markdown|md)?\n([\s\S]*?)\n```$/, '$1');
	if (token.isCancellationRequested) {
		return;
	}
	if (architecture) {
		const doc = ensureSections(architecture, groups);
		if (doc.trim() !== existing?.trim()) {
			sink.proposal(await proposals.propose(architectureUri, doc.endsWith('\n') ? doc : `${doc}\n`));
		}
		const overview = firstParagraph(doc);
		if (overview) {
			await describeProject(overview);
		}
	}
	const treeUri = vscode.Uri.joinPath(folder.uri, TREE);
	const treeText = await readText(treeUri);
	let previous: ReturnType<typeof parseTree> = [];
	try {
		previous = treeText ? parseTree(treeText) : [];
	} catch {
		previous = [];
	}
	const roles = Object.fromEntries(paths.map(path => [path, describeEntry(map.files[path]) || undefined]));
	const tree = `${JSON.stringify(treeFromFiles(roles, previous.map(f => ({ ...f, section: f.section ?? '', status: f.status ?? 'planned' }))), null, 2)}\n`;
	if (tree !== treeText) {
		sink.proposal(await proposals.propose(treeUri, tree));
	}

	const summarised = Object.keys(summaries).length;
	const written = [
		'- **Brain**: written to `.my_editor/brain/`. It has the map with a line per file, a few sentences per part, the index, and a note per part.',
		...(architecture ? [`- **Architecture**: ${existing ? `updated for ${plural(changedParts.length, 'changed part')}` : 'a draft from the code'}. Open it below, fix what is wrong, then Keep.`]
			: existing && !changedParts.length ? ['- **Architecture**: no part changed, so I left it as it is.'] : []),
		...(tree !== treeText ? ['- **File map**: every file linked to its part. Keep it to track progress.'] : []),
	];
	sink.text([
		`I read **${plural(paths.length, 'file')}** in **${plural(groups.size, 'part')}** and summarised ${plural(summarised, 'file')}`
			+ `${upToDate > 0 ? `; ${plural(upToDate, 'file')} had not changed since last time` : ''}.`,
		written.join('\n'),
		...(gaps.length ? [`What I could not cover fully:\n\n${gaps.join('\n')}`] : []),
		'From now on I keep up to date as you save. Ask me anything about the project, or pick a skill.',
	].join('\n\n'));
	if (stale.length > todo.length || failed) {
		sink.action('Continue analysing', 'myEditor.analyseProject', []);
	}
}
