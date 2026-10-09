import { MAX_SOURCE_LINES } from '../quality/sourcePolicy';
import type { DetectedCommands } from './commandDetect';
import type { FileStats, FindingKind, HealthFinding } from './health';
import type { ReviewResult } from './healthReview';

export interface ReportInput {
	readonly project: string;
	readonly date: string;
	readonly model: string;
	readonly stats: readonly FileStats[];
	readonly findings: readonly HealthFinding[];
	readonly commands: DetectedCommands;
	readonly review: Pick<ReviewResult, 'reviewed' | 'notReviewed' | 'partial' | 'error'>;
}

const LABELS: Record<FindingKind, string> = {
	'too-long': `Over ${MAX_SOURCE_LINES} lines`, 'near-limit': `Close to ${MAX_SOURCE_LINES} lines`, 'many-classes': 'More than one class', untested: 'No tests',
	'no-test-runner': 'No test command', 'not-covered': 'Not covered', 'mixed-job': 'More than one job', design: 'Design',
	bug: 'Possible bug', 'poor-code': 'Hard to maintain',
};
const SUGGESTIONS = new Set<FindingKind>(['bug', 'poor-code']);
const SUMMARY_KINDS: FindingKind[] = ['too-long', 'near-limit', 'many-classes', 'untested', 'mixed-job', 'design'];
const NEXT_STEP = [
	'Characterization tests that pin how files behave today, before anything moves, where the compiler cannot prove a move safe',
	'Split long or mixed files into focused files',
	'One class per file',
	'Tests for untested files',
];

/** Model or project text made safe for one Markdown line: whitespace collapsed, Markdown characters escaped. */
function plain(text: string): string {
	return text.replace(/\s+/g, ' ').trim().replace(/[\\`*_{}\[\]()#+!<>|]/g, c => `\\${c}`);
}

/** A link from `.my_editor/ai-ready/report.md` to a project file, at a line when known. */
function link(file: string, line?: number): string {
	const href = file.split('/').map(s => encodeURIComponent(s).replace(/[()]/g, c => '%' + c.charCodeAt(0).toString(16).toUpperCase())).join('/');
	return `[${plain(`${file}${line ? `:${line}` : ''}`)}](../../${href}${line ? `#L${line}` : ''})`;
}

/** The health report as Markdown: summary, build and test commands, files, suggestions, gaps, next step. */
export function renderReport(input: ReportInput): string {
	const count = (kind: FindingKind) => input.findings.filter(f => f.kind === kind).length;
	const byFile = new Map<string, HealthFinding[]>();
	for (const finding of input.findings) {
		if (finding.file && !SUGGESTIONS.has(finding.kind)) { byFile.set(finding.file, [...(byFile.get(finding.file) ?? []), finding]); }
	}
	const stats = new Map(input.stats.map(s => [s.path, s]));
	const files = [...byFile.keys()].sort((a, b) => byFile.get(b)!.length - byFile.get(a)!.length || a.localeCompare(b));
	const suggestions = input.findings.filter(f => SUGGESTIONS.has(f.kind) && f.file);
	const general = input.findings.filter(f => !f.file);
	const { commands, review } = input;
	const lines = [
		`# AI-ready health report: ${input.project}`, '',
		`${input.date} · ${input.stats.length} source files · reviewed with ${input.model}`
		+ `${review.partial ? ' · **stopped early: this report is partial**' : ''}`, '',
		'Nothing in the code was changed. This report shows what would make the project easier for people and AI models to work on.', '',
		'## Summary', '',
		'| Check | Findings |', '|---|---|',
		...SUMMARY_KINDS.map(kind => `| ${LABELS[kind]} | ${count(kind)} |`),
		`| Suggestions (possible bugs, hard-to-maintain code) | ${suggestions.length} |`, '',
		'## How it is built and tested', '',
		commands.languages.length ? `Languages: ${commands.languages.join(', ')}.` : 'No build files were recognised.',
		commands.checks.length ? `Checks: ${commands.checks.map(c => `\`${c}\``).join(', ')}.` : 'No build or type check was found.',
		commands.tests.length ? `Tests: ${commands.tests.map(c => `\`${c}\``).join(', ')}.` : 'No test command was found.',
		...(general.length ? ['', ...general.map(f => `- ${plain(f.text)}`)] : []), '',
		'## Files that need attention', '',
		...(files.length ? files.flatMap(file => {
			const stat = stats.get(file);
			const classes = stat?.classes.length ? ` · ${stat.classes.length} class${stat.classes.length === 1 ? '' : 'es'}` : '';
			return [`### ${link(file)}`, '', stat ? `${stat.lines} lines${classes}` : '', '',
				...byFile.get(file)!.map(f => `- **${LABELS[f.kind]}**${f.line ? ` (${link(file, f.line)})` : ''}: ${plain(f.text)}`
					+ `${f.grouping ? `\n  Grouping: ${plain(f.grouping)}` : ''}`), ''];
		}) : ['Every file passed these checks.', '']),
		'## Suggestions for you', '',
		...(suggestions.length
			? [...suggestions.map(f => `- **${LABELS[f.kind]}** ${link(f.file!, f.line)}: ${plain(f.text)}`), '',
				'This check never changes behavior. To fix one, ask Pair about it.']
			: ['No likely bugs or fragile code were reported.']), '',
		...(review.notReviewed.length || review.error ? ['## Not reviewed by the model', '',
			...(review.error ? [`The model could not be reached: ${plain(review.error)}`, ''] : []),
			...(review.notReviewed.length ? [`${review.notReviewed.map(plain).join(', ')}. They hit the call limit, had no room for an excerpt, `
				+ 'or the model failed; run the check again to retry.', ''] : [])] : []),
		'## What the fixing step will offer', '',
		...NEXT_STEP.map(item => `- ${item}`), '',
		'Fixes run on a separate local branch, one per commit, each checked so the program behaves as before. '
		+ 'For Go projects, choose **Fix on a local branch** in Pair; other languages follow.', '',
	];
	return lines.filter((line, i, all) => !(line === '' && all[i - 1] === '')).join('\n');
}
