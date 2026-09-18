import type { Uri } from 'vscode';

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

export interface RepositoryState {
	readonly indexChanges: Change[];
	readonly workingTreeChanges: Change[];
	/** Absent in older VS Code versions. */
	readonly untrackedChanges?: Change[];
	readonly mergeChanges: Change[];
}

export interface Repository {
	readonly rootUri: Uri;
	readonly state: RepositoryState;
}

export interface API {
	readonly repositories: Repository[];
	toGitUri(uri: Uri, ref: string): Uri;
}

export interface GitExtension {
	readonly enabled: boolean;
	getAPI(version: 1): API;
}
