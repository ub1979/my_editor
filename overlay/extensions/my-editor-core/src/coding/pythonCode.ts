/** Remove a shared indent so a selected function body can run independently in the interactive session. */
export function dedent(code: string): string {
	const lines = code.replace(/\r\n/g, '\n').split('\n');
	const widths = lines.filter(line => line.trim()).map(line => /^\s*/.exec(line)![0].length);
	const width = widths.length ? Math.min(...widths) : 0;
	return lines.map(line => line.slice(Math.min(width, /^\s*/.exec(line)![0].length))).join('\n');
}

/** One REPL expression executes a whole selection without interactive indentation/paste prompts. */
export function pythonSelectionCommand(code: string, filename: string, runId?: number): string {
	return `_my_editor_run(${JSON.stringify(dedent(code))}, ${JSON.stringify(filename)}${runId === undefined ? '' : `, ${runId}`})`;
}

/** Spyder/Jupyter-style # %% cells; a cursor on the delimiter runs the following cell. */
export function pythonCell(text: string, cursor: number): { start: number; end: number; code: string } {
	const lines = text.split(/\r?\n/);
	const marker = (line: string) => /^\s*#\s*%%(?:\s|$)/.test(line);
	let start = Math.min(cursor, lines.length - 1);
	while (start > 0 && !marker(lines[start])) { start--; }
	if (marker(lines[start])) { start++; }
	let end = start;
	while (end < lines.length && !marker(lines[end])) { end++; }
	return { start, end, code: lines.slice(start, end).join('\n') };
}
