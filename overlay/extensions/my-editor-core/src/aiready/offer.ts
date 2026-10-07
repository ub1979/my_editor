/** Which first-open offer a folder with code gets. */
export type OfferKind = 'ai-ready' | 'analyse';

/**
 * A folder without `.my_editor/` was not made with my_editor, so it gets the AI-ready offer; one with `.my_editor/`
 * but no brain gets the plain Analyse offer; one with a brain gets none.
 */
export function offerKind(hasMyEditorFolder: boolean, hasBrain: boolean): OfferKind | undefined {
	if (hasBrain) { return undefined; }
	return hasMyEditorFolder ? 'analyse' : 'ai-ready';
}
