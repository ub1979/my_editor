import { type CoverageCache, ranBefore } from './coverRecord';
import type { FixChoice } from './fixState';
import { type RefusedCache, refusedBefore } from './refusedRecord';

/**
 * Why a refactor offer starts unticked: its package can't be checked here (`blocked`), or an earlier run refused it for
 * this content. Every other offer is ticked, like a split.
 */
export function refactorUnticked(offers: readonly FixChoice[], blobs: ReadonlyMap<string, string>, refused: RefusedCache | undefined,
	blocked: ReadonlyMap<string, string>): Map<string, string> {
	const unticked = new Map<string, string>();
	for (const offer of offers.filter(choice => choice.kind === 'refactor')) {
		const earlier = refusedBefore(refused, offer.file, blobs.get(offer.file));
		const reason = blocked.get(offer.file) ?? (earlier !== undefined ? `an earlier run could not refactor it: ${earlier}` : undefined);
		if (reason) { unticked.set(offer.file, reason); }
	}
	return unticked;
}

/** A note under each refactor no test is known to run (by the last coverage of this content); it is still ticked. */
export function refactorNotes(offers: readonly FixChoice[], blobs: ReadonlyMap<string, string>, coverage: CoverageCache | undefined): Map<string, string> {
	const notes = new Map<string, string>();
	for (const offer of offers.filter(choice => choice.kind === 'refactor')) {
		if (ranBefore(coverage, offer.file, blobs.get(offer.file), offer.target?.name)) { continue; }
		notes.set(offer.file, `no test here runs \`${offer.target?.name ?? offer.file}\`; the extract check, build and vet still guard it`);
	}
	return notes;
}

/** The offers a coverage run could still tick: not in a package that can't be checked here, not refused for this content. */
export function measurable(offers: readonly FixChoice[], blobs: ReadonlyMap<string, string>, refused: RefusedCache | undefined,
	blocked: ReadonlyMap<string, string>): FixChoice[] {
	return offers.filter(offer => offer.kind === 'refactor' && !blocked.has(offer.file)
		&& refusedBefore(refused, offer.file, blobs.get(offer.file)) === undefined);
}
