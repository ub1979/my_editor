import { existsSync, readFileSync, rmSync } from 'fs';
import * as path from 'path';
import type { CheckResult } from './baseline';
import type { CoverageEntry } from './coverRecord';
import { unitOf } from './fixScreen';
import type { FixChoice } from './fixState';
import type { CheckCommand, RefactorHooks } from './language';

/** One coverage command per unit with a refactor offer, and the offers it measures. */
export interface CoverageCommand {
	readonly files: readonly string[];
	readonly command: CheckCommand;
	/** Where the command writes its profile, relative to the worktree. */
	readonly profile: string;
}

/** The coverage commands for the refactor offers, numbered from 1 in the offers' order, one per unit. */
export function coverageCommands(offers: readonly FixChoice[], hooks: Pick<RefactorHooks, 'coverage'>): CoverageCommand[] {
	const units = new Map<string, string[]>();
	for (const offer of offers.filter(choice => choice.kind === 'refactor')) {
		const unit = unitOf(offer.file);
		units.set(unit, [...(units.get(unit) ?? []), offer.file]);
	}
	return [...units.values()].map((files, index) => ({ files, ...hooks.coverage(files[0], index + 1) }));
}

/** What the coverage pass needs from the run. */
export interface CoverageDeps {
	readonly worktree: string;
	/** Runs one approved command in the worktree. */
	readonly run: (command: string, label: string) => Promise<CheckResult>;
	/** The file's blob id as the run started from it. */
	readonly blob: (file: string) => Promise<string | undefined>;
	readonly cancelled: () => boolean;
	readonly progress: (text: string) => void;
}

/** What the coverage pass found: whether each offer's function ran, and the entries to keep by blob. */
export interface Coverage {
	readonly ran: Record<string, boolean>;
	readonly entries: Map<string, CoverageEntry>;
}

/** Runs each command once, reads and deletes its profile, and says per offer whether its function ran. */
export async function runCoverage(commands: readonly CoverageCommand[], offers: readonly FixChoice[], hooks: Pick<RefactorHooks, 'ran'>,
	deps: CoverageDeps): Promise<Coverage | 'stopped'> {
	const coverage: Coverage = { ran: {}, entries: new Map() };
	for (const { files, command, profile } of commands) {
		if (deps.cancelled()) { return 'stopped'; }
		const file = path.join(deps.worktree, profile);
		let text: string | undefined;
		try {
			deps.progress(`Running \`${command.command}\`…`);
			const result = await deps.run(command.command, command.label);
			if (deps.cancelled()) { return 'stopped'; }
			text = result.code === 0 && existsSync(file) ? readFileSync(file, 'utf8') : undefined;
		} finally {
			rmSync(file, { force: true });
		}
		for (const name of files) {
			const target = offers.find(offer => offer.file === name && offer.kind === 'refactor')?.target;
			if (!target) { continue; }
			// A file the language cannot read back (say, it no longer parses) did not run, as far as anyone can show.
			const ran = text !== undefined && await hooks.ran(text, name, target).catch(() => false);
			coverage.ran[name] = ran;
			const blob = await deps.blob(name);
			if (blob) { coverage.entries.set(name, { blob, function: target.name, ran }); }
		}
	}
	return coverage;
}
