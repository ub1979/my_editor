/** Folder-view files that Finder, Explorer and macOS write on their own; they never block a fix run. */
const SYSTEM_FILE = /(^|\/)(\.DS_Store|Thumbs\.db|desktop\.ini|\._[^/]*)$/i;

/** The path a `git status --porcelain` line is about: the new name for a rename, unquoted. */
function pathOf(line: string): string {
	const rest = line.slice(3);
	const target = rest.includes(' -> ') ? rest.slice(rest.lastIndexOf(' -> ') + 4) : rest;
	return target.startsWith('"') && target.endsWith('"') ? target.slice(1, -1).replace(/\\(.)/g, '$1') : target;
}

/** Tracked files with uncommitted edits that matter, from `git status --porcelain --untracked-files=no`. */
export function blockingEdits(porcelain: string): string[] {
	return porcelain.split('\n').filter(line => line.length > 3).map(pathOf).filter(file => !SYSTEM_FILE.test(file));
}

/** Why a run cannot start yet, naming the edited files; undefined when nothing blocks. */
export function dirtyMessage(files: readonly string[]): string | undefined {
	if (!files.length) { return undefined; }
	const named = files.length > 5 ? `${files.slice(0, 5).join(', ')} and ${files.length - 5} more` : files.join(', ');
	return `These tracked files have uncommitted changes: ${named}. Commit or stash them first, `
		+ 'so the branch starts from a known state.';
}
