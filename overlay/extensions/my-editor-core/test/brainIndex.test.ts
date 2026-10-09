import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import type { BrainMap, MapEntry } from '../src/brain/brain';
import { describeEntry, indexNote, mapSection, mergeAuto, PLACEHOLDER } from '../src/brain/brainIndex';

function entry(fields: Partial<MapEntry> = {}): MapEntry {
	return { language: 'ts', lines: 10, imports: [], exports: [], importedBy: [], ...fields };
}

function brain(files: Record<string, MapEntry>, extra: Partial<BrainMap> = {}): BrainMap {
	return { builtAt: '2026-10-09', commit: 'abc123', files, ...extra };
}

test('a file is described by the user note, then the summary, then its doc role, then its exports', () => {
	assert.equal(describeEntry(entry({ note: 'mine', summary: 'pair', role: 'doc' })), 'mine');
	assert.equal(describeEntry(entry({ summary: 'pair', role: 'doc' })), 'pair');
	assert.equal(describeEntry(entry({ role: 'doc' })), 'doc');
	assert.equal(describeEntry(entry({ exports: ['a', 'b', 'c', 'd', 'e'] })), 'exports a, b, c, d');
	assert.equal(describeEntry(entry()), '');
	assert.equal(describeEntry(undefined), '');
});

test('the generated block replaces only the text between its markers', () => {
	const first = mergeAuto(undefined, 'map v1', '# Title\n\n');
	assert.match(first, /^# Title\n\n<!-- my_editor:auto[^\n]*-->\nmap v1\n<!-- \/my_editor:auto -->\n$/);
	const edited = first.replace('# Title', '# My title') + 'My own notes.\n';
	const second = mergeAuto(edited, 'map v2', '# ignored\n\n');
	assert.match(second, /^# My title\n/);
	assert.match(second, /\nmap v2\n/);
	assert.doesNotMatch(second, /map v1/);
	assert.match(second, /My own notes\.\n$/);
	assert.equal(mergeAuto('Hand-written index.\n\n', 'map', '# x'), `Hand-written index.\n\n${mergeAuto(undefined, 'map', '', '\n')}`,
		'a note without markers keeps its text and gains the block at the end');
});

test('a new index note starts with the project name, the placeholder line and a Notes section', () => {
	const note = indexNote(undefined, 'map', 'shop');
	assert.ok(note.startsWith(`# shop\n\n${PLACEHOLDER}\n\n`));
	assert.match(note, /\n\n## Notes\n\nDecisions, gotchas and anything the pair should always know\.\n$/);
	assert.equal(indexNote(note, 'map 2', 'renamed'), note.replace('\nmap\n', '\nmap 2\n'));
});

test('the map counts languages and modules, names the most used files and lists every file of a small project', () => {
	const text = mapSection(brain({
		'src/api/a.ts': entry({ importedBy: ['src/api/b.ts', 'main.py'], summary: 'Routes requests' }),
		'src/api/b.ts': entry(),
		'main.py': entry({ language: 'py', importedBy: [] }),
	}, { modules: { 'src/api': 'The HTTP layer.' } }), 5_000);
	assert.match(text, /^## Map\n\n- \*\*Files:\*\* 3 \(TypeScript 2, Python 1\) · built at abc123\n/);
	assert.match(text, /- \*\*Most used:\*\* `src\/api\/a\.ts` \(2\)\n/);
	assert.match(text, /- `\.` — 1 file\n  - `main\.py`\n/);
	assert.match(text, /- `src\/api` — 2 files\. The HTTP layer\.\n  - `src\/api\/a\.ts` — Routes requests\n  - `src\/api\/b\.ts`/);
	assert.match(text, /\*\*Not covered:\*\* 2 files have no summary yet/);
});

test('the map says what it leaves out and stays within its budget', () => {
	const files = Object.fromEntries(Array.from({ length: 400 }, (_, i) => [`pkg${i}/file${i}.go`, entry({ language: 'go' })]));
	const text = mapSection(brain(files, { fileLimitHit: true, tooLarge: ['a.ts', 'b.ts', 'c.ts', 'd.ts'] }), 400);
	assert.match(text, /\*\*Not covered:\*\* only the first 400 code files are mapped; 4 files are too large to read \(a\.ts, b\.ts, c\.ts, …\)/);
	assert.match(text, /\n- … \(trimmed to keep the brain short; see map\.json\)$/);
	assert.ok(text.length <= 7_000 + 60);
	assert.doesNotMatch(text, /pkg0\/file0\.go`/, 'a project over 60 files lists modules, not files');
	assert.match(mapSection(brain({}), 10), /- \*\*Most used:\*\* none yet/);
});
