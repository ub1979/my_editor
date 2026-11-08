import * as path from 'path';

export const MAX_SOURCE_LINES = 600;
export const WARN_SOURCE_LINES = 540;

const SOURCE_EXTENSIONS = new Set([
	'.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs', '.py', '.rs', '.go',
	'.c', '.h', '.cc', '.cpp', '.cxx', '.hh', '.hpp', '.hxx', '.java', '.cs', '.swift',
	'.css', '.scss', '.sass', '.less', '.vue', '.svelte',
]);
const CLASS_EXTENSIONS = new Set(['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs', '.py', '.java', '.cs', '.swift',
	'.kt', '.kts', '.cpp', '.cc', '.cxx', '.h', '.hpp', '.hxx', '.rb', '.php', '.dart']);

export function sourceLines(text: string): number {
	if (!text) { return 0; }
	const lines = text.split(/\r\n|\r|\n/).length;
	return /\r\n$|[\r\n]$/.test(text) ? lines - 1 : lines;
}

export function isSourceFile(filePath: string): boolean {
	return SOURCE_EXTENSIONS.has(path.extname(filePath).toLowerCase()) && !filePath.endsWith('.d.ts');
}

export function hasClassSyntax(filePath: string): boolean { return CLASS_EXTENSIONS.has(path.extname(filePath).toLowerCase()); }

/** Named, top-level class declarations in class-based languages, with their one-based lines. */
export function classDeclarations(text: string, filePath: string): { name: string; line: number }[] {
	if (!hasClassSyntax(filePath)) { return []; }
	const found: { name: string; line: number }[] = [];
	const modifiers = 'export|default|declare|abstract|public|private|protected|internal|sealed|final|open|data|partial|static';
	const declaration = new RegExp(String.raw`^(?:(?:${modifiers})\s+)*class\s+([A-Za-z_$][\w$]*)\b`);
	text.split(/\r\n|\r|\n/).forEach((line, index) => {
		const match = declaration.exec(line);
		if (match) { found.push({ name: match[1], line: index + 1 }); }
	});
	return found;
}

/** Count named, top-level class declarations in class-based languages. */
export function classNames(text: string, filePath: string): string[] {
	return classDeclarations(text, filePath).map(declaration => declaration.name);
}

/** Hard checks used both before an AI proposal is shown and before its edited form is Kept. */
export function sourcePolicyError(filePath: string, text: string): string | undefined {
	if (!isSourceFile(filePath)) { return undefined; }
	if (/^\s*(?:(?:\/\/|#)\s*)?(?:placeholder|todo|tbd|not implemented)\s*[.;]?\s*$/i.test(text)) {
		return 'The model returned a placeholder instead of source code. Propose the complete implementation or explain what is blocked.';
	}
	if (/^\s*(?:ERROR|BLOCKED):\s*(?:unable to|cannot\s+\w+|could not|failed to|I (?:cannot|can't))\b/i.test(text)) {
		return 'The model returned a failure message instead of source code. Return a final explanation or propose valid code.';
	}
	const lines = sourceLines(text);
	if (lines > MAX_SOURCE_LINES) {
		return `${filePath} would have ${lines} lines. Source files are limited to ${MAX_SOURCE_LINES}; split it into focused files first.`;
	}
	return classPolicyError(filePath, text);
}

export function classPolicyError(filePath: string, text: string): string | undefined {
	const classes = classNames(text, filePath);
	if (classes.length > 1) {
		return `${filePath} contains ${classes.length} classes (${classes.join(', ')}). Keep one class per file and move the others into focused files.`;
	}
	return undefined;
}
