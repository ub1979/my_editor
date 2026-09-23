import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { anchorFor, batchFiles, Coverage, coverageLines, ensureSections, FileInfo, firstParagraph, groupByModule, moduleNote, moduleOf, parseSummaries, projectOutline, splitAtDefinitions, treeFromFiles } from '../src/brain/analysisPlan';

test('batchFiles respects the size budget and the per-batch count', () => {
	const files = Array.from({ length: 5 }, (_, i) => ({ path: `f${i}.ts`, text: 'x'.repeat(20_000) }));
	const batches = batchFiles(files, 21_000, 12);
	assert.equal(batches.length, 3); // each file clipped to 10,200 chars: 2 + 2 + 1
	assert.equal(batches[0][0].text.length, 10_200);
	assert.equal(batchFiles(files, 1_000_000, 2).length, 3);
});

test('parseSummaries keeps only asked paths and one-line strings', () => {
	const reply = 'Here:\n{"src/a.ts": "Parses\\n  input.", "src/b.ts": 3, "evil.ts": "x", "src/c.ts": ""}';
	assert.deepEqual(parseSummaries(reply, ['src/a.ts', 'src/b.ts', 'src/c.ts']), { 'src/a.ts': 'Parses input.' });
	assert.deepEqual(parseSummaries('not json', ['a']), {});
	assert.deepEqual(parseSummaries('["a"]', ['a']), {});
});

test('moduleOf groups by top folder, two levels under src-style roots', () => {
	assert.equal(moduleOf('README.md'), '.');
	assert.equal(moduleOf('src/api/client.ts'), 'src/api');
	assert.equal(moduleOf('src/main.ts'), 'src');
	assert.equal(moduleOf('tests/unit/a.py'), 'tests');
	assert.equal(anchorFor('src/api'), 'src-api');
	assert.equal(anchorFor('.'), 'root');
	assert.deepEqual([...groupByModule(['src/b/x.ts', 'a.ts', 'src/b/y.ts']).keys()], ['.', 'src/b']);
});

test('treeFromFiles marks existing files done and keeps planned ones', () => {
	const tree = treeFromFiles({ 'src/api/client.ts': 'Talks to the API.', 'main.py': undefined }, [
		{ path: 'main.py', section: 'root', status: 'in-progress', requirements: ['FR-001'] },
		{ path: 'src/new.ts', section: 'src', status: 'planned' },
	]);
	assert.deepEqual(tree, [
		{ path: 'main.py', section: 'root', status: 'in-progress', requirements: ['FR-001'], role: undefined },
		{ path: 'src/api/client.ts', role: 'Talks to the API.', section: 'src-api', status: 'done' },
		{ path: 'src/new.ts', section: 'src', status: 'planned' },
	]);
});

const info = (over: Partial<FileInfo> = {}): FileInfo => ({ lines: 10, imports: [], importedBy: [], exports: [], ...over });

test('moduleNote lists files and the parts they use and serve', () => {
	const files = {
		'src/api/client.ts': info({ summary: 'Talks to the API.', exports: ['get'], imports: ['src/util/http.ts'], importedBy: ['src/ui/app.ts'] }),
		'src/util/http.ts': info(),
		'src/ui/app.ts': info(),
	};
	const note = moduleNote('src/api', ['src/api/client.ts'], files);
	assert.match(note, /`src\/api\/client.ts` — Talks to the API\. Exports: get\./);
	assert.match(note, /## Uses\n\n- `src\/util` \(1 import\)/);
	assert.match(note, /## Used by\n\n- `src\/ui` \(1 import\)/);
	assert.match(note, /#src-api/);
});

test('projectOutline stays within budget and names every part with its anchor', () => {
	const files: Record<string, FileInfo> = {};
	for (let i = 0; i < 400; i++) {
		files[`pkg${i % 4}/f${i}.go`] = info({ summary: 'x'.repeat(100) });
	}
	const outline = projectOutline(files, 4_000);
	assert.ok(outline.length <= 4_002);
	assert.match(outline, /### pkg0 \{#pkg0\} — 100 files/);
	assert.match(outline, /… and \d+ more/);
});

test('ensureSections adds missing anchors only', () => {
	const doc = '# App\n\nOverview.\n\n## API {#src-api}\n\nText.';
	const out = ensureSections(doc, new Map([['src/api', ['src/api/a.ts']], ['.', ['main.py']]]));
	assert.ok(out.startsWith(doc));
	assert.match(out, /## Top-level files \{#root\}\n\nFiles: `main.py`\./);
	assert.equal(out.match(/\{#src-api\}/g)?.length, 1);
	assert.equal(firstParagraph(out), 'Overview.');
	assert.equal(firstParagraph('# Only a title'), undefined);
	assert.equal(firstParagraph('# T\n\nA tool (v2.1) for songs. It also exports.'), 'A tool (v2.1) for songs.');
	assert.equal(firstParagraph(`# T\n\n${'word '.repeat(60)}`, 22), 'word word word word…');
});

test('splitAtDefinitions cuts between top-level definitions and reports incomplete files', () => {
	const fn = (name: string) => `function ${name}() {\n${'  work();\n'.repeat(30)}}\n`;
	const text = [fn('a'), fn('b'), fn('c'), fn('d')].join('\n');
	const { pieces, complete } = splitAtDefinitions(text, 700);
	assert.ok(complete);
	assert.ok(pieces.length >= 2);
	assert.ok(pieces.every(p => p.text.length <= 700));
	for (const piece of pieces.slice(1)) {
		assert.match(piece.text, /^function \w\(\) \{/); // every later piece starts at a definition
	}
	assert.equal(pieces[0].start, 1);
	assert.equal(pieces.at(-1)!.end, text.split('\n').length);
	for (let i = 1; i < pieces.length; i++) {
		assert.equal(pieces[i].start, pieces[i - 1].end + 1);
	}
	const partial = splitAtDefinitions(text, 700, 1);
	assert.equal(partial.pieces.length, 1);
	assert.equal(partial.complete, false);
	const oneLine = splitAtDefinitions('x'.repeat(5_000), 1_000);
	assert.equal(oneLine.pieces.length, 1);
	assert.equal(oneLine.pieces[0].text.length, 1_000);
});

test('coverageLines says every gap and nothing when all was covered', () => {
	const none: Coverage = { tooLarge: [], fileLimitHit: false, secretFiles: 0, inPieces: 0, partlyRead: [], leftForLater: 0, failed: 0 };
	assert.deepEqual(coverageLines(none, 5_000), []);
	const lines = coverageLines({ ...none, tooLarge: ['a.js', 'b.js', 'c.js', 'd.js'], fileLimitHit: true, leftForLater: 1200 }, 5_000);
	assert.equal(lines.length, 3);
	assert.match(lines.join('\n'), /first 5,000 code files/);
	assert.match(lines.join('\n'), /`a.js`, `b.js`, `c.js` and 1 more/);
	assert.match(lines.join('\n'), /1,200 files\. .*Run Analyse again/);
});
