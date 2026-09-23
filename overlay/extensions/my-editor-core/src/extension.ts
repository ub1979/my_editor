import * as vscode from 'vscode';
import { buildBrain, updateBrainFile } from './brain/brain';
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
		registerPairParticipant(context.extensionUri),
		vscode.window.registerWebviewViewProvider(ProjectView.id, new ProjectView(context)),
		vscode.commands.registerCommand('myEditor.setApiKey', () => keys.promptAndStore()),
		vscode.commands.registerCommand('myEditor.refreshModels', () => models.refresh()),
		vscode.commands.registerCommand('myEditor.buildBrain', () => vscode.window.withProgress(
			{ location: vscode.ProgressLocation.Notification, title: 'Building the project brain' },
			async progress => {
				const map = await buildBrain(progress);
				if (map) {
					void vscode.window.showInformationMessage(`Project brain built: ${Object.keys(map.files).length} files mapped.`);
				}
			})),
		vscode.workspace.onDidSaveTextDocument(document => void updateBrainFile(document)),
	);
	void applyFirstRunLayout(context);
	void runTestHooks();
}

export function deactivate(): void {}
