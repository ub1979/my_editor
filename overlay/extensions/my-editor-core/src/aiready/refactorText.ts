import type { StepRecord } from './fixState';
import type { HelperSummary } from './language';

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

/** `queryRows(ctx, staleAfter, tx, req, imageRef) → rows, err`; `; carries returns` when it does. */
export function helperLine(helper: HelperSummary): string {
	const outputs = helper.outputs.length ? ` → ${helper.outputs.join(', ')}` : '';
	return `${helper.name}(${helper.params.join(', ')})${outputs}${helper.returns ? '; carries returns' : ''}`;
}

/** `my_editor: extract 7 helpers from StepReportingInventoryVerification (internal/store/x.go)` */
export function refactorSubject(file: string, target: string, count: number): string {
	return `my_editor: extract ${plural(count, 'helper')} from ${target} (${file})`;
}

/** What the coverage pass showed about the function, for the commit and the change note. */
export function coverageSentence(target: string, ran: boolean | undefined): string {
	if (ran === undefined) { return 'Coverage: not recorded.'; }
	return ran ? `Coverage: the package's tests ran ${target} at baseline.`
		: `Coverage: no passing test ran ${target} at baseline; build, vet and the extract check are the net.`;
}

/** The commit body: what moved, each helper, the extract check, coverage and the checks. */
export function refactorBody(helpers: readonly HelperSummary[], target: string, ran: boolean | undefined, checks: string): string {
	return [
		`Moved runs of statements of ${target} into helpers, byte for byte apart from the extract rewrites `
		+ '(parameters, (*x) for shared variables, returns).', '',
		...helpers.map(helper => `- ${helperLine(helper)}`), '',
		`Extract check: passed. ${coverageSentence(target, ran)}`,
		`Checks: ${checks}`,
	].join('\n');
}

/** The run's line for a refactor step; the function is named once a refactor was committed. */
export function refactorRunLine(step: StepRecord): string {
	const what = step.refactor ? `Refactor \`${step.refactor.target}\` in \`${step.file}\`` : `Refactor \`${step.file}\``;
	if (step.status === 'committed') {
		return `- ${what}: committed \`${step.commit?.slice(0, 7)}\` (${plural(step.refactor?.helpers.length ?? 0, 'helper')}).`;
	}
	return `- ${what}: ${step.status}. ${step.reason ?? ''}`.trimEnd();
}

/** The change note's `## Refactored` section: each committed refactor's helpers, its size now, the extract check and coverage. */
export function refactoredLines(steps: readonly StepRecord[]): string[] {
	const done = steps.filter(step => step.status === 'committed' && step.refactor);
	if (!done.length) { return []; }
	return ['## Refactored', '', ...done.flatMap(({ file, refactor }) => [
		`### \`${refactor!.target}\` (\`${file}\`)`, '',
		...refactor!.helpers.map(helper => `- ${helperLine(helper)}`), '',
		`Now ${refactor!.lines} lines. Extract check: passed. ${coverageSentence(refactor!.target, refactor!.ran)}`, '',
	])];
}
