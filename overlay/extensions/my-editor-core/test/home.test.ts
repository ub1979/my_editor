import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { shortPath } from '../src/project/homePaths';

test('shortPath uses ~ for the home folder', () => {
	assert.equal(shortPath('/Users/u/funcoding/lyra', '/Users/u'), '~/funcoding/lyra');
	assert.equal(shortPath('/Users/u', '/Users/u'), '~');
});

test('shortPath keeps the start and the end of long paths', () => {
	const long = '/private/tmp/claude-501/-Users-u-funcoding-my-editor/a02d8390-09ef-43e7/scratchpad/newparent/demo-app';
	const short = shortPath(long, '/Users/u');
	assert.ok(short.length <= 44, short);
	assert.ok(short.startsWith('/private/…/'), short);
	assert.ok(short.endsWith('newparent/demo-app'), short);
});

test('shortPath leaves short paths alone', () => {
	assert.equal(shortPath('/opt/work/app', '/Users/u'), '/opt/work/app');
});
