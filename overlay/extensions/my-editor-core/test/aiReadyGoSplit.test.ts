import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { goFileNameProblems } from '../src/aiready/goRules';
import { buildGoSplit } from '../src/aiready/goSplit';
import type { LanguageAdapter, SplitPlan } from '../src/aiready/language';
import { checkMove, declarationProblems } from '../src/aiready/moveCheck';
import { parsePlan, planProblems } from '../src/aiready/splitPlan';
import { goInfo, KNOWN, SHOP, YAML } from './goFixture';

const PLAN: SplitPlan = [{ file: 'shop_yaml.go', declarations: [6] }, { file: 'shop_misc.go', declarations: [3, 4, 5, 7] }];

/** Only the parts of the adapter that the pure plan check uses. */
const adapter = {
	fileNameProblems: (name: string) => goFileNameProblems(name, KNOWN),
	buildSplit: buildGoSplit,
} as unknown as LanguageAdapter;

test('a split builds new files with a header, a blank line and only the imports they use', async t => {
	const parsed = await goInfo('shop/shop.go', SHOP, YAML);
	if (!parsed) { t.skip('Go is not installed'); return; }
	const result = buildGoSplit(parsed.source, parsed.info, PLAN);
	assert.equal(result.files[0].text.toString(), '// Split from shop.go by my_editor.\n\npackage shop\n\nimport (\n\t"gopkg.in/yaml.v3"\n)\n\n'
		+ '// Encode writes v as YAML.\nfunc Encode(v any) ([]byte, error) { return yaml.Marshal(v) } // nolint\n');
	assert.match(result.files[1].text.toString(), /import \(\n\t"fmt"\n\t"strings"\n\)\n\nvar _ fmt.Stringer\n\nvar _ fmt.Stringer\n\nvar cache/);
	const original = result.original.toString();
	assert.match(original, /import \(\n\t"fmt"\n\)\n/);
	assert.match(original, /var counter = 1\n\n\/\/ Detached note about encoding.\n\nfunc describe/);
	assert.doesNotMatch(original, /\n\n\n/);
});

test('the move check passes a clean split, including rule 4 across the package', async t => {
	const parsed = await goInfo('shop/shop.go', SHOP, YAML);
	if (!parsed) { t.skip('Go is not installed'); return; }
	const result = buildGoSplit(parsed.source, parsed.info, PLAN);
	const after = (await goInfo('shop/shop.go', result.original, YAML))!;
	const files = [(await goInfo('shop/shop_yaml.go', result.files[0].text, YAML))!, (await goInfo('shop/shop_misc.go', result.files[1].text, YAML))!];
	const input = { before: { text: parsed.source, info: parsed.info }, after: { text: after.source, info: after.info },
		files: files.map(f => ({ text: f.source, info: f.info })), plan: PLAN };
	assert.deepEqual(checkMove(input), []);
	assert.deepEqual(declarationProblems([parsed.info], [after.info, ...files.map(f => f.info)]), []);
});

test('the move check catches an edited body, extra content, reordering and a new import', async t => {
	const parsed = await goInfo('shop/shop.go', SHOP, YAML);
	if (!parsed) { t.skip('Go is not installed'); return; }
	const result = buildGoSplit(parsed.source, parsed.info, PLAN);
	const after = (await goInfo('shop/shop.go', result.original, YAML))!;
	const misc = (await goInfo('shop/shop_misc.go', result.files[1].text, YAML))!;
	const check = async (yamlText: string, originalText = result.original.toString()) => {
		const yaml = (await goInfo('shop/shop_yaml.go', yamlText, YAML))!;
		const original = (await goInfo('shop/shop.go', originalText, YAML))!;
		return checkMove({ before: { text: parsed.source, info: parsed.info }, after: { text: original.source, info: original.info },
			files: [{ text: yaml.source, info: yaml.info }, { text: misc.source, info: misc.info }], plan: PLAN }).join(' ');
	};
	const yaml = result.files[0].text.toString();
	assert.match(await check(yaml.replace('yaml.Marshal', 'yaml.Unmarshal')), /Rule 1/);
	assert.match(await check(`${yaml}\n// stray\n`), /Rule 3/);
	const original = result.original.toString();
	const swapped = original.replace('var counter = 1\n\n', '').replace('func describe', 'var counter = 1\n\nfunc describe');
	assert.match(await check(yaml, swapped), /Rule 2/);
	assert.match(await check(yaml, original.replace('\t"fmt"\n', '\t"fmt"\n\t"os"\n')), /gained the import os/);
	const attached = (await goInfo('shop/shop.go', original.replace('encoding.\n\nfunc', 'encoding.\nfunc'), YAML))!;
	assert.match(declarationProblems([after.info], [attached.info]).join(' '), /Rule 4: func describe/);
});

test('plans refer to IDs: unknown, repeated, unmovable and over-long plans are refused with reasons', async t => {
	const parsed = await goInfo('shop/shop.go', SHOP, YAML);
	if (!parsed) { t.skip('Go is not installed'); return; }
	const input = { source: parsed.source, info: parsed.info, existing: ['shop.go', 'Shop_Yaml.go'] };
	assert.deepEqual(planProblems(adapter, { ...input, existing: ['shop.go'] }, PLAN), []);
	const problems = planProblems(adapter, input, [{ file: 'shop_yaml.go', declarations: [6, 6, 2, 42] }, { file: 'shop_linux.go', declarations: [3] }]).join(' ');
	assert.match(problems, /42 does not exist/);
	assert.match(problems, /6 is listed twice/);
	assert.match(problems, /2 \(var counter\) may not move: an initialized package variable/);
	assert.match(problems, /shop_yaml.go already exists/);
	assert.match(problems, /_linux, which Go treats as a build constraint/);
	const long = `package shop\n\n${Array.from({ length: 450 }, (_, i) => `func f${i}() {}`).join('\n')}\n`;
	const big = (await goInfo('shop/big.go', long))!;
	assert.match(planProblems(adapter, { source: big.source, info: big.info, existing: [] }, [{ file: 'big_a.go', declarations: [0] }]).join(' '),
		/big.go would still have 451 lines/);
	assert.deepEqual(parsePlan('Here: [{"file":"a.go","declarations":[1,2]}]'), [{ file: 'a.go', declarations: [1, 2] }]);
	assert.equal(parsePlan('[{"file":"a.go","declarations":["x"]}]'), undefined);
});

test('a blank import stays in the original, and a file with no used import gets no import block', async t => {
	const parsed = await goInfo('shop/embed.go', 'package shop\n\nimport _ "embed"\n\ntype Colour int\n\nvar plain string\n');
	if (!parsed) { t.skip('Go is not installed'); return; }
	const result = buildGoSplit(parsed.source, parsed.info, [{ file: 'embed_more.go', declarations: [0, 1] }]);
	assert.equal(result.original.toString(), 'package shop\n\nimport _ "embed"\n');
	assert.equal(result.files[0].text.toString(), '// Split from embed.go by my_editor.\n\npackage shop\n\ntype Colour int\n\nvar plain string\n');
});
