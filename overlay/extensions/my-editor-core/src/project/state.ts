import * as vscode from 'vscode';

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
		return { name: 'No project open', summary: 'Open a folder to start.', hasWorkspace: false, stages: [], memory: { conventions: false, decisions: 0, chatDays: 0, brain: false, brainFiles: 0 } };
	}
	const root = folder.uri;
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
	let files: { status?: string }[] = [];
	try {
		const parsed = tree ? JSON.parse(tree) : [];
		files = Array.isArray(parsed) ? parsed : parsed.files ?? [];
	} catch {
		files = [];
	}
	const done = files.filter(f => f.status === 'done' || f.status === 'implemented').length;

	const stages: Stage[] = [
		{
			id: 'requirements', title: 'Requirements', file: '.my_editor/specs/requirements.md',
			state: requirements === undefined ? 'empty' : frCount ? 'done' : 'started',
			status: requirements === undefined ? 'Talk it through with the pair' : frCount ? plural(frCount, 'requirement') : 'Draft started',
		},
		{
			id: 'architecture', title: 'Architecture', file: '.my_editor/specs/architecture.md',
			state: architecture === undefined ? 'empty' : sectionCount ? 'done' : 'started',
			status: architecture === undefined ? 'Design the parts and patterns' : plural(sectionCount, 'section'),
		},
		{
			id: 'tree', title: 'Flow & tree', file: '.my_editor/specs/tree.json',
			state: tree === undefined ? 'empty' : files.length ? 'done' : 'started',
			status: tree === undefined ? 'Plan the files before writing them' : plural(files.length, 'planned file'),
		},
		{
			id: 'build', title: 'Build', state: !files.length ? 'empty' : done === files.length ? 'done' : 'started',
			status: files.length ? `${done} of ${files.length} files done` : 'File by file, at your pace',
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
