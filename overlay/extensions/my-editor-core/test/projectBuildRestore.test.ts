import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import type { ProjectBuildState } from '../src/project/projectBuild';

test('reopening restores the project queue paused, drops expired proposal IDs and makes no model request', () => {
	const Module = require('node:module') as { _load: (name: string, parent: unknown, isMain: boolean) => unknown };
	const original = Module._load;
	const commands = new Map<string, (...args: unknown[]) => unknown>();
	const root = { toString: () => 'file:///project' };
	const disposable = { dispose() {} };
	const vscode = {
		window: { createStatusBarItem: () => ({ show() {}, dispose() {} }) }, StatusBarAlignment: { Left: 1 },
		workspace: { workspaceFolders: [{ uri: root }] },
		commands: { registerCommand: (name: string, handler: (...args: unknown[]) => unknown) => { commands.set(name, handler); return disposable; },
			executeCommand: async () => {} }, Disposable: { from: () => disposable },
	};
	const saved: ProjectBuildState = { version: 1, root: root.toString(), identity: 'saved-plan', status: 'review',
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
		assert.deepEqual(state.pending, []);
		assert.match(state.message, /Resume rebuilds any unkept batch/);
		assert.equal(saved.pending.length, 1, 'Loading must not mutate the stored object');
		instance.dispose();
	} finally { Module._load = original; }
});
