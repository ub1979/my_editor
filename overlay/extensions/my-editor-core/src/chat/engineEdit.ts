import * as vscode from 'vscode';
import { streamModel } from '../models/stream';
import { ApiKeys } from '../models/secrets';
import { ChatTurn, ModelEntry } from '../models/types';
import { documentFromReply, elidesCode, fileFromReply } from '../pair/codeBlock';
import { FileContext } from '../pair/context';
import { assertEditSnapshot } from '../pair/editSnapshot';
import { Mode, MODES } from '../pair/prompts';
import { planningReplyPreview } from '../pair/fencedBlocks';
import { isPlanningStage } from './planningStart';
import { logExchange } from '../records/chatLog';
import { pairWebAccess } from '../models/webAccess';
import { mergeTurns } from './modelTurns';
import { Proposals } from './proposals';
import type { Sink } from './engineTypes';

/** Stream a focused edit response, then turn its code into a reviewed proposal. */
export async function streamEdit(entry: ModelEntry, keys: ApiKeys, proposals: Proposals, mode: Mode,
	file: FileContext | undefined, turns: ChatTurn[], system: string, sink: Sink, token: vscode.CancellationToken): Promise<string> {
	let reply = '';
	let shown = 0;
	let writing = false;
	const web = pairWebAccess(entry);
	await streamModel(entry, keys, {
		system,
		turns: mergeTurns(turns),
		token,
		webAccess: web, onActivity: label => sink.progress(label),
		onText: chunk => {
			reply += chunk;
			if (mode.writes === 'none') {
				sink.text(chunk);
				return;
			}
			if (writing) {
				return;
			}
			// Show prose; once a code block starts, show progress instead of the code.
			const fence = reply.indexOf('```');
			const safeEnd = fence >= 0 ? fence : Math.max(shown, reply.length - 2);
			if (safeEnd > shown) {
				sink.text(reply.slice(shown, safeEnd));
				shown = safeEnd;
			}
			if (fence >= 0) {
				writing = true;
				sink.progress(`Writing ${mode.doc ?? file?.relativePath ?? 'the change'}…`);
			}
		},
	});
	if (token.isCancellationRequested) {
		return reply;
	}
	if (mode.writes !== 'none' && !writing && reply.length > shown) {
		sink.text(reply.slice(shown));
	}
	if (mode.writes === 'doc') {
		await proposeDoc(proposals, mode, reply, sink);
	} else if ((mode.writes === 'file' || mode.writes === 'selection') && file) {
		await proposeEdit(proposals, mode, file, reply, sink);
	}

	return reply;
}

async function proposeEdit(proposals: Proposals, mode: Mode, file: FileContext, reply: string, sink: Sink): Promise<void> {
	const code = fileFromReply(reply);
	if (code === undefined) {
		sink.text('\n\n_No code came back, so nothing was changed._');
		return;
	}
	if (mode.writes === 'file' && elidesCode(code)) {
		sink.text('\n\n_The reply left out parts of the file ("… existing code …"), which would delete them, so nothing was changed. '
			+ 'Try again, or select the part to change and use `/change`._');
		return;
	}
	const document = await vscode.workspace.openTextDocument(file.uri);
	assertEditSnapshot(file.fingerprint, document.getText());
	let proposed: string;
	if (mode.writes === 'selection' && file.selection) {
		const text = document.getText();
		proposed = text.slice(0, document.offsetAt(file.selection.start)) + code + text.slice(document.offsetAt(file.selection.end));
	} else {
		proposed = document.getText().endsWith('\n') && !code.endsWith('\n') ? `${code}\n` : code;
	}
	sink.proposal(await proposals.propose(file.uri, proposed));
}

export async function proposeDoc(proposals: Proposals, mode: Mode, reply: string, sink: Sink): Promise<string | undefined> {
	const root = vscode.workspace.workspaceFolders?.[0]?.uri;
	const content = mode.doc ? documentFromReply(reply, mode.doc) : undefined;
	if (!root || !mode.doc || content === undefined) {
		return; // Still interviewing: nothing to write yet.
	}
	sink.proposal(await proposals.propose(vscode.Uri.joinPath(root, mode.doc), content.endsWith('\n') ? content : `${content}\n`));
	return content;
}

/** The retained response is revalidated against today's saved prerequisites and still requires Keep. */
export async function reviewPlanningReply(proposals: Proposals, stage: string, reply: string, sink: Sink): Promise<void> {
	if (!isPlanningStage(stage) || typeof reply !== 'string') { throw new Error('Choose a saved planning document to review.'); }
	const document = await proposeDoc(proposals, MODES[stage], reply, sink);
	if (document === undefined) { throw new Error('This saved reply does not contain a complete planning document.'); }
	sink.archive?.(reply);
	sink.text(planningReplyPreview(reply, document) || 'The saved document is ready for review. Use Keep to save it.');
	await logExchange({ mode: stage, model: 'my_editor', prompt: '(review saved document)', reply })
		.catch(() => sink.error('The review is ready, but its chat archive could not be saved.'));
}

