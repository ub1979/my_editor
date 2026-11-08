import * as vscode from 'vscode';
import { PassModule, PassOptions } from './filePassPlan';
import { savingChoices } from './filePassSaving';
import { authorizeUnattended } from './filePassPermissions';
import { chooseBuildSpeed } from './filePassSpeed';

/** Capture the user's scope and write permission before starting either kind of run. */
export async function choosePass(kind: PassOptions['kind'], modules: PassModule[], selected?: string): Promise<PassOptions | undefined> {
	const files = modules.flatMap(group => group.files);
	const first = modules.slice(0, 2).map(group => group.title);
	const counts = `${modules.length} module${modules.length === 1 ? '' : 's'}, ${files.length} file${files.length === 1 ? '' : 's'}`;
	let interval: PassOptions['interval'] = 0;
	if (!selected) {
		const choices = [
			{ label: `${kind} everything`, description: kind === 'Build'
				? 'Build missing files first, then test and QA the application' : 'Review every file, then test', interval: 0 },
			{ label: 'One module at a time', description: `Test and review after ${first[0]}, then each following module`, interval: 1 },
			...(modules.length > 1 ? [{ label: 'Two modules at a time', description: `Start with ${first.join(' and ')}, then test and review`, interval: 2 }] : []),
			{ label: 'One file at a time', description: 'Test and review after every file', interval: 'file' as const },
			{ label: 'Choose a single file…', description: 'Limit this run to one file', interval: 'select' as const },
		];
		const choice = await vscode.window.showQuickPick(choices, { title: `${kind} · ${counts}`, placeHolder: 'Choose how much to do before stopping for review' });
		if (!choice) { return; }
		if (choice.interval === 'select') {
			selected = await vscode.window.showQuickPick(files, { title: `${kind} one file` });
			if (!selected) { return; }
		} else { interval = choice.interval; }
	}
	const batchSize = kind === 'Build' && !selected && interval !== 'file' ? await chooseBuildSpeed() : 1;
	if (!batchSize) { return; }
	const choice = await vscode.window.showQuickPick(savingChoices,
		{ title: `${kind} · ${selected ?? counts}`, placeHolder: 'How should the editor apply changes? Permissions apply only to this run.' });
	if (choice?.unattended) {
		const root = vscode.workspace.workspaceFolders?.[0]?.uri;
		if (!root || !await authorizeUnattended(root, selected ? [selected] : files)) { return; }
		interval = 0;
	}
	return choice && { kind, automatic: choice.automatic, companionTests: choice.companionTests, interval: selected ? 'file' : interval, selected,
		unattended: choice.unattended, verificationChecks: choice.unattended === true, batchSize,
		...(kind === 'Build' && !selected && interval === 0 ? { workflow: 'buildThenQA' as const } : {}) };
}
