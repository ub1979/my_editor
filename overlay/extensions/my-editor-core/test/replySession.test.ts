import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { ReplySession } from '../src/chat/replySession';
import type { runReplyJob, ReplyJobHooks } from '../src/chat/replyJob';
import type { Message } from '../src/chat/presentation';

test('New Chat cancels the old reply and ignores its later updates and completion', async () => {
	const jobs: { hooks: ReplyJobHooks; finish(): void; cancelled: boolean }[] = [];
	const execute: typeof runReplyJob = async (_reply, _job, hooks) => new Promise<void>(resolve => {
		const job = { hooks, finish: resolve, cancelled: false };
		jobs.push(job);
		hooks.running({ cancel: () => { job.cancelled = true; } } as never);
	});
	const session = new ReplySession(execute);
	let updates = 0, saves = 0;
	const hooks = { running: () => undefined, update: () => { updates++; }, save: () => { saves++; } };
	const reply: Message = { id: 'old', role: 'assistant', done: false, markdown: '', proposals: [], actions: [] };
	const first = session.run(reply, async () => undefined, hooks);
	assert.equal(session.running, true);
	await session.run(reply, async () => undefined, hooks);
	assert.equal(jobs.length, 1, 'a second send cannot start while the first is saving');
	session.reset();
	assert.equal(jobs[0].cancelled, true);
	assert.equal(session.running, false);
	const second = session.run({ ...reply, id: 'new' }, async () => undefined, hooks);
	jobs[0].hooks.update(); jobs[0].hooks.save(); jobs[0].hooks.running(undefined);
	jobs[0].finish(); await first;
	assert.equal(session.running, true, 'the old completion must not clear the new reply');
	assert.deepEqual([updates, saves], [0, 0]);
	jobs[1].hooks.update(); jobs[1].hooks.save(); jobs[1].hooks.running(undefined);
	jobs[1].finish(); await second;
	assert.deepEqual([updates, saves], [1, 1]);
	assert.equal(session.running, false);
});
