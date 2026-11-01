import * as vscode from 'vscode';
import { Proposals } from '../chat/proposals';
import { ApiKeys } from '../models/secrets';
import { Navigator } from '../navigator/navigator';
import { assistanceStatus, chooseAssistanceMode } from './assistance';
import { InlineAi } from './inlineAi';
import { MemberSuggestions, suggestForSymbol } from './memberSuggestions';
import { PythonSession } from './pythonSession';

/** Compose independent coding services at the extension boundary. */
export function registerCoding(keys: ApiKeys, proposals: Proposals, navigator: Navigator): vscode.Disposable {
	const python = new PythonSession();
	const inline = new InlineAi(keys, proposals);
	const suggestions = new MemberSuggestions();
	return vscode.Disposable.from(python, inline, suggestions, assistanceStatus(),
		vscode.languages.registerCodeLensProvider({ scheme: 'file' }, inline),
		vscode.languages.registerCodeLensProvider({ scheme: 'file' }, suggestions),
		vscode.commands.registerCommand('myEditor.python.runSelection', () => python.run()),
		vscode.commands.registerCommand('myEditor.python.runCell', () => python.run(true)),
		vscode.commands.registerCommand('myEditor.python.restart', () => python.restart()),
		vscode.commands.registerCommand('myEditor.python.showResults', () => python.showResults()),
		vscode.commands.registerCommand('myEditor.python.clearInlineResults', () => python.clearInlineResults()),
		vscode.commands.registerCommand('myEditor.inlineAi.generate', (uri?: vscode.Uri, line?: number) => inline.generate(uri, line)),
		vscode.commands.registerCommand('myEditor.assistance.mode', chooseAssistanceMode),
		vscode.commands.registerCommand('myEditor.assistance.review', () => navigator.reviewNow()),
		vscode.commands.registerCommand('myEditor.assistance.symbol', suggestForSymbol));
}
