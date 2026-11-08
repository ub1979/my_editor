import { safeRelativePath } from '../chat/agentProtocol';
import { elidesCode } from '../pair/codeBlock';
import { isSensitiveFile } from '../records/sensitive';
import { hasCredentialLikeSource } from '../records/sourceSecrets';
import { MAX_SOURCE_LINES, sourceLines, sourcePolicyError, classPolicyError } from '../quality/sourcePolicy';

export const implementationRules = 'Follow the saved architecture, design patterns, conventions and public contracts. '
	+ 'Give each file and class one responsibility. Write small, named functions. Keep dependencies behind narrow, replaceable interfaces. '
	+ 'Respect planned service boundaries. Follow explicit saved contract decisions without asking again. Ask before adding a deployed service, dependency, or inventing a change to an agreed contract. '
	+ 'When an authorized new file owns an interface that the saved plans have not specified in detail, define a small typed interface from its assigned responsibility and existing shared contracts. '
	+ 'An empty future consumer or test is not a prerequisite for implementing its provider. Do not wait for that consumer to define the provider API, or invent exports in another file. '
	+ 'Only request dependency ordering for a concrete interface this file consumes from another unimplemented owner, not for future callers or missing test coverage. '
	+ 'Comment non-obvious decisions and failure behavior. Use readable formatting. Keep every generated file within 600 lines. '
	+ 'Cover normal, boundary and failure behavior with executable assertions using the project’s test framework. '
	+ 'Check integration contracts between modules. Never omit behavior or compress code to fit.';

export function eligibleFile(path: string): boolean {
	return !!safeRelativePath(path) && !/^[a-z]:/i.test(path) && !isSensitiveFile(path)
		&& !/(?:^|\/)(?:\.my_editor|\.git|node_modules)(?:\/|$)/i.test(path);
}

export function companionTest(path: string): boolean {
	return eligibleFile(path) && /(?:^|\/)(?:test_[^/]+\.py|[^/]+(?:[._-](?:test|spec)|Test)\.(?:[cm]?[jt]sx?|py|go|rs|java|kt|cs|rb|php|swift))$/i.test(path);
}

export function fileContentProblem(path: string, content: unknown): string | undefined {
	if (typeof content !== 'string' || !content.trim() || elidesCode(content)) { return 'Return complete, nonempty file content without omissions.'; }
	if (content.length > 80_000 || sourceLines(content) > MAX_SOURCE_LINES) { return 'Split the responsibility before applying this file. Every generated file must fit within 600 lines and the whole-file size budget.'; }
	if (content.includes('[REDACTED]')) { return 'The proposal contains redacted data. Preserve the original value with a manual edit.'; }
	if (content.includes('\0')) { return 'The proposal contains binary content. Return a complete text file.'; }
	if (hasCredentialLikeSource(path, content)) {
		return 'The proposal contains values that look like credentials and cannot be saved automatically. '
			+ 'Never include real credentials. For credential-redaction tests, use clearly synthetic short fixture values such as tok123, and update the matching assertions.';
	}
	if (/\.json$/i.test(path)) {
		try { JSON.parse(content); } catch { return 'The proposed file contains invalid JSON.'; }
	}
	return sourcePolicyError(path, content) ?? classPolicyError(path, content);
}
