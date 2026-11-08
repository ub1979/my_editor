import * as vscode from 'vscode';

export async function chooseBuildSpeed(): Promise<1 | 3 | undefined> {
	const choice = await vscode.window.showQuickPick([
		{ label: 'Related files together', description: 'Faster: generate up to 3 related files per request; validate each save', size: 3 as const },
		{ label: 'One file per request', description: 'Smaller requests and individual generation', size: 1 as const },
	], { title: 'Build speed', placeHolder: 'Scope, saving permissions and the 600-line limit stay enforced.' });
	return choice?.size;
}
