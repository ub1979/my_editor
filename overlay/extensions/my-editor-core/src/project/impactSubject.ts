import { planningSections } from './planningSections';

/** The explicit architecture section containing this line, using the same parser as validation and maps. */
export function sectionAt(lines: string[], line: number): string | undefined {
	return planningSections(lines.join('\n')).find(section => section.anchor && section.line <= line && line < section.endLine)?.anchor;
}

/** The first requirement ID (FR-001 / NFR-002) on a line, if any. */
export function requirementOn(line: string): string | undefined {
	return /\bN?FR-\d{3,}\b/.exec(line)?.[0];
}
