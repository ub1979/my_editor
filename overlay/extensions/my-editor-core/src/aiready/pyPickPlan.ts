/** The button and pick item that lead to a file dialog instead of a listed interpreter. */
export const BROWSE = 'Choose a file…';
export const USE_IT = 'Use it';

/** How to ask for the project's Python: confirm the only candidate, pick among several, or go straight to a file. */
export type PythonQuestion =
	| { readonly kind: 'confirm'; readonly message: string; readonly detail: string; readonly buttons: readonly string[] }
	| { readonly kind: 'pick'; readonly title: string; readonly items: readonly string[] }
	| { readonly kind: 'browse' };

/** What an answer means: show the file dialog, or done with this file (undefined when the user cancelled). */
export type PythonChoice = { readonly kind: 'browse' } | { readonly kind: 'done'; readonly file: string | undefined };

/** The file dialog's options when the user chooses an interpreter by hand. */
export const BROWSE_DIALOG = { title: 'The project\'s Python interpreter', canSelectMany: false, openLabel: 'Use this Python' } as const;

export function pythonQuestion(candidates: readonly string[]): PythonQuestion {
	if (candidates.length === 1) {
		return { kind: 'confirm', message: 'Use this Python for fixes on a local branch?', detail: candidates[0], buttons: [USE_IT, BROWSE] };
	}
	if (candidates.length > 1) { return { kind: 'pick', title: 'Python for fixes on a local branch', items: [...candidates, BROWSE] }; }
	return { kind: 'browse' };
}

/** Reads the answer to a question: BROWSE opens the dialog; a confirm takes its candidate only on USE_IT; a pick is the item. */
export function pythonChoice(question: PythonQuestion, answer: string | undefined): PythonChoice {
	if (question.kind === 'browse' || answer === BROWSE) { return { kind: 'browse' }; }
	if (question.kind === 'confirm') { return { kind: 'done', file: answer === USE_IT ? question.detail : undefined }; }
	return { kind: 'done', file: answer };
}

/** The note after an interpreter is checked and remembered for the folder. */
export function pythonChosenMessage(file: string, version: readonly number[]): string {
	return `Fixes in this folder use ${file} (Python ${version.join('.')}).`;
}
