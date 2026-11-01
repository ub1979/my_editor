import type { Mode } from '../pair/prompts';

/** Conversations and planning documents can retrieve evidence; document proposals are handled after the reply. */
export function usesProjectTools(mode: Mode): boolean {
	return mode.writes === 'none' || mode.writes === 'doc';
}

/** Planning can retrieve prior decisions, but cannot execute commands or propose arbitrary project files. */
export function mayUsePlanningTool(name: string): boolean {
	return ['list_files', 'search', 'read_file', 'git_history', 'read_chat', 'search_chat', 'search_records'].includes(name);
}

export function mayProposeFile(modeId: string, locateOnly: boolean): boolean {
	return modeId === 'chat' && !locateOnly;
}
