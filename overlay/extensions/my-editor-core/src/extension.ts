import * as vscode from 'vscode';
import { registerEchoModel } from './spike/echoModel';
import { registerPairParticipant } from './spike/pairParticipant';

/** Entry point of the built-in core. */
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
		registerEchoModel(),
		registerPairParticipant(),
	);
}

export function deactivate(): void {}
