import { EventEmitter } from 'vscode';

/** The queue publishes changes independently of whichever view is open. */
export const filePassChanges = new EventEmitter<void>();

/** Distinguish the editor pinning a tab during a run save from the user pinning it. */
export const filePassWillSave = new EventEmitter<string>();
