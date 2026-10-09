import { randomBytes } from 'crypto';
import * as vscode from 'vscode';
import type { WebviewMessage } from './chatMessages';
import { chatWebviewHtml } from './webviewHtml';

type Receive = (message: WebviewMessage, sender: vscode.Webview) => void;

/** Hosts the chat's two webviews: the sidebar view and the centered "lounge" editor tab. Only one shows at a time. */
export class ChatPanels {
	private view: vscode.WebviewView | undefined;
	private lounge: vscode.WebviewPanel | undefined;

	constructor(private readonly extensionUri: vscode.Uri, private readonly receive: Receive) {}

	/** The open chat webviews: the sidebar, the centered tab, or both. */
	webviews(): vscode.Webview[] {
		return [this.view?.webview, this.lounge?.webview].filter((view): view is vscode.Webview => !!view);
	}

	/** Fills the sidebar view; showing it closes the centered tab. */
	resolveSidebar(view: vscode.WebviewView): void {
		this.view = view;
		const media = this.mediaRoot();
		view.webview.options = { enableScripts: true, localResourceRoots: [media] };
		view.webview.html = chatWebviewHtml(view.webview, media, 'sidebar', nonce());
		view.webview.onDidReceiveMessage(message => this.receive(message, view.webview));
		view.onDidChangeVisibility(() => {
			if (view.visible) {
				this.lounge?.dispose();
			}
		});
	}

	/** Shows the chat as a centered editor tab and closes the sidebar. */
	async openLounge(): Promise<void> {
		if (this.lounge) {
			this.lounge.reveal(vscode.ViewColumn.Active);
			await vscode.commands.executeCommand('workbench.action.closeAuxiliaryBar');
			return;
		}
		const media = this.mediaRoot();
		const options = { enableScripts: true, retainContextWhenHidden: true, localResourceRoots: [media] };
		const panel = vscode.window.createWebviewPanel('myEditor.chatLounge', 'Pair', vscode.ViewColumn.Active, options);
		this.lounge = panel;
		panel.webview.onDidReceiveMessage(message => this.receive(message, panel.webview));
		panel.onDidDispose(() => { this.lounge = undefined; });
		panel.webview.html = chatWebviewHtml(panel.webview, media, 'lounge', nonce());
		await vscode.commands.executeCommand('workbench.action.closeAuxiliaryBar');
	}

	/** Moves the chat back to the sidebar. */
	async openSidebar(): Promise<void> {
		await vscode.commands.executeCommand('myEditor.chat.focus');
		this.lounge?.dispose();
	}

	private mediaRoot(): vscode.Uri {
		return vscode.Uri.joinPath(this.extensionUri, 'media');
	}
}

function nonce(): string {
	return randomBytes(16).toString('base64');
}
