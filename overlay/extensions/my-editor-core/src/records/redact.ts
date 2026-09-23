const SECRET_PATTERNS: RegExp[] = [
	/sk-ant-[A-Za-z0-9_-]{10,}/g,
	/sk-(?:or-|proj-)?[A-Za-z0-9_-]{16,}/g,
	/AKIA[0-9A-Z]{16}/g,
	/gh[pousr]_[A-Za-z0-9]{20,}/g,
	/xox[baprs]-[A-Za-z0-9-]{10,}/g,
	/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
	/((?:api[_-]?key|secret|token|password)\s*[:=]\s*)["']?[^\s"']{8,}/gi,
];

/** Removes likely secrets before anything is written to disk. */
export function redact(text: string): string {
	return SECRET_PATTERNS.reduce(
		(out, pattern) => out.replace(pattern, (match, prefix) => (typeof prefix === 'string' && match.startsWith(prefix) ? `${prefix}[REDACTED]` : '[REDACTED]')),
		text);
}

/** Replaces fenced code blocks with a one-line note, so chat records stay small in git. */
export function collapseCode(text: string): string {
	return text.replace(/```[^\n]*\n([\s\S]*?)(?:```|$)/g, (_match, body: string) => {
		const lines = body.replace(/\n$/, '').split('\n').length;
		return `_[code: ${lines} line${lines === 1 ? '' : 's'}]_`;
	});
}
