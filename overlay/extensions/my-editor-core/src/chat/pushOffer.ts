import { asksToPush, suggestedTarget } from '../project/pushPlan';
import type { Sink } from './engine';

/** Under a reply to a message that asks to push, the Push button; it asks the user to confirm before anything is sent. */
export function offerPush(prompt: string, sink: Pick<Sink, 'action'>): void {
	if (!asksToPush(prompt)) { return; }
	const target = suggestedTarget(prompt);
	sink.action('Push to GitHub…', 'myEditor.pushBranch', [target ? { target } : {}]);
}
