import type { Event, Uri } from 'vscode';

/**
 * Subset of the built-in Git extension API
 * (microsoft/vscode: extensions/git/src/api/git.d.ts).
 * Upstream declares `Status` as a `const enum` in a .d.ts, which esbuild cannot
 * bundle, so this is a regular enum. Numeric values must match upstream.
 */
export enum Status {
	INDEX_MODIFIED,
	INDEX_ADDED,
	INDEX_DELETED,
	INDEX_RENAMED,
	INDEX_COPIED,
	MODIFIED,
	DELETED,
	UNTRACKED,
	IGNORED,
	INTENT_TO_ADD,
	INTENT_TO_RENAME,
	TYPE_CHANGED,
	ADDED_BY_US,
	ADDED_BY_THEM,
	DELETED_BY_US,
	DELETED_BY_THEM,
	BOTH_ADDED,
	BOTH_DELETED,
	BOTH_MODIFIED,
}

export interface Change {
	readonly uri: Uri;
	readonly originalUri: Uri;
	readonly renameUri: Uri | undefined;
	readonly status: Status;
}

/** The checked-out branch (`RepositoryState.HEAD`). */
export interface Branch {
	readonly name?: string;
	readonly commit?: string;
	readonly upstream?: { readonly remote: string; readonly name: string };
	readonly ahead?: number;
	readonly behind?: number;
}

export interface RepositoryState {
	readonly HEAD?: Branch;
	readonly indexChanges: Change[];
	readonly workingTreeChanges: Change[];
	/** Absent in older VS Code versions. */
	readonly untrackedChanges?: Change[];
	readonly mergeChanges: Change[];
	readonly remotes: readonly Remote[];
	readonly onDidChange: Event<void>;
}

export interface Remote {
	readonly name: string;
	readonly fetchUrl?: string;
	readonly pushUrl?: string;
}

export interface FetchOptions {
	readonly remote?: string;
	readonly ref?: string;
	/** Every remote. */
	readonly all?: boolean;
	readonly prune?: boolean;
}

export interface CommitOptions {
	/** Stage everything first (`git add -A`), or only tracked files (`git add -u`). */
	readonly all?: boolean | 'tracked';
}

export interface Repository {
	readonly rootUri: Uri;
	readonly state: RepositoryState;
}

/** Repository operations Git Convenient uses; all part of Git API version 1 (1.105+). */
export interface RepositoryOperations {
	/** The commit message box of Source Control. */
	readonly inputBox: { value: string };
	status(): Promise<void>;
	add(paths: string[]): Promise<void>;
	/** Unstages: the index goes back to HEAD. */
	revert(paths: string[]): Promise<void>;
	/** Discards working tree changes; deletes untracked files. */
	clean(paths: string[]): Promise<void>;
	checkout(treeish: string): Promise<void>;
	createBranch(name: string, checkout: boolean, ref?: string): Promise<void>;
	deleteBranch(name: string, force?: boolean): Promise<void>;
	merge(ref: string): Promise<void>;
	fetch(remote?: string, ref?: string): Promise<void>;
	fetch(options: FetchOptions): Promise<void>;
	commit(message: string, opts?: CommitOptions): Promise<void>;
	pull(): Promise<void>;
	push(remoteName?: string, branchName?: string, setUpstream?: boolean): Promise<void>;
	diffBetween(ref1: string, ref2: string): Promise<Change[]>;
	diffWith(ref: string): Promise<Change[]>;
}

export interface API {
	/** `initialized` once Git has opened the repositories it finds at startup. */
	readonly state: 'uninitialized' | 'initialized';
	readonly onDidChangeState: Event<'uninitialized' | 'initialized'>;
	readonly git: { readonly path: string };
	readonly repositories: Repository[];
	getRepository(uri: Uri): (Repository & RepositoryOperations) | null;
	readonly onDidOpenRepository: Event<Repository>;
	readonly onDidCloseRepository: Event<Repository>;
	toGitUri(uri: Uri, ref: string): Uri;
}

export interface GitExtension {
	readonly enabled: boolean;
	getAPI(version: 1): API;
	/** Internal, not API: the Git extension's model, used by the Source Control redirect. */
	readonly model?: unknown;
}
