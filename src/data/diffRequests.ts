import * as path from 'path';
import * as vscode from 'vscode';
import type { ChangeResource, OpenRequest } from '../openRequest';
import type { FileChange } from './parse';

type ToGitUri = (uri: vscode.Uri, ref: string) => vscode.Uri;

/**
 * Diffs of files between two revisions, for the floating window. `from` is
 * missing for a root commit (every file is new).
 */
export class RevisionDiffs {
	constructor(private readonly root: vscode.Uri, private readonly toGitUri: ToGitUri) { }

	private sides(file: FileChange, from: string | undefined, to: string): { left?: vscode.Uri; right?: vscode.Uri } {
		const at = (relative: string) => vscode.Uri.joinPath(this.root, relative);
		return {
			left: from && file.status !== 'A' ? this.toGitUri(at(file.oldPath ?? file.path), from) : undefined,
			right: file.status === 'D' ? undefined : this.toGitUri(at(file.path), to),
		};
	}

	file(file: FileChange, from: string | undefined, to: string, label: string): OpenRequest {
		const { left, right } = this.sides(file, from, to);
		const title = `${path.posix.basename(file.path)} (${label})`;
		if (left && right) {
			return { kind: 'diff', left, right, title };
		}
		return { kind: 'file', uri: (right ?? left)!, title };
	}

	/** A file as `ref` has it, read-only: an editor opens it when the working tree has no copy. */
	revision(relative: string, ref: string): vscode.Uri {
		return this.toGitUri(vscode.Uri.joinPath(this.root, relative), ref);
	}

	/** `ref`'s version of a file against its working tree copy, or alone when there is no copy. */
	withWorkingTree(relative: string, ref: string, hasCopy: boolean): OpenRequest {
		const working = vscode.Uri.joinPath(this.root, relative);
		const theirs = this.toGitUri(working, ref);
		const name = path.posix.basename(relative);
		return hasCopy
			? { kind: 'diff', left: theirs, right: working, title: `${name} (${ref} ↔ working tree)` }
			: { kind: 'file', uri: theirs, title: `${name} (${ref})` };
	}

	files(files: readonly FileChange[], from: string | undefined, to: string, title: string): OpenRequest | undefined {
		if (files.length === 0) {
			return undefined;
		}
		const resources = files.map((file): ChangeResource => {
			const { left, right } = this.sides(file, from, to);
			return { label: vscode.Uri.joinPath(this.root, file.path), original: left, modified: right };
		});
		return { kind: 'changes', title, resources };
	}
}
