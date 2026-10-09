import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import type * as TS from 'typescript';
import { fileProgram } from '../src/aiready/tsAst';
import {
	classPure, definitionReads, definitionTime, enumLiteral, hasDecorators, identifiers, isDeclarationName, isPure, isTypeUse, isWrite, moduleName,
	Scope, spanProblems, topStatement,
} from '../src/aiready/tsRefs';
import { OPTIONS, ts } from './tsFixture';

function scopeOf(text: string, file = 'src/a.ts'): Scope {
	const { source, checker } = fileProgram(ts, file, text, OPTIONS);
	return { ts, checker, source };
}

/** Every identifier named `name` in the file, in source order. */
function ids(scope: Scope, name: string): TS.Identifier[] {
	return identifiers(ts, scope.source).filter(id => id.text === name);
}

/** The initializer of the top-level `const` at `index`. */
function init(scope: Scope, index: number): TS.Expression {
	const statement = scope.source.statements[index] as TS.VariableStatement;
	return statement.declarationList.declarations[0].initializer!;
}

test('topStatement climbs to the statement directly under the source file', () => {
	const scope = scopeOf('const a = 1;\nfunction f() { return [a + 1]; }\n');
	const use = ids(scope, 'a')[1];
	assert.equal(topStatement(ts, use), scope.source.statements[1]);
	assert.equal(topStatement(ts, scope.source.statements[0]), scope.source.statements[0]);
});

test('moduleName resolves imports and top-level names, never locals, parameters, members or globals', () => {
	const scope = scopeOf("import { dep } from './dep';\nconst top = 1;\nconst { x } = { x: 2 };\n"
		+ 'export function f(param: number) { const local = 3; return [dep, top, x, param, local, Math.max, { top }]; }\n');
	const resolved = (name: string, nth = -1) => moduleName(scope, ids(scope, name).at(nth)!);
	assert.equal(resolved('dep'), 'dep');
	assert.equal(resolved('top', -2), 'top');
	assert.equal(resolved('top'), 'top', 'shorthand `{ top }` resolves to the value it reads');
	assert.equal(resolved('x'), 'x', 'a destructured top-level binding is module scope');
	assert.equal(resolved('param'), undefined);
	assert.equal(resolved('local'), undefined);
	assert.equal(resolved('Math'), undefined);
	assert.equal(resolved('max'), undefined);
});

test('isDeclarationName tells declared names from uses', () => {
	const scope = scopeOf('function f(p: number) { return p; }\nconst v = f(1);\nclass C {}\n');
	assert.equal(isDeclarationName(ts, ids(scope, 'f')[0]), true);
	assert.equal(isDeclarationName(ts, ids(scope, 'f')[1]), false);
	assert.equal(isDeclarationName(ts, ids(scope, 'p')[0]), true);
	assert.equal(isDeclarationName(ts, ids(scope, 'p')[1]), false);
	assert.equal(isDeclarationName(ts, ids(scope, 'v')[0]), true);
	assert.equal(isDeclarationName(ts, ids(scope, 'C')[0]), true);
});

test('isTypeUse: types, implements and interface extends are type uses; class extends and values are not', () => {
	const scope = scopeOf('interface I {}\nclass B {}\ninterface J extends I {}\nclass C extends B implements I {}\n'
		+ 'const b: B = new B();\nexport type { B as BB };\n');
	const uses = (name: string) => ids(scope, name).filter(id => !isDeclarationName(ts, id)).map(id => isTypeUse(ts, id));
	assert.deepEqual(uses('I'), [true, true]);
	assert.deepEqual(uses('B'), [false, true, false, true]);
});

test('identifiers include JSDoc types but not {@link} names', () => {
	const scope = scopeOf('/** @type {Shape} See {@link Other}. */\nconst s = {};\n', 'src/a.js');
	const names = identifiers(ts, scope.source).map(id => id.text);
	assert.ok(names.includes('Shape'));
	assert.ok(!names.includes('Other'));
});

test('definitionTime lists the code that runs when a declaration is evaluated', () => {
	const scope = scopeOf('const a = f(), b;\nclass C extends Base { static s = g(); [key] = 1; x = h(); static { run(); } m() { k(); } }\n'
		+ 'enum E { A = 1, B }\nfunction fn() { z(); }\ninterface I {}\n');
	const texts = (index: number) => definitionTime(ts, scope.source.statements[index]).map(node => node.getText(scope.source));
	assert.deepEqual(texts(0), ['f()']);
	assert.deepEqual(texts(1), ['Base', 'g()', 'key', '{ run(); }']);
	assert.deepEqual(texts(2), ['1']);
	assert.deepEqual(texts(3), []);
	assert.deepEqual(texts(4), []);
});

test('definitionReads: module-scope values read at definition time, not inside functions, nor as types', () => {
	const scope = scopeOf('const A = 1;\nconst B = 2;\ntype T = number;\nconst C = 3;\n'
		+ 'export const v: T = [A, () => B, class { static s = C; }];\n');
	assert.deepEqual(definitionReads(scope, scope.source.statements[4]).sort(), ['A', 'C']);
});

test('isPure accepts literals, functions, module reads, wrappers and empty collections', () => {
	const scope = scopeOf('const top = 1;\nconst a = [1, -2, "s", `t`, /r/, true, null, undefined, top, () => 1, ,];\n'
		+ 'const b = { k: 1, "q": top, [\'c\']: 2, top, m() { return 1; } } as const;\nconst c = new Map();\nconst d = (top!);\n');
	for (const index of [1, 2, 3, 4]) { assert.equal(isPure(scope, init(scope, index)), true, String(index)); }
});

test('isPure refuses anything that may run code', () => {
	const scope = scopeOf('const key = "k";\nconst a = f();\nconst b = [...xs];\nconst c = { [key]: 1 };\nconst d = new Map([[1, 2]]);\n'
		+ 'const e = -x;\nconst g = { get v() { return 1; } };\nconst h = obj.prop;\nconst i = `t${key}`;\nconst j = unknownGlobal;\n');
	for (let index = 1; index <= 9; index++) { assert.equal(isPure(scope, init(scope, index)), false, String(index)); }
});

test('isPure refuses a shadowed `undefined` and a local class named Map', () => {
	const scope = scopeOf('class Map {}\nconst a = new Map();\n');
	assert.equal(isPure(scope, init(scope, 1)), false);
});

test('classPure: decorators, computed names read from variables, impure statics and static blocks with code refuse', () => {
	const pure = scopeOf('class A { static n = 1; ["k"] = 2; m() { side(); } static {} }\n');
	assert.equal(classPure(pure, pure.source.statements[0] as TS.ClassDeclaration), true);
	for (const text of ['class A { static n = f(); }', 'const k = "k";\nclass A { [k] = 1; }', 'class A { static { f(); } }',
		'class A extends make() {}', '@dec class A {}', 'class A { m(@inject x: number) {} }']) {
		const scope = scopeOf(`${text}\n`);
		const node = scope.source.statements.find(ts.isClassDeclaration)!;
		assert.equal(classPure(scope, node), false, text);
	}
});

test('hasDecorators finds a decorator anywhere in a class', () => {
	const scope = scopeOf('class A { @field x = 1; }\nclass B { x = 1; }\n');
	assert.equal(hasDecorators(ts, scope.source.statements[0]), true);
	assert.equal(hasDecorators(ts, scope.source.statements[1]), false);
});

test('enumLiteral accepts literals and earlier members; refuses calls and later members', () => {
	const literal = (text: string) => {
		const scope = scopeOf(`${text}\n`);
		return enumLiteral(ts, scope.source.statements.find(ts.isEnumDeclaration)!);
	};
	assert.equal(literal('enum E { A, B = 2, C = -3, D = "d", F = A, G = E.B }'), true);
	assert.equal(literal('enum E { A = f() }'), false);
	assert.equal(literal('enum E { A = B, B = 1 }'), false);
	assert.equal(literal('const k = 1;\nenum E { A = k }'), false);
});

test('isWrite: assignments, updates, for-of targets and destructuring targets; reads are not writes', () => {
	const scope = scopeOf('let a = 0, b = 0, c = 0, d = 0, e = 0, f = 0;\na = 1;\nb++;\n--c;\nfor (d of []) {}\n'
		+ '[e, { f }] = [1, { f: 2 }];\nconst r = a + b;\nlet g = 0;\ng += 1;\n');
	const write = (name: string, nth: number) => isWrite(ts, ids(scope, name)[nth]);
	assert.deepEqual([write('a', 1), write('b', 1), write('c', 1), write('d', 1), write('e', 1), write('f', 1), write('g', 1)],
		[true, true, true, true, true, true, true]);
	assert.equal(write('a', 2), false);
	assert.equal(write('f', 2), false, 'the property name `f` on the right is not a write');
});

test('spanProblems names everything that ties code to its module or file', () => {
	const problems = (text: string, file?: string) => {
		const scope = scopeOf(`${text}\n`, file);
		return spanProblems(scope, scope.source.statements.at(-1)!);
	};
	assert.deepEqual(problems('export const u = import.meta.url;'), ['it uses `import.meta`, which names its module']);
	assert.deepEqual(problems('export const d = import.meta.dirname;'), []);
	assert.deepEqual(problems('export const t = this;'), ['it uses `this` at module level, which differs per module']);
	assert.deepEqual(problems('export class A { m() { return this; } }'), []);
	assert.deepEqual(problems('export const f = __filename;', 'src/a.js'), ['it uses `__filename`, which names its module or file']);
	assert.deepEqual(problems('export const m = require(name);', 'src/a.js'), ['it uses `require` other than `require(\'literal\')`']);
	assert.deepEqual(problems('export const m = require("./m");', 'src/a.js'), []);
	assert.deepEqual(problems('export const l = readdirSync(".");'), ['it lists a folder, which would now hold the new files']);
	assert.deepEqual(problems('export const e = obj.exports;'), [], 'a property named `exports` is not the module object');
	assert.deepEqual(problems('const module = 1;\nexport const m = module;'), [], 'a declared `module` is not the module object');
});
