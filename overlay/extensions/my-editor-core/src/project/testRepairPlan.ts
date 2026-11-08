import { createHash } from 'crypto';
import type { FileResult, PassModule } from './filePassPlan';
import { companionTest, eligibleFile } from './filePassPolicy';

export interface TestRepairTarget { path: string; reason: string }
export interface TestRepairAttempt {
	signature: string; files: TestRepairTarget[];
	commandId?: string; failure?: string; verified?: boolean;
	changedFiles?: string[];
	verification?: import('./checkpointEvidence').CheckCommandEvidence[];
}
export const MAX_TEST_REPAIR_FILES = 20;
export class TestRepairFormatError extends Error {}

/** Whole-project QA can rediscover existing companion tests created since its first scan. */
export function testRepairModules(modules: readonly PassModule[], discovered: readonly string[]): PassModule[] {
	const known = new Set(modules.flatMap(group => group.files));
	const extra = [...new Set(discovered)].filter(path => !known.has(path) && eligibleFile(path) && companionTest(path));
	return [...modules.map(group => ({ ...group, files: [...group.files] })),
		...(extra.length ? [{ title: 'Discovered QA tests', files: extra }] : [])];
}

/** Same saved sources cannot earn another automatic repair round merely by producing new log names. */
export function testRepairSignature(results: readonly FileResult[]): string {
	return createHash('sha256').update(JSON.stringify(results.map(row => [row.path, row.hash ?? 'missing']).sort())).digest('hex');
}

export function parseTestRepairs(reply: string, modules: readonly PassModule[]): TestRepairTarget[] {
	const match = /^TEST_REPAIRS\s*\n([\s\S]+)$/.exec(reply.trim());
	if (!match) {
		const message = 'Test diagnosis did not identify an actionable repair set. ' + reply.slice(0, 2000);
		if (/^BLOCKED\b/i.test(reply.trim())) { throw new Error(message); }
		throw new TestRepairFormatError(message);
	}
	let data: unknown;
	try { data = JSON.parse(match[1]); } catch { throw new TestRepairFormatError('Test diagnosis returned invalid repair JSON.'); }
	const files = (data as { files?: unknown })?.files;
	const allowed = new Set(modules.flatMap(group => group.files));
	if (!Array.isArray(files) || !files.length || files.length > MAX_TEST_REPAIR_FILES) {
		throw new TestRepairFormatError(`Test diagnosis needs 1–${MAX_TEST_REPAIR_FILES} existing run files; received ${Array.isArray(files) ? files.length : 'no file array'}.`);
	}
	const seen = new Set<string>();
	return files.map(item => {
		if (!item || typeof item.path !== 'string' || !allowed.has(item.path) || seen.has(item.path)
			|| typeof item.reason !== 'string' || !item.reason.trim() || item.reason.length > 2000) {
			throw new TestRepairFormatError(`Test diagnosis referenced a duplicate, unauthorized file or missing failure evidence: ${typeof item?.path === 'string' ? item.path : '(missing path)'}`);
		}
		seen.add(item.path);
		return { path: item.path, reason: item.reason.trim() };
	});
}

export function testRepairProblem(attempts: readonly TestRepairAttempt[], signature: string): string | undefined {
	if (attempts.some(attempt => attempt.signature === signature)) { return 'No source progress since the previous test repair. Inspect the unresolved failure before retrying.'; }
	if (attempts.length >= 5) { return 'Five automatic test repair rounds did not produce passing checks. Review the retained failure evidence before continuing.'; }
}
