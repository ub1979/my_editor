/** What decides the Project view's fix button. `left` is undefined when the count of files over the limit is not known. */
export interface FixButtonInput {
	readonly running: boolean;
	/** A saved, unfinished run exists. */
	readonly saved: boolean;
	/** The `ai_fix` branch exists. */
	readonly branchExists: boolean;
	readonly left: number | undefined;
}

export interface FixButton {
	readonly label: string;
	readonly primary: boolean;
	readonly disabled: boolean;
	/** The card's text. */
	readonly text: string;
}

const INTRO = 'Split long files and add tests on a local branch. Each fix is checked before it is committed.';

export function fixButton({ running, saved, branchExists, left }: FixButtonInput): FixButton {
	if (running) { return { label: 'Running…', primary: true, disabled: true, text: `${INTRO} A fix run is in progress.` }; }
	if (saved) { return { label: 'Continue', primary: true, disabled: false, text: `${INTRO} A fix run is not finished.` }; }
	// After a first run, one click fixes everything still left; with nothing left, the button reads as at the start.
	const label = branchExists && left !== 0 ? 'Fix remaining files' : 'Fix on a local branch';
	if (left === undefined) { return { label, primary: true, disabled: false, text: INTRO }; }
	if (left === 0) { return { label, primary: false, disabled: false, text: `${INTRO} All files are within 400 lines.` }; }
	return { label, primary: true, disabled: false, text: `${INTRO} ${left} file${left === 1 ? '' : 's'} over 400 lines left.` };
}
