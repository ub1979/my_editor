export interface PassModule { title: string; files: string[] }
export interface PassOptions {
	kind: 'Build' | 'QA';
	automatic: boolean;
	/** Explicit permission for new companion tests, scoped to this run only. */
	companionTests?: 'review' | 'automatic';
	/** Zero runs to the end. A positive number counts saved build steps between checkpoints. */
	interval: 'file' | number;
	selected?: string;
	/** Build missing implementations first, then review the completed application. */
	workflow?: 'buildThenQA';
	/** Explicit per-run approval for saves, new tests, detected test execution and automatic completion. */
	unattended?: boolean;
	/** Explicit approval of detected build/type/lint commands; legacy test consent never implies this. */
	verificationChecks?: boolean;
	/** Generate a bounded related group while retaining individual save validation. */
	batchSize?: 1 | 3;
}
export interface FileResult { path: string; hash?: string; note: string; outcome?: 'saved' | 'reviewed' | 'existing' }

export function passTargets(modules: readonly PassModule[], selected?: string): PassModule[] {
	if (selected) { return [{ title: modules.find(group => group.files.includes(selected))?.title ?? 'Selected file', files: [selected] }]; }
	return [...modules];
}

export function checkpointDue(modules: readonly PassModule[], path: string, interval: PassOptions['interval']): boolean {
	if (interval === 'file') { return true; }
	const index = modules.findIndex(group => group.files.includes(path));
	return interval > 0 && index >= 0 && modules[index].files.at(-1) === path && (index + 1) % interval === 0;
}

/** The review screen lists every saved file in the group that just finished. */
export function checkpointFiles(modules: PassModule[], path: string, interval: PassOptions['interval']): string[] {
	if (interval === 'file') { return [path]; }
	if (interval === 0) { return modules.flatMap(group => group.files); }
	const index = modules.findIndex(group => group.files.includes(path));
	return index < 0 ? [path] : modules.slice(index - index % interval, index + 1).flatMap(group => group.files);
}
