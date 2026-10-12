import type { CoverageCache } from './coverRecord';
import type { Candidates } from './fixCandidates';
import { blockedFiles, type CheckCache } from './fixUnverifiable';
import { refactorNotes, refactorUnticked } from './refactorOffers';
import { type RefusedCache, refusedBefore } from './refusedRecord';

/** What a click on the fix button would do, from the last count. */
export interface FixLeft {
	/** Splits a run would start with ticked. */
	readonly left: number;
	/** Long functions a run would start with ticked: every refactor offer not blocked here or refused for its content. */
	readonly offers: number;
	/** Of those, the ones no test is known to run: build, vet and the extract check guard them. */
	readonly uncovered: number;
	/** Files still over the limit a split can't help and no refactor is offered for (or one was refused for their content). */
	readonly refactor: number;
	/** Files over the limit in packages whose build already failed here. */
	readonly unbuildable: number;
	/** Whether the language offers refactors at all. */
	readonly refactors: boolean;
}

/** Whether a saved count has this version's shape; an older one (untested refactors were unticked then) is counted again. */
export function isFixLeft(value: unknown): value is FixLeft {
	const count = value as FixLeft | undefined;
	return !!count && typeof count === 'object' && typeof count.left === 'number' && typeof count.unbuildable === 'number'
		&& typeof count.offers === 'number' && typeof count.uncovered === 'number' && typeof count.refactors === 'boolean';
}

/** The records a count reads: the checks by tip, the coverage and the refused refactors by content. */
export interface CountRecords {
	readonly checks?: CheckCache;
	readonly coverage?: CoverageCache;
	readonly refused?: RefusedCache;
}

/** Counts what the picker would show for these candidates, by what it would tick and why the rest stay unticked. */
export function countLeft(found: Pick<Candidates, 'local' | 'tip' | 'choices' | 'unsplittable' | 'blobs'>, records: CountRecords): FixLeft {
	const checks = (file: string) => found.local.checks(file);
	const splits = found.choices.filter(choice => choice.kind === 'split');
	const blocked = blockedFiles(splits, checks, records.checks, found.tip);
	const offered = found.choices.filter(choice => choice.kind === 'refactor');
	const stuck = blockedFiles(offered, checks, records.checks, found.tip);
	const refused = offered.filter(o => !stuck.has(o.file) && refusedBefore(records.refused, o.file, found.blobs.get(o.file)) !== undefined);
	const unticked = refactorUnticked(offered, found.blobs, records.refused, stuck);
	const notes = refactorNotes(offered.filter(o => !unticked.has(o.file)), found.blobs, records.coverage);
	return {
		left: splits.length - blocked.size,
		offers: offered.length - unticked.size,
		uncovered: notes.size,
		unbuildable: blocked.size + stuck.size,
		refactor: found.unsplittable.filter(fix => !offered.some(o => o.file === fix.file)).length + refused.length,
		refactors: !!found.local.refactor && (!found.local.fixes || found.local.fixes.includes('refactor')),
	};
}
