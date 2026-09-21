import * as path from 'path';
import type { Command, Uri } from 'vscode';
import { Change, Status } from './git';

/** One file of a multi-file diff. */
export interface ChangeResource {
	readonly label: Uri;
	/** Missing for added files. */
	readonly original?: Uri;
	/** Missing for deleted files. */
	readonly modified?: Uri;
}

/** What to show in the floating window. */
export type OpenRequest =
	| { readonly kind: 'diff'; readonly left: Uri; readonly right: Uri; readonly title: string }
	| { readonly kind: 'file'; readonly uri: Uri; readonly title: string }
	| { readonly kind: 'changes'; readonly title: string; readonly resources: readonly ChangeResource[] };

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

/** The file an editor shows: in Git's diffs, a revision of it is a `git:` URI naming the file. */
export function filePathOf(uri: Uri | undefined): string | undefined {
	if (uri?.scheme === 'file') {
		return uri.fsPath;
	}
	if (uri?.scheme === 'git') {
		try {
			const file = (JSON.parse(uri.query) as { path?: unknown }).path;
			return typeof file === 'string' ? file : undefined;
		} catch {
			return undefined;
		}
	}
	return undefined;
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

interface SavedResource {
	readonly label: string;
	readonly original?: string;
	readonly modified?: string;
}

/** A request as plain data, for the extension's storage. */
export type SavedRequest =
	| { readonly kind: 'diff'; readonly left: string; readonly right: string; readonly title: string }
	| { readonly kind: 'file'; readonly uri: string; readonly title: string }
	| { readonly kind: 'changes'; readonly title: string; readonly resources: readonly SavedResource[] };

export function saveRequest(req: OpenRequest): SavedRequest {
	switch (req.kind) {
		case 'diff':
			return { kind: 'diff', left: req.left.toString(), right: req.right.toString(), title: req.title };
		case 'file':
			return { kind: 'file', uri: req.uri.toString(), title: req.title };
		case 'changes':
			return {
				kind: 'changes',
				title: req.title,
				resources: req.resources.map(r => ({ label: r.label.toString(), original: r.original?.toString(), modified: r.modified?.toString() })),
			};
	}
}

/** The request `saveRequest` made `saved` from; undefined for anything else. */
export function restoreRequest(saved: unknown, parse: (value: string) => Uri): OpenRequest | undefined {
	const fields = (value: unknown) => (typeof value === 'object' && value !== null ? value as Record<string, unknown> : {});
	const text = (value: unknown): value is string => typeof value === 'string';
	const optional = (value: unknown) => (text(value) ? parse(value) : undefined);
	const s = fields(saved);
	if (!text(s.title)) {
		return undefined;
	}
	switch (s.kind) {
		case 'diff':
			return text(s.left) && text(s.right) ? { kind: 'diff', left: parse(s.left), right: parse(s.right), title: s.title } : undefined;
		case 'file':
			return text(s.uri) ? { kind: 'file', uri: parse(s.uri), title: s.title } : undefined;
		case 'changes': {
			const resources = Array.isArray(s.resources) ? s.resources.map(fields) : [];
			const valid = resources.length > 0 && resources.every(r => text(r.label) && [r.original, r.modified].every(u => u === undefined || text(u)));
			return valid
				? { kind: 'changes', title: s.title, resources: resources.map(r => ({ label: parse(r.label as string), original: optional(r.original), modified: optional(r.modified) })) }
				: undefined;
		}
	}
	return undefined;
}

/** Whether `uri` is one of the documents shown for `req`. */
export function showsDocument(req: OpenRequest | undefined, uri: Uri | undefined): boolean {
	if (!req || !uri) {
		return false;
	}
	const key = uri.toString();
	const same = (candidate: Uri | undefined) => candidate?.toString() === key;
	switch (req.kind) {
		case 'diff':
			return same(req.left) || same(req.right);
		case 'file':
			return same(req.uri);
		case 'changes':
			return req.resources.some(r => same(r.label) || same(r.original) || same(r.modified));
	}
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
