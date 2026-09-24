import * as vscode from 'vscode';
import type { Sink } from './engine';
import type { Message } from './presentation';
import type { Proposal } from './proposals';

export interface ReplyJobHooks {
	readonly running: (source: vscode.CancellationTokenSource | undefined) => void;
	readonly update: () => void;
	readonly save: () => void;
	readonly proposal?: (proposal: Proposal) => void;
}

/** Owns one reply's cancellation, progress, flush timer and final saved state. */
export async function runReplyJob(
	reply: Message,
	job: (sink: Sink, token: vscode.CancellationToken) => Promise<void>,
	hooks: ReplyJobHooks,
): Promise<void> {
	const source = new vscode.CancellationTokenSource();
	hooks.running(source);
	let flush: NodeJS.Timeout | undefined;
	const sink: Sink = {
		text: chunk => {
			reply.markdown += chunk;
			flush ??= setTimeout(() => { flush = undefined; hooks.update(); }, 50);
		},
		progress: message => { reply.progress = message; hooks.update(); },
		proposal: proposal => {
			reply.proposals.push({ id: proposal.id, file: proposal.relativePath, added: proposal.added,
				removed: proposal.removed, isNewFile: proposal.isNewFile, state: proposal.state });
			hooks.proposal?.(proposal);
			hooks.update();
		},
		action: (label, command, args) => { reply.actions.push({ label, command, args }); },
		error: message => { reply.error = message; },
	};
	try { await job(sink, source.token); }
	catch (error) { reply.error = error instanceof Error ? error.message : String(error); }
	finally {
		clearTimeout(flush);
		reply.done = true;
		reply.progress = undefined;
		if (!reply.markdown && !reply.error && !reply.proposals.length && !reply.actions.length) {
			reply.markdown = source.token.isCancellationRequested ? '_Stopped._' : '';
		}
		source.dispose();
		hooks.running(undefined);
		hooks.save();
		hooks.update();
	}
}
