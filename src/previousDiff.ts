import * as path from 'path';
import * as vscode from 'vscode';
import { createGitRunner } from './branches/gitRunner';
import { GitData } from './data/gitData';
import { FileRevision, revisionTitle, stepBack } from './data/revisions';
import type { DiffWindow } from './diffWindow';
import type { API } from './git';
import { filePathOf, OpenRequest } from './openRequest';

/** The commit a `git:` URI shows, when it is one commit rather than the index or HEAD. */
function refOf(uri: vscode.Uri | undefined): string | undefined {
	if (uri?.scheme !== 'git') {
		return undefined;
	}
	try {
		const ref = (JSON.parse(uri.query) as { ref?: unknown }).ref;
		return typeof ref === 'string' && /^[0-9a-f]{40}$/.test(ref) ? ref : undefined;
	} catch {
		return undefined;
	}
}

async function exists(uri: vscode.Uri): Promise<boolean> {
	try {
		await vscode.workspace.fs.stat(uri);
		return true;
	} catch {
		return false;
	}
}

/**
 * WebStorm's Compare with Previous Version: the newest commit of the file
 * against the working tree, and, clicked again in that diff, the commit before
 * it against it, step by step back through the file's history.
 */
export async function diffWithPrevious(api: API, diffWindow: DiffWindow, resource?: unknown): Promise<void> {
	const shown = vscode.window.tabGroups.activeTabGroup.activeTab?.input;
	const diff = shown instanceof vscode.TabInputTextDiff ? shown : undefined;
	const asked = resource instanceof vscode.Uri ? filePathOf(resource) : undefined;
	// The button in a diff of this file steps back; anywhere else it starts at the working tree.
	const stepping = diff && (!asked || filePathOf(diff.modified) === asked);
	const file = (stepping ? filePathOf(diff.original) : undefined) ?? asked ?? filePathOf(vscode.window.activeTextEditor?.document.uri);
	const repository = file && api.getRepository(vscode.Uri.file(file));
	if (!file || !repository) {
		void vscode.window.showInformationMessage('Git Convenient: open a file of a Git repository to compare it with its previous revision.');
		return;
	}
	const root = repository.rootUri;
	const relative = path.relative(root.fsPath, file).split(path.sep).join('/');
	const ref = stepping ? refOf(diff.original) : undefined;
	const data = new GitData(createGitRunner(api.git.path, root.fsPath));
	const step = stepBack(await data.fileRevisions(relative, { ref }), ref);
	if (!step) {
		const name = path.posix.basename(relative);
		void vscode.window.showInformationMessage(ref ? `Git Convenient: ${ref.slice(0, 7)} is the first commit of ${name}.` : `Git Convenient: git has no commit of ${name} yet.`);
		return;
	}
	const { older, newer } = step;
	const at = (revision: FileRevision) => api.toGitUri(vscode.Uri.joinPath(root, revision.path), revision.hash);
	const title = revisionTitle(path.posix.basename((newer ?? older).path), older, newer);
	const right = newer ? at(newer) : vscode.Uri.joinPath(root, older.path);
	// A file the working tree no longer has: its last committed version, alone.
	const request: OpenRequest = newer || (await exists(right)) ? { kind: 'diff', left: at(older), right, title } : { kind: 'file', uri: at(older), title };
	await diffWindow.show(request);
}
