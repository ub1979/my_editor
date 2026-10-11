/** One block of a Go cover profile: `path:l1.c1,l2.c2 statements count`. */
const BLOCK = /^(.+):(\d+)\.\d+,(\d+)\.\d+ \d+ (\d+)$/;

/**
 * Whether a Go cover profile (`go test -coverprofile`) shows a statement of the file named `base` executed between lines
 * `from` and `to`: a block (`path:l1.c1,l2.c2 statements count`) overlapping them with a count above zero.
 */
export function coverRan(profile: string, base: string, from: number, to: number): boolean {
	return profile.split('\n').some(line => {
		const block = BLOCK.exec(line.trim());
		if (!block || (block[1] !== base && !block[1].endsWith(`/${base}`))) { return false; }
		return Number(block[4]) > 0 && Number(block[2]) <= to && Number(block[3]) >= from;
	});
}
