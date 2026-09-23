/**
 * Deterministic facts about one source file: what it imports, what it exports, and its role taken from
 * its own leading doc comment. No model is involved, so these facts are always what the code says.
 */
export interface FileFacts {
	readonly language: 'ts' | 'js' | 'py' | 'rs' | 'go' | 'c' | 'other';
	readonly lines: number;
	readonly imports: string[];
	readonly exports: string[];
	/** First sentence of the file's leading doc comment or docstring, if any. */
	readonly role?: string;
}

export function languageOf(path: string): FileFacts['language'] {
	if (/\.(ts|tsx|mts|cts)$/.test(path)) {
		return 'ts';
	}
	if (/\.(js|jsx|mjs|cjs)$/.test(path)) {
		return 'js';
	}
	if (/\.pyi?$/.test(path)) {
		return 'py';
	}
	if (path.endsWith('.rs')) {
		return 'rs';
	}
	if (path.endsWith('.go')) {
		return 'go';
	}
	return /\.(c|h|cc|cpp|cxx|hh|hpp|hxx)$/.test(path) ? 'c' : 'other';
}

function firstSentence(text: string): string | undefined {
	const clean = text.replace(/\s+/g, ' ').trim();
	if (!clean) {
		return undefined;
	}
	const end = clean.search(/[.!?](\s|$)/);
	return (end >= 0 ? clean.slice(0, end + 1) : clean).slice(0, 160);
}

function uniq(values: string[]): string[] {
	return [...new Set(values)];
}

const DOC_THEN_EXPORT = /\/\*\*([\s\S]*?)\*\/\s*export\s+(?:default\s+)?(?:declare\s+)?(?:abstract\s+)?(?:async\s+)?(?:function\*?|class|interface|type|enum|const|let|var|namespace)\s+([A-Za-z_$][\w$]*)/g;

function docText(raw: string): string | undefined {
	return firstSentence(raw.replace(/^\s*\*\s?/gm, ' ').replace(/@\w+.*$/gm, ''));
}

/**
 * The file's role, in order of preference: a header doc comment before any code, the doc comment of the
 * export named like the file, then the first documented export.
 */
function scriptRole(path: string, text: string): string | undefined {
	const header = /^(?:\s*(?:\/\/[^\n]*|\/\*(?!\*)[\s\S]*?\*\/))*\s*\/\*\*([\s\S]*?)\*\/\s*(?:import|\/\*\*|$|(?!export))/.exec(text);
	if (header && !/copyright|license/i.test(header[1])) {
		return docText(header[1]);
	}
	const documented = [...text.matchAll(DOC_THEN_EXPORT)].filter(m => !/copyright|license/i.test(m[1]));
	const base = (path.split('/').pop() ?? '').replace(/\.[^.]+$/, '').replace(/[-_.]/g, '').toLowerCase();
	const named = documented.find(m => m[2].toLowerCase() === base);
	const chosen = named ?? documented[0];
	return chosen ? docText(chosen[1]) : undefined;
}

function scriptFacts(path: string, text: string, language: 'ts' | 'js'): FileFacts {
	const imports = [
		...[...text.matchAll(/(?:^|[;}])\s*import\s+(?:type\s+)?(?:[\s\S]*?\s+from\s+)?['"]([^'"]+)['"]/gm)].map(m => m[1]),
		...[...text.matchAll(/(?:^|[;}])\s*export\s+(?:\*|\{[^}]*\})\s+from\s+['"]([^'"]+)['"]/gm)].map(m => m[1]),
		...[...text.matchAll(/\brequire\(\s*['"]([^'"]+)['"]\s*\)/g)].map(m => m[1]),
	];
	const exports = [
		...[...text.matchAll(/(?:^|[;}])\s*export\s+(?:default\s+)?(?:declare\s+)?(?:abstract\s+)?(?:async\s+)?(?:function\*?|class|interface|type|enum|const|let|var|namespace)\s+([A-Za-z_$][\w$]*)/gm)].map(m => m[1]),
		...[...text.matchAll(/(?:^|[;}])\s*export\s+\{([^}]*)\}(?!\s*from)/gm)].flatMap(m => m[1].split(',').map(part => part.trim().split(/\s+as\s+/).pop()!.trim()).filter(Boolean)),
		...(/^\s*export\s+default\b/m.test(text) && !/^\s*export\s+default\s+(?:abstract\s+)?(?:async\s+)?(?:function|class)\s+[A-Za-z_$]/m.test(text) ? ['default'] : []),
	];
	const role = scriptRole(path, text);
	return { language, lines: text.split('\n').length, imports: uniq(imports), exports: uniq(exports), role };
}

function pythonFacts(text: string): FileFacts {
	const imports = [
		...[...text.matchAll(/^\s*from\s+([.\w]+)\s+import\b/gm)].map(m => m[1]),
		...[...text.matchAll(/^\s*import\s+([\w.]+(?:\s*,\s*[\w.]+)*)/gm)].flatMap(m => m[1].split(',').map(s => s.trim())),
	];
	const exports = [...text.matchAll(/^(?:async\s+)?(?:def|class)\s+([A-Za-z]\w*)/gm)].map(m => m[1]);
	const docstring = /^\s*(?:#[^\n]*\n\s*)*(?:"""|''')([\s\S]*?)(?:"""|''')/.exec(text)?.[1];
	return { language: 'py', lines: text.split('\n').length, imports: uniq(imports), exports: uniq(exports), role: docstring ? firstSentence(docstring) : undefined };
}

export function extractFacts(path: string, text: string): FileFacts {
	const language = languageOf(path);
	if (language === 'ts' || language === 'js') {
		return scriptFacts(path, text, language);
	}
	if (language === 'py') {
		return pythonFacts(text);
	}
	return { language, lines: text.split('\n').length, imports: [], exports: [] };
}

/** Resolves a relative import (`./product`) against the importing file to a workspace path, if it exists. */
export function resolveImport(fromPath: string, spec: string, known: ReadonlySet<string>): string | undefined {
	if (!spec.startsWith('.')) {
		return undefined;
	}
	const base = fromPath.split('/').slice(0, -1);
	for (const part of spec.split('/')) {
		if (part === '..') {
			base.pop();
		} else if (part !== '.') {
			base.push(part);
		}
	}
	const stem = base.join('/').replace(/\.(js|mjs|cjs)$/, '');
	const candidates = [stem, `${stem}.ts`, `${stem}.tsx`, `${stem}.js`, `${stem}.jsx`, `${stem}.mts`, `${stem}/index.ts`, `${stem}/index.js`, `${stem}.py`];
	return candidates.find(c => known.has(c));
}
