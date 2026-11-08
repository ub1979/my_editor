import * as vscode from 'vscode';
import type { PairEngine } from '../chat/engine';
import { Proposal, Proposals } from '../chat/proposals';
import { filePassReport, saveQAReport } from './filePassReport';
import { BuildGuideState, readBuildGuide } from './buildStore';
import { redact } from '../records/redact';
import { choosePass } from './filePassSetup';
import { checkpointDue, checkpointFiles, FileResult, PassModule, PassOptions, passTargets } from './filePassPlan';
import { passIdentity, passScope } from './filePassScope';
import { preparePassFile } from './filePassWorker';
import { fileContentProblem } from './filePassPolicy';
import { filePassChanges } from './filePassEvents';
import { passSource } from './filePassSource';
import { CheckpointTestResult, runCheckpointTest } from './filePassTests';
import { applyPrepared } from './filePassReview';
import { DependencyRequest, PlannedDependencies, prioritizeDependencies } from './filePassDependencies';
import { stubContent } from './stubs';
import { savingChoices } from './filePassSaving';
import { existingImplementation, unchangedResults } from './filePassWorkflow';
import { authorizeUnattended } from './filePassPermissions';
import { decisionAnswerPrompt } from './fileDecision';
import { PlannedRepairs, QueuedRepair, RepairRecord, RepairSpec, queueRepairs, repairContext } from './filePassRepairs';
import { approveRepairAdditions, repairScope } from './filePassRepairScope';
import { scheduleRepairDependencies } from './repairDependencies';
import { PreparedBatch } from './preparedBatch';
import { prepareFileBatch } from './filePassBatch';
import { relatedBuildFiles } from './relatedBuildFiles';
import { chooseBuildSpeed } from './filePassSpeed';
import { readPlanningDocuments } from './planningFiles';
import { verifyProject } from './projectVerification';
import { TestRepairAttempt } from './testRepairPlan';
import { CheckCommandEvidence, checkpointEvidence } from './checkpointEvidence';

export interface ProjectBuildState {
	version: 1; root: string; identity: string;
	status: 'running' | 'review' | 'checkpoint' | 'paused' | 'error' | 'complete';
	step?: string; modelKey?: string; message: string; total: number; remaining: number;
	pending: { id: string; path: string }[];
	options?: PassOptions; modules?: PassModule[]; results?: FileResult[]; instruction?: string; lastTest?: string; reportPath?: string; needsAnswer?: boolean;
	answers?: { path: string; text: string }[]; testHistory?: string[];
	currentFile?: { path: string; role?: string }; activity?: string;
	preview?: { path: string; content: string }; activityAt?: number;
	dependencyRequests?: DependencyRequest[];
	lastTestStatus?: CheckpointTestResult['status'];
	phase?: 'build' | 'qa'; buildResults?: FileResult[]; buildTest?: string;
	testEvidenceRefreshed?: boolean;
	repairQueue?: QueuedRepair[]; repairHistory?: RepairRecord[];
	repairAdditions?: RepairSpec[];
	repairDependencyRequests?: DependencyRequest[];
	batchPaths?: string[];
	testRepairs?: TestRepairAttempt[]; testRepairEvidence?: string;
	lastTestCommands?: CheckCommandEvidence[];
	verificationStarted?: boolean; repairVerificationPending?: boolean;
}
const STORAGE = 'myEditor.projectBuild.v1';

/** One workspace queue for Build and QA. Only the active user-authorized run may advance it. */
export class ProjectBuild implements vscode.Disposable {
	private state?: ProjectBuildState;
	private active?: Promise<void>;
	private configuring = false;
	private cancellation?: vscode.CancellationTokenSource;
	private testing?: vscode.CancellationTokenSource;
	private saving: Promise<void> = Promise.resolve();
	private readonly disposables: vscode.Disposable[] = [];
	private readonly preparedBatch = new PreparedBatch();
	private readonly individualFiles = new Set<string>();
	private readonly status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 90);

	constructor(private readonly context: vscode.ExtensionContext, private readonly engine: PairEngine, private readonly proposals: Proposals) {
		const saved = context.workspaceState.get<ProjectBuildState>(STORAGE);
		if (saved?.version === 1) {
			this.state = { ...saved, pending: [], preview: undefined, batchPaths: undefined, status: ['complete', 'error'].includes(saved.status) ? saved.status : 'paused',
				message: ['complete', 'error'].includes(saved.status) ? saved.message : 'Paused after reopening. Resume rebuilds any unkept batch from the current saved files. ' + saved.message };
		}
		this.status.command = 'myEditor.buildGuide.open';
		const register = vscode.commands.registerCommand;
		this.disposables.push(this.status, proposals.onDidChange(p => { void this.changed(p); }),
			vscode.workspace.onDidChangeWorkspaceFolders(() => { void this.pause(); }),
			register('myEditor.projectBuild.start', (modelKey?: string) => this.start('Build', undefined, modelKey)),
			register('myEditor.projectQA.start', (modelKey?: string) => this.start('QA', undefined, modelKey)),
			register('myEditor.projectBuild.file', (uri?: vscode.Uri) => this.selected('Build', uri)),
			register('myEditor.projectQA.file', (uri?: vscode.Uri) => this.selected('QA', uri)),
			register('myEditor.projectBuild.model', () => this.changeModel()),
			register('myEditor.projectBuild.saving', () => this.changeSaving()),
			register('myEditor.projectBuild.speed', () => this.changeSpeed()),
			register('myEditor.projectBuild.buildFirst', () => this.buildFirst()),
			register('myEditor.projectBuild.answer', () => this.answer()),
			register('myEditor.projectBuild.resume', () => this.resume()),
			register('myEditor.projectBuild.pause', () => this.pause()),
			register('myEditor.projectBuild.keep', () => this.keep()),
			register('myEditor.projectBuild.review', (id?: string) => this.review(id)),
			register('myEditor.projectBuild.report', () => this.report()),
			register('myEditor.projectBuild.test', () => this.test()),
			register('myEditor.projectBuild.status', () => this.snapshot()));
		this.render();
	}

	private root() { return vscode.workspace.workspaceFolders?.[0]?.uri; }
	private snapshot() { return this.state?.root === this.root()?.toString() ? structuredClone(this.state) : undefined; }
	private async save() {
		const snapshot = structuredClone(this.state);
		this.saving = this.saving.catch(() => {}).then(() => this.context.workspaceState.update(STORAGE, snapshot));
		this.render(); filePassChanges.fire(); await this.saving;
	}
	private render() {
		const s = this.state;
		if (!s || s.root !== this.root()?.toString()) { this.status.hide(); return; }
		this.status.text = `$(tools) ${s.options?.kind ?? 'Build'}: ${s.status} · ${s.remaining} remaining`;
		this.status.tooltip = s.message; this.status.show(); void vscode.commands.executeCommand('myEditor.buildGuide.refresh');
	}
	private warn(message: string) { void vscode.window.showWarningMessage(message); return message; }
	private selected(kind: PassOptions['kind'], target?: vscode.Uri | vscode.TreeItem) {
		const uri = target instanceof vscode.TreeItem ? target.resourceUri : target ?? vscode.window.activeTextEditor?.document.uri;
		if (!uri || uri.scheme !== 'file' || vscode.workspace.getWorkspaceFolder(uri)?.uri.toString() !== this.root()?.toString()) {
			return this.warn('Select a file in the active project first.');
		}
		return this.start(kind, vscode.workspace.asRelativePath(uri, false));
	}

	async start(kind: PassOptions['kind'], selected?: string, modelKey?: string): Promise<string> {
		const root = this.root();
		if (!root) { return this.warn('Open a project first.'); }
		if (this.active && this.state && ['paused', 'complete', 'error'].includes(this.state.status)) { await this.active; }
		if (this.configuring || this.active || this.testing || this.snapshot()?.pending.length) {
			void vscode.commands.executeCommand('myEditor.buildGuide.open');
			return this.warn('A file run or review is open. Stop it and resolve its open diff before starting another run.');
		}
		this.configuring = true;
		try {
			const { guide, groups, identity } = await passScope(root, kind, selected);
			const previous = this.snapshot();
			if (!selected && previous?.options?.kind === kind && previous.identity === identity && previous.status !== 'complete') {
				const decision = await vscode.window.showQuickPick(['Resume saved run', 'Start a new run'],
					{ title: 'An unfinished run already exists', placeHolder: `${previous.results?.length ?? 0} files processed. Resume preserves this progress.` });
				if (decision !== 'Start a new run') {
					if (decision) { this.configuring = false; await this.resume(); }
					return decision ? 'Resuming saved progress.' : 'Run cancelled.';
				}
			}
			if (selected) { await passSource(root, selected); }
			const options = await choosePass(kind, groups, selected);
			if (!options) { return 'Run cancelled.'; }
			let instruction: string | undefined;
			if (kind === 'Build' && options.selected && !guide.files.some(f => f.path === options.selected)) {
				instruction = await vscode.window.showInputBox({ title: `Build ${options.selected}`, prompt: 'What behavior should this unplanned file implement?' });
				if (!instruction?.trim()) { return 'Run cancelled.'; }
			}
			const modules = passTargets(groups, options.selected);
			const total = modules.reduce((n, m) => n + m.files.length, 0);
			if (identity !== await passIdentity(root)) { return this.warn('The saved plan changed during setup. Start again.'); }
			if (this.root()?.toString() !== root.toString()) { return 'Project changed during setup. Start again.'; }
			this.state = { version: 1, root: root.toString(), identity, options, modules, results: [], instruction, status: 'running',
				phase: options.workflow ? 'build' : undefined,
				total, remaining: total, pending: [], modelKey, message: `${kind} starting · ${modules.length} module(s), ${total} file(s).` };
			await this.save(); this.launch();
			await vscode.commands.executeCommand('myEditor.chat.agent', kind === 'Build' ? 'ada' : 'poppy'); return this.state.message;
		} catch (error) { return this.warn(String(error instanceof Error ? error.message : error)); }
		finally { this.configuring = false; }
	}

	async pause() {
		if (!this.state || this.state.status === 'complete') { return; }
		this.preparedBatch.clear(); this.state.batchPaths = undefined;
		this.cancellation?.cancel(); this.testing?.cancel();
		this.state.status = 'paused'; this.state.message = 'Stopped. Saved work and open review diffs are available in the guide.';
		await this.save();
	}
	async resume() {
		if (this.configuring || this.state?.status === 'running') { return; }
		if (this.testing && this.active && this.state?.status === 'checkpoint') {
			await this.active;
			if (this.state?.status !== 'checkpoint') { return; }
		}
		if (this.testing) { return; }
		if (this.snapshot()?.pending.length) { await this.review(); return; }
		if (this.active) { await this.active; }
		if (!this.snapshot()) { return this.warn('Reopen the original project to resume its queue.'); }
		const state = this.state!;
		if (state.pending.length) { await this.review(); return; }
		if (state.status === 'complete') { return; }
		if (state.lastTestStatus === 'failed' || !state.remaining && state.lastTestStatus !== 'passed' && !state.repairVerificationPending) {
			state.status = 'checkpoint';
			state.message = state.lastTestStatus === 'failed' ? 'The selected test task failed. Review its retained output and rerun checks before continuing.'
				: 'Required checks remain unverified. Run checks before continuing.';
			await this.save(); if (state.options?.unattended && (state.phase === 'qa' || state.options.kind === 'QA')) { await this.test(); } return;
		}
		if (!state.options) { return this.start('Build', undefined, state.modelKey); }
		state.status = 'running'; state.needsAnswer = false; this.launch();
	}
	private launch() {
		if (this.active || this.state?.status !== 'running') { return; }
		const token = this.cancellation = new vscode.CancellationTokenSource();
		this.active = this.run(this.state, token.token).catch(async error => {
			if (!token.token.isCancellationRequested) {
				this.state!.status = 'error'; this.state!.needsAnswer = /^BLOCKED\b/.test(error instanceof Error ? error.message : String(error));
				this.state!.message = redact(String(error instanceof Error ? error.message : error)); await this.save();
				void vscode.window.showWarningMessage(`${this.state!.options?.kind ?? 'Build'} stopped: ${this.state!.message}`, 'Open agent chat')
					.then(choice => { if (choice) { void vscode.commands.executeCommand('myEditor.chat.agent', this.state!.options?.kind === 'QA' ? 'poppy' : 'ada'); } });
			}
		}).finally(() => { this.preparedBatch.clear(); this.individualFiles.clear(); this.state!.batchPaths = undefined; token.dispose(); this.cancellation = undefined; this.active = undefined; });
	}

	private async validatePlan(state: ProjectBuildState, root: vscode.Uri) {
		if (state.root !== this.root()?.toString() || state.identity !== await passIdentity(root)) {
			throw new Error('The project or saved plan changed. Resolve any open diff and start a new run.');
		}
	}

	private async recheckResults(state: ProjectBuildState, root: vscode.Uri, token: vscode.CancellationToken) {
		if (state.phase === 'build') {
			const retained = await unchangedResults(state.results!, async path => {
				if (token.isCancellationRequested) { throw new Error('Stopped.'); }
				return (await passSource(root, path)).hash;
			});
			state.results = retained; state.remaining = state.total - retained.length; return;
		}
		// Changed targets lose their review; unrelated files do not lose theirs merely by array position.
		state.results = await unchangedResults(state.results!, async path => (await passSource(root, path)).hash);
		state.remaining = state.total - state.results.length;
	}

	private async run(state: ProjectBuildState, token: vscode.CancellationToken) {
		const root = vscode.Uri.parse(state.root);
		const guide = await readBuildGuide(root);
		if (guide.problems.length) { throw new Error(guide.problems.join('\n')); }
		await this.validatePlan(state, root); await this.recheckResults(state, root, token);
		if (state.repairVerificationPending && !state.repairQueue?.length
			&& state.testRepairs?.at(-1)?.files.every(file => state.results!.some(result => result.path === file.path))) {
			state.status = 'checkpoint'; await this.save(); await this.test();
			if (token.isCancellationRequested || !['running'].includes(state.status) && state.lastTestStatus !== 'passed') { return; }
			state.status = 'running';
		}
		if (state.options?.kind === 'QA' && !state.options.selected && state.options.unattended && state.options.verificationChecks && !state.verificationStarted) {
			state.status = 'checkpoint'; await this.save(); await this.test();
			if (token.isCancellationRequested || !['running'].includes(state.status) && state.lastTestStatus !== 'passed') { return; }
			state.status = 'running';
		}
		// Older saved runs retained exit codes only. Recollect approved test evidence once
		// when resuming QA so the agent can diagnose failures from actual output.
		if (state.phase === 'qa' && state.options?.unattended && state.buildTest
			&& !state.buildTest.includes('Test output:') && !state.testEvidenceRefreshed) {
			const checked = await runCheckpointTest(root, token, state.modules!.flatMap(group => group.files),
				() => state.options?.unattended === true, message => {
					state.activity = message; state.activityAt = Date.now(); filePassChanges.fire();
				});
			if (token.isCancellationRequested) { return; }
			state.buildTest = checked.message; state.testEvidenceRefreshed = true;
			(state.testHistory ??= []).push(`Refreshed QA test evidence: ${checked.message}`);
			await this.save();
		}
		if (!state.remaining && !state.repairQueue?.length && state.phase === 'build') {
			if (state.lastTestStatus !== 'passed') { state.status = 'checkpoint'; await this.save(); await this.test(); }
			if (state.lastTestStatus === 'passed') { await this.beginQA(state, root, token); }
			else if (state.status !== 'running') { return; }
		}
		while (state.results!.length < state.total || state.repairQueue?.length) {
			const done = new Set(state.results!.map(result => result.path));
			const repair = state.repairQueue?.[0];
			const candidates = state.modules!.flatMap(group => group.files.map(path => ({ group, path })));
			const target = state.repairVerificationPending && state.testRepairs?.at(-1)?.files.find(file => !done.has(file.path));
			const next = candidates.find(item => repair ? item.path === repair.path : target ? item.path === target.path : !done.has(item.path));
			if (!next) { throw new Error('The saved queue is missing an unfinished file. Start a new run from the plan.'); }
			const { group, path } = next;
			if (token.isCancellationRequested) { return; }
			await this.validatePlan(state, root);
			state.step = group.title;
			state.currentFile = { path, role: guide.files.find(file => file.path === path)?.role };
			state.preview = undefined; state.activityAt = Date.now();
			state.activity = 'Reading the file and saved project context…';
			state.message = repair ? `Repairing ${path} · ${state.repairQueue!.length} repair file(s) remaining · then return to ${repair.origin}`
				: `${state.options!.kind} · ${group.title} · ${path} (${state.results!.length + 1}/${state.total})`;
			await this.save();
			let result: FileResult;
			try { result = await this.workOnFile(state, guide, path, token); }
			catch (error) {
				this.preparedBatch.clear(); state.batchPaths = undefined;
				if (error instanceof PlannedRepairs) {
					if (token.isCancellationRequested) { return; }
					const docs = await readPlanningDocuments(root);
					const answers = this.fileAnswers(state, path);
					const qaTests = !state.options?.selected && (state.phase === 'qa' || state.options?.kind === 'QA')
						? (await passScope(root, 'QA')).groups.flatMap(group => group.files) : [];
					const scope = repairScope(error.request, state.modules!, guide.files.map(file => file.path), state.repairAdditions ?? [], qaTests);
					const queue = queueRepairs(path, error.request, scope.modules, scope.planned,
						answers, docs, state.repairQueue ?? [], state.repairHistory ?? []);
					for (const item of error.request.files) {
						const source = await passSource(root, item.path);
						if (scope.additions.some(file => file.path === item.path) && source.source !== undefined) {
							throw new Error(`${item.path} already exists outside the selected plan. Add it to the plan before repairing it.`);
						}
					}
					if (token.isCancellationRequested) { return; }
					if (!await approveRepairAdditions(scope.additions, state.options?.companionTests === 'automatic')) {
						state.status = 'paused'; state.message = 'Supporting repair files were not added. Resume to review the required scope again.';
						await this.save(); return;
					}
					await this.validatePlan(state, root);
					if (token.isCancellationRequested) { return; }
					state.modules = scope.modules; (state.repairAdditions ??= []).push(...scope.additions);
					state.total = state.modules.reduce((count, group) => count + group.files.length, 0);
					state.remaining = state.total - state.results!.length;
					state.repairQueue = queue; (state.repairHistory ??= []).push({ origin: path, ...error.request });
					state.preview = undefined; state.lastTest = undefined; state.lastTestStatus = undefined;
					state.message = `Queued ${error.request.files.length} coordinated repairs before ${path}.`;
					await this.save(); continue;
				}
				if (!(error instanceof PlannedDependencies)) { throw error; }
				if (token.isCancellationRequested) { return; }
				const request = { path, dependencies: error.dependencies };
				const scheduling = repair ? scheduleRepairDependencies(state.modules!, state.repairQueue!, request, [...done],
					state.dependencyRequests ?? [], state.repairDependencyRequests ?? []) : undefined;
				const modules = scheduling?.modules ?? prioritizeDependencies(state.modules!, request, [...done], state.dependencyRequests ?? []);
				for (const dependency of request.dependencies) {
					const planned = guide.files.find(file => file.path === dependency);
					const source = (await passSource(root, dependency)).source?.trim();
					if (!planned || source && source !== stubContent(planned).trim()) {
						throw new Error(`BLOCKED\n${dependency} already has code or is not planned. Review its interface before continuing ${path}.`);
					}
				}
				await this.validatePlan(state, root);
				if (token.isCancellationRequested) { return; }
				state.modules = modules; (state.dependencyRequests ??= []).push(request);
				if (scheduling) {
					state.repairQueue = scheduling.queue; (state.repairDependencyRequests ??= []).push(request);
				}
				state.message = `Building planned dependencies before ${path}: ${request.dependencies.join(', ')}`;
				await this.save(); continue;
			}
			if (token.isCancellationRequested) { return; }
			state.results = state.results!.filter(item => item.path !== path); state.results.push(result);
			if (repair) { state.repairQueue!.shift(); }
			state.remaining = state.total - state.results.length;
			state.activity = undefined; state.preview = undefined;
			const interval = state.options!.interval;
			const verifyRepair = state.repairVerificationPending && !state.repairQueue?.length
				&& state.testRepairs!.at(-1)!.files.every(file => state.results!.some(result => result.path === file.path));
			if (verifyRepair || (!repair || !state.repairQueue?.length && !state.remaining) && (checkpointDue(state.modules!, path, interval) || !state.remaining)) {
				state.status = 'checkpoint'; state.lastTest = undefined; state.lastTestStatus = undefined;
				state.message = state.phase === 'build' ? 'Implementation stage finished. Choose a test task; QA follows, including files already present.'
					: state.remaining ? `Review ${path} · ${group.title}. Run the checks, then continue when ready.`
					: 'All file passes finished. Run the final checks and review their results before finishing this run.';
				await this.save(); await this.test();
				if (state.phase === 'build' && !state.remaining && state.lastTestStatus === 'passed' && await this.beginQA(state, root, token)) { continue; }
				if (['running'].includes(state.status) && state.testRepairEvidence && !token.isCancellationRequested) { continue; }
				if (state.options!.unattended && state.lastTestStatus === 'passed' && !token.isCancellationRequested) {
					state.status = 'running'; continue;
				}
				return;
			}
			await this.save();
		}
		if (token.isCancellationRequested) { return; }
		await this.validatePlan(state, root);
		if (state.lastTestStatus !== 'passed') {
			state.status = 'checkpoint'; state.message = 'File reviews are finished; required checks remain unverified. Run checks before completing.';
			await this.save(); return;
		}
		state.message = `${state.phase === 'qa' ? 'Build and QA' : state.options!.kind} file pass finished for ${state.total} file(s). `
			+ (state.lastTestStatus === 'passed' ? `${state.options!.unattended ? 'All required verification commands' : 'The selected test task'} passed. Review the report for test scope and remaining checks.`
				: 'Tests are unverified: no passing test execution was recorded at the final checkpoint.');
		if (state.options!.kind === 'QA' || state.phase === 'qa') { state.reportPath = await saveQAReport(root, state); }
		if (!token.isCancellationRequested) { state.status = 'complete'; await this.save(); }
	}

	private async workOnFile(state: ProjectBuildState, guide: BuildGuideState, path: string, token: vscode.CancellationToken): Promise<FileResult> {
		const { root } = guide, options = state.options!;
		const file = guide.files.find(f => f.path === path);
		const repair = state.repairQueue?.find(item => item.path === path);
		let batchPrepared = await this.preparedBatch.take(path, async name => (await passSource(root, name)).hash);
		if (!batchPrepared && state.phase === 'build' && file && !repair && !state.repairVerificationPending) {
			const base = await passSource(root, path);
			const existing = existingImplementation(file, base.source, base.hash);
			if (existing) { return existing; }
		}
		const context = { step: guide.steps.find(s => s.step.files.includes(path))?.step, instruction: state.instruction,
			clarifications: this.fileAnswers(state, path) };
		if (repair) { context.instruction = `${context.instruction ?? ''}\n${repairContext(repair, state.repairQueue!)}`; }
		if (state.phase === 'qa' && state.buildTest && !state.testRepairEvidence) { context.instruction = `${context.instruction ?? ''}\nBuild-stage test result: ${state.buildTest}. Diagnose using real source and test evidence; this is not proof of complete coverage.`; }
		if (state.repairVerificationPending && state.testRepairEvidence) { context.instruction = `${context.instruction ?? ''}\nLatest failed checkpoint evidence (supersedes earlier test output): ${state.testRepairEvidence}\nRepair diagnosis: ${JSON.stringify(state.testRepairs?.at(-1)?.files)}. Fix demonstrated causes and retain or strengthen regression assertions. Do not skip tests or alter approved behavior to make them pass.`; }
		if (!batchPrepared) {
			const paths = state.repairVerificationPending || this.individualFiles.has(path) ? [path] : await relatedBuildFiles(state, guide, path);
			if (paths.length > 1) {
				state.batchPaths = paths; await this.save();
				const prepared = await prepareFileBatch(this.engine, root, paths.map(name => {
					const item = state.repairQueue?.find(item => item.path === name);
					return { path: name, file: guide.files.find(file => file.path === name), answers: this.fileAnswers(state, name),
						instruction: `${state.instruction ?? ''}\n${item ? repairContext(item, state.repairQueue!) : ''}` };
				}), state.modelKey, token, message => {
					if (!token.isCancellationRequested) { state.activity = redact(message); state.activityAt = Date.now(); filePassChanges.fire(); }
				});
				if (token.isCancellationRequested) { throw new Error('Stopped.'); }
				if (prepared) { this.preparedBatch.set(prepared); batchPrepared = await this.preparedBatch.take(path, async name => (await passSource(root, name)).hash); }
				if (!batchPrepared) {
					paths.forEach(name => this.individualFiles.add(name));
					state.batchPaths = undefined; state.activity = 'Resolving this file individually before continuing the group…'; await this.save();
				}
			}
		}
		if (batchPrepared) {
			state.preview = batchPrepared.changes[0] && { path, content: redact(batchPrepared.changes[0].content) };
			state.activity = 'Related files prepared. Validating this file before saving…'; state.activityAt = Date.now(); filePassChanges.fire();
		}
		const prepared = batchPrepared ?? await preparePassFile(this.engine, root, path, state.phase === 'qa' || state.repairVerificationPending ? { ...options, kind: 'QA' } : options, context, file, state.modelKey, token,
			message => {
				if (message && !token.isCancellationRequested) {
					state.activity = redact(message); state.activityAt = Date.now(); this.status.tooltip = `${path}: ${state.activity}`; filePassChanges.fire();
				}
			}, candidate => {
				if (!candidate) { state.preview = undefined; filePassChanges.fire(); return; }
				state.preview = { path: candidate.path, content: redact(candidate.content) };
				state.activity = 'Code prepared. Completing the file review before saving…'; state.activityAt = Date.now(); filePassChanges.fire();
			});
		await this.validatePlan(state, root);
		const hash = await applyPrepared(root, prepared, options, this.proposals, token, {
			validatePlan: () => this.validatePlan(state, root),
			permissionsChanged: () => this.save(),
			pending: async proposal => {
				state.pending = [{ id: proposal.id, path: proposal.relativePath }];
				if (!token.isCancellationRequested) { state.status = 'review'; state.message = `${proposal.relativePath}\n${prepared.note}`; }
				await this.save();
			},
			running: async () => { if (!token.isCancellationRequested) { state.status = 'running'; } },
		});
		const current = await passSource(root, path);
		if (current.hash !== hash) { throw new Error(`${path} changed during review. Resume to inspect the current file.`); }
		this.preparedBatch.saved(path, current.hash); state.batchPaths = this.preparedBatch.paths();
		if (prepared.needsCode && current.hash === prepared.hash) { throw new Error(`The saved file ${path} still needs implementation.`); }
		const problem = current.source === undefined ? 'The planned file is missing.' : fileContentProblem(path, current.source);
		if (problem && options.kind === 'Build') { throw new Error(`${path}: ${problem}`); }
		const attempt = state.repairVerificationPending && state.testRepairs?.at(-1);
		if (attempt) { attempt.changedFiles = [...new Set([...(attempt.changedFiles ?? []), ...prepared.changes.map(change => change.path)])]; }
		return { path, hash, outcome: hash !== prepared.hash ? 'saved' : 'reviewed',
			note: problem ? `${prepared.note}\nEditor check: ${problem}` : prepared.note };
	}
	private fileAnswers(state: ProjectBuildState, path: string): string[] {
		const repair = state.repairQueue?.find(item => item.path === path);
		const related = state.repairHistory?.filter(record => record.origin === path || record.files.some(file => file.path === path)) ?? [];
		return [...new Set([...(state.answers?.filter(answer => answer.path === path || answer.path === repair?.origin).map(answer => answer.text) ?? []),
			...related.filter(record => record.decision.source === 'developer').map(record => record.decision.quote),
			...(repair?.decision.source === 'developer' ? [repair.decision.quote] : [])])];
	}
	/** Switch stages only after every planned build file has been processed. */
	private async beginQA(state: ProjectBuildState, root: vscode.Uri, token: vscode.CancellationToken): Promise<boolean> {
		if (token.isCancellationRequested) { return false; }
		await this.validatePlan(state, root);
		const { groups } = await passScope(root, 'QA');
		const discovered = new Set(groups.flatMap(group => group.files));
		const extra = state.repairAdditions?.map(file => file.path).filter(path => !discovered.has(path)) ?? [];
		if (extra.length) { groups.push({ title: 'Approved repair files', files: extra }); }
		await this.validatePlan(state, root);
		if (token.isCancellationRequested) { return false; }
		state.buildResults = state.results; state.buildTest = checkpointEvidence(state.lastTestCommands ?? [], state.lastTest);
		state.phase = 'qa'; state.modules = groups; state.results = [];
		state.total = groups.reduce((count, group) => count + group.files.length, 0); state.remaining = state.total;
		state.lastTest = undefined; state.lastTestStatus = undefined; state.currentFile = undefined; state.preview = undefined;
		state.dependencyRequests = []; state.status = 'running'; state.message = 'Implementation stage finished. QA is reviewing the application; final tests follow.';
		await this.save();
		return true;
	}
	private async buildFirst() {
		const state = this.state;
		if (!state?.options || !this.snapshot() || state.options.kind !== 'Build' || state.options.selected
			|| state.options.interval !== 0 || state.phase || state.status === 'complete') { return; }
		await this.pause(); if (this.active) { await this.active; }
		if (this.state !== state || !this.snapshot() || state.pending.length) { return; }
		state.options.workflow = 'buildThenQA'; state.phase = 'build';
		state.message = 'Build first enabled. Existing implementations await QA after all planned files are present.';
		await this.save();
	}
	private async changed(p: Proposal) {
		if (!this.state?.pending.some(item => item.id === p.id)) { return; }
		this.state.pending = this.state.pending.filter(item => item.id !== p.id);
		if (p.state === 'undone') { await this.pause(); } else { await this.save(); }
	}
	private async review(id?: string) {
		const p = this.snapshot()?.pending.find(item => !id || item.id === id);
		if (p) { await this.proposals.show(p.id); }
	}
	private async keep() {
		const p = this.snapshot()?.pending[0];
		if (p) { await this.proposals.keep(p.id); }
	}
	private async test() {
		if (this.testing && this.active && this.state?.status === 'checkpoint') { await this.active; }
		const state = this.state, root = this.root();
		if (this.testing || !state || !root || state.root !== root.toString() || state.status !== 'checkpoint') { return; }
		const token = this.testing = new vscode.CancellationTokenSource();
		try {
			await verifyProject(state, root, this.engine, token.token, {
				save: () => this.save(), validate: () => this.validatePlan(state, root),
				progress: message => { state.message = message; state.activity = message; state.activityAt = Date.now(); filePassChanges.fire(); },
			});
		} catch (error) {
			state.message = state.lastTest = String(error instanceof Error ? error.message : error);
			if (state.lastTestStatus !== 'failed') { state.lastTestStatus = 'unverified'; }
		} finally { state.activity = undefined; token.dispose(); this.testing = undefined; await this.save(); }
		if (!this.active && state.options?.unattended && (['running'].includes(state.status)
			|| state.lastTestStatus === 'passed' && state.status === 'checkpoint')) {
			state.status = 'running'; this.launch();
		}
	}
	private async changeModel() {
		const state = this.state;
		if (!state || !this.snapshot() || !['paused', 'error', 'checkpoint'].includes(state.status)) { return; }
		const key = await vscode.commands.executeCommand<string | undefined>('myEditor.pickRunModel', state.modelKey);
		if (!key || this.state !== state || !this.snapshot() || !['paused', 'error', 'checkpoint'].includes(state.status)) { return; }
		state.modelKey = key;
		this.preparedBatch.clear(); state.batchPaths = undefined;
		await this.save();
	}
	private async changeSpeed() {
		const state = this.state;
		if (!state?.options || !this.snapshot() || state.options.kind !== 'Build' || state.options.selected || state.options.interval === 'file' || state.status === 'complete') { return; }
		const size = await chooseBuildSpeed();
		if (!size || this.state !== state || !this.snapshot() || ['complete'].includes(state.status)) { return; }
		state.options.batchSize = size; await this.save();
	}

	private async changeSaving() {
		const state = this.state;
		if (!state?.options || !this.snapshot() || state.status === 'complete') { return; }
		const choice = await vscode.window.showQuickPick(savingChoices, { title: 'Saving permissions for this run',
			placeHolder: 'Apply to the current pending change and the remaining files. Other runs are unaffected.' });
		if (!choice || this.state !== state || !this.snapshot() || ['complete'].includes(state.status)) { return; }
		if (choice.unattended && !await authorizeUnattended(vscode.Uri.parse(state.root), state.modules?.flatMap(group => group.files) ?? [])) { return; }
		if (this.state !== state || !this.snapshot() || ['complete'].includes(state.status)) { return; }
		state.options.automatic = choice.automatic;
		state.options.companionTests = choice.companionTests;
		state.options.unattended = choice.unattended;
		state.options.verificationChecks = choice.unattended === true;
		if (choice.unattended) {
			state.options.interval = 0;
			if (state.options.kind === 'Build' && !state.options.selected && !state.phase) {
				state.options.workflow = 'buildThenQA'; state.phase = 'build';
			}
		}
		await this.save();
		const pending = state.pending[0];
		const extra = pending && pending.path !== state.currentFile?.path;
		if (pending && (extra ? choice.companionTests === 'automatic' : choice.automatic)) { await this.keep(); }
	}

	private async answer() {
		const state = this.state;
		if (!state || !this.snapshot() || !state.needsAnswer || state.status !== 'error') { return; }
		const done = new Set(state.results?.map(row => row.path));
		const path = state.repairQueue?.[0]?.path ?? state.modules?.flatMap(module => module.files).find(file => !done.has(file));
		if (!path) { return; }
		const answer = await vscode.window.showInputBox({ title: `Clarify ${path}`, prompt: decisionAnswerPrompt(state.message) });
		if (!answer?.trim() || this.state !== state || !this.snapshot() || state.status !== 'error') { return; }
		(state.answers ??= []).push({ path, text: redact(answer.trim()) }); state.needsAnswer = false;
		await this.save(); await this.resume();
	}
	private async report() {
		const state = this.snapshot();
		if (!state) { return; }
		if (state.reportPath) { await vscode.window.showTextDocument(vscode.Uri.joinPath(this.root()!, state.reportPath)); return; }
		await vscode.window.showTextDocument(await vscode.workspace.openTextDocument({ content: filePassReport(state) }));
	}
	dispose() { this.cancellation?.cancel(); this.testing?.cancel(); vscode.Disposable.from(...this.disposables).dispose(); }
}
