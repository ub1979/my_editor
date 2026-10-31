import { lstatSync, realpathSync } from 'fs';
import * as path from 'path';

/** Resolve the closest existing ancestor so a new directory is allowed without escaping through a symlink. */
export function checkedProjectPath(root: string, relative: string, creating = false): string {
	const boundary = realpathSync(root);
	const target = path.resolve(root, relative);
	if (target === path.resolve(root) || !target.startsWith(path.resolve(root) + path.sep)) { throw new Error('Path is outside the project.'); }
	let ancestor = target;
	while (true) {
		try {
			const resolved = realpathSync(ancestor);
			if (resolved !== boundary && !resolved.startsWith(boundary + path.sep)) { throw new Error('Path is outside the project.'); }
			return target;
		} catch (error) {
			if (!creating || (error as NodeJS.ErrnoException).code !== 'ENOENT') { throw error; }
			// realpath reports ENOENT for a dangling symlink too; never turn it into a new-file write.
			try { if (lstatSync(ancestor).isSymbolicLink()) { throw new Error('Path contains a dangling symlink.'); } }
			catch (statError) { if ((statError as NodeJS.ErrnoException).code !== 'ENOENT') { throw statError; } }
			const parent = path.dirname(ancestor);
			if (parent === ancestor) { throw error; }
			ancestor = parent;
		}
	}
}
