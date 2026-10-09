import * as path from 'path';
import { treeSource } from './branchTip';
import { fixChoices } from './fixPicker';
import type { FixChoice } from './fixState';
import { type FileStats, fileStats, scanHealth } from './health';
import type { LanguageAdapter } from './language';
import type { AdapterFactory } from './languages';
import { needsRefactor } from './stillOver';
import { trackedFiles } from './worktree';

/** What the picker offers, sized on the branch a run builds on. */
export interface Candidates {
	/** The adapter for the user's folder. */
	readonly local: LanguageAdapter;
	/** The branch tip the files were sized on; undefined when no run has made one yet. */
	readonly tip?: string;
	/** The fixes to offer, biggest first. */
	readonly choices: FixChoice[];
	/** Splits that need a real refactor: never offered, settled before any work and listed as still over the limit. */
	readonly refactor: FixChoice[];
	/** Offered splits of files new or changed on the branch, which only its working copy can parse. */
	readonly unparsed: FixChoice[];
	/** Files never split, with the reason. */
	readonly skipped: Map<string, string>;
	readonly stats: FileStats[];
}

/**
 * The fixes a run can offer, from a fresh deterministic scan of the branch tip (never the report's text): long and
 * untested files of the adapter's language. Files the same as in the user's folder are parsed there, for files that
 * are never split and splits that need a real refactor; the rest are new on the branch, so its working copy screens
 * them after the baseline. Undefined when cancelled.
 */
export async function findCandidates(root: string, factory: AdapterFactory, cancelled: () => boolean): Promise<Candidates | undefined> {
	const source = await treeSource(root);
	const local = factory(root, await trackedFiles(root));
	const sources = source.tracked.filter(file => local.extensions.includes(path.extname(file)));
	const stats: FileStats[] = [];
	for (const file of sources) { stats.push(fileStats(file, await source.text(file))); }
	const findings = scanHealth(stats, source.tracked, { languages: [local.label], checks: [], tests: [] }, []);
	const offers = (kind: 'split' | 'tests') => !local.fixes || local.fixes.includes(kind);
	const fixable = (f: (typeof findings)[number]) => (f.kind === 'too-long' && offers('split')) || (f.kind === 'untested' && offers('tests'));
	const candidates = [...new Set(findings.filter(f => f.file && fixable(f)).map(f => f.file!))].filter(file => sources.includes(file));
	const lines = new Map(stats.map(s => [s.path, s.lines]));
	const skipped = new Map<string, string>();
	const narrowed = new Map<string, string>();
	const refactor = new Set<string>();
	for (const file of candidates.filter(name => !source.changed.has(name))) {
		if (cancelled()) { return undefined; }
		try {
			const info = await local.parse(file);
			if (info.skip) { skipped.set(file, info.skip); continue; }
			if (info.narrowed) { narrowed.set(file, info.narrowed); }
			if (needsRefactor(info, lines.get(file) ?? 0)) { refactor.add(file); }
		} catch (error) { skipped.set(file, error instanceof Error ? error.message : String(error)); }
	}
	const all = fixChoices(findings, stats, local.extensions, skipped, narrowed).filter(choice => offers(choice.kind));
	const refactors = (choice: FixChoice) => choice.kind === 'split' && refactor.has(choice.file);
	const choices = all.filter(c => !refactors(c));
	const unparsed = choices.filter(c => c.kind === 'split' && source.changed.has(c.file));
	return { local, tip: source.tip, choices, refactor: all.filter(refactors), unparsed, skipped, stats };
}
