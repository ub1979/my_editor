import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import type { ProjectBuildState } from '../src/project/projectBuild';

test('reopening restores the queue paused; changing projects cannot resume its work in another folder', async () => {
	const Module = require('node:module') as { _load: (name: string, parent: unknown, isMain: boolean) => unknown };
	const original = Module._load;
	const commands = new Map<string, (...args: unknown[]) => unknown>();
	const root = { toString: () => 'file:///project' };
	const disposable = { dispose() {} };
	const vscode = {
		EventEmitter: class { event = () => disposable; fire() {} dispose() {} },
		window: { createStatusBarItem: () => ({ show() {}, dispose() {} }), showWarningMessage: async () => {} }, StatusBarAlignment: { Left: 1 },
		workspace: { workspaceFolders: [{ uri: root }], onDidChangeWorkspaceFolders: () => disposable },
		commands: { registerCommand: (name: string, handler: (...args: unknown[]) => unknown) => { commands.set(name, handler); return disposable; },
			executeCommand: async () => {} }, Disposable: { from: () => disposable },
	};
	const saved: ProjectBuildState = { version: 1, root: root.toString(), identity: 'saved-plan', status: 'review',
		options: { kind: 'Build', automatic: true, companionTests: 'automatic', unattended: true, interval: 0 },
		repairQueue: [{ path: 'db.ts', origin: 'main.ts', reason: 'Align IDs', decision: { source: 'developer', quote: 'Use integer IDs.' } }],
		message: 'Two proposals ready.', total: 8, remaining: 2, modelKey: 'selected:model', pending: [{ id: 'expired', path: 'src/main.ts' }] };
	try {
		Module._load = (name, parent, main) => name === 'vscode' ? vscode : original(name, parent, main);
		const { ProjectBuild } = require('../src/project/projectBuild');
		Module._load = original;
		const instance = new ProjectBuild({ workspaceState: { get: () => saved } },
			{ run: () => assert.fail('Reopening must not generate code') }, { onDidChange: () => disposable });
		const state = commands.get('myEditor.projectBuild.status')!() as ProjectBuildState;
		assert.equal(state.status, 'paused');
		assert.equal(state.remaining, 2);
		assert.equal(state.modelKey, 'selected:model');
		assert.equal(state.options?.unattended, true, 'Per-run approval survives reopening without automatically launching work');
		assert.equal(state.options?.verificationChecks, undefined, 'Legacy test consent does not authorize build/type/lint execution');
		assert.deepEqual(state.repairQueue, saved.repairQueue, 'Reopening must preserve the queued repair and approved decision');
		assert.deepEqual(state.pending, []);
		assert.match(state.message, /Resume rebuilds any unkept batch/);
		assert.equal(saved.pending.length, 1, 'Loading must not mutate the stored object');
		vscode.workspace.workspaceFolders = [{ uri: { toString: () => 'file:///another-project' } }];
		await commands.get('myEditor.projectBuild.resume')!();
		assert.equal(commands.get('myEditor.projectBuild.status')!(), undefined);
		instance.dispose();
		vscode.workspace.workspaceFolders = [{ uri: root }];
		const failed = new ProjectBuild({ workspaceState: { get: () => ({ ...saved, status: 'error',
			message: 'claude-cli: OAuth session expired' }) } },
			{ run: () => assert.fail('Authentication errors must await user recovery') }, { onDidChange: () => disposable });
		const error = commands.get('myEditor.projectBuild.status')!() as ProjectBuildState;
		assert.equal(error.status, 'error'); assert.match(error.message, /OAuth session expired/);
		failed.dispose();
		const failedCheck = new ProjectBuild({ workspaceState: { get: () => ({ ...saved, status: 'checkpoint',
			lastTest: 'npm test exited with code 1.', lastTestStatus: 'failed' }), update: async () => {} } },
			{ run: () => assert.fail('A reopened failing checkpoint must not generate or finish') }, { onDidChange: () => disposable });
		await commands.get('myEditor.projectBuild.resume')!();
		const restoredCheck = commands.get('myEditor.projectBuild.status')!() as ProjectBuildState;
		assert.equal(restoredCheck.status, 'checkpoint');
		assert.equal(restoredCheck.lastTestStatus, 'failed');
		assert.match(restoredCheck.message, /test task failed/);
		failedCheck.dispose();
	} finally { Module._load = original; }
});
