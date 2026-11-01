import { randomBytes } from 'node:crypto';

export interface PythonOutputEvent { id: number; text?: string; channel?: string; started?: boolean; done?: boolean; failed?: boolean }
export interface OutputAnchor { start: number; end: number }
export interface OutputEdit { rangeOffset: number; rangeLength: number; text: string }

/** Edits above a block move its output; editing that block invalidates its old result. */
export function moveOutputAnchor(anchor: OutputAnchor, edits: readonly OutputEdit[]): OutputAnchor | undefined {
	let { start, end } = anchor;
	for (const edit of [...edits].sort((a, b) => b.rangeOffset - a.rangeOffset)) {
		const last = edit.rangeOffset + edit.rangeLength;
		if (edit.rangeOffset <= end && last >= start) { return undefined; }
		if (last < start) { const delta = edit.text.length - edit.rangeLength; start += delta; end += delta; }
	}
	return { start, end };
}

export function outputHeight(text: string): number { return Math.min(16, Math.max(4, text.split('\n').length + 2)); }
function escape(text: string): string { return text.replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]!)); }

/** Output is plain text, never executable HTML, even when the Python code prints markup. */
export function pythonOutputHtml(id: number, status: string, text: string): string {
	const nonce = randomBytes(16).toString('hex');
	return `<!DOCTYPE html><html><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}'">
<style>
*{box-sizing:border-box}html,body{height:100%;margin:0}body{padding:5px 12px;color:var(--vscode-editor-foreground);background:var(--vscode-editorWidget-background);font-family:var(--vscode-font-family)}
section{height:100%;display:flex;flex-direction:column;border-left:2px solid var(--vscode-focusBorder);padding-left:12px}
header{display:flex;align-items:center;gap:8px;font-size:11px;color:var(--vscode-descriptionForeground)}
button{margin-left:auto;border:0;background:transparent;color:inherit;cursor:pointer;padding:3px 7px}button:hover{background:var(--vscode-toolbar-hoverBackground)}button:focus-visible{outline:1px solid var(--vscode-focusBorder)}
pre{margin:4px 0;overflow:auto;flex:1;white-space:pre-wrap;overflow-wrap:anywhere;font-family:var(--vscode-editor-font-family);font-size:var(--vscode-editor-font-size);line-height:1.4}
</style></head><body><section aria-label="Python block output"><header><span>Out [${id}] · ${escape(status)}</span><button id="dismiss" aria-label="Dismiss this block output">Dismiss</button></header>
<pre role="log" aria-live="polite">${escape(text || (status === 'Queued' ? 'Waiting to run…' : status === 'Running' ? 'Running…' : 'No output'))}</pre>
</section><script nonce="${nonce}">const api=acquireVsCodeApi();document.getElementById('dismiss').onclick=()=>api.postMessage({type:'dismiss'});</script></body></html>`;
}
