import { createHash } from 'crypto';
import type { CheckCommandEvidence } from './checkpointEvidence';

/** Stable failure evidence excludes timestamps, durations, process ids and fresh log names. */
export function failureSignature(command: CheckCommandEvidence): string {
	const clean = command.message.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '')
		.replace(/\.my_editor\/test-runs\/[^\s]+/g, '<log>')
		.replace(/\b\d{4}-\d\d-\d\dT[\d:.]+Z\b/g, '<time>')
		.replace(/:\d+(?::\d+)?/g, ':<line>')
		.replace(/\b\d+(?:\.\d+)?\s*(?:ms|s|seconds|milliseconds)\b/g, '<duration>');
	const anchors = clean.split('\n').filter(line => /error TS\d+|(?:Assertion|Type|Syntax|Reference)Error|^\s*(?:not ok|FAIL\b|×|❯)|expected:|actual:|Expected:|Received:|Error:/.test(line))
		.map(line => line.trim().replace(/^not ok \d+ - /, 'not ok ').replace(/\s+\([^)]+\)$/, ''));
	const normalized = anchors.length ? [...new Set(anchors)].sort().join('\n') : clean.split('\n')
		.filter(line => !/duration|time:|pid|tests |pass |fail |skipped |started|finished|Test output:|^\s*$/.test(line)).join('\n');
	return createHash('sha256').update((command.id ?? command.name) + '\n' + normalized).digest('hex');
}

export function repeatedFailure(before: { commandId?: string; failure?: string }, commands: readonly CheckCommandEvidence[]): boolean {
	return !!before.failure && commands.some(command => (command.id ?? command.name) === before.commandId
		&& command.status === 'failed' && failureSignature(command) === before.failure);
}
