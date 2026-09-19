import * as path from 'path';
import * as vscode from 'vscode';
import { BranchService } from './branches/branchService';
import { createGitRunner, GitRunner } from './branches/gitRunner';
import { RevisionDiffs } from './data/diffRequests';
import { GitData } from './data/gitData';
import type { API, Repository, RepositoryOperations } from './git';

/** Everything the GitStorm screens need about one repository. */
export interface RepoContext {
	readonly repository: Repository & RepositoryOperations;
	readonly git: GitRunner;
	readonly data: GitData;
	readonly diffs: RevisionDiffs;
	readonly branches: BranchService;
}

/**
 * The repository of the active editor's file; without one, the repository of a
 * workspace folder (not one nested in it), else the first.
 */
export function activeRepository(api: API): (Repository & RepositoryOperations) | undefined {
	const uri = vscode.window.activeTextEditor?.document.uri;
	const folders = new Set((vscode.workspace.workspaceFolders ?? []).map(folder => folder.uri.fsPath));
	const repository =
		(uri && api.getRepository(uri)) || api.repositories.find(candidate => folders.has(candidate.rootUri.fsPath)) || api.repositories[0];
	// Every repository the Git API hands out has the operations.
	return repository as (Repository & RepositoryOperations) | undefined;
}

/**
 * The repository a command works on, the way Git's own commands choose:
 * `root` when given, else the active file's, else the only one, else the user picks.
 */
export async function pickRepository(api: API, root?: string): Promise<(Repository & RepositoryOperations) | undefined> {
	const repositories = api.repositories as (Repository & RepositoryOperations)[];
	if (root) {
		return repositories.find(repository => repository.rootUri.fsPath === root);
	}
	const uri = vscode.window.activeTextEditor?.document.uri;
	const active = uri && api.getRepository(uri);
	if (active || repositories.length <= 1) {
		return active || repositories[0];
	}
	const picked = await vscode.window.showQuickPick(
		repositories.map(repository => ({ label: path.basename(repository.rootUri.fsPath), description: repository.rootUri.fsPath, repository })),
		{ placeHolder: 'Choose a repository' },
	);
	return picked?.repository;
}

export function createRepoContext(api: API, repository: Repository & RepositoryOperations): RepoContext {
	const git = createGitRunner(api.git.path, repository.rootUri.fsPath);
	const toGitUri = (uri: vscode.Uri, ref: string) => api.toGitUri(uri, ref);
	return {
		repository,
		git,
		data: new GitData(git),
		diffs: new RevisionDiffs(repository.rootUri, toGitUri),
		branches: new BranchService(repository, git, toGitUri),
	};
}
