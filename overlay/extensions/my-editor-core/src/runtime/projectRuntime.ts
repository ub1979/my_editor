import * as vscode from 'vscode';
import { homedir } from 'os';
import { join } from 'path';
import { AgentLoopOptions, runAgentLoop } from '../chat/agentLoop';
import { runOpenCodeLoop } from './openCodeLoop';
import { projectRuntimeName } from './openCodeConfig';

export function selectedProjectRuntime(): 'builtin' | 'opencode' {
	return projectRuntimeName(vscode.workspace.getConfiguration('myEditor').get('projectAgents.runtime', 'builtin'));
}
export function runProjectAgent(options: AgentLoopOptions, token: vscode.CancellationToken): Promise<string> {
	if (selectedProjectRuntime() === 'builtin') { return runAgentLoop(options); }
	const binary = vscode.workspace.getConfiguration('myEditor').get<string>('projectAgents.openCodePath', '').trim()
		|| join(homedir(), '.opencode', 'bin', process.platform === 'win32' ? 'opencode.exe' : 'opencode');
	return runOpenCodeLoop(options, binary, token);
}
export async function chooseProjectRuntime() {
	const choice = await vscode.window.showQuickPick([
		{ label: 'OpenCode', runtime: 'opencode', description: 'Project agents through OpenCode; current model, permissions and Keep/Undo stay with my_editor' },
		{ label: 'Built-in', runtime: 'builtin', description: 'Use the existing my_editor project-agent loop' },
	], { title: 'Project agent runtime', placeHolder: 'Applies to new turns; paused runs stay paused.' });
	if (choice) { await vscode.workspace.getConfiguration('myEditor').update('projectAgents.runtime', choice.runtime, vscode.ConfigurationTarget.Global); }
}
