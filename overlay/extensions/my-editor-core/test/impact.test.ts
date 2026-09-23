import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { requirementOn, sectionAt } from '../src/project/impactSubject';

test('sectionAt finds the nearest anchored heading above the line', () => {
	const lines = ['# Architecture', '', '## Store {#store}', 'Keeps habits.', '## Streaks {#streaks}', 'Counts days.'];
	assert.equal(sectionAt(lines, 3), 'store');
	assert.equal(sectionAt(lines, 5), 'streaks');
	assert.equal(sectionAt(lines, 1), undefined);
});

test('requirementOn reads functional and non-functional IDs', () => {
	assert.equal(requirementOn('- FR-003 Show streaks. MUST'), 'FR-003');
	assert.equal(requirementOn('NFR-002: fast'), 'NFR-002');
	assert.equal(requirementOn('no id here'), undefined);
});
