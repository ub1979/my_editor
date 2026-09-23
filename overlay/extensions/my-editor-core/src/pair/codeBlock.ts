/** The body of the last fenced code block, or undefined. Tolerates a missing closing fence. */
export function lastCodeBlock(text: string): string | undefined {
	const blocks = [...text.matchAll(/```[^\n]*\n([\s\S]*?)(?:\n?```|$)/g)];
	return blocks.length ? blocks[blocks.length - 1][1] : undefined;
}

/**
 * The document in a reply for a spec file. Prefers a fenced block; smaller models often skip the fence,
 * so for Markdown it falls back to the text from the first heading (needing at least two headings), and
 * for JSON to the outermost array.
 */
export function documentFromReply(reply: string, target: string): string | undefined {
	const fenced = lastCodeBlock(reply);
	if (fenced !== undefined && fenced.trim()) {
		return fenced;
	}
	if (target.endsWith('.json')) {
		const start = reply.indexOf('[');
		const end = reply.lastIndexOf(']');
		if (start < 0 || end <= start) {
			return undefined;
		}
		try {
			return JSON.stringify(JSON.parse(reply.slice(start, end + 1)), null, '\t');
		} catch {
			return undefined;
		}
	}
	const headings = [...reply.matchAll(/^#{1,3} \S/gm)];
	if (headings.length < 2) {
		return undefined;
	}
	return reply.slice(headings[0].index).trim();
}
