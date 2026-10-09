import { type FixChoice, MAX_FIXES_PER_RUN, type RunState, type StepRecord } from './fixState';

/** What running the queue needs: one fix's step, Stop, progress, and a hook that saves and shows each record. */
export interface QueueHooks {
	readonly run: (fix: FixChoice) => Promise<StepRecord | 'stopped'>;
	readonly cancelled: () => boolean;
	readonly progress: (text: string) => void;
	readonly record: (step: StepRecord) => void;
}

/**
 * Runs fixes from `state.next` until the queue ends, `max` fixes were attempted, or Stop. A fix settled before any
 * model call or edit (`early`) does not count. A stopped step is not recorded, so Continue runs it again. Returns how
 * many fixes were attempted.
 */
export async function runQueue(state: RunState, hooks: QueueHooks, max = MAX_FIXES_PER_RUN): Promise<number> {
	let attempted = 0;
	while (state.next < state.fixes.length && attempted < max && !hooks.cancelled()) {
		const fix = state.fixes[state.next];
		hooks.progress(`Fix ${state.next + 1} of ${state.fixes.length}: ${fix.file}`);
		let outcome: StepRecord | 'stopped';
		try { outcome = await hooks.run(fix); } catch (error) {
			if (hooks.cancelled()) { break; }
			outcome = { file: fix.file, kind: fix.kind, status: 'skipped', reason: error instanceof Error ? error.message : String(error) };
		}
		if (outcome === 'stopped') { break; }
		state.steps.push(outcome);
		state.next++;
		if (!outcome.early) { attempted++; }
		hooks.record(outcome);
	}
	return attempted;
}
