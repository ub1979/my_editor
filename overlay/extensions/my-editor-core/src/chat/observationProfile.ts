import { createHash } from 'crypto';
import * as path from 'path';

/** Project-authored observations are inert data until the user approves their exact content. */
export interface ObservationCheck {
	readonly id: string;
	readonly title: string;
	readonly description: string;
	readonly command: string;
	readonly args: readonly string[];
	readonly stdin?: string;
	readonly timeoutSeconds: number;
}

const EXECUTABLES = new Set(['ssh', 'git', 'rg', 'kubectl', 'docker', 'psql', 'curl']);
const ID = /^[a-z][a-z0-9_-]{1,39}$/;

export function parseObservationProfile(source: string): ObservationCheck[] {
	if (source.length > 64_000) { throw new Error('The observation profile is too large (64 KB limit).'); }
	let value: unknown;
	try { value = JSON.parse(source); } catch { throw new Error('The observation profile is not valid JSON.'); }
	if (!value || typeof value !== 'object' || Array.isArray(value)) { throw new Error('The observation profile must be an object.'); }
	const profile = value as Record<string, unknown>;
	if (profile.version !== 1 || !Array.isArray(profile.checks) || profile.checks.length > 12) {
		throw new Error('Use profile version 1 with at most 12 checks.');
	}
	const seen = new Set<string>();
	return profile.checks.map((raw, index) => {
		if (!raw || typeof raw !== 'object' || Array.isArray(raw)) { throw new Error(`Check ${index + 1} must be an object.`); }
		const item = raw as Record<string, unknown>;
		if (typeof item.id !== 'string' || !ID.test(item.id) || seen.has(item.id)) { throw new Error(`Check ${index + 1} needs a unique, simple id.`); }
		seen.add(item.id);
		if (typeof item.title !== 'string' || !item.title.trim() || item.title.length > 100
			|| typeof item.description !== 'string' || !item.description.trim() || item.description.length > 300) {
			throw new Error(`Check ${item.id} needs a short title and description.`);
		}
		if (typeof item.command !== 'string' || !path.isAbsolute(item.command)
			|| !EXECUTABLES.has(path.basename(item.command))) {
			throw new Error(`Check ${item.id} must use an absolute path to an approved observation executable.`);
		}
		if (!Array.isArray(item.args) || item.args.length > 32
			|| item.args.some(arg => typeof arg !== 'string' || arg.length > 4_000 || arg.includes('\0'))) {
			throw new Error(`Check ${item.id} has invalid arguments.`);
		}
		if (item.stdin !== undefined && (typeof item.stdin !== 'string' || item.stdin.length > 24_000 || item.stdin.includes('\0'))) {
			throw new Error(`Check ${item.id} has invalid input.`);
		}
		const timeout = item.timeoutSeconds ?? 30;
		if (!Number.isInteger(timeout) || Number(timeout) < 1 || Number(timeout) > 60) {
			throw new Error(`Check ${item.id} needs a timeout of 1–60 seconds.`);
		}
		return {
			id: item.id, title: item.title.trim(), description: item.description.trim(),
			command: item.command, args: item.args as string[], stdin: item.stdin as string | undefined,
			timeoutSeconds: Number(timeout),
		};
	});
}

/** Any change to a recipe invalidates its approval. Workspace identity is part of the trust key. */
export function observationFingerprint(workspace: string, check: ObservationCheck): string {
	return createHash('sha256').update(JSON.stringify([workspace, check])).digest('hex');
}

export function observationSummary(checks: readonly ObservationCheck[]): string {
	return checks.length
		? `Configured observations (request with observe; a project recipe needs approval before first use):\n${checks.map(check => `- ${check.id}: ${check.title}. ${check.description}`).join('\n')}`
		: 'No live observations are configured for this project.';
}
