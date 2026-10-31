import * as vscode from 'vscode';
import { planningProblems, PlanningDocuments, PlanningStage } from './planning';

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
	if (content !== undefined) { docs[stage] = content; }
	const problems = planningProblems(stage, docs);
	if (problems.length) {
		const first = problems[0];
		throw new Error(`Planning is not complete: ${problems.slice(0, 4).map(problem => problem.reason).join('; ')}. `
			+ `Finalize ${first.stage} before continuing. No planned files were created.`);
	}
}
