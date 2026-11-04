import * as vscode from 'vscode';
import type { PairEngine } from '../chat/engine';
import { Proposal, Proposals } from '../chat/proposals';
import { readBuildGuide, BuildGuideState } from './buildStore';
import { buildPlanIdentity, canImplement, needsImplementation } from './buildWork';
import { assertPlanningReady, readPlanningDocuments } from './planningFiles';
import { digest } from './buildProgress';
import { redact } from '../records/redact';

export interface ProjectBuildState {
	version: 1; root: string; identity: string;
	status: 'running' | 'review' | 'paused' | 'error' | 'complete';
	step?: string; modelKey?: string; message: string; total: number; remaining: number;
	pending: { id: string; path: string }[];
}
const STORAGE = 'myEditor.projectBuild.v1';

/** A durable whole-project request: reviewed batches advance without another chat prompt. */
export class ProjectBuild implements vscode.Disposable {
	private state?: ProjectBuildState;
	private active?: Promise<void>;
	private cancellation?: vscode.CancellationTokenSource;
	private saving: Promise<void> = Promise.resolve();
	private keeping = false;
	private readonly disposables: vscode.Disposable[] = [];
	private readonly status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 90);

	constructor(private readonly context: vscode.ExtensionContext, private readonly engine: PairEngine,
		private readonly proposals: Proposals) {
		const saved = context.workspaceState.get<ProjectBuildState>(STORAGE);
		if (saved?.version === 1) {
			this.state = { ...saved, pending: [], status: saved.status === 'complete' ? 'complete' : 'paused',
				message: saved.status === 'complete' ? saved.message : 'Build paused after reopening. Resume rebuilds any unkept batch from the current saved files.' };
		}
		this.status.command = 'myEditor.buildGuide.open';
		this.disposables.push(this.status, proposals.onDidChange(proposal => { void this.changed(proposal); }),
			vscode.commands.registerCommand('myEditor.projectBuild.start', (modelKey?: string) => this.start(modelKey)),
			vscode.commands.registerCommand('myEditor.projectBuild.resume', () => this.resume()),
			vscode.commands.registerCommand('myEditor.projectBuild.pause', () => this.pause()),
			vscode.commands.registerCommand('myEditor.projectBuild.keep', () => this.keepBatch()),
			vscode.commands.registerCommand('myEditor.projectBuild.review', (id?: string) => this.review(id)),
			vscode.commands.registerCommand('myEditor.projectBuild.status', () => this.snapshot()));
		this.render();
	}

	private root(): vscode.Uri | undefined { return vscode.workspace.workspaceFolders?.[0]?.uri; }
	private snapshot(): ProjectBuildState | undefined {
		return this.state?.root === this.root()?.toString() ? structuredClone(this.state) : undefined;
	}
	private async identity(guide: BuildGuideState): Promise<string> {
		const docs = await readPlanningDocuments(guide.root);
		return digest(JSON.stringify({ plan: buildPlanIdentity(guide), requirements: docs.requirements, architecture: docs.architecture }));
	}
	private async save(): Promise<void> {
		const snapshot = this.state && structuredClone(this.state);
		this.saving = this.saving.catch(() => {}).then(() => this.context.workspaceState.update(STORAGE, snapshot));
		this.render(); await this.saving;
	}
	private render(): void {
		if (!this.state) { return; }
		this.status.text = `$(tools) Build: ${this.state.status} · ${this.state.remaining} files remaining`;
		this.status.tooltip = this.state.message; this.status.show();
		void vscode.commands.executeCommand('myEditor.buildGuide.refresh');
	}

	async start(modelKey?: string): Promise<string> {
		if (this.active && this.state?.status !== 'running') { await this.active; }
		if (this.active || this.state?.pending.length) {
			if (!this.active) { await this.resume(); } else { await this.review(); }
			return this.state?.message ?? 'The project build is already running.';
		}
		const root = this.root();
		if (!root) { return 'Open a project with a saved build plan first.'; }
		try {
			await assertPlanningReady(root, 'tree');
			const guide = await readBuildGuide(root);
			if (!guide.plan || guide.problems.length) { throw new Error('Save a valid dependency-aware build plan before building the whole project.'); }
			const remaining = guide.files.filter(file => needsImplementation(guide, file.path)).length;
			this.state = { version: 1, root: root.toString(), identity: await this.identity(guide), status: 'running',
				message: 'Preparing the remaining planned files in dependency order. Review each batch and Keep it; the next batch starts automatically. Existing content is preserved. Tests remain unverified.',
				total: guide.files.length, remaining, pending: [], modelKey };
			await this.save(); this.launch();
			await vscode.commands.executeCommand('myEditor.buildGuide.open');
			return this.state.message;
		} catch (error) {
			const message = `Build could not start: ${error instanceof Error ? error.message : String(error)}`;
			void vscode.window.showWarningMessage(message); return message;
		}
	}

	async resume(): Promise<void> {
		if (this.active && this.state?.status === 'running') { return; }
		if (this.active) { await this.active; }
		if (!this.snapshot()) { await this.start(); return; }
		this.state!.pending = this.state!.pending.filter(item => this.proposals.get(item.id)?.state === 'open');
		if (this.state!.pending.length) { this.state!.status = 'review'; await this.save(); await this.review(); return; }
		this.state!.status = 'running'; await this.save(); this.launch();
	}
	async pause(): Promise<void> {
		if (!this.state) { return; }
		this.state.status = 'paused'; this.state.message = 'Build paused. Kept code and open review proposals are preserved.';
		this.cancellation?.cancel(); await this.save();
	}
	private launch(): void {
		if (this.active) { return; }
		this.active = this.run().finally(() => {
			this.active = undefined;
			if (this.state?.status === 'review' && !this.state.pending.length) { void this.resume(); }
		});
	}

	private async run(): Promise<void> {
		const state = this.state;
		if (!state) { return; }
		const token = this.cancellation = new vscode.CancellationTokenSource();
		try {
			while (state.status === 'running' && !token.token.isCancellationRequested) {
				if (state.root !== this.root()?.toString()) { throw new Error('The project changed. Reopen the original project to resume.'); }
				const guide = await readBuildGuide(vscode.Uri.parse(state.root));
				if (guide.problems.length || state.identity !== await this.identity(guide)) {
					throw new Error('The saved plan changed. Review it, then use Build whole project to start from the updated plan.');
				}
				state.remaining = guide.files.filter(file => needsImplementation(guide, file.path)).length;
				const next = guide.steps.find(item => item.step.files.some(path => needsImplementation(guide, path)));
				if (!next) {
					state.status = 'complete'; state.message = 'No planned stubs remain. Existing code was preserved; run the build, tests and integration checks before calling the project complete.';
					await this.save(); break;
				}
				const targets = next.step.files.filter(path => needsImplementation(guide, path));
				if (!canImplement(guide, next)) { throw new Error('Save prerequisite code before resuming this build step.'); }
				if (next.step.files.some(path => guide.snapshots.get(path)?.dirty)) { throw new Error('Save or discard unsaved files in this step before resuming the project build.'); }
				state.step = next.step.title; state.message = `Preparing ${next.step.title}: ${targets.length} remaining files in this step.`;
				await this.save();
				let failure = '', answer = '';
				await this.engine.run({ mode: 'chat', characterId: 'ada', buildFiles: targets, modelKey: state.modelKey,
					buildHashes: Object.fromEntries(targets.map(path => [path, guide.snapshots.get(path)?.hash])),
					text: `Implement these remaining files completely from the saved plan: ${JSON.stringify(targets)}.\n`
						+ `Current build step: ${JSON.stringify(next.step)}. Preserve all existing implemented files and the saved planning documents. `
						+ 'Read the real prerequisite source when its interfaces matter. Prepare every requested file using propose_file; source files must stay under 300 lines without omitting behavior. '
						+ 'A final reply is not completion unless the requested file proposals were actually prepared.' }, [], {
					text: text => { answer += text; }, action: () => {},
					progress: message => { if (message) { this.status.tooltip = `${state.step}: ${message}`; } },
					error: message => { failure = message; },
					proposal: proposal => {
						state.pending = state.pending.filter(item => item.path !== proposal.relativePath);
						state.pending.push({ id: proposal.id, path: proposal.relativePath }); void this.save();
					},
				}, token.token);
				if (state.status !== 'running' || token.token.isCancellationRequested) { break; }
				state.pending = state.pending.filter(item => this.proposals.get(item.id)?.state === 'open');
				if (state.pending.length) {
					state.status = 'review'; state.message = `${state.pending.length} file proposals await review for ${state.step}. Keep reviewed batch to continue automatically. ${state.remaining} files were pending at the start of this batch. Tests are not verified.`;
					await this.save(); break;
				}
				const current = await readBuildGuide(guide.root);
				if (targets.some(path => needsImplementation(current, path))) {
					throw new Error(failure || `The model did not finish this batch. ${answer.slice(0, 700) || 'No file proposals were returned.'}`);
				}
			}
		} catch (error) {
			if (!token.token.isCancellationRequested) {
				state.status = 'error'; state.message = redact(error instanceof Error ? error.message : String(error)); await this.save();
			}
		} finally { token.dispose(); if (this.cancellation === token) { this.cancellation = undefined; } }
	}

	private async changed(proposal: Proposal): Promise<void> {
		const state = this.state;
		if (!state?.pending.some(item => item.id === proposal.id)) { return; }
		state.pending = state.pending.filter(item => item.id !== proposal.id);
		if (proposal.state === 'undone') {
			state.status = 'paused'; state.message = 'A build proposal was undone. Review the decision before resuming.'; this.cancellation?.cancel();
		}
		await this.save();
		if (!this.active && !this.keeping && state.status === 'review' && !state.pending.length) {
			state.status = 'running'; await this.save(); this.launch();
		}
	}
	private async review(id?: string): Promise<void> {
		await vscode.commands.executeCommand('myEditor.buildGuide.open');
		const first = this.snapshot()?.pending.find(item => (!id || id === item.id) && this.proposals.get(item.id)?.state === 'open');
		if (first) { await this.proposals.show(first.id); }
	}
	private async keepBatch(): Promise<void> {
		if (this.state?.status === 'review' && this.active) { await this.active; }
		const state = this.snapshot();
		if (!state || this.active || this.keeping || state.status !== 'review') { return; }
		this.keeping = true;
		try {
			for (const item of state.pending) {
				if (this.proposals.get(item.id)?.state === 'open' && !await this.proposals.keep(item.id)) { return; }
			}
		} finally { this.keeping = false; }
		if (this.state?.status === 'review' && !this.state.pending.length) { await this.resume(); }
	}
	dispose(): void { this.cancellation?.cancel(); vscode.Disposable.from(...this.disposables).dispose(); }
}
