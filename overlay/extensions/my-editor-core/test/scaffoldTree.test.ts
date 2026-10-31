import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { requirements, architecture } from './planningFixture';

test('keeping a tree creates every missing nested stub and preserves existing files', async () => {
	const root = mkdtempSync(path.join(os.tmpdir(), 'editor-tree-'));
	const specs = path.join(root, '.my_editor', 'specs');
	mkdirSync(specs, { recursive: true });
	writeFileSync(path.join(specs, 'requirements.md'), requirements);
	writeFileSync(path.join(specs, 'architecture.md'), architecture);
	mkdirSync(path.join(root, 'src'));
	writeFileSync(path.join(root, 'src', 'existing.ts'), 'existing code\n');
	writeFileSync(path.join(specs, 'tree.json'), JSON.stringify([
		{ path: 'src/existing.ts', role: 'Do not replace this.', status: 'planned' },
		{ path: 'src/new.ts', role: 'Stores data.', status: 'planned' },
		{ path: 'docs/guide.md', role: 'Explains setup.', status: 'planned' },
		{ path: '../outside.ts', role: 'Unsafe path.', status: 'planned' },
	].map(file => ({ ...file, requirements: ['FR-001'], section: 'store' }))));
	const Module = require('node:module') as { _load: (name: string, parent: unknown, isMain: boolean) => unknown };
	const originalLoad = Module._load;
	const uri = (fsPath: string) => ({ fsPath });
	const vscode = {
		Uri: { file: uri, joinPath: (base: { fsPath: string }, ...parts: string[]) => uri(path.join(base.fsPath, ...parts)) },
		workspace: { fs: {
			readFile: async (target: { fsPath: string }) => fs.readFile(target.fsPath),
			writeFile: async (target: { fsPath: string }, bytes: Uint8Array) => fs.writeFile(target.fsPath, bytes),
			stat: async (target: { fsPath: string }) => fs.stat(target.fsPath),
			createDirectory: async (target: { fsPath: string }) => fs.mkdir(target.fsPath, { recursive: true }),
		} },
	};
	try {
		Module._load = (name, parent, isMain) => name === 'vscode' ? vscode : originalLoad(name, parent, isMain);
		const { scaffoldKeptTree } = require('../src/project/tree') as typeof import('../src/project/tree');
		Module._load = originalLoad;
		const result = await scaffoldKeptTree(uri(root) as never);
		assert.equal(result.created, 2);
		assert.equal(result.skipped.length, 1);
		assert.match(result.skipped[0], /outside/);
		assert.equal(readFileSync(path.join(root, 'src', 'existing.ts'), 'utf8'), 'existing code\n');
		assert.match(readFileSync(path.join(root, 'src', 'new.ts'), 'utf8'), /Stores data\./);
		assert.match(readFileSync(path.join(root, 'docs', 'guide.md'), 'utf8'), /Explains setup\./);
		const saved = JSON.parse(readFileSync(path.join(specs, 'tree.json'), 'utf8')) as { status: string }[];
		assert.deepEqual(saved.map(file => file.status), ['planned', 'stub', 'stub', 'planned']);
		writeFileSync(path.join(specs, 'architecture.md'), architecture + '\nWhen you say write it, I will produce the full architecture doc.');
		writeFileSync(path.join(specs, 'tree.json'), JSON.stringify([{ path: 'src/late.ts', role: 'A new part.', requirements: ['FR-001'], section: 'store' }]));
		await assert.rejects(scaffoldKeptTree(uri(root) as never), /Finalize architecture/);
		assert.equal(existsSync(path.join(root, 'src', 'late.ts')), false);
		assert.equal(readFileSync(path.join(root, 'src', 'existing.ts'), 'utf8'), 'existing code\n');
	} finally {
		Module._load = originalLoad;
		rmSync(root, { recursive: true, force: true });
	}
});
