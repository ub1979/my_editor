import { createHash } from 'crypto';
import { posix } from 'path';
import { detectCommands, RootFiles } from '../aiready/commandDetect';

export type CheckKind = 'build' | 'typecheck' | 'lint' | 'test';
export interface CheckSpec { id: string; directory: string; command: string; kind: CheckKind; requires: string[] }
export interface CheckLocation extends RootFiles { directory: string; configurationHashes?: Record<string, string> }
export interface VerificationPlan { checks: CheckSpec[]; signature: string }

function manifest(location: CheckLocation): Record<string, any> {
	try {
		const data = JSON.parse(location.packageJson ?? '{}');
		if (!data || typeof data !== 'object' || Array.isArray(data)) { throw new Error('Expected an object'); }
		return data;
	} catch { throw new Error(`Invalid verification package manifest: ${location.directory || '.'}/package.json`); }
}

/** Commands come from host discovery, never from a model's proposed shell text. */
export function verificationPlan(locations: readonly CheckLocation[]): VerificationPlan {
	const checks: CheckSpec[] = [];
	const add = (directory: string, command: string, kind: CheckKind) => {
		checks.push({ id: `${directory || '.'}:${command}`, directory, command, kind, requires: [] });
	};
	const byName = new Map<string, string>();
	for (const location of locations) {
		const name = manifest(location).name;
		if (typeof name === 'string') {
			if (byName.has(name)) { throw new Error(`Ambiguous workspace package name: ${name}`); }
			byName.set(name, location.directory);
		}
		const detected = detectCommands(location), scripts = manifest(location).scripts ?? {};
		const available = (key: string) => typeof scripts[key] === 'string' && !!scripts[key].trim();
		if (available('build')) { add(location.directory, 'npm run build', 'build'); }
		for (const key of ['typecheck', 'type-check', 'check-types']) {
			if (available(key)) { add(location.directory, `npm run ${key}`, 'typecheck'); }
		}
		if (available('lint')) { add(location.directory, 'npm run lint', 'lint'); }
		// Prefer the project's explicit TypeScript scripts over an invented compiler invocation.
		for (const command of detected.checks) {
			if (command.startsWith('npx ') && ['build', 'typecheck', 'type-check', 'check-types'].some(available)) { continue; }
			add(location.directory, command, command.includes('--noEmit') || command === 'cargo check' ? 'typecheck' : command.includes('vet') ? 'lint' : 'build');
		}
		for (const command of detected.tests) { add(location.directory, command, 'test'); }
	}
	const dependencies = new Map(locations.map(location => {
		const data = manifest(location);
		const names = Object.keys({ ...data.dependencies, ...data.devDependencies, ...data.peerDependencies });
		return [location.directory, names.map(name => byName.get(name)).filter((directory): directory is string => directory !== undefined && directory !== location.directory)];
	}));
	const builds = (directory: string) => checks.filter(check => check.directory === directory && check.kind === 'build').map(check => check.id);
	for (const check of checks) {
		const prerequisiteDirs = check.directory ? dependencies.get(check.directory) ?? [] : locations.map(item => item.directory).filter(Boolean);
		check.requires = [...new Set([...prerequisiteDirs.flatMap(builds), ...(check.kind !== 'build' ? builds(check.directory) : [])])];
	}
	// Build prerequisites first, then independent checks/tests. A failed prerequisite is recorded as blocked, never green.
	const pending = [...checks].sort((a, b) => Number(a.kind === 'test') - Number(b.kind === 'test'));
	const ordered: CheckSpec[] = [], done = new Set<string>();
	while (pending.length) {
		const index = pending.findIndex(check => check.requires.every(id => done.has(id)));
		if (index < 0) { throw new Error('Verification build dependencies contain a cycle. Resolve the package graph before running checks.'); }
		const [check] = pending.splice(index, 1); ordered.push(check); done.add(check.id);
	}
	return { checks: ordered, signature: createHash('sha256').update(JSON.stringify(locations)).digest('hex') };
}

/** Retest the demonstrated failure and changed packages, rebuilding prerequisite artifacts first. */
export function focusedChecks(plan: VerificationPlan, ids: readonly string[], files: readonly string[]): CheckSpec[] {
	const selected = new Set(ids);
	for (const id of selected) { if (!plan.checks.some(check => check.id === id)) { throw new Error(`Required check disappeared: ${id}`); } }
	const directories = [...new Set(plan.checks.map(check => check.directory))].sort((a, b) => b.length - a.length);
	const owners = new Set(files.map(file => directories.find(directory => !directory || file.startsWith(directory + '/'))).filter(value => value !== undefined));
	for (const check of plan.checks) { if (owners.has(check.directory)) { selected.add(check.id); } }
	const include = (id: string) => {
		const check = plan.checks.find(item => item.id === id)!;
		for (const dependency of check.requires) { if (!selected.has(dependency)) { selected.add(dependency); include(dependency); } }
	};
	for (const id of [...selected]) { include(id); }
	return plan.checks.filter(check => selected.has(check.id));
}

export function checkAncestors(files: readonly string[]): string[] {
	const directories = new Set<string>(['']);
	for (const file of files) {
		if (posix.isAbsolute(file) || file.includes('\\') || file.split('/').includes('..')) { continue; }
		let directory = posix.dirname(file);
		while (directory !== '.') { directories.add(directory); directory = posix.dirname(directory); }
	}
	return [...directories].sort();
}
