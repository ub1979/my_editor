import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { parseCloneSource, validBranchName } from '../src/project/cloneSource';

test('GitHub branch pages clone the repository and select the named branch', () => {
	assert.deepEqual(parseCloneSource('https://github.com/lucky-ali/go-dialer/tree/codex/production-predictdial-delivery-v1'), {
		url: 'https://github.com/lucky-ali/go-dialer.git',
		branch: 'codex/production-predictdial-delivery-v1',
		folderName: 'go-dialer',
	});
});

test('normal Git clone URLs remain usable', () => {
	assert.deepEqual(parseCloneSource('https://github.com/lucky-ali/go-dialer.git'), {
		url: 'https://github.com/lucky-ali/go-dialer.git', folderName: 'go-dialer',
	});
	assert.deepEqual(parseCloneSource('git@github.com:lucky-ali/go-dialer.git'), {
		url: 'git@github.com:lucky-ali/go-dialer.git', folderName: 'go-dialer',
	});
});

test('file pages, embedded credentials, and malformed branch names are rejected', () => {
	assert.equal(parseCloneSource('https://github.com/lucky-ali/go-dialer/blob/main/README.md'), undefined);
	assert.equal(parseCloneSource('https://user:token@github.com/lucky-ali/go-dialer'), undefined);
	assert.equal(parseCloneSource('https://github.com/lucky-ali/go-dialer/tree/bad..branch'), undefined);
	assert.equal(validBranchName('codex/production-predictdial-delivery-v1'), true);
	assert.equal(validBranchName('../other'), false);
});
