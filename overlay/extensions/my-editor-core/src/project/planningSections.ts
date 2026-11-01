import MarkdownIt from 'markdown-it';

const markdown = new MarkdownIt({ html: false });
export interface PlanningSection {
	readonly title: string;
	readonly anchor?: string;
	readonly level: number;
	readonly line: number;
	readonly endLine: number;
	readonly body: string;
}

/** Read real Markdown headings, ignoring fenced examples; accept explicit Markdown or HTML anchors. */
export function planningSections(text: string): PlanningSection[] {
	const lines = text.split(/\r?\n/);
	const tokens = markdown.parse(text, {});
	const headings = tokens.flatMap((token, i) => {
		if (token.type !== 'heading_open' || !token.map) { return []; }
		const inline = tokens[i + 1];
		const raw = inline?.content ?? '';
		const title = (inline?.children ?? []).map(part => part.type === 'html_inline' ? '' : part.content).join('');
		let previous = token.map[0] - 1;
		while (previous >= 0 && !lines[previous].trim()) { previous--; }
		const html = /^\s*<a\s+(?:id|name)\s*=\s*["']([\w-]+)["']\s*>\s*<\/a>\s*$/i.exec(lines[previous] ?? '');
		const anchor = /\{#([\w-]+)\}\s*$/.exec(raw)?.[1] ?? html?.[1];
		return [{ title: title.replace(/\s*\{#[\w-]+\}\s*$/, '').trim(), anchor,
			level: Number(token.tag.slice(1)), line: html ? previous : token.map[0], contentLine: token.map[1] }];
	});
	return headings.map((heading, i) => {
		const next = headings.slice(i + 1).find(item => item.level <= heading.level);
		const endLine = next?.line ?? lines.length;
		return { ...heading, endLine, body: lines.slice(heading.contentLine, endLine).join('\n') };
	});
}
