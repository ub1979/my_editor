/** What decides the Project view's fix button. `left` is undefined when the count of files over the limit is not known. */
export interface FixButtonInput {
	readonly running: boolean;
	/** A saved, unfinished run exists. */
	readonly saved: boolean;
	/** The `ai_fix` branch exists. */
	readonly branchExists: boolean;
	readonly left: number | undefined;
	/** Files over the limit a split can't help: they need a real refactor. */
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

const INTRO = 'Split long files and add tests on a local branch. Each fix is checked before it is committed.';

const files = (n: number) => `${n} file${n === 1 ? '' : 's'}`;

/** The card's words for files the fixer can't split here, by reason; empty when there are none. */
function stuckText(refactor: number, unbuildable: number): string {
	const parts = [
		...(refactor ? [`${files(refactor)} need${refactor === 1 ? 's' : ''} a real refactor, which this fixer doesn't do`] : []),
		...(unbuildable ? [`${files(unbuildable)} ${unbuildable === 1 ? 'is' : 'are'} in packages that don't build on this computer`] : []),
	];
	return parts.length ? `${parts.join('; ')}.` : '';
}

export function fixButton({ running, saved, branchExists, left, refactor = 0, unbuildable = 0 }: FixButtonInput): FixButton {
	if (running) { return { label: 'Running…', primary: true, disabled: true, text: `${INTRO} A fix run is in progress.` }; }
	if (saved) { return { label: 'Continue', primary: true, disabled: false, text: `${INTRO} A fix run is not finished.` }; }
	// After a first run, one click fixes everything still left; with nothing left, the button reads as at the start.
	const label = branchExists && left !== 0 ? 'Fix remaining files' : 'Fix on a local branch';
	if (left === undefined) { return { label, primary: true, disabled: false, text: INTRO }; }
	if (left === 0) {
		const stuck = stuckText(refactor, unbuildable);
		const done = stuck ? `Nothing left to split here. ${stuck}` : 'All files are within 400 lines.';
		return { label, primary: false, disabled: false, text: `${INTRO} ${done}` };
	}
	const stuck = stuckText(refactor, unbuildable);
	return { label, primary: true, disabled: false, text: `${INTRO} ${files(left)} over 400 lines left to split.${stuck ? ` ${stuck}` : ''}` };
}
