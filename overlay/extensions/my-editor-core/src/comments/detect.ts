/** Line-comment and doc-comment syntax per language, for finding and writing comments. */
const STYLES: Record<string, { lead: RegExp; doc: string }> = {
	python: { lead: /^\s*(#|"""|''')/, doc: 'a docstring' },
	typescript: { lead: /^\s*(\/\/|\/\*|\*)/, doc: 'a JSDoc comment (/** … */)' },
	typescriptreact: { lead: /^\s*(\/\/|\/\*|\*)/, doc: 'a JSDoc comment (/** … */)' },
	javascript: { lead: /^\s*(\/\/|\/\*|\*)/, doc: 'a JSDoc comment (/** … */)' },
	javascriptreact: { lead: /^\s*(\/\/|\/\*|\*)/, doc: 'a JSDoc comment (/** … */)' },
	rust: { lead: /^\s*(\/\/|\/\*|\*)/, doc: 'a /// doc comment' },
	go: { lead: /^\s*(\/\/|\/\*|\*)/, doc: 'a // comment that starts with the name, as Go does' },
	c: { lead: /^\s*(\/\/|\/\*|\*)/, doc: 'a /* … */ or // comment' },
	cpp: { lead: /^\s*(\/\/|\/\*|\*)/, doc: 'a /// or // comment' },
	java: { lead: /^\s*(\/\/|\/\*|\*)/, doc: 'a Javadoc comment (/** … */)' },
};

export function supportsAutoComments(languageId: string): boolean {
	return languageId in STYLES;
}

export function docStyle(languageId: string): string {
	return STYLES[languageId]?.doc ?? 'a short comment';
}

/** Decorators and attributes sit between a comment and the code it describes. */
const DECORATOR = /^\s*(@\w|#\[|#!\[)/;

/**
 * True when the symbol starting at `line` has no comment: nothing comment-like directly above it (past
 * decorators/attributes), and for Python no docstring as the first line of the body.
 */
export function needsComment(lines: readonly string[], line: number, languageId: string): boolean {
	const style = STYLES[languageId];
	if (!style) {
		return false;
	}
	let above = line - 1;
	while (above >= 0 && DECORATOR.test(lines[above])) {
		above--;
	}
	if (above >= 0 && style.lead.test(lines[above]) || above >= 0 && /\*\/\s*$/.test(lines[above])) {
		return false;
	}
	if (languageId === 'python') {
		let body = line + 1;
		while (body < lines.length && !lines[body].trim()) {
			body++;
		}
		// A signature split over lines ends at the first line ending in ':'.
		let header = line;
		while (header < lines.length - 1 && !/:\s*(#.*)?$/.test(lines[header])) {
			header++;
		}
		body = header + 1;
		while (body < lines.length && !lines[body].trim()) {
			body++;
		}
		if (body < lines.length && /^\s*[rRbBuU]?("""|''')/.test(lines[body])) {
			return false;
		}
	}
	return true;
}

/**
 * The plain comment text from a model reply: markers, quotes and fences removed. Undefined when the reply is
 * empty, too long, or looks like code rather than a sentence.
 */
export function commentText(reply: string): string | undefined {
	const unfenced = reply.replace(/```[^\n]*\n?/g, '');
	const text = unfenced
		.split('\n')
		.map(line => line.trim().replace(/^(\/\*\*?|\*\/|\/\/\/?|#+|\*|[rRuU]?"""|[rRuU]?\'\'\')\s?/, '').replace(/(\*\/|"""|\'\'\')\s*$/, '').trim())
		.filter(Boolean)
		.join(' ')
		.replace(/\s+/g, ' ')
		.trim();
	if (text.length < 8 || text.length > 320) {
		return undefined;
	}
	if (/(^|\s)(def|function|return|const|let|fn|func|class)\s+\w+\s*[({=]|=>|;\s*$|[{}]/.test(text)) {
		return undefined;
	}
	return text;
}

function wrap(text: string, width: number): string[] {
	const out: string[] = [];
	let line = '';
	for (const word of text.split(' ')) {
		if (line && line.length + word.length + 1 > width) {
			out.push(line);
			line = word;
		} else {
			line = line ? `${line} ${word}` : word;
		}
	}
	if (line) {
		out.push(line);
	}
	return out;
}

/** The text as a comment in the language's own style, wrapped to a readable width. */
export function formatComment(text: string, languageId: string, name: string): string[] {
	const sentence = /[.!?]$/.test(text) ? text : `${text}.`;
	switch (languageId) {
		case 'python': {
			const lines = wrap(sentence, 72);
			// PEP 257: the first line of the docstring starts right after the opening quotes.
			return lines.length === 1 ? [`"""${lines[0]}"""`] : [`"""${lines[0]}`, ...lines.slice(1), '"""'];
		}
		case 'rust':
			return wrap(sentence, 90).map(l => `/// ${l}`);
		case 'go': {
			const withName = sentence.startsWith(name) ? sentence : `${name} ${sentence[0].toLowerCase()}${sentence.slice(1)}`;
			return wrap(withName, 90).map(l => `// ${l}`);
		}
		case 'cpp':
			return wrap(sentence, 90).map(l => `// ${l}`);
		case 'c': {
			const lines = wrap(sentence, 88);
			return lines.length === 1 ? [`/* ${lines[0]} */`] : ['/*', ...lines.map(l => `* ${l}`), '*/'];
		}
		default: {
			const lines = wrap(sentence, 88);
			return lines.length === 1 ? [`/** ${lines[0]} */`] : ['/**', ...lines.map(l => `* ${l}`), '*/'];
		}
	}
}

/** Where and how to insert the comment: above the symbol, or as the first line of a Python body. */
export function insertion(lines: readonly string[], line: number, comment: string[], languageId: string): { line: number; text: string } {
	if (languageId === 'python') {
		let header = line;
		while (header < lines.length - 1 && !/:\s*(#.*)?$/.test(lines[header])) {
			header++;
		}
		const bodyIndent = /^(\s*)/.exec(lines[header + 1] ?? '')?.[1] || `${/^(\s*)/.exec(lines[line])?.[1] ?? ''}    `;
		return { line: header + 1, text: comment.map(l => bodyIndent + l).join('\n') + '\n' };
	}
	let target = line;
	while (target > 0 && DECORATOR.test(lines[target - 1])) {
		target--;
	}
	const indent = /^(\s*)/.exec(lines[target])?.[1] ?? '';
	// Continuation lines of a /** */ block get one space so the stars line up.
	const text = comment.map(l => indent + (l.startsWith('*') ? ` ${l}` : l)).join('\n') + '\n';
	return { line: target, text };
}

const DEFINITIONS: Record<string, RegExp> = {
	python: /^\s*(?:async\s+)?(?:def|class)\s+([A-Za-z_]\w*)/,
	typescript: /^\s*(?:export\s+)?(?:default\s+)?(?:abstract\s+)?(?:async\s+)?(?:function\*?|class|interface|enum)\s+([A-Za-z_$][\w$]*)/,
	javascript: /^\s*(?:export\s+)?(?:default\s+)?(?:async\s+)?(?:function\*?|class)\s+([A-Za-z_$][\w$]*)/,
	rust: /^\s*(?:pub(?:\([^)]*\))?\s+)?(?:async\s+)?(?:unsafe\s+)?(?:fn|struct|enum|trait)\s+([A-Za-z_]\w*)/,
	go: /^\s*(?:func(?:\s*\([^)]*\))?|type)\s+([A-Za-z_]\w*)/,
	java: /^\s*(?:public|private|protected)?\s*(?:static\s+)?(?:final\s+)?(?:class|interface|enum)\s+([A-Za-z_]\w*)/,
};
DEFINITIONS.typescriptreact = DEFINITIONS.typescript;
DEFINITIONS.javascriptreact = DEFINITIONS.javascript;

/**
 * Definitions found from the text alone, for when the language server has no symbols yet. The end line is
 * found by indentation (Python) or by the line where braces balance again.
 */
export function findDefinitions(lines: readonly string[], languageId: string): { name: string; line: number; endLine: number }[] {
	const pattern = DEFINITIONS[languageId];
	if (!pattern) {
		return [];
	}
	const found: { name: string; line: number; endLine: number }[] = [];
	lines.forEach((text, line) => {
		const match = pattern.exec(text);
		if (!match) {
			return;
		}
		let endLine = line;
		if (languageId === 'python') {
			const indent = /^(\s*)/.exec(text)![1].length;
			for (let next = line + 1; next < lines.length; next++) {
				if (lines[next].trim() && /^(\s*)/.exec(lines[next])![1].length <= indent) {
					break;
				}
				if (lines[next].trim()) {
					endLine = next;
				}
			}
		} else {
			let depth = 0;
			let opened = false;
			for (let next = line; next < lines.length; next++) {
				for (const char of lines[next]) {
					if (char === '{') {
						depth++;
						opened = true;
					} else if (char === '}') {
						depth--;
					}
				}
				endLine = next;
				if (opened && depth <= 0) {
					break;
				}
			}
		}
		found.push({ name: match[1], line, endLine });
	});
	return found;
}
