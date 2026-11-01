import * as vscode from 'vscode';

/** Offers bounded follow-up tasks at declarations; nothing is generated until the developer chooses one. */
export class MemberSuggestions implements vscode.CodeLensProvider, vscode.Disposable {
	private readonly changed = new vscode.EventEmitter<void>();
	readonly onDidChangeCodeLenses = this.changed.event;
	private readonly configuration = vscode.workspace.onDidChangeConfiguration(event => {
		if (event.affectsConfiguration('myEditor.assistance')) { this.changed.fire(); }
	});
	async provideCodeLenses(document: vscode.TextDocument): Promise<vscode.CodeLens[]> {
		const config = vscode.workspace.getConfiguration('myEditor');
		if (config.get('assistance.mode', 'auto') !== 'auto' || !config.get('assistance.suggestions', true)) { return []; }
		const symbols = await vscode.commands.executeCommand<(vscode.DocumentSymbol | vscode.SymbolInformation)[]>('vscode.executeDocumentSymbolProvider', document.uri) ?? [];
		const lenses: vscode.CodeLens[] = [];
		const visit = (items: (vscode.DocumentSymbol | vscode.SymbolInformation)[]) => {
			for (const symbol of items) {
				const range = 'selectionRange' in symbol ? symbol.selectionRange : symbol.location.range;
				const isClass = symbol.kind === vscode.SymbolKind.Class;
				if (isClass || symbol.kind === vscode.SymbolKind.Function || symbol.kind === vscode.SymbolKind.Method) {
					lenses.push(new vscode.CodeLens(range, { title: 'AI: suggest tests', command: 'myEditor.assistance.symbol',
						arguments: [document.uri, symbol.name, range.start.line, 'tests'] }));
					if (isClass) { lenses.push(new vscode.CodeLens(range, { title: 'AI: suggest accessors', command: 'myEditor.assistance.symbol',
						arguments: [document.uri, symbol.name, range.start.line, 'accessors'] })); }
				}
				if ('children' in symbol) { visit(symbol.children); }
			}
		};
		visit(symbols);
		return lenses;
	}
	dispose(): void { this.configuration.dispose(); this.changed.dispose(); }
}

export async function suggestForSymbol(uri?: vscode.Uri, name?: string, line?: number, task?: string): Promise<void> {
	const editor = vscode.window.activeTextEditor;
	const target = uri ?? editor?.document.uri;
	if (!target) { return; }
	const selected = task ?? await vscode.window.showQuickPick(['tests', 'accessors'], { title: 'Ask AI for a focused suggestion' });
	if (!selected) { return; }
	const location = `${vscode.workspace.asRelativePath(target)}:${(line ?? editor?.selection.active.line ?? 0) + 1}`;
	const scope = selected === 'tests'
		? 'Propose a small set of useful unit tests for this declaration in the project’s existing test framework. Read its callers and existing tests first. Only propose test files; preserve production code.'
		: 'Check whether explicit getters/setters are useful for this class in this language. Explain briefly if they add no value. If useful, propose only those accessors inside this class; preserve every unrelated line and file.';
	await vscode.commands.executeCommand('myEditor.chat.ask', `${scope}\nTarget: ${name ?? 'the declaration at the cursor'} in ${location}. Keep the task limited to this declaration.`);
}
