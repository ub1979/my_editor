import { type CoverageCache, ranBefore } from './coverRecord';
import type { FixChoice } from './fixState';
import { type RefusedCache, refusedBefore } from './refusedRecord';

/**
 * Why each refactor offer starts unticked, in this order: its package can't be checked here (`blocked`); an earlier run
 * refused it for this content; no coverage record for this content shows the package's tests running the function.
 * Offers missing from the map are ticked.
 */
export function refactorUnticked(offers: readonly FixChoice[], blobs: ReadonlyMap<string, string>, coverage: CoverageCache | undefined,
	refused: RefusedCache | undefined, blocked: ReadonlyMap<string, string>): Map<string, string> {
	const unticked = new Map<string, string>();
	for (const offer of offers.filter(choice => choice.kind === 'refactor')) {
		const blob = blobs.get(offer.file);
		const earlier = refusedBefore(refused, offer.file, blob);
		const name = offer.target?.name ?? offer.file;
		const untested = `no test here runs \`${name}\` yet; build, vet and the extract check still apply`;
		const reason = blocked.get(offer.file)
			?? (earlier !== undefined ? `an earlier run could not refactor it: ${earlier}` : undefined)
			?? (ranBefore(coverage, offer.file, blob, offer.target?.name) ? undefined : untested);
		if (reason) { unticked.set(offer.file, reason); }
	}
	return unticked;
}

/** The offers a coverage run could still tick: not in a package that can't be checked here, not refused for this content. */
export function measurable(offers: readonly FixChoice[], blobs: ReadonlyMap<string, string>, refused: RefusedCache | undefined,
	blocked: ReadonlyMap<string, string>): FixChoice[] {
	return offers.filter(offer => offer.kind === 'refactor' && !blocked.has(offer.file)
		&& refusedBefore(refused, offer.file, blobs.get(offer.file)) === undefined);
}
