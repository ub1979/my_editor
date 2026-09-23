import * as vscode from 'vscode';
import { buildBrain, updateBrainFile } from './brain/brain';
import { PairEngine } from './chat/engine';
import { Proposals } from './chat/proposals';
import { ChatView } from './chat/view';
import { runTestHooks } from './dev/testHooks';
import { applyFirstRunLayout } from './layout';
import { chooseDefaultModel } from './models/catalog';
import { ApiKeys } from './models/secrets';
import { Navigator } from './navigator/navigator';
import { Home } from './project/home';
import { adaptFile } from './project/impact';
import { openNextFile, scaffoldFromTree, toggleFileDone, trackProgress } from './project/tree';
import { ProjectView } from './project/view';
import { offerPythonSupport } from './python';
import { checkFit } from './qa/checkFit';
import { DecisionDraft, saveDecision } from './records/decisions';

/** Entry point of the built-in core. */
export function activate(context: vscode.ExtensionContext): void {
	const keys = new ApiKeys(context.secrets);
	const log = vscode.window.createOutputChannel('my_editor', { log: true });
	const navigator = new Navigator(keys, log);
	const home = new Home(context);
	const proposals = new Proposals();
	const engine = new PairEngine(context.extensionUri, keys, proposals);
	const chat = new ChatView(context, engine, proposals, keys);

	const status = vscode.window.createStatusBarItem('myEditor.status', vscode.StatusBarAlignment.Left, 100);
	status.name = 'my_editor';
	status.text = '$(sparkle) my_editor';
	status.tooltip = 'my_editor: choose the model';
	status.command = 'myEditor.chooseModel';
	status.show();
	navigator.onDidChangeBusy(busy => {
		status.text = busy ? '$(loading~spin) my_editor' : '$(sparkle) my_editor';
		status.tooltip = busy ? 'The navigator is looking at your change' : 'my_editor: choose the model';
	});

	context.subscriptions.push(
		keys,
		log,
		navigator,
		proposals,
		status,
		vscode.window.registerWebviewViewProvider(ChatView.id, chat, { webviewOptions: { retainContextWhenHidden: true } }),
		vscode.window.registerWebviewViewProvider(ProjectView.id, new ProjectView(context, keys)),
		vscode.commands.registerCommand('myEditor.chat.start', (skill: string) => chat.startSkill(skill)),
		vscode.commands.registerCommand('myEditor.chat.ask', (text: string) => chat.ask(text)),
		vscode.commands.registerCommand('myEditor.chat.skills', () => chat.toggleSkills()),
		vscode.commands.registerCommand('myEditor.chat.new', () => chat.newChat()),
		vscode.commands.registerCommand('myEditor.proposal.keep', (uri?: vscode.Uri) => {
			const proposal = proposals.fromUri(uri ?? vscode.window.activeTextEditor?.document.uri);
			return proposal && proposals.keep(proposal.id);
		}),
		vscode.commands.registerCommand('myEditor.proposal.undo', (uri?: vscode.Uri) => {
			const proposal = proposals.fromUri(uri ?? vscode.window.activeTextEditor?.document.uri);
			return proposal && proposals.undo(proposal.id);
		}),
		vscode.commands.registerCommand('myEditor.navigator.toggle', () => navigator.toggleSession()),
		vscode.commands.registerCommand('myEditor.navigator.muteFile', () => navigator.toggleFile(vscode.window.activeTextEditor?.document.uri)),
		vscode.commands.registerCommand('myEditor.navigator.clear', () => navigator.clear()),
		vscode.commands.registerCommand('myEditor.setApiKey', () => keys.promptAndStore()),
		vscode.commands.registerCommand('myEditor.chooseModel', () => chooseDefaultModel(keys)),
		vscode.commands.registerCommand('myEditor.home', () => home.show()),
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
	if (vscode.workspace.workspaceFolders?.length) {
		void home.continuePendingStart();
	} else {
		// No project open: show Home instead of an empty window.
		void vscode.commands.executeCommand('workbench.action.closeSidebar');
		void vscode.commands.executeCommand('workbench.action.closeAuxiliaryBar');
		home.show();
	}
	void applyFirstRunLayout(context);
	void offerPythonSupport(context);
	if (context.extensionMode !== vscode.ExtensionMode.Production) {
		void runTestHooks(keys);
	}
}

export function deactivate(): void {}
