import type { Sink } from '../chat/engine';
import { clearState, type RunState } from './fixState';
import { nothingText } from './fixText';
import { rememberChecks } from './fixUnverifiable';
import { discard } from './worktree';

/**
 * Closes a run that committed nothing: no change note goes on the branch, so it stays as it was (a branch this run
 * made is deleted again), the worktree goes, and the run text says why each fix was settled.
 */
export async function closeEmpty(storage: string, state: RunState, sink: Pick<Sink, 'text'>): Promise<void> {
	await rememberChecks(storage, state.root, state.baseline);
	let removed = true;
	try { await discard(state.root, state.worktree); } catch { removed = false; }
	clearState(storage, state.root);
	sink.text(nothingText({ steps: state.steps, branch: state.worktree.branch, kept: !state.worktree.created, removed, worktree: state.worktree.path }));
}
