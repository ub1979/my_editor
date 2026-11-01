import * as vscode from 'vscode';

/** One persistent choice controls unsolicited reviews and suggestions; explicit commands work in either mode. */
export async function chooseAssistanceMode(): Promise<void> {
	const picked = await vscode.window.showQuickPick([
		{ label: 'Automatic', description: 'Review after a quiet spell while you type; show focused suggestions', value: 'auto' },
		{ label: 'Manual', description: 'Respond when you run Review or ask Pair', value: 'manual' },
	], { title: 'Coding assistance' });
	if (picked) { await vscode.workspace.getConfiguration('myEditor').update('assistance.mode', picked.value, vscode.ConfigurationTarget.Global); }
}

export function assistanceStatus(): vscode.Disposable {
	const status = vscode.window.createStatusBarItem('myEditor.assistance', vscode.StatusBarAlignment.Left, 99);
	status.name = 'Coding assistance';
	status.command = 'myEditor.assistance.mode';
	const update = () => {
		const automatic = vscode.workspace.getConfiguration('myEditor').get('assistance.mode', 'auto') === 'auto';
		status.text = automatic ? '$(eye) AI: Auto' : '$(hand) AI: Manual';
		status.tooltip = 'Choose automatic or manual coding assistance';
		status.show();
	};
	update();
	return vscode.Disposable.from(status, vscode.workspace.onDidChangeConfiguration(event => {
		if (event.affectsConfiguration('myEditor.assistance.mode')) { update(); }
	}));
}
