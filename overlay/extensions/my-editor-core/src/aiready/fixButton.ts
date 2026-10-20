/** What decides the Project view's fix button. `left` is undefined when the count of files over the limit is not known. */
export interface FixButtonInput {
	readonly running: boolean;
	/** A saved, unfinished run exists. */
	readonly saved: boolean;
	/** The `ai_fix` branch exists. */
	readonly branchExists: boolean;
	readonly left: number | undefined;
	/** Long functions a run would refactor into helpers: offers the picker starts ticked. */
	readonly offers?: number;
	/** Of the offers, the ones no test is known to run. */
	readonly uncovered?: number;
	/** Whether the language offers refactors. */
	readonly refactors?: boolean;
	/** Files over the limit a split can't help and no refactor here can: refactors not offered, or refused for their content. */
	readonly refactor?: number;
	/** Files over the limit in packages whose build fails here, so no split of them can be checked. */
	readonly unbuildable?: number;
}

export interface FixButton {
	readonly label: string;
	readonly primary: boolean;
	readonly disabled: boolean;
	/** The card's text. */
	readonly text: string;
}

/** What the fixer does, refactors named only when the language offers them. */
const intro = (refactors: boolean) => `Split long files${refactors ? ', refactor long functions' : ''} and add tests on a local branch. `
	+ 'Each fix is checked before it is committed.';

const files = (n: number) => `${n} file${n === 1 ? '' : 's'}`;

/** The card's words for files the fixer can't split here, by reason; empty when there are none. */
function stuckText(refactor: number, unbuildable: number): string {
	const parts = [
		...(refactor ? [`${files(refactor)} need${refactor === 1 ? 's' : ''} a real refactor this fixer can't do here`] : []),
		...(unbuildable ? [`${files(unbuildable)} ${unbuildable === 1 ? 'is' : 'are'} in packages that don't build on this computer `
			+ '(once they build, tick them in the list to check again)'] : []),
	];
	return parts.length ? `${parts.join('; ')}.` : '';
}

/** The card's words for refactors no test is known to run; they are still done, guarded by build, vet and the extract check. */
function uncoveredText(uncovered: number, offers: number): string {
	if (!uncovered) { return ''; }
	const which = uncovered === offers ? (offers === 1 ? 'it' : 'them') : `${uncovered} of them`;
	return `No test here runs ${which}, so build, vet and the extract check guard ${uncovered === 1 ? 'it' : 'them'}.`;
}

export function fixButton(input: FixButtonInput): FixButton {
	const { running, saved, branchExists, left, offers = 0, uncovered = 0, refactor = 0, unbuildable = 0 } = input;
	const opening = intro(!!input.refactors);
	if (running) { return { label: 'Running…', primary: true, disabled: true, text: `${opening} A fix run is in progress.` }; }
	if (saved) { return { label: 'Continue', primary: true, disabled: false, text: `${opening} A fix run is not finished.` }; }
	// After a first run, one click fixes everything still left; with nothing left, the button reads as at the start.
	const label = branchExists && (left === undefined || left + offers > 0) ? 'Fix remaining files' : 'Fix on a local branch';
	if (left === undefined) { return { label, primary: true, disabled: false, text: opening }; }
	const stuck = stuckText(refactor, unbuildable);
	const uncoveredNote = uncoveredText(uncovered, offers);
	if (left + offers === 0) {
		const rest = [uncoveredNote, stuck].filter(Boolean).join(' ');
		const done = rest ? `Nothing left to split here. ${rest}` : 'All files are within 400 lines.';
		return { label, primary: false, disabled: false, text: `${opening} ${done}` };
	}
	const parts = [
		...(left ? [`${files(left)} over 400 lines left to split.`] : []),
		...(offers ? [`${offers} long function${offers === 1 ? '' : 's'} to refactor into helpers.`] : []),
		...(uncoveredNote ? [uncoveredNote] : []),
		...(stuck ? [stuck] : []),
	];
	return { label, primary: true, disabled: false, text: `${opening} ${parts.join(' ')}` };
}
