export interface CloneSource {
	readonly url: string;
	readonly branch?: string;
	readonly folderName: string;
}

/** Turn a GitHub branch page into a Git clone source; leave normal HTTPS/SSH clone URLs usable. */
export function parseCloneSource(input: string): CloneSource | undefined {
	const value = input.trim();
	const ssh = /^git@[^\s:]+:([^\s]+)$/.exec(value);
	if (ssh) {
		const name = ssh[1].split('/').pop()?.replace(/\.git$/, '');
		return name ? { url: value, folderName: name } : undefined;
	}
	let parsed: URL;
	try { parsed = new URL(value); } catch { return undefined; }
	if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.search || parsed.hash) { return undefined; }
	const pieces = parsed.pathname.split('/').filter(Boolean);
	const github = parsed.hostname === 'github.com' || parsed.hostname === 'www.github.com';
	if (github) {
		if (pieces.length < 2 || !validPart(pieces[0]) || !validPart(pieces[1])) { return undefined; }
		const repo = pieces[1].replace(/\.git$/, '');
		if (!repo) { return undefined; }
		if (pieces.length === 2) { return { url: `https://github.com/${pieces[0]}/${repo}.git`, folderName: repo }; }
		if (pieces[2] !== 'tree' || pieces.length < 4) { return undefined; }
		let branch: string;
		try { branch = pieces.slice(3).map(decodeURIComponent).join('/'); } catch { return undefined; }
		if (!validBranchName(branch)) { return undefined; }
		return { url: `https://github.com/${pieces[0]}/${repo}.git`, branch, folderName: repo };
	}
	if (pieces.length < 2 || pieces.some(piece => !validPart(piece))) { return undefined; }
	const name = pieces[pieces.length - 1].replace(/\.git$/, '');
	return name ? { url: value.replace(/\/$/, ''), folderName: name } : undefined;
}

function validPart(value: string): boolean {
	return /^[A-Za-z0-9_.-]+$/.test(value) && value !== '.' && value !== '..';
}

export function validBranchName(value: string): boolean {
	return /^[A-Za-z0-9_./-]+$/.test(value) && !value.includes('..') && !value.includes('//')
		&& !value.startsWith('/') && !value.endsWith('/') && !value.endsWith('.lock');
}
