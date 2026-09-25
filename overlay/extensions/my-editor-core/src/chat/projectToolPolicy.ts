import type { Mode } from '../pair/prompts';

/** Every read-only conversation can fetch project evidence; only ordinary chat can propose. */
export function usesProjectTools(mode: Mode): boolean {
	return mode.writes === 'none';
}

export function mayProposeFile(modeId: string, locateOnly: boolean): boolean {
	return modeId === 'chat' && !locateOnly;
}
