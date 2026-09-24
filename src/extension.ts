import * as path from 'path';
import * as vscode from 'vscode';
import { LineBlame } from './blame/lineBlame';
import { runBranchCommand } from './branches/branchCommands';
import { BranchesPopup } from './branches/branchesPopup';
import { GitPanel } from './branches/gitPanel';
import { DiffWindow } from './diffWindow';
import type { FileChange } from './data/parse';
import type { API, GitExtension } from './git';
import { ExplorerPanel, pickBranchToBrowse } from './explorer/explorerPanel';
import { getGitApi } from './gitApi';
import { LogPanel } from './log/logPanel';
import { filePathOf, fromScmCommand } from './openRequest';
import { pickChange } from './pickChange';
import { diffWithPrevious } from './previousDiff';
import { createRepoContext, pickRepository, RepoContext } from './repoContext';
import { Sidebar } from './sidebar/sidebar';
import { GitInternals, ScmOpenRedirect } from './scmRedirect';
import { Bounds, MacWindowBoundsReader, WindowSizeMemory } from './windowBounds';

const BOUNDS_KEY = 'gitConvenient.windowBounds';
const OPEN_SCM_RESOURCE = 'gitConvenient.openScmResource';

/** What `activate` returns; the integration tests reach the sidebar through it. */
export interface GitConvenientExports {
	readonly sidebar?: Sidebar;
	readonly git?: GitPanel;
	readonly blame?: LineBlame;
}

export async function activate(context: vscode.ExtensionContext): Promise<GitConvenientExports> {
	const log = vscode.window.createOutputChannel('Git Convenient', { log: true });
	context.subscriptions.push(log);
	const diffWindow = new DiffWindow({
		sizeMemory: createSizeMemory(context, log),
		log: message => log.info(message),
		state: context.workspaceState,
	});
	let redirect: ScmOpenRedirect | undefined;
	let api: API | undefined;
	let sidebar: Sidebar | undefined;
	let gitPanel: GitPanel | undefined;
	let blame: LineBlame | undefined;
	context.subscriptions.push(
		diffWindow,
		// Runs for the window icon and, through the redirect, for clicks on Source Control files.
		vscode.commands.registerCommand(OPEN_SCM_RESOURCE, async (state?: vscode.SourceControlResourceState) => {
			if (!state) {
				return;
			}
			const command = redirect ? redirect.originalCommand(state) : state.command;
			const req = fromScmCommand(command);
			if (req) {
				await diffWindow.show(req);
			} else if (command) {
				// e.g. the merge editor: keep the regular click behavior
				await vscode.commands.executeCommand(command.command, ...(command.arguments ?? []));
			}
		}),
		vscode.commands.registerCommand('gitConvenient.pickChange', () => pickChange(diffWindow)),
		vscode.commands.registerCommand('gitConvenient.close', () => diffWindow.dismiss()),
		// Menus pass their own arguments (e.g. a URI): only strings are a branch and a repository root.
		vscode.commands.registerCommand('gitConvenient.branches', async (branch?: unknown, root?: unknown) => {
			const ctx = await repoContext(root);
			if (ctx) {
				await branchesPopup(ctx).show(typeof branch === 'string' ? branch : undefined);
			}
		}),
		// The log in the Git panel at the bottom, like WebStorm; in an editor tab on request.
		vscode.commands.registerCommand('gitConvenient.log', async (branch?: unknown, root?: unknown) => {
			await gitPanel?.show({ branch: typeof branch === 'string' ? branch : undefined, root: typeof root === 'string' ? root : undefined });
			return gitPanel;
		}),
		// The button in an editor's title: the history of its file in the Git panel, on the branch picked there.
		vscode.commands.registerCommand('gitConvenient.fileHistory', async (resource?: unknown) => {
			const file = fileOf(resource instanceof vscode.Uri ? resource : vscode.window.activeTextEditor?.document.uri);
			const repository = file && api?.getRepository(file);
			if (!file || !repository) {
				void vscode.window.showInformationMessage('Git Convenient: open a file of a Git repository to see its history.');
				return undefined;
			}
			const relative = path.relative(repository.rootUri.fsPath, file.fsPath).split(path.sep).join('/');
			await gitPanel?.show({ root: repository.rootUri.fsPath, paths: [relative] });
			return gitPanel;
		}),
		// The button left of File History: this file against its newest commit, then one commit further back each click.
		vscode.commands.registerCommand('gitConvenient.diffWithPrevious', (resource?: unknown) =>
			api ? diffWithPrevious(api, diffWindow, resource) : vscode.window.showInformationMessage('Git Convenient: no Git repository is open.'),
		),
		// The branch context menu of the Branches panel: WebStorm's actions, on a branch that need not be checked out.
		...(['pull', 'checkout', 'merge', 'rebase', 'newBranch'] as const).map(name =>
			vscode.commands.registerCommand(`gitConvenient.branch.${name}`, async (context?: { branch?: string; root?: string }) => {
				const branch = typeof context?.branch === 'string' ? context.branch : undefined;
				const ctx = branch ? await repoContext(context?.root) : undefined;
				return ctx && branch ? runBranchCommand(ctx, name, branch) : undefined;
			}),
		),
		// The file context menu of a commit's files: the path as the repository writes it, and the file itself.
		vscode.commands.registerCommand('gitConvenient.file.copyPath', async (context?: { path?: string }) => {
			if (context?.path) {
				await vscode.env.clipboard.writeText(context.path);
				vscode.window.setStatusBarMessage(`Git Convenient: copied ${context.path}`, 2000);
			}
		}),
		vscode.commands.registerCommand('gitConvenient.file.open', (context?: { webview?: string; hash?: string; file?: FileChange }) => {
			const session = context?.webview === 'gitConvenient.log' ? LogPanel.currentSession : gitPanel?.session;
			return session && context?.hash && context.file ? session.handle({ type: 'openSource', hash: context.hash, file: context.file }) : undefined;
		}),
		// The commit context menu of the logs: the webview says which one, the row which commit.
		...(['openDiff', 'copyHash', 'cherryPick', 'checkout', 'merge', 'rebase', 'revert', 'newBranch'] as const).map(name =>
			vscode.commands.registerCommand(`gitConvenient.commit.${name}`, (context?: { webview?: string; hash?: string }) => {
				const session = context?.webview === 'gitConvenient.log' ? LogPanel.currentSession : gitPanel?.session;
				if (!session || !context?.hash) {
					return undefined;
				}
				return session.handle(name === 'openDiff' ? { type: 'openCommit', hash: context.hash } : { type: 'action', action: name, hash: context.hash });
			}),
		),
		vscode.commands.registerCommand('gitConvenient.logInEditor', async (branch?: unknown, root?: unknown) => {
			const ctx = await repoContext(root);
			return ctx && LogPanel.show(context.extensionUri, ctx, diffWindow, typeof branch === 'string' ? { branch } : undefined);
		}),
		// Fetch in the panel titles, Pull and Push next to File History in an editor's title.
		...(['fetch', 'pull', 'push'] as const).map(action =>
			vscode.commands.registerCommand(`gitConvenient.${action}`, (target?: unknown) =>
				sidebar ? sidebar.sync(action, rootOf(target)) : vscode.window.showInformationMessage('Git Convenient: no Git repository is open.'),
			),
		),
		vscode.commands.registerCommand('gitConvenient.browseBranch', async (branch?: unknown, root?: unknown) => {
			const ctx = await repoContext(root);
			const name = ctx && (typeof branch === 'string' ? branch : await pickBranchToBrowse(ctx));
			return ctx && name ? ExplorerPanel.show(context.extensionUri, ctx, diffWindow, name) : undefined;
		}),
	);

	/** What a menu passed: the Git panel a repository root, an editor's title the file it shows. */
	function rootOf(target: unknown): string | undefined {
		if (typeof target === 'string') {
			return target;
		}
		const file = target instanceof vscode.Uri ? fileOf(target) : undefined;
		return file ? api?.getRepository(file)?.rootUri.fsPath : undefined;
	}

	/** The repository of `root`, else of the active file, else the only one, else the one the user picks. */
	async function repoContext(root?: unknown): Promise<RepoContext | undefined> {
		const repository = api && (await pickRepository(api, typeof root === 'string' ? root : undefined));
		if (!api || !repository) {
			if (!api || api.repositories.length === 0) {
				void vscode.window.showInformationMessage('Git Convenient: no Git repository is open.');
			}
			return undefined;
		}
		return createRepoContext(api, repository);
	}

	function branchesPopup(ctx: RepoContext): BranchesPopup {
		return new BranchesPopup(ctx.branches, diffWindow, branch => vscode.commands.executeCommand('gitConvenient.browseBranch', branch.name));
	}
	api = await getGitApi();
	const scm = await gitInternals();
	if (api) {
		setUpLogLink(context, api);
		sidebar = new Sidebar(context.extensionUri, api, diffWindow, scm, context.workspaceState);
		gitPanel = new GitPanel(context.extensionUri, api, diffWindow);
		blame = new LineBlame(api, diffWindow);
		context.subscriptions.push(sidebar, gitPanel, blame);
		if (scm) {
			redirect = setUpScmRedirect(context, log, scm, api);
		}
	}
	if (!scm) {
		log.warn('The Git extension internals are unavailable: Source Control clicks open tabs, and Changes stages through the Git API.');
	}
	return { sidebar, git: gitPanel, blame };
}

/** The file an editor shows, as a URI of the working tree copy. */
function fileOf(uri: vscode.Uri | undefined): vscode.Uri | undefined {
	const file = filePathOf(uri);
	return file ? vscode.Uri.file(file) : undefined;
}

/** The Git extension's own model (not API); Source Control clicks and the Changes view use it. */
async function gitInternals(): Promise<GitInternals | undefined> {
	const extension = vscode.extensions.getExtension<GitExtension>('vscode.git');
	const git = extension && (extension.isActive ? extension.exports : await extension.activate());
	const model = git?.model as GitInternals | undefined;
	return git?.enabled && Array.isArray(model?.repositories) ? model : undefined;
}

/** `Git Log` on the right of the status bar while a repository is open. */
function setUpLogLink(context: vscode.ExtensionContext, api: API): void {
	const logLink = vscode.window.createStatusBarItem('gitConvenient.log', vscode.StatusBarAlignment.Right, 100);
	logLink.name = 'Git Convenient: Git Log';
	logLink.text = '$(history) Git Log';
	logLink.tooltip = 'Open the Git Log';
	logLink.command = 'gitConvenient.log';
	const update = () => {
		if (api.repositories.length > 0) {
			logLink.show();
		} else {
			logLink.hide();
		}
	};
	context.subscriptions.push(logLink, api.onDidOpenRepository(update), api.onDidCloseRepository(update));
	update();
}

/**
 * Reading window bounds uses macOS CoreGraphics, which needs no permissions.
 * The extension host's parent process owns all windows of this VS Code instance.
 */
function createSizeMemory(context: vscode.ExtensionContext, log: vscode.LogOutputChannel): WindowSizeMemory | undefined {
	if (process.platform !== 'darwin') {
		return undefined;
	}
	const reader = new MacWindowBoundsReader(process.ppid);
	context.subscriptions.push({ dispose: () => reader.dispose() });
	return new WindowSizeMemory(
		reader,
		{
			get: () => context.globalState.get<Bounds>(BOUNDS_KEY),
			set: bounds => context.globalState.update(BOUNDS_KEY, bounds),
		},
		error => log.warn(`Window size: ${error instanceof Error ? error.message : String(error)}`),
	);
}

/** Makes clicks on Source Control files behave like the window icon (see ScmOpenRedirect). */
function setUpScmRedirect(context: vscode.ExtensionContext, log: vscode.LogOutputChannel, model: GitInternals, api: API): ScmOpenRedirect {
	const redirect = new ScmOpenRedirect(model, { commandId: OPEN_SCM_RESOURCE, log: message => log.info(message) });
	const enabled = () => vscode.workspace.getConfiguration('gitConvenient').get<boolean>('openFromSourceControl', false);
	// Git lists its files a moment after startup: retry on every change until installed.
	const apply = () => void redirect.setEnabled(enabled());
	context.subscriptions.push(
		vscode.workspace.onDidChangeConfiguration(e => {
			if (e.affectsConfiguration('gitConvenient.openFromSourceControl')) {
				apply();
			}
		}),
		...api.repositories.map(repository => repository.state.onDidChange(apply)),
		api.onDidOpenRepository(repository => context.subscriptions.push(repository.state.onDidChange(apply))),
		// Give Source Control its own commands back when the extension goes away.
		{ dispose: () => void redirect.setEnabled(false) },
	);
	apply();
	return redirect;
}

export function deactivate(): void {}
