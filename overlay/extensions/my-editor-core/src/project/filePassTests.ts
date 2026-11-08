import * as vscode from 'vscode';
import { posix } from 'path';
import { detectCommands } from '../aiready/commandDetect';
import { splitCommand } from '../aiready/projectCommands';
import { checkedProjectPath } from '../chat/projectPath';
import { detectedTestExecution, testDiagnostics } from './testDiagnostics';
import type { CheckCommandEvidence } from './checkpointEvidence';
import { discoverVerification } from './verificationDiscovery';
import { CheckSpec, focusedChecks } from './verificationPlan';

export interface CheckpointTestResult {
	status: 'passed' | 'failed' | 'unverified';
	message: string;
	commands?: CheckCommandEvidence[];
}

// VS Code normalizes process task definitions from their execution and can discard
// custom fields. Keep host-owned paths on the original task instead of its definition.
const detectedTasks = new WeakMap<vscode.Task, { directory: string; output: string; check?: CheckSpec }>();

export interface VerificationRequest { checks: boolean; selected?: boolean; focus?: { ids: string[]; files: string[] } }

async function verificationTasks(root: vscode.Uri, files: readonly string[], request: VerificationRequest, unattended: boolean) {
	const plan = await discoverVerification(root, files);
	const specs = request.focus ? focusedChecks(plan, request.focus.ids, request.focus.files)
		: request.selected ? focusedChecks(plan, [], files) : plan.checks;
	const tasks = specs.map(check => {
		const spec = splitCommand(check.command);
		if (!spec) { throw new Error(`Unsupported verification command: ${check.command}`); }
		const captured = detectedTestExecution(root, check.directory, spec, unattended);
		const task = new vscode.Task({ type: 'process', directory: check.directory, command: check.command },
			vscode.workspace.getWorkspaceFolder(root)!, check.directory ? `${check.command} · ${check.directory}` : check.command,
			'Detected verification command', captured.execution);
		detectedTasks.set(task, { directory: check.directory, output: captured.relative, check }); return task;
	});
	return { plan, tasks };
}

/** Present configured tasks and standard test runners detected from the actual project manifest. */
export async function testTasks(root: vscode.Uri, files: readonly string[], detectedOnly = false) {
	const tasks = (detectedOnly ? [] : await vscode.tasks.fetchTasks()).filter(task => task.group?.id === vscode.TaskGroup.Test.id
		&& (typeof task.scope !== 'object' || task.scope.uri.toString() === root.toString()));
	const detected = new Map<string, Promise<readonly string[]>>();
	const commands = (directory: string): Promise<readonly string[]> => {
		if (!detected.has(directory)) {
			detected.set(directory, (async () => {
				if (directory && directory !== '.') { checkedProjectPath(root.fsPath, directory); }
				const cwd = vscode.Uri.joinPath(root, directory);
				const names = (await vscode.workspace.fs.readDirectory(cwd)).map(([name]) => name);
				const manifest = async (name: string) => names.includes(name)
					? new TextDecoder().decode(await vscode.workspace.fs.readFile(vscode.Uri.joinPath(cwd, name))) : undefined;
				const [packageJson, pyproject] = await Promise.all([manifest('package.json'), manifest('pyproject.toml')]);
				return detectCommands({ names, packageJson, pyproject }).tests;
			})().catch(() => []));
		}
		return detected.get(directory)!;
	};
	const locations = new Map<string, readonly string[]>();
	for (const file of files) {
		// The controller supplies workspace-relative paths, but keep discovery inside the root.
		if (posix.isAbsolute(file) || file.includes('\\') || file.split('/').includes('..')) { continue; }
		let directory = posix.dirname(file);
		while (directory !== '.') {
			const found = await commands(directory);
			if (found.length) { locations.set(directory, found); break; }
			directory = posix.dirname(directory);
		}
	}
	// Whole-project tasks remain available after the more relevant module tasks.
	locations.set('', await commands(''));
	const folder = vscode.workspace.getWorkspaceFolder(root)!;
	for (const [directory, lines] of locations) {
		for (const line of lines) {
			const spec = splitCommand(line);
			if (spec) {
				const captured = detectedTestExecution(root, directory, spec, detectedOnly);
				const task = new vscode.Task({ type: 'process', directory, command: line }, folder,
					directory ? `${line} · ${directory}` : line, 'Detected test command',
					captured.execution);
				detectedTasks.set(task, { directory, output: captured.relative }); tasks.push(task);
			}
		}
	}
	return tasks;
}

/** Listen before launch so a fast task cannot finish before its listener is attached. */
export async function runCheckpointTest(root: vscode.Uri, token: vscode.CancellationToken, files: readonly string[] = [],
	automatic: () => boolean = () => false, progress: (message: string) => void = () => {}, request?: VerificationRequest): Promise<CheckpointTestResult> {
	const unattended = automatic();
	const verification = request && await verificationTasks(root, files, request, unattended);
	const tasks = verification?.tasks ?? await testTasks(root, files, unattended);
	const unverified = (message: string): CheckpointTestResult => ({ status: 'unverified', message });
	if (token.isCancellationRequested) { return unverified('Test stopped.'); }
	if (!tasks.length) { return unverified('No configured or detected test task. Run the listed checks manually before continuing.'); }
	if (unattended && request && !request.checks && tasks.some(task => detectedTasks.get(task)?.check?.kind !== 'test')) {
		return unverified('Required build/type/lint checks are not authorized by this saved test-only run. Choose verification permissions before continuing. No additional command was executed.');
	}
	let selectedTask: vscode.Task | undefined;
	if (!unattended) {
		const choices = tasks.map(task => ({ label: task.name, description: task.source, task }));
		if (verification && tasks.length > 1) { choices.unshift({ label: 'Run all required checks', description: tasks.map(task => task.name).join('; '), task: undefined! }); }
		const picked = await vscode.window.showQuickPick(choices,
			{ title: 'Run a test on the saved files', placeHolder: 'Authorize required checks, or select one command for investigation' }, token);
		if (!picked || token.isCancellationRequested) { return unverified('Test task cancelled.'); }
		selectedTask = picked.task;
		if (selectedTask) {
			const result = await executeTest(selectedTask, token, root);
			if (verification && verification.plan.signature !== (await discoverVerification(root, files)).signature) {
				return { ...result, status: 'unverified', message: result.message + '\nVerification commands or package dependencies changed while checks ran. Rerun the current plan.' };
			}
			if (verification && tasks.length > 1 && result.status === 'passed') {
				return { ...result, status: 'unverified', message: result.message + '\nOther required checks have not run. Choose Run all required checks before completion.' };
			}
			if (verification && !request?.focus && result.status === 'passed' && detectedTasks.get(selectedTask)?.check?.kind !== 'test') {
				return { ...result, status: 'unverified', message: result.message + '\nNo executable tests were detected for this scope. Test coverage remains unverified.' };
			}
			return result;
		}
	}
	{
		const results: CheckpointTestResult[] = [];
		for (const [index, task] of tasks.entries()) {
			if (token.isCancellationRequested || unattended && !automatic() || vscode.workspace.workspaceFolders?.[0]?.uri.toString() !== root.toString()) {
				results.push(unverified('Automatic tests stopped or permission changed.')); break;
			}
			const directory = detectedTasks.get(task)?.directory;
			if (directory) { checkedProjectPath(root.fsPath, directory); }
			const check = detectedTasks.get(task)?.check;
			const blocked = check?.requires.filter(id => !results.some(result => result.commands?.some(item => item.id === id && item.status === 'passed')));
			if (blocked?.length) {
				const message = `${task.name} not run: prerequisite checks did not pass: ${blocked.join(', ')}`;
				results.push({ status: 'unverified', message, commands: [{ ...check, name: task.name, status: 'unverified', message }] }); continue;
			}
			progress(`Checking ${index + 1}/${tasks.length}: ${task.name}`);
			try { results.push(await executeTest(task, token, root)); }
			catch (error) { const message = `${task.name}: ${String(error)}`; results.push({ status: 'failed', message,
				commands: [{ ...check, name: task.name, status: 'failed', message, output: detectedTasks.get(task)?.output }] }); }
		}
		if (verification && verification.plan.signature !== (await discoverVerification(root, files)).signature) {
			return { status: 'unverified', message: 'Verification commands or package dependencies changed while checks ran. Rerun the current plan.', commands: results.flatMap(result => result.commands ?? []) };
		}
		if (verification && !request?.focus && !tasks.some(task => detectedTasks.get(task)?.check?.kind === 'test') && results.every(result => result.status === 'passed')) {
			return { status: 'unverified', message: results.map(result => result.message).join('\n') + '\nNo executable tests were detected for this scope. Test coverage remains unverified.',
				commands: results.flatMap(result => result.commands ?? []) };
		}
		return { status: results.some(result => result.status === 'failed') ? 'failed'
			: results.some(result => result.status === 'unverified') ? 'unverified' : 'passed',
			message: results.map(result => result.message).join('\n'), commands: results.flatMap(result => result.commands ?? []) };
	}
}

async function executeTest(task: vscode.Task, token: vscode.CancellationToken, root: vscode.Uri): Promise<CheckpointTestResult> {
	const unverified = (message: string): CheckpointTestResult => ({ status: 'unverified', message });
	if (token.isCancellationRequested) { return unverified('Test stopped.'); }
	const output = detectedTasks.get(task)?.output;
	if (output) { checkedProjectPath(root.fsPath, output, true); }
	let finish!: (result: CheckpointTestResult) => void;
	const result = new Promise<CheckpointTestResult>(resolve => { finish = resolve; });
	let execution: Thenable<vscode.TaskExecution>;
	const ended = (event: vscode.TaskExecution, result: CheckpointTestResult) => {
		void execution.then(launched => { if (event === launched) { finish(result); } }, () => {});
	};
	const processEnd = vscode.tasks.onDidEndTaskProcess(e => ended(e.execution, {
		status: e.exitCode === undefined ? 'unverified' : e.exitCode === 0 ? 'passed' : 'failed',
		message: `${task.name} exited with code ${e.exitCode ?? 'unknown'}.`,
	}));
	const taskEnd = vscode.tasks.onDidEndTask(e => ended(e.execution, unverified(`${task.name} ended without a reported exit code.`)));
	try {
		execution = vscode.tasks.executeTask(task);
		const cancel = token.onCancellationRequested(() => {
			void execution.then(task => task.terminate(), () => {}); finish(unverified('Test stopped.'));
		});
		if (token.isCancellationRequested) { void execution.then(task => task.terminate(), () => {}); finish(unverified('Test stopped.')); }
		try {
			await execution;
			const completed = await result;
			const message = completed.message + await testDiagnostics(root, output, completed.status !== 'passed');
			return { ...completed, message, commands: [{ ...detectedTasks.get(task)?.check, name: task.name, status: completed.status, message, output }] };
		} finally { cancel.dispose(); }
	} finally { processEnd.dispose(); taskEnd.dispose(); }
}
