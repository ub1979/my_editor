import * as vscode from 'vscode';
import { filePassWillSave } from '../project/filePassEvents';

/** Own only tabs opened by the run; existing, pinned and dirty tabs belong to the user. */
export class RunPreview {
	private owned?: { tab: vscode.Tab; uri: string; pinnedBySave?: boolean };
	private work: Promise<void> = Promise.resolve();
	private readonly saves = filePassWillSave.event(uri => {
		if (this.owned?.uri === uri && this.owned.tab.isPreview) { this.owned.pinnedBySave = true; }
	});

	show(uri: vscode.Uri, allowed: () => boolean): Promise<void> {
		return this.enqueue(async () => {
			if (!allowed()) { return; }
			await this.closeOwned();
			if (!allowed()) { return; }
			const before = new Set(vscode.window.tabGroups.all.flatMap(group => group.tabs));
			await vscode.window.showTextDocument(uri, { preview: true, preserveFocus: true, viewColumn: vscode.ViewColumn.Active });
			const tab = vscode.window.tabGroups.all.flatMap(group => group.tabs).find(item => !before.has(item)
				&& item.input instanceof vscode.TabInputText && item.input.uri.toString() === uri.toString());
			if (tab) { this.owned = { tab, uri: uri.toString() }; }
			if (!allowed()) { await this.closeOwned(); }
		});
	}

	close(): Promise<void> { return this.enqueue(() => this.closeOwned()); }

	private enqueue(action: () => Promise<void>): Promise<void> {
		this.work = this.work.catch(() => {}).then(action);
		return this.work;
	}

	private async closeOwned(): Promise<void> {
		const owned = this.owned;
		this.owned = undefined;
		if (!owned || !vscode.window.tabGroups.all.some(group => group.tabs.includes(owned.tab))) { return; }
		const tab = owned.tab;
		if (tab.isDirty || !tab.isPreview && !owned.pinnedBySave || !(tab.input instanceof vscode.TabInputText)
			|| tab.input.uri.toString() !== owned.uri) { return; }
		await vscode.window.tabGroups.close(tab, true);
	}
	dispose(): void { this.saves.dispose(); }
}
