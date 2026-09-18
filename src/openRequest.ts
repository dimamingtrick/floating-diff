import * as path from 'path';
import type { Command, Uri } from 'vscode';
import { Change, Status } from './git';

/** What to show in the floating window. */
export type OpenRequest =
	| { readonly kind: 'diff'; readonly left: Uri; readonly right: Uri; readonly title: string }
	| { readonly kind: 'file'; readonly uri: Uri; readonly title: string };

export interface ChangeDeps {
	toGitUri(uri: Uri, ref: string): Uri;
	/** Rename target of `uri` in the index, if the file was renamed there. */
	indexRenameOf(uri: Uri): Uri | undefined;
}

function basename(uri: Uri): string {
	return path.posix.basename(uri.path);
}

function isUri(value: unknown): value is Uri {
	return typeof value === 'object' && value !== null && typeof (value as Uri).path === 'string';
}

/** Reuses the click command of a built-in Git resource state (`vscode.diff` / `vscode.open`). */
export function fromScmCommand(cmd: Command | undefined): OpenRequest | undefined {
	const [first, second, third]: unknown[] = cmd?.arguments ?? [];
	const title = typeof third === 'string' && third !== '' ? third : undefined;
	if (cmd?.command === 'vscode.diff' && isUri(first) && isUri(second)) {
		return { kind: 'diff', left: first, right: second, title: title ?? basename(second) };
	}
	if (cmd?.command === 'vscode.open' && isUri(first)) {
		return { kind: 'file', uri: first, title: title ?? basename(first) };
	}
	return undefined;
}

/** Whether `uri` is one of the documents shown for `req`. */
export function showsDocument(req: OpenRequest | undefined, uri: Uri | undefined): boolean {
	if (!req || !uri) {
		return false;
	}
	const key = uri.toString();
	return req.kind === 'diff'
		? req.left.toString() === key || req.right.toString() === key
		: req.uri.toString() === key;
}

const TITLE_SUFFIX: Partial<Record<Status, string>> = {
	[Status.INDEX_MODIFIED]: 'Index',
	[Status.INDEX_RENAMED]: 'Index',
	[Status.INDEX_ADDED]: 'Index',
	[Status.MODIFIED]: 'Working Tree',
	[Status.INDEX_DELETED]: 'Deleted',
	[Status.DELETED]: 'Deleted',
	[Status.UNTRACKED]: 'Untracked',
	[Status.INTENT_TO_ADD]: 'Intent to add',
	[Status.INTENT_TO_RENAME]: 'Intent to add',
	[Status.TYPE_CHANGED]: 'Type changed',
};

/**
 * Mirrors getLeftResource/getRightResource/getTitle of the built-in Git
 * extension (extensions/git/src/repository.ts). Merge conflicts are out of scope.
 */
export function fromChange(change: Change, deps: ChangeDeps): OpenRequest | undefined {
	const { uri, originalUri, status } = change;
	const workingTree = (): Uri => deps.indexRenameOf(uri) ?? uri;
	let left: Uri | undefined;
	let right: Uri;
	switch (status) {
		case Status.INDEX_MODIFIED:
		case Status.INDEX_RENAMED:
			left = deps.toGitUri(originalUri, 'HEAD');
			right = deps.toGitUri(uri, '');
			break;
		case Status.INDEX_ADDED:
		case Status.INDEX_COPIED:
			right = deps.toGitUri(uri, '');
			break;
		case Status.INDEX_DELETED:
		case Status.DELETED:
			right = deps.toGitUri(uri, 'HEAD');
			break;
		case Status.MODIFIED:
			left = deps.toGitUri(uri, '~');
			right = workingTree();
			break;
		case Status.TYPE_CHANGED:
		case Status.INTENT_TO_RENAME:
			left = deps.toGitUri(originalUri, 'HEAD');
			right = workingTree();
			break;
		case Status.UNTRACKED:
		case Status.INTENT_TO_ADD:
			right = workingTree();
			break;
		default:
			return undefined;
	}
	const suffix = TITLE_SUFFIX[status];
	const title = suffix ? `${basename(uri)} (${suffix})` : basename(uri);
	return left ? { kind: 'diff', left, right, title } : { kind: 'file', uri: right, title };
}
