import { strict as assert } from 'node:assert';
import { existsSync, mkdtempSync, writeFileSync } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { test } from 'node:test';
import type { CheckResult } from '../src/aiready/baseline';
import { coverageCommands, type CoverageDeps, runCoverage } from '../src/aiready/coverageRun';
import type { FixChoice } from '../src/aiready/fixState';
import type { RefactorHooks } from '../src/aiready/language';

const offer = (file: string, name: string): FixChoice => ({ file, kind: 'refactor', lines: 450, target: { name, lines: 420 } });
const OFFERS = [offer('internal/store/plan.go', 'buildPlan'), offer('internal/store/step.go', 'Step'), offer('cmd/x/main.go', 'main')];
const HOOKS: Pick<RefactorHooks, 'coverage' | 'ran'> = {
	coverage: (file, index) => {
		const profile = `.cover-${index}.out`;
		return { command: { label: 'test', command: `go test -coverprofile=${profile} ./${path.posix.dirname(file)}` }, profile };
	},
	// The fake profile lists the names of the functions it ran.
	ran: async (profile, _file, target) => {
		if (profile.includes('garbled')) { throw new Error('cannot parse'); }
		return profile.split('\n').includes(target.name);
	},
};

test('one coverage command per package with a refactor offer', () => {
	const commands = coverageCommands([...OFFERS, { file: 'internal/store/x.go', kind: 'split', lines: 500 }], HOOKS);
	assert.deepEqual(commands.map(c => [c.unit, c.files, c.command.command, c.profile]), [
		['./internal/store', ['internal/store/plan.go', 'internal/store/step.go'], 'go test -coverprofile=.cover-1.out ./internal/store', '.cover-1.out'],
		['./cmd/x', ['cmd/x/main.go'], 'go test -coverprofile=.cover-2.out ./cmd/x', '.cover-2.out'],
	]);
	assert.deepEqual(coverageCommands([], HOOKS), []);
});

/** Deps on a temp worktree whose commands write `profiles[command]` (when given) and exit with `codes[command]` (0 by default). */
function deps(profiles: Record<string, string>, codes: Record<string, number> = {}): CoverageDeps & { ran: string[]; worktree: string } {
	const worktree = mkdtempSync(path.join(os.tmpdir(), 'my-editor-cover-'));
	const ran: string[] = [];
	return {
		worktree, ran, cancelled: () => false, progress: () => undefined,
		blob: async file => (file.startsWith('cmd/') ? undefined : `blob-${path.posix.basename(file)}`),
		run: async (command, label): Promise<CheckResult> => {
			ran.push(`${label} ${command}`);
			const profile = command.match(/-coverprofile=(\S+)/)![1];
			if (profiles[command] !== undefined) { writeFileSync(path.join(worktree, profile), profiles[command]); }
			return { command, code: codes[command] ?? 0, failures: [], tail: '', log: '' };
		},
	};
}

test('the coverage pass runs each command once, reads and deletes the profile, and records ran by blob', async () => {
	const commands = coverageCommands(OFFERS, HOOKS);
	const d = deps({ [commands[0].command.command]: 'mode: set\nbuildPlan', [commands[1].command.command]: 'mode: set\nmain' });
	const result = await runCoverage(commands, OFFERS, HOOKS, d);
	assert.ok(result !== 'stopped');
	assert.deepEqual(d.ran, commands.map(c => `test ${c.command.command}`));
	assert.deepEqual(result.ran, { 'internal/store/plan.go': true, 'internal/store/step.go': false, 'cmd/x/main.go': true });
	assert.deepEqual([...result.entries], [
		['internal/store/plan.go', { blob: 'blob-plan.go', function: 'buildPlan', ran: true }],
		['internal/store/step.go', { blob: 'blob-step.go', function: 'Step', ran: false }],
	], 'a file without a blob is measured but not recorded');
	assert.equal(existsSync(path.join(d.worktree, '.cover-1.out')), false);
	assert.equal(existsSync(path.join(d.worktree, '.cover-2.out')), false);
	assert.equal(await runCoverage(commands, OFFERS, HOOKS, { ...d, cancelled: () => true }), 'stopped');
});

test('a failing coverage run records not ran', async () => {
	const commands = coverageCommands(OFFERS, HOOKS);
	const [store, cmd] = commands.map(c => c.command.command);
	const failing = deps({ [store]: 'mode: set\nbuildPlan\nStep' }, { [store]: 1 });
	const result = await runCoverage(commands, OFFERS, HOOKS, failing);
	assert.ok(result !== 'stopped');
	assert.deepEqual(result.ran, { 'internal/store/plan.go': false, 'internal/store/step.go': false, 'cmd/x/main.go': false }, 'no profile for cmd/x');
	assert.equal(existsSync(path.join(failing.worktree, '.cover-1.out')), false);
	const garbled = await runCoverage(commands, OFFERS, HOOKS, deps({ [store]: 'garbled', [cmd]: 'main' }));
	assert.ok(garbled !== 'stopped');
	assert.deepEqual(garbled.ran, { 'internal/store/plan.go': false, 'internal/store/step.go': false, 'cmd/x/main.go': true });
});
