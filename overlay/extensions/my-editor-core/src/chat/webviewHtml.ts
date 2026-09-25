import * as vscode from 'vscode';

/** One design in a compact sidebar or a centered editor tab. */
export function chatWebviewHtml(webview: vscode.Webview, media: vscode.Uri, layout: 'sidebar' | 'lounge', nonce: string): string {
	const asset = (name: string) => webview.asWebviewUri(vscode.Uri.joinPath(media, name));
	return `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${webview.cspSource} data:; style-src ${webview.cspSource}; script-src 'nonce-${nonce}';">
<link rel="stylesheet" href="${asset('chat-foundation.css')}"><link rel="stylesheet" href="${asset('chat-messages.css')}">
<link rel="stylesheet" href="${asset('chat-controls.css')}"><link rel="stylesheet" href="${asset('chat-lounge.css')}"></head>
<body class="${layout}"><div id="app"></div>
<script nonce="${nonce}" src="${asset('chatDom.js')}"></script>
<script nonce="${nonce}" src="${asset('chatCards.js')}"></script>
<script nonce="${nonce}" src="${asset('chat.js')}"></script></body></html>`;
}
