/** What decides the Project view's fix button. `left` is undefined when the count of files over the limit is not known. */
export interface FixButtonInput {
	readonly running: boolean;
	/** A saved, unfinished run exists. */
	readonly saved: boolean;
	/** The `ai_fix` branch exists. */
	readonly branchExists: boolean;
	readonly left: number | undefined;
	/** Long functions a run can refactor into helpers (offers not refused for their content). */
	readonly offers?: number;
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

const INTRO = 'Split long files and add tests on a local branch. Each fix is checked before it is committed.';

const files = (n: number) => `${n} file${n === 1 ? '' : 's'}`;

/** The card's words for files the fixer can't split here, by reason; empty when there are none. */
function stuckText(refactor: number, unbuildable: number): string {
	const parts = [
		...(refactor ? [`${files(refactor)} need${refactor === 1 ? 's' : ''} a real refactor this fixer can't do here`] : []),
		...(unbuildable ? [`${files(unbuildable)} ${unbuildable === 1 ? 'is' : 'are'} in packages that don't build on this computer`] : []),
	];
	return parts.length ? `${parts.join('; ')}.` : '';
}

export function fixButton({ running, saved, branchExists, left, offers = 0, refactor = 0, unbuildable = 0 }: FixButtonInput): FixButton {
	if (running) { return { label: 'Running…', primary: true, disabled: true, text: `${INTRO} A fix run is in progress.` }; }
	if (saved) { return { label: 'Continue', primary: true, disabled: false, text: `${INTRO} A fix run is not finished.` }; }
	// After a first run, one click fixes everything still left; with nothing left, the button reads as at the start.
	const label = branchExists && (left === undefined || left + offers > 0) ? 'Fix remaining files' : 'Fix on a local branch';
	if (left === undefined) { return { label, primary: true, disabled: false, text: INTRO }; }
	const stuck = stuckText(refactor, unbuildable);
	if (left + offers === 0) {
		const done = stuck ? `Nothing left to split here. ${stuck}` : 'All files are within 400 lines.';
		return { label, primary: false, disabled: false, text: `${INTRO} ${done}` };
	}
	const parts = [
		...(left ? [`${files(left)} over 400 lines left to split.`] : []),
		...(offers ? [`${offers} long function${offers === 1 ? '' : 's'} to refactor into helpers.`] : []),
		...(stuck ? [stuck] : []),
	];
	return { label, primary: true, disabled: false, text: `${INTRO} ${parts.join(' ')}` };
}
