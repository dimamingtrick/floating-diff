import { parseLines } from '../branches/branchModel';
import type { GitRunError, GitRunner } from '../branches/gitRunner';
import {
	FileChange, GrepHit, LOG_FORMAT, LogCommit, mergeFileStats, parseAheadBehind, parseGrep, parseLog, parseLsTree, parseNameStatus, parseNumstat,
} from './parse';
import { FileRevision, parseFileRevisions, REVISION_FORMAT } from './revisions';

export interface LogFilter {
	/** A branch or other revision; all branches, remotes and tags when missing. */
	readonly ref?: string;
	readonly author?: string;
	/** Anything `git log --since` takes, e.g. `7 days ago`. */
	readonly since?: string;
	/** Commits that change any of these files or folders. */
	readonly paths?: readonly string[];
	/** Commits whose message contains this text, in any case. */
	readonly text?: string;
}

export interface LogQuery extends LogFilter {
	readonly skip?: number;
	readonly limit: number;
}

/** The part of `git log` / `git rev-list` arguments that picks commits. */
function filterArgs(filter: LogFilter): string[] {
	const args: string[] = [];
	if (filter.author || filter.text) {
		args.push('--fixed-strings');
	}
	if (filter.author) {
		args.push(`--author=${filter.author}`);
	}
	if (filter.text) {
		args.push('--regexp-ignore-case', `--grep=${filter.text}`);
	}
	if (filter.since) {
		args.push(`--since=${filter.since}`);
	}
	// Branches, remotes and tags rather than --all, which would add stash commits.
	args.push(...(filter.ref ? ['--end-of-options', filter.ref] : ['--branches', '--remotes', '--tags', 'HEAD']));
	args.push('--', ...(filter.paths ?? []));
	return args;
}

export interface GrepOptions {
	readonly matchCase: boolean;
	readonly wholeWord: boolean;
	readonly regex: boolean;
}

export interface FileContent {
	readonly text?: string;
	readonly binary?: boolean;
	readonly tooLarge?: boolean;
}

const MAX_PREVIEW_BYTES = 1024 * 1024;
const MAX_GREP_HITS = 1000;

/** Read-only git data for the log and branch explorer, straight from git. */
export class GitData {
	constructor(private readonly git: GitRunner) { }

	async log(query: LogQuery): Promise<LogCommit[]> {
		const args = ['log', '--date-order', '--decorate=full', `--format=${LOG_FORMAT}`, `-n${query.limit}`];
		if (query.skip) {
			args.push(`--skip=${query.skip}`);
		}
		return parseLog(await this.git([...args, ...filterArgs(query)]));
	}

	/**
	 * The commits that changed one file, newest first, following it through
	 * renames; `ref` starts the log at a commit instead of HEAD.
	 */
	async fileRevisions(file: string, options: { readonly ref?: string; readonly limit?: number } = {}): Promise<FileRevision[]> {
		const args = ['log', '--follow', '--name-only', `--format=${REVISION_FORMAT}`, `-n${options.limit ?? 2}`];
		if (options.ref) {
			args.push('--end-of-options', options.ref);
		}
		try {
			return parseFileRevisions(await this.git([...args, '--', file]));
		} catch {
			// An untracked file, a ref this repository does not have: nothing to step back through.
			return [];
		}
	}

	/** How many commits `log` finds for a filter, to page through them. */
	async count(filter: LogFilter): Promise<number> {
		return Number((await this.git(['rev-list', '--count', ...filterArgs(filter)])).trim()) || 0;
	}

	/** Everyone who authored a commit on a branch, remote or tag, by name. */
	async authors(): Promise<string[]> {
		const out = await this.git(['shortlog', '-s', '--branches', '--remotes', '--tags', 'HEAD', '--']);
		const names = parseLines(out).map(line => line.slice(line.indexOf('\t') + 1));
		return [...new Set(names)].sort((a, b) => a.localeCompare(b));
	}

	/** The commit a hash (or its start) names, if any. */
	async commitByHash(prefix: string): Promise<LogCommit | undefined> {
		try {
			return parseLog(await this.git(['log', '-1', '--decorate=full', `--format=${LOG_FORMAT}`, '--end-of-options', `${prefix}^{commit}`, '--']))[0];
		} catch {
			return undefined;
		}
	}

	/** Body and changed files of a commit, against `parent` (its first parent; none for a root commit). */
	async commit(hash: string, parent: string | undefined): Promise<{ body: string; files: FileChange[] }> {
		const range = parent ? [parent, hash] : ['--root', hash];
		const [body, nameStatus, numstat] = await Promise.all([
			this.git(['show', '-s', '--format=%b', hash]),
			this.git(['diff-tree', '-r', '-M', '-z', '--no-commit-id', '--name-status', ...range]),
			this.git(['diff-tree', '-r', '-M', '-z', '--no-commit-id', '--numstat', ...range]),
		]);
		return { body: body.trim(), files: mergeFileStats(parseNameStatus(nameStatus), parseNumstat(numstat)) };
	}

	/** The files Git tracks in the working tree, for the log's Paths filter. */
	async files(): Promise<string[]> {
		// A file in conflict is listed once per side.
		return [...new Set(parseLsTree(await this.git(['ls-files', '-z'])))];
	}

	async tree(ref: string): Promise<string[]> {
		return parseLsTree(await this.git(['ls-tree', '-r', '-z', '--name-only', ref]));
	}

	async file(ref: string, path: string): Promise<FileContent> {
		const spec = `${ref}:${path}`;
		const size = Number((await this.git(['cat-file', '-s', spec])).trim());
		if (size > MAX_PREVIEW_BYTES) {
			return { tooLarge: true };
		}
		const text = await this.git(['cat-file', 'blob', spec]);
		return text.slice(0, 8000).includes('\0') ? { binary: true } : { text };
	}

	/** Whether the working tree file has the same content as `ref`'s version. */
	async sameAsWorkingFile(ref: string, path: string): Promise<boolean> {
		const [working, other] = await Promise.all([this.git(['hash-object', '--', path]), this.git(['rev-parse', `${ref}:${path}`])]);
		return working.trim() === other.trim();
	}

	/** Writes `ref`'s version of a file into the working tree; the index stays as it is. */
	async restoreFile(ref: string, path: string): Promise<void> {
		await this.git(['restore', `--source=${ref}`, '--worktree', '--', path]);
	}

	async grep(ref: string, query: string, options: GrepOptions): Promise<GrepHit[]> {
		if (!query) {
			return [];
		}
		const args = ['grep', '-n', '-I', '--null', options.regex ? '-E' : '-F'];
		if (!options.matchCase) {
			args.push('-i');
		}
		if (options.wholeWord) {
			args.push('-w');
		}
		args.push('-e', query, ref, '--');
		try {
			return parseGrep(await this.git(args), ref).slice(0, MAX_GREP_HITS);
		} catch (error) {
			// Exit code 1 without a message: nothing matched.
			const failure = error as GitRunError;
			if (failure.exitCode === 1 && !failure.stderr) {
				return [];
			}
			throw error;
		}
	}

	/** Files changed from `from` to `to`, with line counts. */
	async diffStat(from: string, to: string): Promise<FileChange[]> {
		const [nameStatus, numstat] = await Promise.all([
			this.git(['diff', '-M', '-z', '--name-status', from, to, '--']),
			this.git(['diff', '-M', '-z', '--numstat', from, to, '--']),
		]);
		return mergeFileStats(parseNameStatus(nameStatus), parseNumstat(numstat));
	}

	async mergeBase(a: string, b: string): Promise<string> {
		return (await this.git(['merge-base', a, b])).trim();
	}

	/** Commits `ref` has that `base` has not (ahead), and the other way round (behind). */
	async aheadBehind(base: string, ref: string): Promise<{ ahead: number; behind: number }> {
		return parseAheadBehind(await this.git(['rev-list', '--left-right', '--count', `${base}...${ref}`, '--']));
	}

	async commitsBetween(base: string, ref: string, limit = 500): Promise<LogCommit[]> {
		return parseLog(await this.git(['log', '--date-order', '--decorate=full', `--format=${LOG_FORMAT}`, `-n${limit}`, `${base}..${ref}`, '--']));
	}

	async branchNames(): Promise<{ local: string[]; remote: string[] }> {
		const refs = parseLines(await this.git(['for-each-ref', '--format=%(refname)', 'refs/heads', 'refs/remotes']));
		return {
			local: refs.filter(ref => ref.startsWith('refs/heads/')).map(ref => ref.slice('refs/heads/'.length)),
			remote: refs.filter(ref => ref.startsWith('refs/remotes/') && !ref.endsWith('/HEAD')).map(ref => ref.slice('refs/remotes/'.length)),
		};
	}

	/** Local, then remote branches that contain a commit. */
	async branchesContaining(hash: string): Promise<string[]> {
		const refs = parseLines(await this.git(['for-each-ref', `--contains=${hash}`, '--format=%(refname)', 'refs/heads', 'refs/remotes']));
		return refs.filter(ref => !ref.endsWith('/HEAD')).map(ref => ref.replace(/^refs\/(heads|remotes)\//, ''));
	}

	async tags(): Promise<string[]> {
		return parseLines(await this.git(['for-each-ref', '--sort=-creatordate', '--format=%(refname:short)', 'refs/tags']));
	}

	async cherryPick(hash: string): Promise<void> {
		await this.git(['cherry-pick', hash]);
	}

	async revert(hash: string): Promise<void> {
		await this.git(['revert', '--no-edit', hash]);
	}
}
