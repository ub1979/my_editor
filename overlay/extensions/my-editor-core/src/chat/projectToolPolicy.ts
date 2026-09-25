/** Review needs source tools but cannot write; ordinary chat may propose after consultation. */
export function usesProjectTools(modeId: string): boolean {
	return modeId === 'chat' || modeId === 'review';
}

export function mayProposeFile(modeId: string, locateOnly: boolean): boolean {
	return modeId !== 'review' && !locateOnly;
}
