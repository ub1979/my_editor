import * as vscode from 'vscode';

/**
 * M0 spike: a fake model that echoes the prompt back. Proves a built-in extension can
 * put its own models into the core chat's model picker without Copilot or an API key.
 */
export function registerEchoModel(): vscode.Disposable {
	const info: vscode.LanguageModelChatInformation = {
		id: 'echo',
		name: 'Echo (spike)',
		family: 'echo',
		version: '0.0.1',
		maxInputTokens: 100_000,
		maxOutputTokens: 4_000,
		capabilities: {},
		isDefault: true,
		isUserSelectable: true,
	};

	return vscode.lm.registerLanguageModelChatProvider('my-editor', {
		provideLanguageModelChatInformation: () => [info],
		async provideLanguageModelChatResponse(_model, messages, _options, progress) {
			const last = messages[messages.length - 1];
			const text = last?.content
				.map(part => (part instanceof vscode.LanguageModelTextPart ? part.value : ''))
				.join('') ?? '';
			progress.report(new vscode.LanguageModelTextPart(`Echo: ${text}`));
		},
		async provideTokenCount(_model, text) {
			const raw = typeof text === 'string' ? text : JSON.stringify(text.content);
			return Math.ceil(raw.length / 4);
		},
	});
}
