/** A branch or tag pointing at a commit, from `git log --decorate=full --format=%D`. */
export interface RefLabel {
	readonly name: string;
	/** `head` is the checked-out branch (or a detached `HEAD`). */
	readonly kind: 'head' | 'local' | 'remote' | 'tag';
}

export interface LogCommit {
	readonly hash: string;
	readonly parents: readonly string[];
	readonly author: string;
	readonly email: string;
	/** Author date in ms. */
	readonly date: number;
	readonly refs: readonly RefLabel[];
	readonly subject: string;
}

export interface FileChange {
	/** A, M, D, R, C or T. */
	readonly status: string;
	readonly path: string;
	readonly oldPath?: string;
	/** Undefined for binary files. */
	readonly added?: number;
	readonly deleted?: number;
}

export interface GrepHit {
	readonly path: string;
	readonly line: number;
	readonly text: string;
}

const US = '\x1f';

/** `git log` format read by `parseLog`, with `--decorate=full`: one commit per line. */
export const LOG_FORMAT = ['%H', '%P', '%an', '%ae', '%at', '%D', '%s'].join('%x1f');

export function parseRefs(decorations: string): RefLabel[] {
	const refs: RefLabel[] = [];
	for (const raw of decorations.split(', ')) {
		const ref = raw.trim();
		if (ref === 'HEAD') {
			refs.push({ name: 'HEAD', kind: 'head' });
		} else if (ref.startsWith('HEAD -> refs/heads/')) {
			refs.push({ name: ref.slice('HEAD -> refs/heads/'.length), kind: 'head' });
		} else if (ref.startsWith('tag: refs/tags/')) {
			refs.push({ name: ref.slice('tag: refs/tags/'.length), kind: 'tag' });
		} else if (ref.startsWith('refs/heads/')) {
			refs.push({ name: ref.slice('refs/heads/'.length), kind: 'local' });
		} else if (ref.startsWith('refs/remotes/') && !ref.endsWith('/HEAD')) {
			refs.push({ name: ref.slice('refs/remotes/'.length), kind: 'remote' });
		}
	}
	return refs;
}

export function parseLog(output: string): LogCommit[] {
	const commits: LogCommit[] = [];
	for (const line of output.split('\n')) {
		const [hash, parents = '', author = '', email = '', at = '0', decorations = '', ...subject] = line.split(US);
		if (!hash) {
			continue;
		}
		commits.push({
			hash,
			parents: parents ? parents.split(' ') : [],
			author,
			email,
			date: Number(at) * 1000,
			refs: parseRefs(decorations),
			subject: subject.join(US),
		});
	}
	return commits;
}

/** `git diff-tree -z --name-status`: `M\0path\0`, renames and copies `R063\0old\0new\0`. */
export function parseNameStatus(output: string): FileChange[] {
	const tokens = output.split('\0');
	const changes: FileChange[] = [];
	for (let i = 0; i < tokens.length && tokens[i]; ) {
		const status = tokens[i][0];
		if (status === 'R' || status === 'C') {
			changes.push({ status, path: tokens[i + 2], oldPath: tokens[i + 1] });
			i += 3;
		} else {
			changes.push({ status, path: tokens[i + 1] });
			i += 2;
		}
	}
	return changes;
}

/** `git diff-tree -z --numstat`: `3\t1\tpath\0`, renames `1\t0\t\0old\0new\0`, binary `-\t-\tpath\0`. */
export function parseNumstat(output: string): { path: string; added?: number; deleted?: number }[] {
	const tokens = output.split('\0');
	const stats: { path: string; added?: number; deleted?: number }[] = [];
	for (let i = 0; i < tokens.length; i++) {
		const match = /^(\d+|-)\t(\d+|-)\t(.*)$/s.exec(tokens[i]);
		if (!match) {
			continue;
		}
		const count = (value: string) => (value === '-' ? undefined : Number(value));
		let path = match[3];
		if (!path) {
			path = tokens[i + 2];
			i += 2;
		}
		stats.push({ path, added: count(match[1]), deleted: count(match[2]) });
	}
	return stats;
}

export function mergeFileStats(nameStatus: readonly FileChange[], numstat: readonly { path: string; added?: number; deleted?: number }[]): FileChange[] {
	const byPath = new Map(numstat.map(stat => [stat.path, stat] as const));
	return nameStatus.map(change => {
		const stat = byPath.get(change.path);
		return { ...change, added: stat?.added, deleted: stat?.deleted };
	});
}

/** `git ls-tree -r -z --name-only`. */
export function parseLsTree(output: string): string[] {
	return output.split('\0').filter(Boolean);
}

/** `git grep -n -I --null <pattern> <ref> --`: `<ref>:<path>\0<line>\0<text>` per line. */
export function parseGrep(output: string, ref: string): GrepHit[] {
	const prefix = `${ref}:`;
	const hits: GrepHit[] = [];
	for (const line of output.split('\n')) {
		const [file, lineNumber, ...text] = line.split('\0');
		if (!file || lineNumber === undefined) {
			continue;
		}
		hits.push({ path: file.startsWith(prefix) ? file.slice(prefix.length) : file, line: Number(lineNumber), text: text.join('\0') });
	}
	return hits;
}

/** `git rev-list --left-right --count <base>...<ref>`: behind, then ahead. */
export function parseAheadBehind(output: string): { ahead: number; behind: number } {
	const [behind = '0', ahead = '0'] = output.trim().split(/\s+/);
	return { behind: Number(behind) || 0, ahead: Number(ahead) || 0 };
}
