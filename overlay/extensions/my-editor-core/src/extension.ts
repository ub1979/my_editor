import * as vscode from 'vscode';

/** Entry point of the built-in core. M0 only proves the extension ships and loads. */
export function activate(context: vscode.ExtensionContext): void {
	const status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
	status.text = '$(sparkle) my_editor';
	status.tooltip = 'my_editor core is running';
	status.command = 'myEditor.about';
	status.show();

	context.subscriptions.push(
		status,
		vscode.commands.registerCommand('myEditor.about', () => {
			const version = context.extension.packageJSON.version as string;
			void vscode.window.showInformationMessage(`my_editor core ${version} is loaded.`);
		}),
	);
}

export function deactivate(): void {}
