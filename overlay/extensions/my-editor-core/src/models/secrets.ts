import * as vscode from 'vscode';
import { ProviderId } from './types';

const KEYED: { id: ProviderId; label: string; hint: string }[] = [
	{ id: 'anthropic', label: 'Anthropic (Claude)', hint: 'sk-ant-…' },
	{ id: 'openai', label: 'OpenAI', hint: 'sk-…' },
	{ id: 'openrouter', label: 'OpenRouter', hint: 'sk-or-…' },
	{ id: 'custom', label: 'Custom OpenAI-compatible endpoint', hint: 'key for myEditor.custom.baseUrl' },
];

/** API keys live in the OS keychain (VS Code SecretStorage), never in settings or `.my_editor/`. */
export class ApiKeys {
	private readonly changed = new vscode.EventEmitter<void>();
	readonly onDidChange = this.changed.event;

	constructor(private readonly secrets: vscode.SecretStorage) {
		secrets.onDidChange(e => e.key.startsWith('myEditor.apiKey.') && this.changed.fire());
	}

	get(provider: ProviderId): Thenable<string | undefined> {
		return this.secrets.get(`myEditor.apiKey.${provider}`);
	}

	/** Command: pick a provider, then paste (or clear) its key. */
	async promptAndStore(): Promise<void> {
		const pick = await vscode.window.showQuickPick(
			KEYED.map(p => ({ label: p.label, id: p.id, hint: p.hint })),
			{ title: 'Set API key', placeHolder: 'Which provider?' });
		if (!pick) {
			return;
		}
		const value = await vscode.window.showInputBox({
			title: `${pick.label} API key`,
			prompt: 'Stored in your system keychain. Leave empty to remove the key.',
			placeHolder: pick.hint,
			password: true,
			ignoreFocusOut: true,
		});
		if (value === undefined) {
			return;
		}
		const key = `myEditor.apiKey.${pick.id}`;
		if (value.trim()) {
			await this.secrets.store(key, value.trim());
			void vscode.window.showInformationMessage(`${pick.label} key saved.`);
		} else {
			await this.secrets.delete(key);
			void vscode.window.showInformationMessage(`${pick.label} key removed.`);
		}
	}

	dispose(): void {
		this.changed.dispose();
	}
}
