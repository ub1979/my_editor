import * as vscode from 'vscode';
import { changedPlanningPrerequisites, planningError, PlanningDocuments, PlanningStage } from './planning';

export interface PlanningBaseline { stage: PlanningStage; docs: PlanningDocuments }

export async function planningBaseline(target: vscode.Uri): Promise<PlanningBaseline | undefined> {
	const root = vscode.workspace.getWorkspaceFolder(target)?.uri;
	if (!root) { return; }
	const path = vscode.workspace.asRelativePath(target, false).replaceAll('\\', '/');
	const name = /^\.my_editor\/specs\/(requirements\.md|architecture\.md|tree\.json)$/.exec(path)?.[1];
	if (!name) { return; }
	return { stage: name.split('.')[0] as PlanningStage, docs: await readPlanningDocuments(root) };
}

export async function assertPlanningBaseline(target: vscode.Uri, baseline?: PlanningBaseline): Promise<void> {
	if (!baseline) { return; }
	const current = await planningBaseline(target);
	const changes = current ? changedPlanningPrerequisites(baseline.stage, baseline.docs, current.docs) : [baseline.stage];
	if (changes.length) { throw new Error(`Saved ${changes.join(' and ')} changed while this ${baseline.stage} was being prepared. Repair the draft against the current saved documents before Keep.`); }
}

export async function readPlanningDocuments(root: vscode.Uri): Promise<PlanningDocuments> {
	const values = await Promise.all(['requirements.md', 'architecture.md', 'tree.json'].map(async name => {
		try { return new TextDecoder().decode(await vscode.workspace.fs.readFile(vscode.Uri.joinPath(root, '.my_editor/specs', name))); }
		catch { return undefined; }
	}));
	return { requirements: values[0], architecture: values[1], tree: values[2] };
}

/** Both proposal creation and Keep validate against the currently saved prerequisite documents. */
export async function validatePlanningFile(target: vscode.Uri, content: string): Promise<void> {
	const root = vscode.workspace.getWorkspaceFolder(target)?.uri;
	if (!root) { return; }
	const relative = vscode.workspace.asRelativePath(target, false).replaceAll('\\', '/');
	const stage = /^\.my_editor\/specs\/(requirements\.md|architecture\.md|tree\.json)$/.exec(relative)?.[1]?.split('.')[0] as PlanningStage | undefined;
	if (!stage) { return; }
	await assertPlanningReady(root, stage, content);
}

export async function assertPlanningReady(root: vscode.Uri, stage: PlanningStage, content?: string): Promise<void> {
	const docs = await readPlanningDocuments(root);
	const error = planningError(stage, docs, content);
	if (error) { throw new Error(error); }
}
