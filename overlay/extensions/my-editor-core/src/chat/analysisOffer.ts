import * as vscode from 'vscode';
import { EXCLUDE_GLOB, SOURCE_GLOB } from '../brain/brain';
import { OfferKind, offerKind } from '../aiready/offer';

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
