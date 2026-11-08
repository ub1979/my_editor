import type * as vscode from 'vscode';
import type { PairEngine } from '../chat/engine';
import type { ProjectBuildState } from './projectBuild';
import { checkpointFiles } from './filePassPlan';
import { runCheckpointTest } from './filePassTests';
import { checkpointEvidence } from './checkpointEvidence';
import { diagnoseTestRepairs, testSourceSignature } from './testRepairDiagnosis';
import { testRepairModules, testRepairProblem } from './testRepairPlan';
import { passScope } from './filePassScope';
import { failureSignature, repeatedFailure } from './verificationProgress';
import { redact } from '../records/redact';

interface Host { save(): Promise<void>; validate(): Promise<void>; progress(message: string): void }

/** Deterministic verifier owns execution and completion; the model can only nominate scoped repair files. */
export async function verifyProject(state: ProjectBuildState, root: vscode.Uri, engine: PairEngine,
	token: vscode.CancellationToken, host: Host): Promise<void> {
	const path = state.results?.at(-1)?.path;
	const files = state.options?.unattended ? state.modules!.flatMap(group => group.files)
		: path && state.options && state.modules ? checkpointFiles(state.modules, path, state.options.interval) : [];
	const attempt = state.testRepairs?.at(-1);
	const focused = !!state.repairVerificationPending && !!attempt?.commandId;
	const request = { checks: state.options?.verificationChecks === true, selected: !!state.options?.selected,
		...(focused ? { focus: { ids: [attempt!.commandId!], files: [...attempt!.files.map(file => file.path), ...(attempt!.changedFiles ?? [])] } } : {}) };
	await host.validate();
	const before = await testSourceSignature(root, files);
	const result = await runCheckpointTest(root, token, files, () => state.options?.unattended === true, host.progress, request);
	await host.validate();
	if (!token.isCancellationRequested && before !== await testSourceSignature(root, files)) {
		result.status = 'unverified'; result.message += '\nSource changed while checks ran. Rerun checks on current saved files.';
	}
	state.lastTest = result.message; state.lastTestCommands = result.commands;
	if (result.status !== 'unverified' || state.lastTestStatus !== 'failed') { state.lastTestStatus = result.status; }
	(state.testHistory ??= []).push(`${focused ? 'Repair verification' : 'Checkpoint'}: ${result.message}`);
	state.verificationStarted = true;
	if (token.isCancellationRequested || state.status !== 'checkpoint') { return; }
	if (focused) {
		attempt!.verification = result.commands; attempt!.verified = result.status === 'passed';
		if (result.status !== 'unverified') { state.repairVerificationPending = false; }
		if (result.status === 'passed') {
			// A focused success cannot stand in for the final suite. Refresh every required check before declaring success.
			if (!state.remaining || state.phase === 'build') { await verifyProject(state, root, engine, token, host); return; }
			state.lastTestStatus = undefined; state.status = 'running';
			state.message = 'Repair checks passed on saved source. Continuing the remaining file reviews.'; return;
		}
		if (result.status === 'failed' && repeatedFailure(attempt!, result.commands ?? [])) {
			state.message = 'The same demonstrated failure remains after the repair. Stopped before another QA cycle; inspect the retained before/after evidence.';
			return;
		}
	}
	state.message = result.status === 'passed' ? 'Required checks passed on saved source. Finishing this stage…'
		: result.status === 'failed' ? 'Checks failed. Results are recorded; this run is not complete.' : result.message;
	await host.save(); // Evidence must survive a long or failed model diagnosis.
	if (result.status === 'failed' && state.options?.unattended) { await queueTestRepair(state, root, engine, token, host); }
}

async function queueTestRepair(state: ProjectBuildState, root: vscode.Uri, engine: PairEngine, token: vscode.CancellationToken, host: Host) {
	const discovered = !state.options?.selected ? (await passScope(root, 'QA')).groups.flatMap(group => group.files) : [];
	await host.validate();
	if (token.isCancellationRequested || !state.options?.unattended || state.status !== 'checkpoint') { return; }
	state.modules = testRepairModules(state.modules!, discovered);
	state.total = state.modules.reduce((total, group) => total + group.files.length, 0);
	state.remaining = state.total - state.results!.length;
	const signature = await testSourceSignature(root, state.modules.flatMap(group => group.files));
	const problem = testRepairProblem(state.testRepairs ?? [], signature);
	if (problem) { state.message = problem; return; }
	// Choose the earliest real failure in dependency order. Blocked consumers are not separate root causes.
	const failure = state.lastTestCommands?.find(command => command.status === 'failed');
	if (!failure) { state.message = 'No executable failure evidence was retained. Inspect the checkpoint before repairing.'; return; }
	if ((state.testRepairs ?? []).some(previous => repeatedFailure(previous, [failure]))) {
		state.message = 'A previously repaired failure has returned. Stopped before another QA cycle; inspect the retained repair history.';
		return;
	}
	host.progress(`Diagnosing ${failure.name} before further QA…`);
	try {
		const evidence = checkpointEvidence([failure]) + '\nFocus on this demonstrated failing command and its causal dependencies only. '
			+ 'The host will execute this check again immediately after the coherent repair batch; unrelated QA waits. '
			+ 'Identify why the failing assertion/build path executes differently from the intended source, including package exports and compiled artifacts. '
			+ 'Changing tests or adding passing cases is not evidence that this failure is fixed.';
		const files = await diagnoseTestRepairs(engine, root, state.modules, evidence, state.modelKey, token, host.progress);
		await host.validate();
		if (token.isCancellationRequested || !state.options?.unattended || state.status !== 'checkpoint') { return; }
		(state.testRepairs ??= []).push({ signature, files, commandId: failure.id ?? failure.name, failure: failureSignature(failure) });
		state.testRepairEvidence = evidence; state.repairVerificationPending = true;
		const paths = new Set(files.map(file => file.path));
		state.results = state.results!.filter(result => !paths.has(result.path));
		state.remaining = state.total - state.results.length;
		state.lastTestStatus = undefined; state.status = 'running';
		state.message = `Repairing ${failure.name} across ${files.length} file(s), then verifying it before continuing.`;
	} catch (error) {
		if (!token.isCancellationRequested) { state.message = `Tests still fail. ${redact(String(error instanceof Error ? error.message : error))}`; }
	}
}
