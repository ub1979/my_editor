import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { CheckLocation, focusedChecks, verificationPlan } from '../src/project/verificationPlan';
import { failureSignature, repeatedFailure } from '../src/project/verificationProgress';

const location = (directory: string, data: unknown): CheckLocation => ({ directory, names: ['package.json', 'tsconfig.json'], packageJson: JSON.stringify(data) });
test('required checks build workspace dependencies before testing their consumers', () => {
	assert.equal(verificationPlan([location('', {})]).checks[0].kind, 'typecheck', 'A no-emit check is not an artifact-producing build');
	const plan = verificationPlan([
		location('', { scripts: { build: 'aggregate build', test: 'aggregate test' } }),
		location('apps/api', { name: 'api', dependencies: { core: 'workspace:*' }, scripts: { build: 'tsc', typecheck: 'tsc --noEmit', lint: 'eslint .', test: 'vitest run' } }),
		location('packages/core', { name: 'core', scripts: { build: 'tsc', test: 'vitest run' } }),
	]);
	const ids = plan.checks.map(item => item.id);
	assert.ok(ids.indexOf('packages/core:npm run build') < ids.indexOf('apps/api:npm run build'));
	assert.ok(ids.indexOf('apps/api:npm run build') < ids.indexOf('.:npm run build'));
	assert.ok(ids.indexOf('packages/core:npm run build') < ids.indexOf('apps/api:npm test'));
	assert.ok(plan.checks.some(item => item.kind === 'lint'));
	assert.ok(plan.checks.some(item => item.kind === 'typecheck'));
	assert.ok(!ids.some(id => id.includes('npx')), 'Explicit compiler scripts replace generic detection');
	const selected = focusedChecks(plan, ['apps/api:npm test'], ['apps/api/src/routes.ts']);
	assert.ok(selected.some(item => item.id === 'packages/core:npm run build'), 'Focused tests refresh dependency artifacts');
	assert.ok(!selected.some(item => item.directory === ''), 'A scoped repair need not rerun the unrelated root aggregate');
	assert.throws(() => focusedChecks(plan, ['apps/api:deleted test'], []), /disappeared/);
});

test('ambiguous or cyclic package build graphs stop instead of guessing execution order', () => {
	assert.throws(() => verificationPlan([{ directory: '', names: ['package.json'], packageJson: '{broken' }]), /Invalid verification package manifest/);
	assert.throws(() => verificationPlan([location('a', { name: 'same' }), location('b', { name: 'same' })]), /Ambiguous/);
	assert.throws(() => verificationPlan([
		location('a', { name: 'a', dependencies: { b: '*' }, scripts: { build: 'tsc' } }),
		location('b', { name: 'b', dependencies: { a: '*' }, scripts: { build: 'tsc' } }),
	]), /cycle/);
});

test('same failure is not progress when only source comments, timings and log names change', () => {
	const first = { id: 'pkg:npm test', name: 'npm test · pkg', status: 'failed' as const,
		message: 'Test output: .my_editor/test-runs/first.log\nnot ok 1 - rejects invalid input\n  duration_ms: 23\n  expected: 400\n  actual: 415' };
	const next = { ...first, message: first.message.replace('first.log', 'next.log').replace('ok 1', 'ok 4').replace('23', '77') };
	assert.equal(failureSignature(first), failureSignature(next));
	assert.equal(repeatedFailure({ commandId: first.id, failure: failureSignature(first) }, [next]), true);
	assert.equal(repeatedFailure({ commandId: first.id, failure: failureSignature(first) }, [{ ...next, status: 'passed' }]), false);
	assert.notEqual(failureSignature(first), failureSignature({ ...first, message: first.message.replace('415', '500') }));
});
