/** The architecture section anchor (`{#id}`) that contains the given 0-based line, if any. */
export function sectionAt(lines: string[], line: number): string | undefined {
	for (let i = Math.min(line, lines.length - 1); i >= 0; i--) {
		const match = /^#{1,6} .*\{#([\w-]+)\}\s*$/.exec(lines[i]);
		if (match) {
			return match[1];
		}
	}
	return undefined;
}

/** The first requirement ID (FR-001 / NFR-002) on a line, if any. */
export function requirementOn(line: string): string | undefined {
	return /\bN?FR-\d{3}\b/.exec(line)?.[0];
}
