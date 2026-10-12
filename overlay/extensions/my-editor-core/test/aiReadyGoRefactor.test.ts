import { strict as assert } from 'node:assert';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { test } from 'node:test';
import { createGoAdapter, GO_LANGUAGE, goTools, type GoTools } from '../src/aiready/goAdapter';
import type { GoAst, GoDecl } from '../src/aiready/goAst';
import { createGoRefactor } from '../src/aiready/goRefactor';
import { platforms, type GoFileInfo } from '../src/aiready/goRules';
import type { RefactorHooks } from '../src/aiready/language';
import { goModule } from './goExtractFixture';

const FAKE: GoTools = { go: 'go', helper: 'goast', platforms: platforms(), extract: 'goextract' };

function goDecl(kind: GoDecl['kind'], names: string[], lines: number, receiver = ''): GoDecl {
	return { id: 0, kind, grouped: kind === 'var', names, receiver, start: 0, end: 0, lines, doc: '', docText: '', isInit: false, hasInit: false,
		embed: false, generate: false, own: true, qualifiers: [] };
}

const info = (...decls: GoDecl[]) => ({ path: 'a.go', declarations: [], frame: [], imports: [], go: { decls } as unknown as GoAst }) as GoFileInfo;

let tools: Promise<GoTools | string> | undefined;
/** The real Go tools, both helpers built once; a message when Go is not installed. */
function realTools(): Promise<GoTools | string> {
	tools ??= goTools(path.resolve(__dirname, '../../resources/goast/main.go'), path.join(os.tmpdir(), 'my-editor-goast-cache'), 'test');
	return tools;
}

test('the refactor target is the largest declaration over 400 lines, and only a function', () => {
	const hooks = createGoRefactor('/p', FAKE);
	assert.deepEqual(hooks.target(info(goDecl('func', ['small'], 30), goDecl('method', ['StepVerification'], 452, 'Store'), goDecl('var', ['x', 'y'], 410))),
		{ name: 'StepVerification', receiver: 'Store', lines: 452 });
	assert.deepEqual(hooks.target(info(goDecl('func', ['Big'], 420))), { name: 'Big', lines: 420 });
	assert.equal(hooks.target(info(goDecl('func', ['small'], 30), goDecl('var', ['x', 'y'], 410))), '`x` is a var, not a function');
	assert.equal(hooks.target(info(goDecl('func', ['f'], 400), goDecl('type', ['T'], 12))), 'no declaration is over 400 lines');
	assert.equal(hooks.target(info()), 'no declaration is over 400 lines');
	assert.deepEqual(createGoAdapter('/p', FAKE, []).fixes, ['split', 'tests', 'refactor']);
	assert.ok(createGoAdapter('/p', FAKE, []).refactor);
	assert.deepEqual(createGoAdapter('/p', { ...FAKE, extract: undefined }, []).fixes, ['split', 'tests']);
	assert.equal(createGoAdapter('/p', { ...FAKE, extract: undefined }, []).refactor, undefined);
	assert.deepEqual(GO_LANGUAGE.fixes, ['split', 'tests', 'refactor']);
});

test('coverage runs go test with a dot-file profile in the worktree root, one per package', () => {
	const hooks = createGoRefactor('/p', FAKE);
	assert.deepEqual(hooks.coverage('internal/store/plan.go', 2), {
		command: { label: 'test', command: 'go test -count=1 -coverprofile=.my_editor-cover-2.out ./internal/store' }, profile: '.my_editor-cover-2.out' });
	assert.equal(hooks.coverage('main.go', 0).command.command, 'go test -count=1 -coverprofile=.my_editor-cover-0.out .');
	assert.match(hooks.mayDiffer, /runtime\.Caller/);
	assert.match(hooks.approvalNote, /go list -export[\s\S]*go build[\s\S]*helper\.$/);
	assert.doesNotMatch(hooks.approvalNote, /`/, 'the approval modal is plain text');
});

test('ran reads the profile by the function\'s lines in the file', async t => {
	const found = await realTools();
	if (typeof found === 'string') { t.skip(found); return; }
	const root = goModule({ 'sub/a.go': 'package sub\n\nfunc First() int {\n\treturn 1\n}\n\n// Second is second.\nfunc Second() int {\n\treturn 2\n}\n' });
	const hooks = createGoRefactor(root, found);
	const profile = 'mode: set\nexample.com/m/sub/a.go:8.19,10.2 1 1\nexample.com/m/sub/a.go:3.18,5.2 1 0\n';
	assert.equal(await hooks.ran(profile, 'sub/a.go', { name: 'Second', lines: 4 }), true);
	assert.equal(await hooks.ran(profile, 'sub/a.go', { name: 'First', lines: 3 }), false);
	assert.equal(await hooks.ran(profile, 'sub/a.go', { name: 'Second', receiver: 'T', lines: 4 }), false, 'no such method');
});

test('end to end on a small module: the prompt, a plan, the build and the extract check, and the result builds', async t => {
	const found = await realTools();
	if (typeof found === 'string') { t.skip(found); return; }
	assert.ok(found.extract, 'goTools builds the extract helper');
	const source = `package m\nfunc Big(i int) int {\n\tn := 0\n${'\tn += i\n'.repeat(405)}\treturn n\n}\n`;
	const root = goModule({ 'a.go': source });
	const adapter = createGoAdapter(root, found, ['go.mod', 'a.go']);
	const hooks = adapter.refactor as RefactorHooks;
	const target = hooks.target(await adapter.parse('a.go'));
	assert.deepEqual(target, { name: 'Big', lines: 409 });
	if (typeof target === 'string') { return; }
	const prompt = await hooks.prompt('a.go', target);
	assert.ok(typeof prompt !== 'string' && prompt.text.includes('Function: Big, lines 2–410'), String(prompt));
	const built = await hooks.build('a.go', target, [{ name: 'addMany', from: 3, to: 300 }]);
	assert.deepEqual(built.problems, []);
	assert.deepEqual(built.helpers, [{ name: 'addMany', params: ['i'], outputs: ['n'], returns: false }]);
	assert.equal(built.functionLines, 112);
	writeFileSync(path.join(root, 'a.go'), built.text!);
	assert.deepEqual(await hooks.check('a.go', Buffer.from(source), target, built), []);
	assert.match(readFileSync(path.join(root, 'a.go'), 'utf8'), /\tn := addMany\(i\)\n/);
	execFileSync(found.go, ['build', './...'], { cwd: root, env: { ...process.env, GOTOOLCHAIN: 'local', GOFLAGS: '', GOPROXY: 'off' } });
});

test('the extract check is never run without a successful build\'s facts', async () => {
	const hooks = createGoRefactor('/p', FAKE);
	assert.deepEqual(await hooks.check('a.go', Buffer.from(''), { name: 'Big', lines: 420 }, { problems: [] }),
		['The build reported no helpers, so there is nothing to check.']);
});

test('a prompt that throws leaves no temp folder behind', async () => {
	const tmp = mkdtempSync(path.join(os.tmpdir(), 'my-editor-refactor-tmp-'));
	const saved = process.env.TMPDIR;
	process.env.TMPDIR = tmp;
	try {
		const hooks = createGoRefactor('/p', { ...FAKE, go: 'go\0' });
		await assert.rejects(hooks.prompt('a.go', { name: 'Big', lines: 420 }));
		hooks.abandon?.('a.go');
	} finally {
		process.env.TMPDIR = saved;
	}
	assert.deepEqual(readdirSync(tmp), []);
});
