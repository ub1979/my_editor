import { execFile } from 'child_process';
import * as vscode from 'vscode';
import { readMap } from '../brain/brain';
import { inspectGitSync } from './gitSync';
import { ProjectContextStatus } from './contextStatusText';

function gitHead(cwd: string): Promise<string | undefined> {
	return new Promise(resolve => execFile('git', ['rev-parse', '--short', 'HEAD'],
		{ cwd, timeout: 5_000 }, (error, output) => resolve(error ? undefined : output.trim())));
}

/** A cheap, read-only snapshot for every Pair turn; remote age is inherited from the last Project check. */
export async function currentProjectStatus(): Promise<ProjectContextStatus | undefined> {
	const root = vscode.workspace.workspaceFolders?.[0];
	if (!root || root.uri.scheme !== 'file') { return undefined; }
	const [head, git, map] = await Promise.all([
		gitHead(root.uri.fsPath),
		inspectGitSync(root.uri.fsPath, false).catch(() => ({ kind: 'not-git' as const })),
		readMap(),
	]);
	const entries = Object.values(map?.files ?? {});
	return {
		name: root.name, path: root.uri.fsPath, head, git,
		brainCommit: map?.commit, brainFiles: entries.length,
		summarizedFiles: entries.filter(entry => !!entry.summary).length,
	};
}
