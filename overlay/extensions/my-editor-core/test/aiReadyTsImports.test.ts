import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import type { SplitPlan } from '../src/aiready/language';
import { tsImportProblems } from '../src/aiready/tsMoveCheck';
import type { TsFileContext } from '../src/aiready/tsRules';
import { split, text, ts, tsInfo } from './tsFixture';

/** Rule 2 and 3 import problems for a split whose original and first new file were edited after it was built. */
function tamper(file: string, src: string, plan: SplitPlan, edit: { original?: (t: string) => string; first?: (t: string) => string },
	splitContext: Partial<TsFileContext> = {}, context: Partial<TsFileContext> = splitContext): string[] {
	const result = split(file, src, plan, splitContext);
	if (typeof result === 'string') { throw new Error(result); }
	const dir = file.slice(0, file.lastIndexOf('/') + 1);
	const parsed = (name: string, body: string) => ({ text: Buffer.from(body), info: tsInfo(name, body, context) });
	const original = edit.original ? edit.original(text(result)) : text(result);
	const files = result.files.map((f, i) => parsed(`${dir}${f.name}`, i === 0 && edit.first ? edit.first(text(result, 0)) : text(result, i)));
	return tsImportProblems(parsed(file, src), parsed(file, original), files);
}

/** The JavaScript TypeScript emits for a file, with or without verbatimModuleSyntax. */
function emit(code: string, verbatimModuleSyntax: boolean): string {
	const options = { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022, verbatimModuleSyntax };
	return ts.transpileModule(code, { compilerOptions: options }).outputText;
}

test('a rebuilt import keeps `$` patterns in its text: no $$, $& or $1 expansion', () => {
	const kept = "import { $$, type Gone } from './dollar.js';\n\nexport function moved(g: Gone) { return g; }\n\nexport function stays() { return $$; }\n";
	assert.match(text(split('src/a.ts', kept, [{ file: 'b.ts', declarations: [0] }])), /^import \{ \$\$ \} from '\.\/dollar\.js';$/m);
	const amp = "import { $1, type Gone } from './$&.js';\n\nexport function moved(g: Gone) { return g; }\n\nexport function stays() { return $1; }\n";
	assert.match(text(split('src/a.ts', amp, [{ file: 'b.ts', declarations: [0] }])), /^import \{ \$1 \} from '\.\/\$&\.js';$/m);
	const effect = "import { only } from './$$lib.js';\n\nexport function moved() { return only; }\n\nexport function stays() { return 2; }\n";
	assert.match(text(split('src/a.ts', effect, [{ file: 'b.ts', declarations: [0] }])), /^import '\.\/\$\$lib\.js';$/m);
});

test('an empty import clause is a side-effect import: never copied, never dropped', () => {
	const src = "import {} from './polyfill.js';\nimport type {} from './types.js';\nimport def from './def.js';\n\n"
		+ 'export function f() { return 1; }\n\nexport function g() { return f(); }\n';
	const result = split('src/a.ts', src, [{ file: 'b.ts', declarations: [0] }]);
	assert.equal(text(result, 0), '// Split from a.ts by my_editor.\n\nexport function f() { return 1; }\n');
	assert.match(text(result), /^import \{\} from '\.\/polyfill\.js';\nimport type \{\} from '\.\/types\.js';\nimport def from '\.\/def\.js';\n/);
	assert.deepEqual(tsInfo('src/a.ts', src).imports.slice(0, 1), ["_ './polyfill.js'"]);
});

test('types-only scope refuses to drop an import binding written as a value, so the emitted JavaScript cannot change', () => {
	const src = "import { sym, v } from './keys.js';\n\nexport interface Keyed { [sym]: number }\n\nexport function stays(k: Keyed) { return [k, v]; }\n";
	const plan = [{ file: 'keyed.ts', declarations: [0] }];
	assert.match(String(split('src/a.ts', src, plan, { scope: 'types' })), /sym \(from '\.\/keys\.js'\) is not written as a type/);
	const runtime = text(split('src/a.ts', src, plan));
	assert.match(runtime, /^import \{ v \} from '\.\/keys\.js';\n/);
	assert.notEqual(emit(runtime, false), emit(src, false), 'dropping sym changes the emitted imports');
	assert.match(tamper('src/a.ts', src, plan, {}, {}, { scope: 'types' }).join(' '), /Rule 2: the import import \{ sym, v \}/);
	const effect = "import { sym } from './keys.js';\n\nexport interface Keyed { [sym]: number }\n\nexport function stays(k: Keyed) { return k; }\n";
	assert.match(tamper('src/a.ts', effect, plan, {}, {}, { scope: 'types' }).join(' '), /Rule 2: the import import \{ sym \}/);
	const typed = "import { type T, v } from './t.js';\n\nexport type A = T;\n\nexport function stays() { return v; }\n";
	const kept = text(split('src/a.ts', typed, [{ file: 'a2.ts', declarations: [0] }], { scope: 'types' }));
	assert.match(kept, /^import \{ v \} from '\.\/t\.js';\n/);
	for (const verbatim of [true, false]) { assert.equal(emit(kept, verbatim), emit(typed, verbatim), `verbatimModuleSyntax: ${verbatim}`); }
});

test('rules 2 and 3 compare import attributes: a kept import must be byte-identical, a copy must keep them', () => {
	const src = "import { u } from './util.js';\nimport data from './data.json' with { type: 'json' };\nimport { readFileSync } from 'node:fs';\n\n"
		+ 'export function k(): number {\n\treturn data.k;\n}\n\nexport function size(p: string): number {\n\treturn readFileSync(p).length + data.k + u;\n}\n';
	const plan = [{ file: 'rows.ts', declarations: [0] }];
	assert.deepEqual(tamper('src/report.ts', src, plan, {}), []);
	const dropAttr = (t: string) => t.replace(" with { type: 'json' }", '');
	assert.match(tamper('src/report.ts', src, plan, { first: dropAttr }).join(' '), /Rule 3: src\/rows\.ts imports import data/);
	assert.match(tamper('src/report.ts', src, plan, { first: t => t.replace("type: 'json'", "type: 'css'") }).join(' '), /Rule 3/);
	const addAttr = (t: string) => t.replace("from 'node:fs';", "from 'node:fs' with { type: 'json' };");
	assert.match(tamper('src/report.ts', src, plan, { original: addAttr }).join(' '), /Rule 2: the import import \{ readFileSync \}/);
	const filtered = "import { a, type T } from './m.js';\nimport { z } from './z.js';\n\n"
		+ 'export function f(t: T) { return t; }\n\nexport function g() { return a + z; }\n';
	const respaced = (t: string) => t.replace("import { a } from './m.js';", "import {a} from './m.js';");
	assert.match(tamper('src/a.ts', filtered, [{ file: 'f.ts', declarations: [0] }], { original: respaced }).join(' '),
		/Rule 2: the import import \{ a, type T \}/);
});
