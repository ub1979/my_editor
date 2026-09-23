/**
 * A path short enough to read at a glance: the home folder as `~`, and long paths shortened in the middle
 * so the start and the folders nearest the project stay visible.
 */
export function shortPath(fullPath: string, home: string, max = 44): string {
	const path = fullPath === home ? '~' : fullPath.startsWith(`${home}/`) ? `~${fullPath.slice(home.length)}` : fullPath;
	if (path.length <= max) {
		return path;
	}
	const parts = path.split('/');
	const head = parts[0] === '' ? `/${parts[1]}` : parts[0];
	let tail = parts[parts.length - 1];
	for (let i = parts.length - 2; i > 1; i--) {
		const next = `${parts[i]}/${tail}`;
		if (`${head}/…/${next}`.length > max) {
			break;
		}
		tail = next;
	}
	return `${head}/…/${tail}`;
}
