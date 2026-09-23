import * as os from 'os';
import * as vscode from 'vscode';
import { parseSkill } from './frontmatter';

export interface Skill {
	readonly name: string;
	readonly description: string;
	readonly source: 'built-in' | 'global' | 'project';
	/** `none` (talk only) or `file` (may propose an edit to the open file, reviewed as usual). */
	readonly writes: 'none' | 'file';
	readonly instruction: string;
	readonly uri: vscode.Uri;
}

const MAX_SKILL_CHARS = 40_000;

async function loadFrom(dir: vscode.Uri, source: Skill['source']): Promise<Skill[]> {
	let entries: [string, vscode.FileType][];
	try {
		entries = await vscode.workspace.fs.readDirectory(dir);
	} catch {
		return [];
	}
	const skills = await Promise.all(entries
		.filter(([, type]) => type === vscode.FileType.Directory)
		.map(async ([folder]) => {
			const uri = vscode.Uri.joinPath(dir, folder, 'SKILL.md');
			try {
				const text = new TextDecoder().decode(await vscode.workspace.fs.readFile(uri)).slice(0, MAX_SKILL_CHARS);
				const { meta, body } = parseSkill(text);
				return {
					name: (meta.name || folder).toLowerCase(),
					description: meta.description ?? '',
					source,
					writes: meta.writes === 'file' ? 'file' : 'none',
					instruction: body,
					uri,
				} satisfies Skill;
			} catch {
				return undefined;
			}
		}));
	return skills.filter((s): s is NonNullable<typeof s> => s !== undefined);
}

/** All skills by name; project skills override global ones, which override built-ins. */
export async function loadSkills(extensionUri: vscode.Uri): Promise<Map<string, Skill>> {
	const root = vscode.workspace.workspaceFolders?.[0]?.uri;
	const layers = await Promise.all([
		loadFrom(vscode.Uri.joinPath(extensionUri, 'skills'), 'built-in'),
		loadFrom(vscode.Uri.joinPath(vscode.Uri.file(os.homedir()), '.my_editor', 'skills'), 'global'),
		root ? loadFrom(vscode.Uri.joinPath(root, '.my_editor', 'skills'), 'project') : Promise.resolve([]),
	]);
	const byName = new Map<string, Skill>();
	for (const skill of layers.flat()) {
		byName.set(skill.name, skill);
	}
	return byName;
}
