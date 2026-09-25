import * as vscode from 'vscode';
import { analysisOffer } from './analysisOffer';
import { CHARACTERS, CharacterId } from './characters';
import { Message, render } from './presentation';
import { skillCards } from './skillCards';

/** The shared starting state for the sidebar and centered Pair tab. */
export async function chatInit(context: vscode.ExtensionContext, messages: readonly Message[], characterId: CharacterId,
	pinned: boolean, answeredKey: string, visibleLimit: number): Promise<unknown> {
	return {
		type: 'init',
		project: vscode.workspace.workspaceFolders?.[0]?.name,
		projectPath: vscode.workspace.workspaceFolders?.[0]?.uri.fsPath,
		characters: CHARACTERS.map(({ id, name, role, greeting }) => ({ id, name, role, greeting })),
		characterId, pinned,
		skills: await skillCards(context.extensionUri),
		messages: messages.slice(-visibleLimit).map(render),
		offer: await analysisOffer(context, answeredKey),
	};
}
