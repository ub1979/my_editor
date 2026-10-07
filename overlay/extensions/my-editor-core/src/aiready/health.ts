import * as path from 'path';
import { classDeclarations, isSourceFile, MAX_SOURCE_LINES, sourceLines, WARN_SOURCE_LINES } from '../quality/sourcePolicy';
import type { DetectedCommands } from './commandDetect';

/** What the health report can say, from deterministic checks and from the model's review. */
export type FindingKind = 'too-long' | 'near-limit' | 'many-classes' | 'untested' | 'no-test-runner' | 'not-covered'
	| 'mixed-job' | 'design' | 'bug' | 'poor-code';

export interface HealthFinding {
	readonly kind: FindingKind;
	readonly file?: string;
	readonly line?: number;
	readonly text: string;
	/** For a file doing more than one job: how its definitions could be grouped. */
	readonly grouping?: string;
}

export interface FileStats {
	readonly path: string;
	readonly lines: number;
	readonly classes: readonly { name: string; line: number }[];
	/** Rust only: the file has its own `#[cfg(test)]` module. */
	readonly inlineTests: boolean;
}

const TESTABLE = /\.(?:[cm]?[jt]sx?|py|go|rs)$/;
const NOT_CHECKED = /(^|\/)(?:[^/]*\.config\.[^/]+|setup\.py|conftest\.py|__init__\.py)$|(^|\/)(?:tests?|__tests__)\//;

export function fileStats(filePath: string, text: string): FileStats {
	return {
		path: filePath, lines: sourceLines(text), classes: classDeclarations(text, filePath),
		inlineTests: filePath.endsWith('.rs') && /#\[cfg\(test\)\]/.test(text),
	};
}

/** The name a test file is about, or undefined when the path is not a test file. */
export function testSubject(filePath: string): string | undefined {
	const base = path.posix.basename(filePath);
	const js = /^(.+)\.(?:test|spec)\.[cm]?[jt]sx?$/.exec(base);
	if (js) { return js[1]; }
	if (/(^|\/)__tests__\//.test(filePath) && /\.[cm]?[jt]sx?$/.test(base)) { return base.replace(/\.[^.]+$/, ''); }
	const py = /^test_(.+)\.py$/.exec(base) ?? /^(.+)_test\.py$/.exec(base);
	if (py) { return py[1]; }
	return /^(.+)_test\.go$/.exec(base)?.[1];
}

/** Source files whose tests the report checks: TS/JS, Python, Go and Rust; not tests, declarations or config. */
export function needsTests(filePath: string): boolean {
	return TESTABLE.test(filePath) && !filePath.endsWith('.d.ts') && !NOT_CHECKED.test(filePath) && testSubject(filePath) === undefined;
}

/** Findings that need no model: size, classes per file, missing tests and test command, analysis gaps. */
export function scanHealth(stats: readonly FileStats[], allPaths: readonly string[], commands: DetectedCommands,
	notCovered: readonly string[]): HealthFinding[] {
	const subjects = new Set(allPaths.map(testSubject).filter((s): s is string => !!s).map(s => s.toLowerCase()));
	const findings: HealthFinding[] = [];
	for (const file of stats) {
		if (!isSourceFile(file.path)) { continue; }
		if (file.lines > MAX_SOURCE_LINES) {
			findings.push({ kind: 'too-long', file: file.path, text: `${file.lines} lines; the limit is ${MAX_SOURCE_LINES}.` });
		} else if (file.lines >= WARN_SOURCE_LINES) {
			findings.push({ kind: 'near-limit', file: file.path, text: `${file.lines} lines, close to the ${MAX_SOURCE_LINES}-line limit.` });
		}
		if (file.classes.length > 1) {
			findings.push({ kind: 'many-classes', file: file.path, line: file.classes[1].line,
				text: `${file.classes.length} classes: ${file.classes.map(c => c.name).join(', ')}.` });
		}
		const name = path.posix.basename(file.path).replace(/\.[^.]+$/, '').toLowerCase();
		if (needsTests(file.path) && !file.inlineTests && !subjects.has(name)) {
			findings.push({ kind: 'untested', file: file.path, text: 'No test file for it was found.' });
		}
	}
	if (!commands.tests.length) {
		findings.push({ kind: 'no-test-runner', text: 'No test command was found, so changes cannot be checked by tests yet.' });
	}
	for (const gap of notCovered) { findings.push({ kind: 'not-covered', text: gap }); }
	return findings;
}
