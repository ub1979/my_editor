let tail: Promise<unknown> = Promise.resolve();

/**
 * Runs read-modify-write jobs on `.my_editor/` files one at a time, so two quick saves cannot each read the
 * same old version and overwrite the other's update.
 */
export function serial<T>(job: () => Promise<T>): Promise<T> {
	const run = tail.then(job, job);
	tail = run.catch(() => undefined);
	return run;
}
