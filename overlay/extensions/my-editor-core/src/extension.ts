import * as vscode from 'vscode';
import { runTestHooks } from './dev/testHooks';
import { applyFirstRunLayout } from './layout';
import { ModelProvider } from './models/provider';
import { ApiKeys } from './models/secrets';
import { registerPairParticipant } from './pair/participant';
import { ProjectView } from './project/view';

/** Entry point of the built-in core. */
export function activate(context: vscode.ExtensionContext): void {
	const keys = new ApiKeys(context.secrets);
	const models = new ModelProvider(keys);

	const status = vscode.window.createStatusBarItem('myEditor.status', vscode.StatusBarAlignment.Left, 100);
	status.name = 'my_editor';
	status.text = '$(sparkle) my_editor';
	status.tooltip = 'my_editor — set up models';
	status.command = 'myEditor.setApiKey';
	status.show();

	context.subscriptions.push(
		keys,
		models,
		status,
		vscode.lm.registerLanguageModelChatProvider('my-editor', models),
		registerPairParticipant(),
		vscode.window.registerWebviewViewProvider(ProjectView.id, new ProjectView(context)),
		vscode.commands.registerCommand('myEditor.setApiKey', () => keys.promptAndStore()),
		vscode.commands.registerCommand('myEditor.refreshModels', () => models.refresh()),
	);
	void applyFirstRunLayout(context);
	void runTestHooks();
}

export function deactivate(): void {}
