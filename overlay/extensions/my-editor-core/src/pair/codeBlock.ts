/** The body of the last fenced code block, or undefined. Tolerates a missing closing fence. */
export function lastCodeBlock(text: string): string | undefined {
	const blocks = [...text.matchAll(/```[^\n]*\n([\s\S]*?)(?:\n?```|$)/g)];
	return blocks.length ? blocks[blocks.length - 1][1] : undefined;
}
