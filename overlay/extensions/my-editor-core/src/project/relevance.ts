const STOP = new Set('a an and are as at be by can check could do does for from have how i in is it me my of on or our please project see should show that the their them there these this to us want what when where which why with you your all able few secs seconds lines files code'.split(' '));

/** Terms used to find source evidence for a question, including common names for the same subsystem. */
export function queryTerms(question: string): string[] {
	const words = question.toLowerCase().match(/[a-z][a-z0-9_]{2,}/g) ?? [];
	const terms = new Set(words.filter(word => !STOP.has(word)));
	if (words.some(word => /^(db|database|postgres|postgresql|sql|query|queries|index|indexes|migration|migrations|rows|throughput|ingest|processing|millions)$/.test(word))) {
		'postgres sql database db query index migration store repository redis cache cdr spool insert batch'.split(' ').forEach(word => terms.add(word));
	}
	if (words.some(word => /^(redis|cache|hopper|queue)$/.test(word))) {
		'redis cache infra lead hopper queue'.split(' ').forEach(word => terms.add(word));
	}
	return [...terms].slice(0, 32);
}

export function rankPaths<T>(files: Readonly<Record<string, T>>, terms: readonly string[], describe: (entry: T) => string): string[] {
	if (!terms.length) { return []; }
	return Object.entries(files)
		.map(([path, entry]) => {
			const lowerPath = path.toLowerCase();
			const details = describe(entry).toLowerCase();
			const score = terms.reduce((sum, term) => sum + (lowerPath.includes(term) ? 5 : 0) + (details.includes(term) ? 1 : 0), 0);
			return { path, score };
		})
		.filter(item => item.score > 0)
		.sort((a, b) => b.score - a.score || a.path.localeCompare(b.path))
		.map(item => item.path);
}

/** Bounded, line-numbered windows around matching code, preserving useful citations. */
export function sourceExcerpt(source: string, terms: readonly string[], maxChars = 2600): string {
	const lines = source.split('\n');
	const matches: number[] = [];
	for (let i = 0; i < lines.length; i++) {
		const line = lines[i].toLowerCase();
		if (terms.some(term => line.includes(term))) { matches.push(i); }
	}
	const selected = new Set<number>();
	for (const i of (matches.length ? matches.slice(0, 16) : [0])) {
		for (let j = Math.max(0, i - 3); j <= Math.min(lines.length - 1, i + 4); j++) { selected.add(j); }
	}
	let result = '';
	let previous = -2;
	for (const i of [...selected].sort((a, b) => a - b)) {
		const next = `${i > previous + 1 ? '  ...\n' : ''}${i + 1}| ${lines[i]}\n`;
		if (result.length + next.length > maxChars) { break; }
		result += next;
		previous = i;
	}
	return result || 'Source could not fit in the excerpt budget.';
}
