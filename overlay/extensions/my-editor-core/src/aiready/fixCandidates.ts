import * as path from 'path';
import { treeSource } from './branchTip';
import { fixChoices } from './fixPicker';
import type { Remembered } from './fixSettled';
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
	/**
	 * Splits that can't help (a real refactor, or nothing in the file may move): never offered, settled before any work
	 * and listed in the change note.
	 */
	readonly unsplittable: FixChoice[];
	/** Offered splits of files new or changed on the branch, which only its working copy can parse. */
	readonly unparsed: FixChoice[];
	/** Files never split, with the reason. */
	readonly skipped: Map<string, string>;
	readonly stats: FileStats[];
}

/**
 * The fixes a run can offer, from a fresh deterministic scan of the branch tip (never the report's text): long and
 * untested files of the adapter's language. Files an earlier run settled for good (`known`, by content) are left out
 * without parsing; other files the same as in the user's folder are parsed there, for files that are never split and
 * splits that can't help; the rest are new on the branch, so its working copy screens them after the
 * baseline. Undefined when cancelled.
 */
export async function findCandidates(root: string, factory: AdapterFactory, cancelled: () => boolean,
	known: Remembered = () => undefined): Promise<Candidates | undefined> {
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
	const unsplittable = new Set<string>();
	for (const file of candidates) {
		if (cancelled()) { return undefined; }
		const settled = known(file, await source.blob(file));
		if (settled) {
			if (settled.skip) { skipped.set(file, settled.skip); } else { unsplittable.add(file); }
			continue;
		}
		if (source.changed.has(file)) { continue; }
		try {
			const info = await local.parse(file);
			if (info.skip) { skipped.set(file, info.skip); continue; }
			if (info.narrowed) { narrowed.set(file, info.narrowed); }
			if (!info.declarations.some(d => d.movable) || needsRefactor(info, lines.get(file) ?? 0)) { unsplittable.add(file); }
		} catch (error) { skipped.set(file, error instanceof Error ? error.message : String(error)); }
	}
	const all = fixChoices(findings, stats, local.extensions, skipped, narrowed).filter(choice => offers(choice.kind));
	const cannot = (choice: FixChoice) => choice.kind === 'split' && unsplittable.has(choice.file);
	const choices = all.filter(c => !cannot(c));
	const unparsed = choices.filter(c => c.kind === 'split' && source.changed.has(c.file));
	return { local, tip: source.tip, choices, unsplittable: all.filter(cannot), unparsed, skipped, stats };
}
