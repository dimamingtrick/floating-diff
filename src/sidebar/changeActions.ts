import * as vscode from 'vscode';
import type { DiffWindow } from '../diffWindow';
import { API, Repository, RepositoryOperations, Status } from '../git';
import { indexRenameOf } from '../gitChanges';
import { ChangeDeps, ChangeResource, fromChange } from '../openRequest';
import type { GitInternals, GitRepository } from '../scmRedirect';
import type { ChangeGroupKind, ChangeRow } from './sidebarModel';

type Repo = Repository & RepositoryOperations;

/** Where Git keeps each group in its own model. */
const GIT_GROUPS: Record<ChangeGroupKind, keyof GitRepository> = {
	merge: 'mergeGroup',
	index: 'indexGroup',
	workingTree: 'workingTreeGroup',
	untracked: 'untrackedGroup',
};

const DELETED = new Set([Status.INDEX_DELETED, Status.DELETED]);

const paths = (rows: readonly ChangeRow[]) => rows.map(row => row.change.uri.fsPath);

/** The question Git asks before discarding, for when its own command is out of reach. */
async function confirmDiscard(rows: readonly ChangeRow[]): Promise<boolean> {
	const [first] = rows;
	const untracked = rows.every(row => row.change.status === Status.UNTRACKED);
	const message =
		rows.length > 1
			? `Are you sure you want to discard changes in ${rows.length} files?\n\nThis is IRREVERSIBLE!\nYour current working set will be FOREVER LOST if you proceed.`
			: untracked
				? `Are you sure you want to DELETE "${first.name}"?\nThis is IRREVERSIBLE!\nThis file will be FOREVER LOST if you proceed.`
				: `Are you sure you want to discard changes in "${first.name}"?`;
	const action = rows.length > 1 ? `Discard ${rows.length} Files` : untracked ? 'Delete File' : 'Discard File';
	return (await vscode.window.showWarningMessage(message, { modal: true }, action)) === action;
}

/**
 * What Source Control does with uncommitted files. Staging, unstaging,
 * discarding and friends run Git's own Source Control commands on Git's own
 * resources, so they ask and behave exactly like there; when those are out of
 * reach (a future Git extension), the public API does the same work.
 */
export class ChangeActions {
	constructor(
		private readonly api: API,
		private readonly diffWindow: DiffWindow,
		private readonly scm: GitInternals | undefined,
	) { }

	/** Git's own Source Control resource for a file, which its commands require; undefined without Git's internals. */
	gitResource(repository: Repo, row: ChangeRow): object | undefined {
		const root = repository.rootUri.toString();
		const internal = this.scm?.repositories.find(candidate => candidate.root !== undefined && vscode.Uri.file(candidate.root).toString() === root);
		const group = internal?.[GIT_GROUPS[row.group]] as { resourceStates?: readonly object[] } | undefined;
		const uri = row.change.uri.toString();
		return group?.resourceStates?.find(state => (state as { resourceUri?: vscode.Uri }).resourceUri?.toString() === uri);
	}

	/** Runs a Source Control command of Git on its resources for `rows`, else `fallback`. */
	private async runGit(repository: Repo, command: string, rows: readonly ChangeRow[], fallback: () => Promise<unknown>): Promise<void> {
		if (rows.length === 0) {
			return;
		}
		const resources = rows.map(row => this.gitResource(repository, row));
		if (resources.every(resource => resource !== undefined)) {
			await vscode.commands.executeCommand(command, ...resources);
		} else {
			await fallback();
		}
	}

	stage(repository: Repo, rows: readonly ChangeRow[]): Promise<void> {
		const unstaged = rows.filter(row => row.group !== 'index');
		return this.runGit(repository, 'git.stage', unstaged, () => repository.add(paths(unstaged)));
	}

	unstage(repository: Repo, rows: readonly ChangeRow[]): Promise<void> {
		const staged = rows.filter(row => row.group === 'index');
		return this.runGit(repository, 'git.unstage', staged, () => repository.revert(paths(staged)));
	}

	discard(repository: Repo, rows: readonly ChangeRow[]): Promise<void> {
		const changed = rows.filter(row => row.group === 'workingTree' || row.group === 'untracked');
		return this.runGit(repository, 'git.clean', changed, async () => {
			if (await confirmDiscard(changed)) {
				await repository.clean(paths(changed));
			}
		});
	}

	ignore(repository: Repo, rows: readonly ChangeRow[]): Promise<void> {
		return this.runGit(repository, 'git.ignore', rows.filter(row => row.group !== 'index'), async () => undefined);
	}

	openFiles(repository: Repo, rows: readonly ChangeRow[]): Promise<void> {
		return this.runGit(repository, 'git.openFile', rows, async () => {
			for (const row of rows.filter(candidate => !DELETED.has(candidate.change.status))) {
				await vscode.window.showTextDocument(row.change.uri, { preview: false });
			}
		});
	}

	async reveal(rows: readonly ChangeRow[]): Promise<void> {
		if (rows.length > 0) {
			await vscode.commands.executeCommand('revealInExplorer', rows[0].change.uri);
		}
	}

	/** Like Source Control's "+" on a group; Git picks what "all" means from its settings. */
	async stageAll(repository: Repo, group: ChangeGroupKind): Promise<void> {
		const command = { merge: 'git.stageAllMerge', untracked: 'git.stageAllUntracked', index: undefined, workingTree: this.mixed(repository) ? 'git.stageAll' : 'git.stageAllTracked' }[group];
		if (command) {
			await vscode.commands.executeCommand(command, repository);
		}
	}

	async unstageAll(repository: Repo): Promise<void> {
		await vscode.commands.executeCommand('git.unstageAll', repository);
	}

	async discardAll(repository: Repo, group: ChangeGroupKind): Promise<void> {
		const command = { untracked: 'git.cleanAllUntracked', workingTree: this.mixed(repository) ? 'git.cleanAll' : 'git.cleanAllTracked', merge: undefined, index: undefined }[group];
		if (command) {
			await vscode.commands.executeCommand(command, repository);
		}
	}

	/** Whether Source Control lists untracked files together with the other changes. */
	private mixed(repository: Repo): boolean {
		return vscode.workspace.getConfiguration('git', repository.rootUri).get<string>('untrackedChanges', 'mixed') === 'mixed';
	}

	private deps(repository: Repo): ChangeDeps {
		return { toGitUri: (uri, ref) => this.api.toGitUri(uri, ref), indexRenameOf: uri => indexRenameOf(repository, uri) };
	}

	/** A click: the diff in the floating window; several selected files as one multi-file diff. */
	async open(repository: Repo, rows: readonly ChangeRow[]): Promise<void> {
		if (rows.length > 1) {
			return this.view(repository, 'Changes', rows);
		}
		const [row] = rows;
		if (!row) {
			return;
		}
		const req = fromChange(row.change, this.deps(repository));
		if (req) {
			await this.diffWindow.show(req);
			return;
		}
		// A merge conflict: whatever Git does on click (the merge editor or the file).
		const git = (this.gitResource(repository, row) as { command?: vscode.Command } | undefined)?.command;
		if (git) {
			await vscode.commands.executeCommand(git.command, ...(git.arguments ?? []));
		} else {
			await vscode.commands.executeCommand('vscode.open', row.change.uri);
		}
	}

	/** Several files as one multi-file diff in the floating window. */
	async view(repository: Repo, title: string, rows: readonly ChangeRow[]): Promise<void> {
		const deps = this.deps(repository);
		const resources = rows.flatMap((row): ChangeResource[] => {
			const req = fromChange(row.change, deps);
			if (req?.kind === 'diff') {
				return [{ label: row.change.uri, original: req.left, modified: req.right }];
			}
			if (req?.kind === 'file') {
				const deleted = DELETED.has(row.change.status);
				return [{ label: row.change.uri, original: deleted ? req.uri : undefined, modified: deleted ? undefined : req.uri }];
			}
			return [];
		});
		if (resources.length > 0) {
			await this.diffWindow.show({ kind: 'changes', title, resources });
		}
	}
}
