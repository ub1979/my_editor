import { FileResult } from './filePassPlan';
import { fileContentProblem } from './filePassPolicy';
import { stubContent, TreeFile } from './stubs';

/** Presence is not correctness. Existing implementations are queued for the later QA stage. */
export function existingImplementation(file: TreeFile, source: string | undefined, hash?: string): FileResult | undefined {
	if (!source?.trim() || source.trim() === stubContent(file).trim() || fileContentProblem(file.path, source)) { return; }
	// Catch common incomplete bodies even when they differ from the generated scaffold.
	if (/\b(?:TODO|FIXME|NotImplementedError)\b|not implemented|implement me/i.test(source)) { return; }
	return { path: file.path, hash, outcome: 'existing',
		note: `${file.role ?? 'Existing implementation'}. Code is already present; preserved for the QA stage. It has not been verified by this build.` };
}

/** A changed file must be revisited without discarding unrelated completed build work. */
export async function unchangedResults(results: readonly FileResult[], readHash: (path: string) => Promise<string | undefined>): Promise<FileResult[]> {
	const retained: FileResult[] = [];
	for (const result of results) {
		const hash = await readHash(result.path);
		if (hash !== undefined && hash === result.hash) { retained.push(result); }
	}
	return retained;
}
