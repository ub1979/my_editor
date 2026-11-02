import * as vscode from 'vscode';
import { checkedProjectPath } from '../chat/projectPath';
import { serial } from '../util/serial';
import { BuildPlan, buildPlanProblems, legacyBuildSteps, orderedSteps } from './buildPlan';
import { BuildFileSnapshot, BuildProgress, digest, StepState, stepStates } from './buildProgress';
import { parseTree, stubContent, TreeFile } from './stubs';

const TREE = '.my_editor/specs/tree.json';
const PROGRESS = '.my_editor/build-progress.json';
export interface BuildGuideState {
	root: vscode.Uri;
	files: TreeFile[];
	plan?: BuildPlan;
	steps: StepState[];
	problems: string[];
	snapshots: Map<string, BuildFileSnapshot>;
}

async function read(root: vscode.Uri, relative: string): Promise<string | undefined> {
	try {
		const uri = vscode.Uri.file(checkedProjectPath(root.fsPath, relative));
		if ((await vscode.workspace.fs.stat(uri)).size > 2_000_000) { throw new Error(`${relative} exceeds the build guide's read limit`); }
		return new TextDecoder().decode(await vscode.workspace.fs.readFile(uri));
	} catch (error) {
		if (['ENOENT', 'FileNotFound'].includes((error as { code?: string }).code ?? '')) { return; }
		throw error;
	}
}

async function progress(root: vscode.Uri): Promise<BuildProgress> {
	const text = await read(root, PROGRESS);
	if (text === undefined) { return { version: 1, steps: {} }; }
	const value = JSON.parse(text);
	if (value?.version !== 1 || !value.steps || typeof value.steps !== 'object' || Array.isArray(value.steps)) {
		throw new Error('Build progress could not be read. The saved progress was left unchanged.');
	}
	return value;
}

/** Reading guidance never regenerates plans, creates files or infers that tests have passed. */
export async function readBuildGuide(root: vscode.Uri): Promise<BuildGuideState> {
	const base: BuildGuideState = { root, files: [], steps: [], problems: [], snapshots: new Map() };
	try {
		const text = await read(root, TREE);
		if (!text) { return base; }
		const files = parseTree(text), raw = JSON.parse(text);
		const problems = buildPlanProblems(raw, files);
		if (problems.length) { return { ...base, files, problems }; }
		const plan: BuildPlan | undefined = raw.buildPlan;
		const steps = plan ? orderedSteps(plan.steps) : legacyBuildSteps(files);
		const snapshots = new Map<string, BuildFileSnapshot>();
		await Promise.all(files.map(async file => {
			try {
				const uri = vscode.Uri.file(checkedProjectPath(root.fsPath, file.path));
				const document = vscode.workspace.textDocuments.find(doc => doc.uri.toString() === uri.toString());
				const content = document?.getText() ?? await read(root, file.path);
				snapshots.set(file.path, { hash: content === undefined ? undefined : digest(content), dirty: document?.isDirty,
					stub: content !== undefined && content.trim() === stubContent(file).trim() });
			} catch { snapshots.set(file.path, {}); }
		}));
		return { root, files, plan, problems: [], snapshots, steps: stepStates(steps, snapshots, await progress(root)) };
	} catch (error) { return { ...base, problems: [error instanceof Error ? error.message : String(error)] }; }
}

/** Explicit user verification is recorded separately from tree progress, scoped to the checked source. */
export function confirmBuildStep(root: vscode.Uri, id: string, expectedSignature: string): Promise<void> {
	return serial(async () => {
		const guide = await readBuildGuide(root);
		const state = guide.steps.find(item => item.step.id === id);
		if (!guide.plan || guide.problems.length || !state) { throw new Error('Add a valid build plan before recording checks.'); }
		if (state.signature !== expectedSignature) { throw new Error('The step changed. Review its current files and checks before confirming.'); }
		if (state.status === 'blocked') { throw new Error('Finish and verify this step’s prerequisites first.'); }
		if (state.missing.length || state.dirty.length) { throw new Error('Create and save every file in this step before confirming its checks.'); }
		if (state.step.files.some(file => guide.snapshots.get(file)?.stub)) { throw new Error('This step still contains unchanged stubs. Implement them and run the listed checks first.'); }
		const saved = await progress(root);
		saved.steps[id] = { signature: state.signature, confirmedAt: new Date().toISOString(), evidence: 'user-confirmed' };
		const uri = vscode.Uri.file(checkedProjectPath(root.fsPath, PROGRESS, true));
		await vscode.workspace.fs.writeFile(uri, new TextEncoder().encode(JSON.stringify(saved, null, '\t') + '\n'));
	});
}
