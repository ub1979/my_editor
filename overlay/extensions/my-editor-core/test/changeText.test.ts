import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { commitLine, historySubjectTerm, impactHint, workingTreeLine } from '../src/project/changeText';

const COMMIT = { hash: 'abc123', date: '2026-09-23', subject: 'Add indexes', paths: ['a.sql', 'b.go'] };

test('a history question searches commit subjects for its first topic word, never a Git or question word', () => {
	assert.equal(historySubjectTerm('Why was the redis cache changed?'), 'redis');
	assert.equal(historySubjectTerm('Which commit introduced this file change?'), undefined);
	assert.equal(historySubjectTerm('when did CHANGED Migrations break'), 'migrations');
	assert.equal(historySubjectTerm('why ok'), undefined, 'words shorter than four letters are skipped');
});

test('a commit line lists files and downstream importers only when detailed', () => {
	assert.equal(commitLine(COMMIT, false, new Set(['c.go'])), '- abc123 2026-09-23 Add indexes');
	assert.equal(commitLine(COMMIT, true, new Set(['c.go'])),
		'- abc123 2026-09-23 Add indexes\n  Files: a.sql, b.go\n  Possible downstream: c.go');
	assert.equal(commitLine({ ...COMMIT, paths: [] }, true, new Set()), '- abc123 2026-09-23 Add indexes');
	const many = { ...COMMIT, paths: Array.from({ length: 11 }, (_, i) => `f${i}.ts`) };
	assert.match(commitLine(many, true, new Set()), /Files: f0\.ts, .*f7\.ts \(\+3 more\)$/);
});

test('the working tree line is clean, or the first 10 changed paths (30 when detailed) with a count of the rest', () => {
	const changed = Array.from({ length: 12 }, (_, i) => `f${i}`);
	assert.equal(workingTreeLine([], true, false), 'Working tree: clean');
	assert.equal(workingTreeLine(changed, false, false), `Working tree: ${changed.slice(0, 10).join(', ')} (+2 more)`);
	assert.equal(workingTreeLine(changed, false, true), `Working tree: ${changed.join(', ')}`);
});

test('the impact hint names importers, linked requirements and section, or says none are recorded', () => {
	assert.equal(impactHint('src/a.ts', [], undefined), 'If src/a.ts changes: direct importers: (none recorded); '
		+ 'linked requirements: (none recorded); architecture section: (none recorded). '
		+ 'This is a dependency hint, not a prediction of runtime behavior.');
	const importers = Array.from({ length: 16 }, (_, i) => `u${i}.ts`);
	const hint = impactHint('src/a.ts', importers, { path: 'src/a.ts', role: 'x', requirements: ['R1', 'R2'], section: 'store' });
	assert.match(hint, /direct importers: u0\.ts, .*u14\.ts; linked requirements: R1, R2; architecture section: #store\./);
	assert.doesNotMatch(hint, /u15\.ts/);
});
