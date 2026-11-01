import * as vscode from 'vscode';
import type { Sink } from '../chat/engine';
import { Proposals } from '../chat/proposals';
import { loadCatalog, pickDefault } from '../models/catalog';
import { ApiKeys } from '../models/secrets';
import { parseTree } from '../project/stubs';
import {
	anchorFor, coverageLines, ensureSections, firstParagraph, groupByModule, moduleNote, projectOutline,
	SourceFile, treeFromFiles,
} from './analysisPlan';
import { buildBrain, describeEntry, describeProject, MAX_FILES, readText, saveSummaries, writeBrainNote } from './brain';

const ARCHITECTURE = '.my_editor/specs/architecture.md';
const TREE = '.my_editor/specs/tree.json';

export { ask } from './analysisModel';
import { summariseSourceFiles } from './fileSummaries';
import { ask, plural, summarise, PART_SYSTEM, ARCHITECTURE_SYSTEM } from './analysisModel';

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

	// The model picked in the chat does every step: the user chose it, and asked for this analysis.
	const model = pickDefault(await loadCatalog(keys));
	if (!model) {
		sink.error('No model is set up yet. Choose one with "my_editor: Choose Model", then try again.');
		return;
	}

	const result = await summariseSourceFiles(built, paths, folder.uri, model, keys, token, sink);
	const { summaries, upToDate, coverage } = result;
	let { map } = result;
	if (token.isCancellationRequested) {
		sink.text(`Stopped. I summarised ${plural(Object.keys(summaries).length, 'file')} and kept them. Run **Analyse** again to continue from here.`);
		sink.action('Continue', 'myEditor.analyseProject', []);
		return;
	}

	// A few sentences per part: for parts with new file summaries, or none yet.
	const groups = groupByModule(paths);
	const partItems: SourceFile[] = [...groups]
		.filter(([module, files]) => !map.modules?.[module] || files.some(f => summaries[f]))
		.map(([module, files]) => ({ path: module, text: files.map(f => {
			const what = describeEntry(map.files[f]);
			return `- ${f}${what ? `: ${what}` : ''}`;
		}).join('\n') }));
	if (partItems.length) {
		sink.progress(`Summarising ${plural(partItems.length, 'part')} of the project…`);
		const parts = await summarise(partItems, PART_SYSTEM, model, keys, token, () => undefined, 500);
		map = await saveSummaries({}, parts) ?? map;
	}

	// A note per part of the project.
	sink.progress('Writing a note for each part…');
	for (const [module, files] of groups) {
		const title = module === '.' ? 'Top-level files' : module;
		await writeBrainNote(`modules/${anchorFor(module)}.md`, title, moduleNote(module, files, map.files, map.modules?.[module]));
	}

	const gaps = coverageLines({
		tooLarge: built.tooLarge ?? [], fileLimitHit: !!built.fileLimitHit, ...coverage,
	}, MAX_FILES);

	// Architecture and file map: proposals the user keeps or undoes.
	const architectureUri = vscode.Uri.joinPath(folder.uri, ARCHITECTURE);
	const existing = await readText(architectureUri);
	// On a re-run, only parts with changed files (or no section yet) are rewritten; the rest stays word for word.
	const changedParts = [...groups.keys()].filter(module =>
		groups.get(module)!.some(f => summaries[f]) || !existing?.includes(`{#${anchorFor(module)}}`));
	let architecture = '';
	if (!existing || changedParts.length) {
		sink.progress(`${existing ? 'Updating' : 'Drafting'} the architecture with ${model.label}…`);
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
			architecture = (await ask(model, keys, ARCHITECTURE_SYSTEM, request, token, 300_000)).trim();
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
			sink.proposal(await proposals.propose(architectureUri,
				`<!-- my_editor: draft -->\n${doc.replace(/^<!--\s*my_editor:\s*draft\s*-->\s*/, '').trimEnd()}\n`, 'write', true));
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
		sink.proposal(await proposals.propose(treeUri, tree, 'write', true));
	}

	const summarised = Object.keys(summaries).length;
	const written = [
		'- **Brain**: written to `.my_editor/brain/`. It has the map with a line per file, a few sentences per part, the index, and a note per part.',
		...(architecture
			? [`- **Architecture**: ${existing ? `updated for ${plural(changedParts.length, 'changed part')}` : 'a draft from the code'}. `
				+ 'Open it below, fix what is wrong, then Keep.']
			: existing && !changedParts.length ? ['- **Architecture**: no part changed, so I left it as it is.'] : []),
		...(tree !== treeText ? ['- **File map**: every file linked to its part. Keep it to track progress.'] : []),
	];
	sink.text([
		`I read **${plural(paths.length, 'file')}** in **${plural(groups.size, 'part')}** and summarised ${plural(summarised, 'file')}`
			+ `${upToDate > 0 ? `; ${plural(upToDate, 'file')} had not changed since last time` : ''}.`,
		written.join('\n'),
		...(gaps.length ? [`What I could not cover fully:\n\n${gaps.join('\n')}`] : []),
		'From now on I keep up to date as you save. Ask me anything about the project, or pick a skill.',
		'To split long files and add tests safely, use **Fix on a local branch**: every fix is checked and committed on a new '
			+ 'local branch, and your own branch stays as it is.',
	].join('\n\n'));
	if (coverage.leftForLater || coverage.failed) {
		sink.action('Continue analysing', 'myEditor.analyseProject', []);
	}
	sink.action('Fix on a local branch', 'myEditor.aiReadyFix', []);
}
