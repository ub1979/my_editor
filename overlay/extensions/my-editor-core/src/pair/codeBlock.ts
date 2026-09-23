/** Every fenced code block's body, in order. Tolerates a missing closing fence on the last one. */
function codeBlocks(text: string): string[] {
	return [...text.matchAll(/```[^\n]*\n([\s\S]*?)(?:\n?```|$)/g)].map(m => m[1]);
}

/** The body of the last fenced code block, or undefined. */
export function lastCodeBlock(text: string): string | undefined {
	const blocks = codeBlocks(text);
	return blocks.length ? blocks[blocks.length - 1] : undefined;
}

/**
 * The code meant to replace a whole file: the largest block, so a short usage example after the file
 * does not replace it. Undefined when there is no block.
 */
export function fileFromReply(text: string): string | undefined {
	const blocks = codeBlocks(text);
	return blocks.length ? blocks.reduce((a, b) => (b.length > a.length ? b : a)) : undefined;
}

/**
 * True when a "complete file" reply elides code instead of repeating it — e.g. `// ... existing code ...`
 * or `# rest unchanged` — which would delete those lines if applied.
 */
export function elidesCode(code: string): boolean {
	const omitted = /(?:existing|remaining|previous|other|unchanged) (?:code|methods|functions|imports|implementation|logic|content)|rest of (?:the )?(?:file|code|class|module|function|implementation)|(?:code|content|file|methods?) (?:stays |remains |is )?unchanged|same as before/i;
	const comment = /^\s*(?:\/\/|#|\/\*|<!--|--)(.*)$/;
	return code.split('\n').some(line => {
		const body = comment.exec(line)?.[1];
		return body !== undefined && (/^\s*(?:\.{3}|…)\s*(?:\*\/|-->)?\s*$/.test(body) || omitted.test(body));
	});
}

/**
 * The document in a reply for a spec file. Prefers a fenced block; smaller models often skip the fence,
 * so for Markdown it falls back to the text from the first heading (needing at least two headings), and
 * for JSON to the outermost array.
 */
export function documentFromReply(reply: string, target: string): string | undefined {
	const fenced = fileFromReply(reply);
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
