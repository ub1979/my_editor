import type { TestRun } from './baseline';

/**
 * A UTF-8 byte range. A declaration's span starts at the beginning of its first line (its doc comment, if any) and
 * ends at the newline that ends its last line; that newline is not part of the span.
 */
export interface Span {
	readonly start: number;
	readonly end: number;
}

/** One top-level declaration, as the language adapter sees it. */
export interface Declaration {
	/** Stable within one parse: the declaration's index in the file. Plans refer to declarations by this ID. */
	readonly id: number;
	readonly kind: string;
	/** A multiset: `_` may repeat. */
	readonly names: readonly string[];
	readonly receiver?: string;
	readonly span: Span;
	readonly lines: number;
	/** The first line of its doc comment, for the model. */
	readonly doc: string;
	/** The whole doc comment, compared by move rule 4. */
	readonly docText: string;
	/** Imports it uses, as keys from `FileInfo.imports` (Go: `name path`, so `"fmt"` and `f "fmt"` differ). */
	readonly uses: readonly string[];
	readonly movable: boolean;
	/** Why it may not move. */
	readonly reason?: string;
}

/** What an adapter knows about one source file. */
export interface FileInfo {
	/** Relative to the project root, with `/` separators. */
	readonly path: string;
	readonly declarations: readonly Declaration[];
	/** The region the adapter rebuilds rather than copies (Go: the import declarations); move rule 2 treats it as opaque. */
	readonly importRegion?: Span;
	/** Spans a new file may hold besides moved declarations: header comment, package clause, imports. */
	readonly frame: readonly Span[];
	/**
	 * Imports as comparable keys; after a split the original may only lose some, and a new file may only use some of
	 * the original's. A key starting with `_ ` is a blank (side-effect) import, which a new file may not have.
	 */
	readonly imports: readonly string[];
	/** The bytes before the package clause (Go); in a new file they must equal the adapter's split header exactly. */
	readonly prelude?: Span;
	/** Why this file is never split or given tests, if it is not. */
	readonly skip?: string;
}

/** The model's plan: which declarations go to which new file. */
export interface SplitGroup {
	readonly file: string;
	readonly declarations: readonly number[];
}
export type SplitPlan = readonly SplitGroup[];

export interface NewFile {
	readonly name: string;
	readonly text: Buffer;
}

export interface SplitResult {
	readonly original: Buffer;
	readonly files: readonly NewFile[];
}

/** One exact check command for a file's unit (Go: its package). */
export interface CheckCommand {
	readonly label: 'build' | 'vet' | 'test';
	readonly command: string;
}

export interface Prompt {
	readonly system: string;
	readonly text: string;
}

/**
 * Everything the language-neutral fixer needs from one language. Go is the first adapter; TS/JS, Python, C#, Rust and
 * C/C++ follow. Paths are relative to the root the adapter was created for, with `/` separators.
 */
export interface LanguageAdapter {
	readonly id: string;
	readonly label: string;
	readonly extensions: readonly string[];
	/** Parse one file, with each declaration's movability and the file's skip reason. */
	parse(file: string): Promise<FileInfo>;
	/** Why a new file may not have this name. */
	fileNameProblems(name: string): string[];
	/** The exact text a new file split from `file` starts with (Go: a comment naming the original and a blank line). */
	splitHeader(file: string): string;
	/** New files and the new original, imports rebuilt. Throws when the plan cannot be applied. */
	buildSplit(source: Buffer, info: FileInfo, plan: SplitPlan): SplitResult;
	/** Move rule 4: the unit's declarations, before and after, are the same apart from their file. */
	sameDeclarations(before: readonly FileInfo[], after: readonly FileInfo[]): string[];
	/** The files rule 4 compares (Go: the package's files). */
	unitFiles(file: string): Promise<string[]>;
	/** Files that the formatter would change; empty when all are formatted or the language has no formatter. */
	unformatted(files: readonly string[]): Promise<string[]>;
	/** Exact build, vet and test commands for the file's unit, in order. */
	checks(file: string): CheckCommand[];
	/** Per-test results from a test command's output. */
	parseTests(output: string): TestRun;
	/** The add-tests fix writes this file. */
	testFileName(file: string): string;
	/** Test names a test file declares. */
	testNames(info: FileInfo): string[];
	/** Why a generated test file may not be used (wrong package, network access). */
	testProblems(text: string, info: FileInfo, source: FileInfo): string[];
	/** The model's input for a split plan of a file with this many lines. */
	splitPrompt(info: FileInfo, lines: number): Prompt;
	testPrompt(file: string, source: string, info: FileInfo): Prompt;
}
