import * as vscode from 'vscode';
import { ChatTurn } from '../models/types';

export function configuredReasoningEffort(): 'low' | 'medium' | 'high' | 'xhigh' | undefined {
	const value = vscode.workspace.getConfiguration('myEditor').get<string>('codexCli.reasoningEffort', 'default');
	return value === 'low' || value === 'medium' || value === 'high' || value === 'xhigh' ? value : undefined;
}

/** Providers expect alternating turns starting with the user. */
export function mergeTurns(turns: ChatTurn[]): ChatTurn[] {
	const out: ChatTurn[] = [];
	for (const turn of turns) {
		const last = out[out.length - 1];
		if (last && last.role === turn.role) {
			out[out.length - 1] = { role: turn.role, text: `${last.text}\n\n${turn.text}` };
		} else if (turn.text) { out.push(turn); }
	}
	if (out[0]?.role === 'assistant') { out.unshift({ role: 'user', text: '(continuing)' }); }
	return out;
}
