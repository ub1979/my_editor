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
	anchorFor, batchFiles, ensureSections, firstParagraph, groupByModule, moduleNote, parseSummaries, projectOutline, SourceFile, treeFromFiles,
} from './analysisPlan';
import { buildBrain, describeEntry, describeProject, readText, saveSummaries, writeBrainNote } from './brain';

/** Summaries beyond this many files would take too long; the most-used files are summarised first. */
const MAX_SUMMARISED = 1_500;
const PARALLEL = 3;
const BATCH_TIMEOUT_MS = 180_000;
const ARCHITECTURE = '.my_editor/specs/architecture.md';
const TREE = '.my_editor/specs/tree.json';

const SUMMARY_SYSTEM = `You summarise source files for a project map. For each file you are given, write one plain sentence
(at most 25 words) saying what the file is responsible for, as a teammate would explain it. No Markdown, no code.
Reply with only a JSON object mapping each file path exactly as given to its sentence.`;

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

async function readSources(root: vscode.Uri, paths: readonly string[]): Promise<SourceFile[]> {
	const files: SourceFile[] = [];
	for (const path of paths) {
		const text = await readText(vscode.Uri.joinPath(root, path));
		if (text?.trim()) {
			files.push({ path, text: redact(text) });
		}
	}
	return files;
}

function plural(n: number, word: string): string {
	return `${n} ${word}${n === 1 ? '' : 's'}`;
}

/**
 * "Analyse this project": builds the brain from the code, asks a quick model for a one-line summary of every
 * file, writes a note per part, then proposes an architecture document and a file map for the user to keep.
 * Only `.my_editor/brain/` is written directly (the user asked for it); the code is never touched.
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

	// Summaries: most-used files first, secrets never sent.
	const wanted = paths
		.filter(path => !isSensitiveFile(path))
		.sort((a, b) => built.files[b].importedBy.length - built.files[a].importedBy.length || a.localeCompare(b))
		.slice(0, MAX_SUMMARISED);
	const batches = batchFiles(await readSources(folder.uri, wanted));
	const total = batches.reduce((n, b) => n + b.length, 0);
	const summaries: Record<string, string> = {};
	let done = 0;
	let failed = 0;
	let next = 0;
	sink.progress(`Summarising ${plural(total, 'file')} with ${quick.label}…`);
	const worker = async () => {
		while (next < batches.length && !token.isCancellationRequested) {
			const batch = batches[next++];
			const text = batch.map(f => `=== ${f.path} ===\n${f.text}`).join('\n\n');
			try {
				const found = parseSummaries(await ask(quick, keys, SUMMARY_SYSTEM, text, token, BATCH_TIMEOUT_MS), batch.map(f => f.path));
				Object.assign(summaries, found);
				failed += batch.length - Object.keys(found).length;
			} catch {
				failed += batch.length;
			}
			done += batch.length;
			sink.progress(`Summarised ${done} of ${total} files…`);
		}
	};
	await Promise.all(Array.from({ length: Math.min(PARALLEL, batches.length) }, worker));
	const map = await saveSummaries(summaries) ?? built;
	if (token.isCancellationRequested) {
		sink.text(`Stopped. The brain has the code facts for ${plural(paths.length, 'file')} and summaries for ${Object.keys(summaries).length}. Run **Analyse** again to finish.`);
		return;
	}

	// A note per part of the project.
	sink.progress('Writing a note for each part…');
	const groups = groupByModule(paths);
	for (const [module, files] of groups) {
		await writeBrainNote(`modules/${anchorFor(module)}.md`, module === '.' ? 'Top-level files' : module, moduleNote(module, files, map.files));
	}

	// Architecture and file map: proposals the user keeps or undoes.
	sink.progress(`Drafting the architecture with ${main.label}…`);
	const architectureUri = vscode.Uri.joinPath(folder.uri, ARCHITECTURE);
	const existing = await readText(architectureUri);
	const request = [
		`Project: ${folder.name}`,
		'',
		'Outline (parts, their anchors, files and one-line summaries):',
		projectOutline(map.files),
		existing ? `\nThe current architecture document follows. Keep what is still true and the user's own words; update the rest.\n\n${existing}` : '',
	].join('\n');
	let architecture = '';
	try {
		architecture = (await ask(main, keys, ARCHITECTURE_SYSTEM, request, token, 300_000)).trim();
	} catch (err) {
		sink.error(`The architecture draft failed: ${err instanceof Error ? err.message : String(err)}`);
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

	const missed = failed ? ` (${plural(failed, 'file')} got no summary; run Analyse again to retry)` : '';
	const written = [
		'- **Brain**: written to `.my_editor/brain/`. It has the map with a line per file, the index, and a note per part.',
		...(architecture ? ['- **Architecture**: a draft from the code. Open it below, fix what is wrong, then Keep.'] : []),
		...(tree !== treeText ? ['- **File map**: every file linked to its part. Keep it to track progress.'] : []),
	];
	sink.text([
		`I read **${plural(paths.length, 'file')}** in **${plural(groups.size, 'part')}** and summarised ${Object.keys(summaries).length}${missed}.`,
		written.join('\n'),
		'From now on I keep up to date as you save. Ask me anything about the project, or pick a skill.',
	].join('\n\n'));
}
