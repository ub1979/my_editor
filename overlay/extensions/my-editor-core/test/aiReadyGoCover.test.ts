import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { coverRan } from '../src/aiready/goCover';

test('a block with a count inside the function\'s lines means it ran; zero counts and other files do not', () => {
	const p = 'mode: set\nm/a.go:3.21,4.11 1 1\nm/a.go:10.25,10.37 1 0\nm/b.go:3.1,9.2 2 1\n';
	assert.equal(coverRan(p, 'a.go', 3, 8), true);
	assert.equal(coverRan(p, 'a.go', 4, 4), true, 'a block overlapping the lines counts');
	assert.equal(coverRan(p, 'a.go', 10, 12), false);
	assert.equal(coverRan(p, 'a.go', 20, 30), false);
	assert.equal(coverRan(p, 'c.go', 1, 99), false);
	assert.equal(coverRan(p, 'b.go', 9, 9), true);
	assert.equal(coverRan('mode: atomic\na.go:3.1,5.2 1 7\n', 'a.go', 1, 3), true, 'a bare base name matches');
	assert.equal(coverRan(p, '/a.go', 3, 8), false);
	assert.equal(coverRan('mode: set\nm/xa.go:3.21,4.11 1 1\n', 'a.go', 3, 8), false, 'only whole base names match');
});

test('an empty or garbled profile shows nothing ran', () => {
	assert.equal(coverRan('', 'a.go', 1, 99), false);
	assert.equal(coverRan('mode: set\n', 'a.go', 1, 99), false);
	assert.equal(coverRan('not a profile\nm/a.go:3.21 1 1\nm/a.go:x.1,4.1 1 1\nm/a.go:3.1,4.1 1\n', 'a.go', 1, 99), false);
});
