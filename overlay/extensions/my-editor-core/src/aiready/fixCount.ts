import type { CoverageCache } from './coverRecord';
import type { Candidates } from './fixCandidates';
import { blockedFiles, type CheckCache } from './fixUnverifiable';
import { refactorUnticked } from './refactorOffers';
import { type RefusedCache, refusedBefore } from './refusedRecord';

/** What a click on the fix button would do, from the last count. */
export interface FixLeft {
	/** Splits a run would start with ticked. */
	readonly left: number;
	/** Long functions a run would start with ticked: the last coverage of their content shows tests running them. */
	readonly offers?: number;
	/** Long functions offered unticked because no test is known to run them; the user may tick them in the picker. */
	readonly untested?: number;
	/** Files still over the limit a split can't help and no refactor is offered for (or one was refused for their content). */
	readonly refactor: number;
	/** Files over the limit in packages whose build already failed here. */
	readonly unbuildable: number;
	/** Whether the language offers refactors at all. */
	readonly refactors?: boolean;
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
	const unticked = refactorUnticked(offered, found.blobs, records.coverage, records.refused, stuck);
	return {
		left: splits.length - blocked.size,
		offers: offered.length - unticked.size,
		untested: unticked.size - stuck.size - refused.length,
		unbuildable: blocked.size + stuck.size,
		refactor: found.unsplittable.filter(fix => !offered.some(o => o.file === fix.file)).length + refused.length,
		refactors: !!found.local.refactor && (!found.local.fixes || found.local.fixes.includes('refactor')),
	};
}
