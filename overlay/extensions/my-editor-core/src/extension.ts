import * as vscode from 'vscode';
import { buildBrain, updateBrainFile } from './brain/brain';
import { runTestHooks } from './dev/testHooks';
import { applyFirstRunLayout } from './layout';
import { ModelProvider } from './models/provider';
import { Navigator } from './navigator/navigator';
import { ApiKeys } from './models/secrets';
import { registerPairParticipant } from './pair/participant';
import { DecisionDraft, saveDecision } from './records/decisions';
import { ProjectView } from './project/view';
import { offerPythonSupport } from './python';
import { checkFit } from './qa/checkFit';
import { adaptFile } from './project/impact';
import { openNextFile, scaffoldFromTree, toggleFileDone, trackProgress } from './project/tree';

/** Entry point of the built-in core. */
export function activate(context: vscode.ExtensionContext): void {
	const keys = new ApiKeys(context.secrets);
	const models = new ModelProvider(keys);
	const log = vscode.window.createOutputChannel('my_editor', { log: true });
	const navigator = new Navigator(keys, log);

	const status = vscode.window.createStatusBarItem('myEditor.status', vscode.StatusBarAlignment.Left, 100);
	status.name = 'my_editor';
	status.text = '$(sparkle) my_editor';
	status.tooltip = 'my_editor — set up models';
	status.command = 'myEditor.setApiKey';
	status.show();
	navigator.onDidChangeBusy(busy => {
		status.text = busy ? '$(loading~spin) my_editor' : '$(sparkle) my_editor';
		status.tooltip = busy ? 'The navigator is looking at your change' : 'my_editor — set up models';
	});

	context.subscriptions.push(
		keys,
		models,
		log,
		navigator,
		vscode.commands.registerCommand('myEditor.navigator.toggle', () => navigator.toggleSession()),
		vscode.commands.registerCommand('myEditor.navigator.muteFile', () => navigator.toggleFile(vscode.window.activeTextEditor?.document.uri)),
		vscode.commands.registerCommand('myEditor.navigator.clear', () => navigator.clear()),
		status,
		vscode.lm.registerLanguageModelChatProvider('my-editor', models),
		registerPairParticipant(context.extensionUri),
		vscode.window.registerWebviewViewProvider(ProjectView.id, new ProjectView(context)),
		vscode.commands.registerCommand('myEditor.setApiKey', () => keys.promptAndStore()),
		vscode.commands.registerCommand('myEditor.refreshModels', () => models.refresh()),
		vscode.commands.registerCommand('myEditor.checkFit', (uri?: vscode.Uri, uris?: vscode.Uri[]) => checkFit(uri, uris)),
		vscode.commands.registerCommand('myEditor.adaptFile', (path: string, change: string) => adaptFile(path, change)),
		vscode.commands.registerCommand('myEditor.saveDecision', (draft: DecisionDraft) => saveDecision(draft)),
		vscode.commands.registerCommand('myEditor.buildBrain', () => vscode.window.withProgress(
			{ location: vscode.ProgressLocation.Notification, title: 'Building the project brain' },
			async progress => {
				const map = await buildBrain(progress);
				if (map) {
					void vscode.window.showInformationMessage(`Project brain built: ${Object.keys(map.files).length} files mapped.`);
				}
			})),
		vscode.workspace.onDidSaveTextDocument(document => {
			void updateBrainFile(document);
			void trackProgress(document);
		}),
		vscode.commands.registerCommand('myEditor.scaffold', () => scaffoldFromTree()),
		vscode.commands.registerCommand('myEditor.nextFile', () => openNextFile()),
		vscode.commands.registerCommand('myEditor.toggleDone', () => toggleFileDone()),
	);
	void applyFirstRunLayout(context);
	void offerPythonSupport(context);
	void runTestHooks();
}

export function deactivate(): void {}
