import * as path from 'path';
import { treeSource } from './branchTip';
import { biggestFirst, fixChoices } from './fixPicker';
import type { Remembered } from './fixSettled';
import type { FixChoice } from './fixState';
import { type FileStats, fileStats, scanHealth } from './health';
import type { LanguageAdapter, RefactorTarget } from './language';
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
	/** Blob ids of the refactor offers' files at the tip, for the records kept by content. */
	readonly blobs: ReadonlyMap<string, string>;
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
	const offers = (kind: FixChoice['kind']) => !local.fixes || local.fixes.includes(kind);
	const fixable = (f: (typeof findings)[number]) => (f.kind === 'too-long' && offers('split')) || (f.kind === 'untested' && offers('tests'));
	const candidates = [...new Set(findings.filter(f => f.file && fixable(f)).map(f => f.file!))].filter(file => sources.includes(file));
	const lines = new Map(stats.map(s => [s.path, s.lines]));
	const skipped = new Map<string, string>();
	const narrowed = new Map<string, string>();
	const unsplittable = new Set<string>();
	const refactor = local.refactor && offers('refactor') ? local.refactor : undefined;
	const refactors: FixChoice[] = [];
	const blobs = new Map<string, string>();
	const offer = (file: string, target: RefactorTarget, blob: string | undefined) => {
		refactors.push({ file, kind: 'refactor', lines: lines.get(file) ?? 0, target });
		if (blob) { blobs.set(file, blob); }
	};
	for (const file of candidates) {
		if (cancelled()) { return undefined; }
		const blob = await source.blob(file);
		const settled = known(file, blob);
		// Every record holds: a file it settled is never offered as a split again while its content is the same.
		if (settled) {
			if (settled.skip) { skipped.set(file, settled.skip); } else { unsplittable.add(file); }
			if (refactor && settled.big) { offer(file, settled.big, blob); }
		}
		if (settled && (settled.skip || settled.big || !refactor)) { continue; }
		// Only the run's working copy can parse a changed file; a record without a big function (nothing may move, or one
		// from before refactors) stays unsplittable. An unchanged one is parsed here once more, for a refactor to offer.
		if (source.changed.has(file)) { continue; }
		try {
			const info = await local.parse(file);
			if (info.skip) { skipped.set(file, info.skip); continue; }
			if (info.narrowed) { narrowed.set(file, info.narrowed); }
			const big = needsRefactor(info, lines.get(file) ?? 0);
			if (!info.declarations.some(d => d.movable) || big) { unsplittable.add(file); }
			const target = big && refactor?.target(info);
			if (target && typeof target === 'object') { offer(file, target, blob); }
		} catch (error) { skipped.set(file, error instanceof Error ? error.message : String(error)); }
	}
	const all = fixChoices(findings, stats, local.extensions, skipped, narrowed).filter(choice => offers(choice.kind));
	const cannot = (choice: FixChoice) => choice.kind === 'split' && unsplittable.has(choice.file);
	const choices = [...all.filter(c => !cannot(c)), ...refactors].sort(biggestFirst);
	const unparsed = choices.filter(c => c.kind === 'split' && source.changed.has(c.file));
	return { local, tip: source.tip, choices, unsplittable: all.filter(cannot), unparsed, blobs, skipped, stats };
}
