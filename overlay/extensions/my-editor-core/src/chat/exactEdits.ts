/** Apply independently located replacements to one original file; never guess an ambiguous match. */
export function applyExactEdits(source: string, value: unknown): string {
	if (source.length > 80_000 || source.includes('\0')) { throw new Error('Choose a text file under 80,000 characters.'); }
	if (!Array.isArray(value) || !value.length || value.length > 20) { throw new Error('Provide 1–20 exact replacements for one file.'); }
	const edits = value.map(item => {
		if (!item || typeof item !== 'object' || typeof item.oldText !== 'string' || !item.oldText
			|| typeof item.newText !== 'string' || item.oldText.length > 80_000 || item.newText.length > 80_000
			|| item.oldText.includes('[REDACTED]') || item.newText.includes('[REDACTED]')) {
			throw new Error('Each replacement needs nonempty oldText and string newText, without redacted placeholders.');
		}
		const start = source.indexOf(item.oldText);
		if (start < 0 || source.indexOf(item.oldText, start + 1) >= 0) {
			throw new Error('oldText must match exactly once. Read the current file and include enough surrounding context.');
		}
		return { start, end: start + item.oldText.length, text: item.newText as string };
	}).sort((a, b) => a.start - b.start);
	for (let i = 1; i < edits.length; i++) {
		if (edits[i].start < edits[i - 1].end) { throw new Error('Replacements overlap. Provide independent edits against the original file.'); }
	}
	let result = source;
	for (const edit of edits.reverse()) { result = result.slice(0, edit.start) + edit.text + result.slice(edit.end); }
	if (result.length > 80_000 || result.includes('\0')) { throw new Error('The result must be text under 80,000 characters.'); }
	return result;
}
