/**
 * The `+` range of a hunk header, 1-based. A merge diff writes one range per
 * parent (`@@@ -1,2 -1,3 +5,4 @@@`), so the last one is the new file's.
 */
const HUNK = /^@{2,} .*\+(\d+)(?:,(\d+))? @{2,}/;

/**
 * The line of the first change of a unified diff, in the file as it is now.
 * A hunk that only removes lines names the line before them (`+12,0`), which
 * is where the removal shows; a diff without hunks has no line.
 */
export function firstHunkLine(diff: string): number | undefined {
	for (const line of diff.split('\n')) {
		const match = HUNK.exec(line);
		if (match) {
			const start = Number(match[1]);
			return match[2] === '0' ? Math.max(1, start) : start;
		}
	}
	return undefined;
}
