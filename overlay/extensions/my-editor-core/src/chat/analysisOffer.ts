import * as vscode from 'vscode';
import { makeAiReady } from '../aiready/healthRun';
import { OfferKind, offerKind } from '../aiready/offer';
import { analyseProject } from '../brain/analyse';
import { EXCLUDE_GLOB, SOURCE_GLOB } from '../brain/brain';
import { ApiKeys } from '../models/secrets';
import type { Sink } from './engine';
import type { Proposals } from './proposals';

/** Set once the user answered the "Analyse this project?" offer, either way. */
export const ANALYSE_ANSWERED = 'myEditor.analyse.answered';

export interface AnalysisOffer {
	readonly files: number;
	readonly kind: OfferKind;
}

/** The one-time first-open offer: AI-ready for folders my_editor did not create, Analyse for ones without a brain. */
export async function analysisOffer(context: vscode.ExtensionContext, answeredKey: string): Promise<AnalysisOffer | undefined> {
	const root = vscode.workspace.workspaceFolders?.[0]?.uri;
	if (!root || context.workspaceState.get(answeredKey)) { return undefined; }
	const exists = async (uri: vscode.Uri) => {
		try { await vscode.workspace.fs.stat(uri); return true; } catch { return false; }
	};
	const kind = offerKind(await exists(vscode.Uri.joinPath(root, '.my_editor')),
		await exists(vscode.Uri.joinPath(root, '.my_editor', 'brain', 'map.json')));
	if (!kind) { return undefined; }
	const files = await vscode.workspace.findFiles(SOURCE_GLOB, EXCLUDE_GLOB, 5_000);
	return files.length ? { files: files.length, kind } : undefined;
}

/** Records that the offer was answered and hides it in every chat webview. */
export async function closeAnalysisOffer(context: vscode.ExtensionContext, chat: { post(message: unknown): void }): Promise<void> {
	await context.workspaceState.update(ANALYSE_ANSWERED, true);
	chat.post({ type: 'offer', offer: undefined });
}

/** The request line and job for accepting: analyse into the brain, or with `aiReady` also write the health report. */
export function analysisTask(aiReady: boolean, keys: ApiKeys, proposals: Proposals): {
	readonly label: string;
	readonly job: (sink: Sink, token: vscode.CancellationToken) => Promise<void>;
} {
	const run = aiReady ? makeAiReady : analyseProject;
	return {
		label: aiReady ? 'Check AI-readiness' : 'Analyse this project',
		job: (sink, token) => run(keys, proposals, sink, token),
	};
}
