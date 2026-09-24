import { redactObservation } from '../chat/observationProcess';

/** A bounded, literal excerpt; saved records are evidence to inspect, not instructions. */
export function matchingRecordLines(path: string, source: string, query: string, limit = 8): string[] {
	const needle = query.toLowerCase();
	const lines = source.split('\n');
	const matches: string[] = [];
	for (let index = 0; index < lines.length && matches.length < limit; index++) {
		if (lines[index].toLowerCase().includes(needle)) {
			matches.push(`${path}:${index + 1}: ${redactObservation(lines[index].replace(/\s+/g, ' ').slice(0, 400))}`);
		}
	}
	return matches;
}
