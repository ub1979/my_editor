import type * as vscode from 'vscode';
import type { runReplyJob, ReplyJobHooks } from './replyJob';

/** Reserves a reply before asynchronous work and isolates callbacks from discarded conversations. */
export class ReplySession {
	private generation = 0;
	private source: vscode.CancellationTokenSource | undefined;
	private busy = false;
	get running(): boolean { return this.busy; }

	constructor(private readonly execute: typeof runReplyJob) {}

	stop(): void { this.source?.cancel(); }

	reset(): void {
		this.generation++;
		this.stop();
		this.source = undefined;
		this.busy = false;
	}

	async run(reply: Parameters<typeof runReplyJob>[0], job: Parameters<typeof runReplyJob>[1], hooks: ReplyJobHooks): Promise<void> {
		if (this.busy) { return; }
		this.busy = true;
		const generation = ++this.generation;
		const current = () => generation === this.generation;
		try {
			await this.execute(reply, job, {
				running: source => {
					if (!current()) { return; }
					this.source = source;
					this.busy = !!source;
					hooks.running(source);
				},
				update: () => { if (current()) { hooks.update(); } },
				save: () => { if (current()) { hooks.save(); } },
				proposal: proposal => { if (current()) { hooks.proposal?.(proposal); } },
			});
		} finally {
			if (current()) { this.source = undefined; this.busy = false; }
		}
	}
}
