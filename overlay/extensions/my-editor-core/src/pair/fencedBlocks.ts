export interface FencedBlock { readonly text: string; readonly start: number; readonly end: number; readonly closed: boolean }

/** Match whole Markdown fences, including longer outer fences around examples inside a document. */
export function fencedBlocks(text: string): FencedBlock[] {
	const lines = [...text.matchAll(/[^\n]*(?:\n|$)/g)].filter(line => line[0]);
	const blocks: FencedBlock[] = [];
	for (let i = 0; i < lines.length; i++) {
		const open = /^ {0,3}(`{3,}|~{3,})[^\r\n]*\r?\n$/.exec(lines[i][0]);
		if (!open) { continue; }
		const start = lines[i].index!;
		const bodyStart = start + lines[i][0].length;
		const close = new RegExp(`^ {0,3}${open[1][0]}{${open[1].length},}[ \\t]*\\r?\\n?$`);
		let end = text.length;
		let bodyEnd = text.length;
		let closed = false;
		for (i++; i < lines.length; i++) {
			if (!close.test(lines[i][0])) { continue; }
			bodyEnd = lines[i].index!;
			end = bodyEnd + lines[i][0].length;
			closed = true;
			break;
		}
		const body = text.slice(bodyStart, bodyEnd);
		blocks.push({ start, end, closed, text: closed ? body.replace(/\r?\n$/, '') : body });
	}
	return blocks;
}

/** Keep both introductory prose and warnings after a proposed document in the visible reply. */
export function planningReplyPreview(reply: string, document?: string): string {
	const block = fencedBlocks(reply).find(item => item.text === document);
	if (!block) { return reply; }
	return [reply.slice(0, block.start).trim(), reply.slice(block.end).trim()].filter(Boolean).join('\n\n');
}
