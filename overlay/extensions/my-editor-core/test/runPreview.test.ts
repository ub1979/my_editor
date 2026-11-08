import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import type { RunPreview as RunPreviewType } from '../src/chat/runPreview';

test('run previews close owned clean tabs but preserve pre-existing, pinned, dirty and repurposed tabs', async () => {
	const Module = require('node:module');
	const original = Module._load;
	const uri = (value: string) => ({ toString: () => value });
	class TabInputText { constructor(readonly uri: { toString(): string }) {} }
	const tabs: any[] = [], closed: any[] = [];
	const create = (name: string) => ({ input: new TabInputText(uri(name)), isDirty: false, isPreview: true });
	const api = { EventEmitter: class {
		listeners = new Set<(value: string) => void>();
		event = (fn: (value: string) => void) => { this.listeners.add(fn); return { dispose: () => this.listeners.delete(fn) }; };
		fire(value: string) { for (const fn of this.listeners) { fn(value); } }
	}, TabInputText, ViewColumn: { Active: -1 }, window: {
		tabGroups: { all: [{ tabs }], close: async (tab: any) => { closed.push(tab); tabs.splice(tabs.indexOf(tab), 1); return true; } },
		showTextDocument: async (target: ReturnType<typeof uri>) => {
			if (!tabs.some(tab => tab.input.uri.toString() === target.toString())) { tabs.push(create(target.toString())); }
		},
	} };
	try {
		Module._load = (name: string, parent: unknown, main: boolean) => name === 'vscode' ? api : original(name, parent, main);
		const { RunPreview } = require('../src/chat/runPreview') as { RunPreview: new () => RunPreviewType };
		const { filePassWillSave } = require('../src/project/filePassEvents');
		Module._load = original;
		const preview = new RunPreview();
		const existing = create('existing.ts'); tabs.push(existing);
		await preview.show(uri('existing.ts') as any, () => true); await preview.close();
		assert.deepEqual(tabs, [existing]); assert.equal(closed.length, 0);
		await preview.show(uri('generated.ts') as any, () => true); const generated = tabs.at(-1);
		await preview.close(); assert.ok(closed.includes(generated)); assert.deepEqual(tabs, [existing]);
		await preview.show(uri('saved.ts') as any, () => true); const saved = tabs.at(-1)!;
		filePassWillSave.fire('saved.ts'); saved.isPreview = false;
		await preview.close(); assert.ok(closed.includes(saved), 'Host saves may promote a preview but must not leave it open');
		for (const mode of ['dirty', 'pinned', 'repurposed']) {
			await preview.show(uri(mode + '.ts') as any, () => true); const tab = tabs.at(-1);
			assert.ok(tab);
			if (mode === 'dirty') { tab.isDirty = true; }
			if (mode === 'pinned') { tab.isPreview = false; }
			if (mode === 'repurposed') { tab.input = new TabInputText(uri('user-choice.ts')); }
			await preview.close(); assert.ok(tabs.includes(tab), mode); assert.ok(!closed.includes(tab), mode);
		}
		const before = tabs.length;
		await preview.show(uri('stale.ts') as any, () => false); assert.equal(tabs.length, before);
		let allowed = true;
		const opening = preview.show(uri('cancelled.ts') as any, () => allowed); allowed = false;
		await opening; assert.equal(tabs.length, before);
		preview.dispose();
	} finally { Module._load = original; }
});
