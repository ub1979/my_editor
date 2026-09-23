export interface CommitRecord {
	readonly hash: string;
	readonly date: string;
	readonly subject: string;
	readonly paths: string[];
}

export function parseCommits(output: string): CommitRecord[] {
	const commits: CommitRecord[] = [];
	let current: { hash: string; date: string; subject: string; paths: string[] } | undefined;
	for (const line of output.split('\n')) {
		if (line.startsWith('COMMIT\t')) {
			const [, hash, date, ...subject] = line.split('\t');
			if (hash && date) {
				current = { hash, date, subject: subject.join(' '), paths: [] };
				commits.push(current);
			}
		} else if (line.trim() && current) {
			current.paths.push(line.trim());
		}
	}
	return commits;
}
