import * as vscode from 'vscode';
import { checkedProjectPath } from '../chat/projectPath';
import { BuildGuideState, confirmBuildStep, readBuildGuide } from './buildStore';
import { StepState } from './buildProgress';
import { nextFile } from './stubs';
import { GuideItem } from './buildGuideItem';
import { firstBuildFile } from './buildBrief';
import { checkpointFiles } from './filePassPlan';
import { canImplement, nextImplementation } from './buildWork';
import type { ProjectBuildState } from './projectBuild';

/** A quiet, deterministic roadmap: opening it reads saved guidance; only explicit actions invoke agents or tasks. */
export class BuildGuide implements vscode.TreeDataProvider<GuideItem>, vscode.Disposable {
	private readonly changed = new vscode.EventEmitter<void>();
	readonly onDidChangeTreeData = this.changed.event;
	private readonly disposables: vscode.Disposable[] = [];
	private timer?: NodeJS.Timeout;
	private guide?: BuildGuideState;
	private readonly view: vscode.TreeView<GuideItem>;

	constructor() {
		this.view = vscode.window.createTreeView('myEditor.buildGuide', { treeDataProvider: this });
		const watcher = vscode.workspace.createFileSystemWatcher('**/.my_editor/{specs/tree.json,build-progress.json}');
		this.disposables.push(this.view, this.changed, watcher,
			watcher.onDidChange(() => this.refresh()), watcher.onDidCreate(() => this.refresh()), watcher.onDidDelete(() => this.refresh()),
			vscode.workspace.onDidSaveTextDocument(() => this.refresh()),
			vscode.workspace.onDidChangeTextDocument(event => {
				if (this.guide?.files.some(file => event.document.uri.fsPath === vscode.Uri.joinPath(this.guide!.root, file.path).fsPath)) { this.refresh(); }
			}),
			vscode.workspace.onDidChangeWorkspaceFolders(() => this.refresh()),
			vscode.commands.registerCommand('myEditor.buildGuide.open', () => this.open()),
			vscode.commands.registerCommand('myEditor.buildGuide.next', () => this.next()),
			vscode.commands.registerCommand('myEditor.buildGuide.following', (uri: vscode.Uri) => this.following(uri)),
			vscode.commands.registerCommand('myEditor.buildGuide.file', (item: GuideItem) => this.openFile(item)),
			vscode.commands.registerCommand('myEditor.buildGuide.plan', () => this.plan()),
			vscode.commands.registerCommand('myEditor.buildGuide.confirm', (item?: GuideItem) => this.confirm(item)),
			vscode.commands.registerCommand('myEditor.buildGuide.test', () => this.testTask()),
			vscode.commands.registerCommand('myEditor.buildGuide.refresh', () => this.refresh()),
		);
	}

	getTreeItem(item: GuideItem): vscode.TreeItem { return item; }
	refresh(): void { clearTimeout(this.timer); this.timer = setTimeout(() => this.changed.fire(), 150); }
	async open(): Promise<void> { await vscode.commands.executeCommand('myEditor.buildGuide.focus'); this.refresh(); }

	async getChildren(item?: GuideItem): Promise<GuideItem[]> {
		if (item) {
			const state = item.state;
			if (!state || item.kind !== 'step') { return []; }
			return [
				...state.step.dependsOn.map(id => this.note(`Needs: ${id}`, 'link')),
				...state.step.tasks.map(task => this.note(`Build: ${task}`, 'tools')),
				...state.step.files.map(file => this.file(file, item.root!)),
				...state.step.checks.map(check => this.note(`Check: ${check}`, 'beaker')),
				...(!state.step.checks.length ? [this.note('Verification checks have not been planned yet.', 'info')] : []),
			];
		}
		const root = vscode.workspace.workspaceFolders?.[0]?.uri;
		if (!root) { return [this.note('Open a project to see its build guide.', 'info')]; }
		const guide = this.guide = await readBuildGuide(root);
		const result: GuideItem[] = [];
		const build = await vscode.commands.executeCommand<ProjectBuildState>('myEditor.projectBuild.status');
		const action = (label: string, command: string) => {
			const item = this.note(label, 'tools'); item.command = { command, title: label }; result.push(item);
		};
		if (build) {
			result.push(this.note(build.message, build.status === 'error' ? 'warning' : 'info'));
			for (const proposal of build.pending) {
				const item = this.note(`Review pending: ${proposal.path}`, 'diff');
				item.command = { command: 'myEditor.projectBuild.review', title: 'Review file', arguments: [proposal.id] }; result.push(item);
			}
			if (build.status === 'review') {
				action('Review file diff', 'myEditor.projectBuild.review');
				action('Keep reviewed file and continue', 'myEditor.projectBuild.keep');
			}
			if (build.status === 'checkpoint') {
				if (build.lastTest) { result.push(this.note(build.lastTest, 'beaker')); }
				const file = build.results?.at(-1)?.path;
				for (const path of file ? checkpointFiles(build.modules ?? [], file, build.options?.interval ?? 'file') : []) {
					const row = this.note(`Review saved file: ${path}`, 'file-code');
					row.command = { command: 'myEditor.fileChat.open', title: 'Review file', arguments: [vscode.Uri.joinPath(root, path)] }; result.push(row);
				}
				action('Run checkpoint tests…', 'myEditor.projectBuild.test');
				if (build.lastTestStatus === 'failed') {
					result.push(this.note('Tests failed. Fix the failures and rerun tests before continuing.', 'warning'));
				} else {
					action(build.lastTestStatus !== 'passed' ? 'Continue with tests unverified'
						: build.remaining ? 'Continue after review' : 'Finish after review', 'myEditor.projectBuild.resume');
				}
			}
			if (build.needsAnswer) { action('Answer question and retry…', 'myEditor.projectBuild.answer'); }
			if (build.status !== 'complete') { action('Saving permissions for this run…', 'myEditor.projectBuild.saving'); }
			action('Show file results', 'myEditor.projectBuild.report');
			if (['paused', 'error'].includes(build.status)) { action('Resume run', 'myEditor.projectBuild.resume'); }
			if (['running', 'review', 'checkpoint'].includes(build.status)) { action('Stop run', 'myEditor.projectBuild.pause'); }
		}
		if (!build || ['complete', 'error', 'paused'].includes(build.status)) {
			action('Build everything…', 'myEditor.projectBuild.start'); action('QA everything…', 'myEditor.projectQA.start');
		}
		this.view.description = guide.plan ? `${guide.steps.filter(step => step.status === 'verified').length}/${guide.steps.length} checked` : 'Saved file order';
		if (guide.problems.length) { return [...result, ...guide.problems.map(problem => this.note(problem, 'warning'))]; }
		if (!guide.plan) {
			const add = this.note(guide.files.length ? 'Add build order and test checks' : 'Plan the files with Flow', 'list-ordered');
			add.command = { command: 'myEditor.buildGuide.plan', title: 'Plan build steps' }; result.push(add);
			if (guide.files.length) { result.push(this.note('Existing tree order; dependencies and checks are not yet planned.', 'info')); }
		} else {
			const entry = this.file(guide.plan.entryPoint, root.toString());
			entry.label = `Application / library entry: ${guide.plan.entryPoint}`; result.push(entry);
		}
		const next = this.nextState(guide);
		if (next) {
			const start = this.file(firstBuildFile(guide, next), root.toString());
			start.label = `Start here: ${next.step.title}`; start.iconPath = new vscode.ThemeIcon('play'); result.push(start);
		} else if (guide.plan) {
			result.push(this.note(guide.steps.every(step => step.status === 'verified')
				? 'All step checks confirmed. Run the final project integration checks.'
				: 'No unchanged stubs remain. Review existing code and run the step checks; implementation is not verification.', 'check-all'));
		}
		for (const [index, state] of guide.steps.entries()) {
			const step = new GuideItem(`${index + 1}. ${state.step.title}`, 'step', state, undefined, root.toString());
			step.description = state.status === 'blocked' && canImplement(guide, state) ? 'Coding available · prerequisite checks pending'
				: ({ ready: 'To build / check', blocked: 'Waiting for prerequisite code / checks', verified: 'Checks confirmed by you', changed: 'Changed · recheck' })[state.status];
			step.iconPath = new vscode.ThemeIcon(({ ready: 'circle-outline', blocked: 'lock', verified: 'pass', changed: 'refresh' })[state.status]);
			step.contextValue = guide.plan && ['ready', 'changed'].includes(state.status) ? 'buildStepReady' : 'buildStep';
			step.tooltip = [...state.step.tasks, ...state.step.checks.map(check => `Verify: ${check}`)].join('\n');
			result.push(step);
		}
		return result;
	}

	private note(label: string, icon: string): GuideItem {
		const item = new GuideItem(label, 'note'); item.iconPath = new vscode.ThemeIcon(icon); item.tooltip = label; return item;
	}
	private file(path: string, root: string): GuideItem {
		const item = new GuideItem(path, 'file', undefined, path, root);
		item.contextValue = 'buildGuideFile'; item.resourceUri = vscode.Uri.joinPath(vscode.Uri.parse(root), path);
		item.iconPath = new vscode.ThemeIcon('file-code');
		item.command = { command: 'myEditor.buildGuide.file', title: 'Open file', arguments: [item] }; return item;
	}
	private nextState(guide: BuildGuideState): StepState | undefined {
		if (guide.plan) { return nextImplementation(guide); }
		const file = nextFile(guide.files); return guide.steps.find(step => step.step.files.includes(file?.path ?? ''));
	}

	async next(): Promise<void> {
		const root = vscode.workspace.workspaceFolders?.[0]?.uri;
		if (!root) { return; }
		const guide = await readBuildGuide(root), next = this.nextState(guide);
		await this.open();
		if (next) { await this.openFile(this.file(firstBuildFile(guide, next), root.toString())); }
	}

	private async following(uri?: vscode.Uri): Promise<void> {
		const root = vscode.workspace.workspaceFolders?.[0]?.uri;
		if (!root || !uri || vscode.workspace.getWorkspaceFolder(uri)?.uri.toString() !== root.toString()) { return; }
		const guide = await readBuildGuide(root), path = vscode.workspace.asRelativePath(uri, false);
		const state = guide.steps.find(state => state.step.files.includes(path));
		const next = state?.step.files[state.step.files.indexOf(path) + 1];
		if (next && state && canImplement(guide, state)) { await this.openFile(this.file(next, root.toString())); }
		else { await this.open(); }
	}

	private async openFile(item: GuideItem): Promise<void> {
		const root = vscode.workspace.workspaceFolders?.[0]?.uri;
		if (!root || item?.root !== root.toString() || !item.path) { return; }
		try {
			const guide = await readBuildGuide(root);
			if (!guide.files.some(file => file.path === item.path)) { throw new Error('This file is no longer in the saved plan.'); }
			const uri = vscode.Uri.file(checkedProjectPath(root.fsPath, item.path, true));
			try { await vscode.workspace.fs.stat(uri); }
			catch { await vscode.commands.executeCommand('myEditor.scaffold'); }
			await vscode.window.showTextDocument(uri, { preview: false });
			await vscode.commands.executeCommand('myEditor.fileChat.open', uri);
		} catch (error) { void vscode.window.showWarningMessage(String(error instanceof Error ? error.message : error)); }
	}

	private async plan(): Promise<void> {
		await vscode.commands.executeCommand('myEditor.chat.ask', '/tree Update only tree.json to add a dependency-aware buildPlan '
			+ 'with a real entry point, ordered build steps, implementation tasks, test checks and per-source-file estimatedLines. '
			+ 'Preserve saved paths, roles, requirement links, architecture anchors and statuses. Split responsibilities expected to exceed '
			+ '600 lines with a concrete reason; preserve all behavior. Keep requirements and architecture as saved.');
	}

	private async confirm(item?: GuideItem): Promise<void> {
		const root = vscode.workspace.workspaceFolders?.[0]?.uri;
		if (!root) { return; }
		try {
			const guide = await readBuildGuide(root);
			if (item && item.root !== root.toString()) { return; }
			const state = item?.state ?? guide.steps.find(step => step.status === 'ready' || step.status === 'changed');
			if (!state) { return; }
			await confirmBuildStep(root, state.step.id, state.signature);
			this.refresh();
			void vscode.window.showInformationMessage(`Recorded your confirmation: ${state.step.title}. The next ready step is available in Build guide.`);
		} catch (error) { void vscode.window.showWarningMessage(error instanceof Error ? error.message : String(error)); }
	}

	private async testTask(): Promise<void> {
		const tasks = (await vscode.tasks.fetchTasks()).filter(task => task.group?.id === vscode.TaskGroup.Test.id);
		if (!tasks.length) {
			void vscode.window.showInformationMessage('No test task is configured. Follow the step’s listed checks, or add a test task in .vscode/tasks.json.'); return;
		}
		const choice = await vscode.window.showQuickPick(tasks.map(task => ({ label: task.name, description: task.source, task })),
			{ title: 'Run a configured test task', placeHolder: 'Review its result against the step’s checks before confirming them' });
		if (choice) { await vscode.tasks.executeTask(choice.task); }
	}

	dispose(): void { clearTimeout(this.timer); vscode.Disposable.from(...this.disposables).dispose(); }
}
