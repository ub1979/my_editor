import * as vscode from 'vscode';
import { planningProblems } from './planning';
import { parseTree, TreeFile } from './stubs';

/** One stage of the guided build, with a line of live status derived from the files that exist. */
export interface Stage {
	readonly id: 'requirements' | 'architecture' | 'tree' | 'build' | 'qa';
	readonly title: string;
	readonly status: string;
	readonly state: 'empty' | 'started' | 'done';
	readonly file?: string;
}

export interface ProjectState {
	readonly name: string;
	readonly summary: string;
	readonly hasWorkspace: boolean;
	readonly stages: Stage[];
	readonly memory: { conventions: boolean; decisions: number; chatDays: number; brain: boolean; brainFiles: number };
}

async function read(root: vscode.Uri, path: string): Promise<string | undefined> {
	try {
		return new TextDecoder().decode(await vscode.workspace.fs.readFile(vscode.Uri.joinPath(root, path)));
	} catch {
		return undefined;
	}
}

async function count(root: vscode.Uri, dir: string, suffix: string): Promise<number> {
	try {
		const entries = await vscode.workspace.fs.readDirectory(vscode.Uri.joinPath(root, dir));
		return entries.filter(([name, type]) => type === vscode.FileType.File && name.endsWith(suffix)).length;
	} catch {
		return 0;
	}
}

function plural(n: number, word: string): string {
	return `${n} ${word}${n === 1 ? '' : 's'}`;
}

/** Reads `.my_editor/` and turns it into what the project view shows. Nothing is stored: status is derived. */
export async function readProjectState(): Promise<ProjectState> {
	const folder = vscode.workspace.workspaceFolders?.[0];
	if (!folder) {
		return {
			name: 'No project open', summary: 'Open a folder to start.', hasWorkspace: false, stages: [],
			memory: { conventions: false, decisions: 0, chatDays: 0, brain: false, brainFiles: 0 },
		};
	}
	return readProjectStateAt(folder.uri, folder.name);
}

/** The same status for any project folder, open or not (used by the Home screen). */
export async function readProjectStateAt(root: vscode.Uri, name: string): Promise<ProjectState> {
	const folder = { name };
	const [requirements, architecture, tree, brain, conventions, brainMap] = await Promise.all([
		read(root, '.my_editor/specs/requirements.md'),
		read(root, '.my_editor/specs/architecture.md'),
		read(root, '.my_editor/specs/tree.json'),
		read(root, '.my_editor/brain/index.md'),
		read(root, '.my_editor/conventions.md'),
		read(root, '.my_editor/brain/map.json'),
	]);
	let brainFiles = 0;
	try {
		brainFiles = brainMap ? Object.keys(JSON.parse(brainMap).files ?? {}).length : 0;
	} catch {
		brainFiles = 0;
	}
	const [decisions, chatDays, qaReports] = await Promise.all([
		count(root, '.my_editor/decisions', '.md'),
		count(root, '.my_editor/chats', '.md'),
		count(root, '.my_editor/qa', '.md'),
	]);

	const frCount = requirements ? new Set(requirements.match(/\bN?FR-\d{3}\b/g) ?? []).size : 0;
	const sectionCount = architecture ? (architecture.match(/^## /gm) ?? []).length : 0;
	let files: TreeFile[] = [];
	try {
		files = tree ? parseTree(tree) : [];
	} catch {
		files = [];
	}
	const done = files.filter(f => f.status === 'done' || f.status === 'implemented').length;
	const started = files.filter(f => f.status === 'in-progress').length;
	const docs = { requirements, architecture, tree };
	const requirementProblems = planningProblems('requirements', docs);
	const architectureProblems = planningProblems('architecture', docs);
	const treeProblems = planningProblems('tree', docs);
	const treeReady = files.length > 0 && !treeProblems.length;

	const stages: Stage[] = [
		{
			id: 'requirements', title: 'Requirements', file: '.my_editor/specs/requirements.md',
			state: requirements === undefined ? 'empty' : requirementProblems.length ? 'started' : 'done',
			status: requirements === undefined ? 'Talk it through with the pair' : requirementProblems.length
				? `Draft · ${requirementProblems[0].reason}` : plural(frCount, 'requirement'),
		},
		{
			id: 'architecture', title: 'Architecture', file: '.my_editor/specs/architecture.md',
			state: architecture === undefined ? 'empty' : architectureProblems.length ? 'started' : 'done',
			status: architecture === undefined ? 'Design the parts and patterns' : architectureProblems.length
				? `Draft · ${architectureProblems[0].reason}` : plural(sectionCount, 'section'),
		},
		{
			id: 'tree', title: 'Flow & tree', file: '.my_editor/specs/tree.json',
			state: tree === undefined ? 'empty' : treeReady ? 'done' : 'started',
			status: tree === undefined ? 'Plan the files before writing them' : treeReady
				? plural(files.length, 'planned file') : `Draft · ${treeProblems[0]?.reason ?? 'no planned files'}`,
		},
		{
			id: 'build', title: 'Build', state: !treeReady ? 'empty' : done === files.length ? 'done' : 'started',
			status: !treeReady && files.length ? 'Finalize the planning documents first' : files.length
				? `${done} of ${files.length} done${started ? ` · ${started} in progress` : ''}` : 'File by file, at your pace',
		},
		{
			id: 'qa', title: 'QA', state: qaReports ? 'done' : 'empty',
			status: qaReports ? plural(qaReports, 'report') : 'Check parts fit together',
		},
	];

	const firstLine = brain?.split('\n').find(line => line.trim() && !line.startsWith('#'))?.trim();
	return {
		name: folder.name,
		summary: firstLine ?? 'No project brain yet.',
		hasWorkspace: true,
		stages,
		memory: { conventions: conventions !== undefined, decisions, chatDays, brain: brain !== undefined, brainFiles },
	};
}
