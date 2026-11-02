import * as vscode from 'vscode';
import { StepState } from './buildProgress';

export class GuideItem extends vscode.TreeItem {
	constructor(label: string, readonly kind: 'step' | 'file' | 'note', readonly state?: StepState,
		readonly path?: string, readonly root?: string) {
		super(label, kind === 'step' ? (state?.status === 'ready' || state?.status === 'changed'
			? vscode.TreeItemCollapsibleState.Expanded : vscode.TreeItemCollapsibleState.Collapsed) : vscode.TreeItemCollapsibleState.None);
	}
}
