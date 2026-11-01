import { randomBytes } from 'crypto';
import * as vscode from 'vscode';

export function fileChatHtml(webview: vscode.Webview, media: vscode.Uri): string {
	const nonce = randomBytes(16).toString('base64');
	const asset = (name: string) => webview.asWebviewUri(vscode.Uri.joinPath(media, name));
	return `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource}; script-src 'nonce-${nonce}';">
<link rel="stylesheet" href="${asset('filechat.css')}"></head><body>
<header><strong id="file">File chat</strong><span id="scope"></span></header>
<p id="empty">Open a project file to chat about it.</p>
<main id="content" hidden>
<nav aria-label="File actions"><button data-action="why">Why this file?</button><button data-action="explain">Explain</button><button data-action="review">Review code</button></nav>
<p class="hint">Each file has its own chat. Short answers first; ask for more when you need it.</p>
<div id="messages" role="log" aria-live="polite"></div><p id="error" role="alert"></p>
<form><label for="question">Ask about this file</label><textarea id="question" rows="3" maxlength="12000" placeholder="Why this variable? Is there a better algorithm?"></textarea>
<div class="controls"><button id="send" type="submit">Send</button><button id="stop" type="button" hidden>Stop</button><button id="new" type="button">New chat</button></div></form>
<p class="hint">To write code here: add <code>#AI write a class…</code> (or <code>// AI …</code>) in your source, then click “AI: generate below”. Review the diff and Keep.</p>
<footer><button id="model">Model</button><button id="project">Project agents</button></footer>
</main><script nonce="${nonce}" src="${asset('filechat.js')}"></script></body></html>`;
}
