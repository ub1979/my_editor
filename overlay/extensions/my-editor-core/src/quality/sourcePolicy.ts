import * as path from 'path';

export const MAX_SOURCE_LINES = 400;
export const WARN_SOURCE_LINES = 360;

const SOURCE_EXTENSIONS = new Set([
	'.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs', '.py', '.rs', '.go',
	'.c', '.h', '.cc', '.cpp', '.cxx', '.hh', '.hpp', '.hxx', '.java', '.cs', '.swift',
	'.css', '.scss', '.sass', '.less', '.vue', '.svelte',
]);
const CLASS_EXTENSIONS = new Set(['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs', '.py', '.java', '.cs', '.swift']);

export function sourceLines(text: string): number {
	if (!text) { return 0; }
	const lines = text.split(/\r\n|\r|\n/).length;
	return /\r\n$|[\r\n]$/.test(text) ? lines - 1 : lines;
}

export function isSourceFile(filePath: string): boolean {
	return SOURCE_EXTENSIONS.has(path.extname(filePath).toLowerCase()) && !filePath.endsWith('.d.ts');
}

export function hasClassSyntax(filePath: string): boolean { return CLASS_EXTENSIONS.has(path.extname(filePath).toLowerCase()); }

/** Count named, top-level class declarations in class-based languages. */
export function classNames(text: string, filePath: string): string[] {
	if (!hasClassSyntax(filePath)) { return []; }
	const names: string[] = [];
	const declaration = /^(?:(?:export|default|declare|abstract|public|private|protected|internal|sealed|final|open|data|partial|static)\s+)*class\s+([A-Za-z_$][\w$]*)\b/;
	for (const line of text.split(/\r\n|\r|\n/)) {
		const match = declaration.exec(line);
		if (match) { names.push(match[1]); }
	}
	return names;
}

/** Hard checks used both before an AI proposal is shown and before its edited form is Kept. */
export function sourcePolicyError(filePath: string, text: string): string | undefined {
	if (!isSourceFile(filePath)) { return undefined; }
	const lines = sourceLines(text);
	if (lines > MAX_SOURCE_LINES) {
		return `${filePath} would have ${lines} lines. Source files are limited to ${MAX_SOURCE_LINES}; split it into focused files first.`;
	}
	const classes = classNames(text, filePath);
	if (classes.length > 1) {
		return `${filePath} contains ${classes.length} classes (${classes.join(', ')}). Keep one class per file and move the others into focused files.`;
	}
	return undefined;
}
