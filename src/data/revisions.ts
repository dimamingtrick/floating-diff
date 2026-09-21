/** One commit that changed a file, with the name the file had at that commit. */
export interface FileRevision {
	readonly hash: string;
	readonly subject: string;
	readonly author: string;
	/** Author date in ms. */
	readonly date: number;
	readonly path: string;
}

const RS = '\x1e';
const US = '\x1f';

/** `git log --follow --name-only` format read by `parseFileRevisions`. */
export const REVISION_FORMAT = `%x1e%H%x1f%s%x1f%an%x1f%at`;

/** The commits of one file, newest first, from `git log --follow --name-only`. */
export function parseFileRevisions(output: string): FileRevision[] {
	const revisions: FileRevision[] = [];
	for (const block of output.split(RS).slice(1)) {
		const [head, ...rest] = block.split('\n');
		const [hash, subject, author, time] = head.split(US);
		if (!hash) {
			continue;
		}
		// A commit that changed nothing here (a merge) lists no name: the file kept the one it had.
		const named = rest.map(line => line.trim()).find(Boolean);
		revisions.push({
			hash,
			subject: subject ?? '',
			author: author ?? '',
			date: Number(time ?? 0) * 1000,
			path: named ?? revisions[revisions.length - 1]?.path ?? '',
		});
	}
	return revisions;
}

/**
 * The pair the next step compares, like WebStorm's Compare with Previous
 * Version: without a commit, the newest one against the working tree; with
 * one, the commit before it against it. `revisions` comes from `git log
 * <ref>`, so it starts at the newest commit at or before `ref`.
 */
export function stepBack(revisions: readonly FileRevision[], ref?: string): { older: FileRevision; newer?: FileRevision } | undefined {
	if (!ref) {
		return revisions[0] ? { older: revisions[0] } : undefined;
	}
	const index = Math.max(revisions.findIndex(revision => revision.hash === ref), 0);
	const older = revisions[index + 1];
	return older && revisions[index] ? { older, newer: revisions[index] } : undefined;
}

const shorten = (subject: string) => (subject.length > 30 ? `${subject.slice(0, 28)}…` : subject);

/** "app.ts (c3d4e5f ↔ a1b2c3d · fix: the second one)": both sides and the change shown. */
export function revisionTitle(name: string, older: FileRevision, newer?: FileRevision): string {
	const latest = newer ?? older;
	return `${name} (${older.hash.slice(0, 7)} ↔ ${newer ? newer.hash.slice(0, 7) : 'working tree'} · ${shorten(latest.subject)})`;
}
