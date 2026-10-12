/** What the approval modal says after the commands' description, part by part; a part that does not apply is unset. */
export interface ApprovalParts {
	/** The language's note for the working copy (Python: the interpreter, its version and env). */
	readonly language?: string;
	/** The language's refactor note, given only when a refactor was picked. */
	readonly refactor?: string;
	/** How many coverage commands end the approved list. */
	readonly coverage: number;
}

/** The parts joined with single spaces, in this order; empty when none applies. The modal is plain text. */
export function approvalNote({ language, refactor, coverage }: ApprovalParts): string {
	return [language, refactor, coverage ? coverageNote(coverage) : undefined].map(part => part?.trim()).filter(Boolean).join(' ');
}

/** Why the coverage commands run: they are approved with the rest, so each one is explained. */
function coverageNote(count: number): string {
	return count === 1
		? 'The last command records which long functions its package\'s tests run, so a later run can tick their refactors; '
			+ 'the profile file it writes is deleted right after.'
		: `The last ${count} commands record which long functions their packages' tests run, so a later run can tick their refactors; `
			+ 'each profile file they write is deleted right after.';
}
