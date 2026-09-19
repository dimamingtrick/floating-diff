import * as path from 'path';
import * as vscode from 'vscode';
import type { DiffWindow } from '../diffWindow';
import type { API, Repository, RepositoryOperations } from '../git';
import { LogSession } from '../log/logSession';
import { activeRepository, createRepoContext } from '../repoContext';
import { reportError } from '../report';
import type { GitBranchItem, GitPanelBranches, GitPanelFromWebview, GitPanelToWebview, LogFilters } from '../shared/protocol';
import { FileIconTheme } from '../sidebar/iconTheme';
import { WebviewChannel, webviewHtml, webviewOptions } from '../webview/host';
import { BranchInfo, localName, syncLabel } from './branchModel';

type Repo = Repository & RepositoryOperations;

/** Branches WebStorm stars by default. */
const FAVORITES = new Set(['main', 'master']);

/**
 * The Git panel at the bottom, like WebStorm's Git tool window: branches of a
 * repository as a tree on the left, the log of the selected branch in the
 * middle, the files and details of the selected commit on the right.
 * `⑂ Branches` in the status bar opens and closes it.
 */
export class GitPanel implements vscode.WebviewViewProvider, vscode.Disposable {
	static readonly viewId = 'gitStorm.branchesPanel';

	/** Set while the view is open. */
	channel: WebviewChannel<GitPanelFromWebview, GitPanelToWebview> | undefined;
	/** The log the panel shows. */
	session: LogSession | undefined;
	private view: vscode.WebviewView | undefined;
	private readonly item = vscode.window.createStatusBarItem('gitStorm.branches', vscode.StatusBarAlignment.Left, 0.5);
	private readonly icons = new FileIconTheme();
	private readonly subscriptions: vscode.Disposable[] = [];
	private readonly listeners = new Map<string, vscode.Disposable>();
	/** The repository picked in the panel or passed to `show`; else the active file's. */
	private picked: string | undefined;
	private pendingFilters: LogFilters | undefined;
	private branchesTimer: ReturnType<typeof setTimeout> | undefined;
	private last: GitPanelBranches | undefined;

	constructor(
		private readonly extensionUri: vscode.Uri,
		private readonly api: API,
		private readonly diffWindow: DiffWindow,
	) {
		this.item.name = 'GitStorm: Branches';
		this.item.text = '$(git-branch) Branches';
		this.item.tooltip = 'Show or hide branches and the log';
		this.item.command = 'gitStorm.toggleBranches';
		this.subscriptions.push(
			this.item,
			this.icons,
			vscode.window.registerWebviewViewProvider(GitPanel.viewId, this, { webviewOptions: { retainContextWhenHidden: true } }),
			vscode.commands.registerCommand('gitStorm.toggleBranches', () => this.toggle()),
			// A panel restored at startup opens before Git has found the repositories.
			api.onDidChangeState(() => this.startSession()),
			api.onDidOpenRepository(repository => this.watch(repository)),
			api.onDidCloseRepository(repository => {
				this.listeners.get(repository.rootUri.fsPath)?.dispose();
				this.listeners.delete(repository.rootUri.fsPath);
				this.updateItem();
				this.scheduleBranches();
			}),
			this.icons.onDidChange(() => {
				this.allowIconFiles();
				this.postIconFonts();
			}),
		);
		api.repositories.forEach(repository => this.watch(repository));
		this.updateItem();
	}

	/** The branches the panel shows now (tests read them). */
	snapshot(): GitPanelBranches | undefined {
		return this.last;
	}

	get visible(): boolean {
		return this.view?.visible === true;
	}

	/** Like the terminal's toggle: shows the panel, or closes it. */
	async toggle(): Promise<void> {
		if (this.visible) {
			await vscode.commands.executeCommand('workbench.action.closePanel');
		} else {
			await vscode.commands.executeCommand(`${GitPanel.viewId}.focus`);
		}
	}

	/** Shows the panel on a repository, with the log of one branch if given (the Git Log command). */
	async show(options: { readonly root?: string; readonly branch?: string } = {}): Promise<void> {
		if (options.root) {
			this.picked = options.root;
		}
		if (options.branch) {
			this.pendingFilters = { ...(this.session?.filters ?? {}), branch: options.branch };
		}
		await vscode.commands.executeCommand(`${GitPanel.viewId}.focus`);
		this.startSession();
	}

	resolveWebviewView(view: vscode.WebviewView): void {
		this.view = view;
		this.allowIconFiles();
		view.webview.html = webviewHtml(view.webview, this.extensionUri, 'git', 'Git');
		const channel = new WebviewChannel<GitPanelFromWebview, GitPanelToWebview>(view.webview, message => this.handle(message), reportError);
		this.channel?.dispose();
		this.channel = channel;
		view.onDidChangeVisibility(() => {
			if (view.visible) {
				this.scheduleBranches();
			}
		});
		view.onDidDispose(() => {
			if (this.view === view) {
				this.view = undefined;
				this.channel = undefined;
				this.session?.dispose();
				this.session = undefined;
			}
			channel.dispose();
		});
		this.postIconFonts();
		this.startSession();
	}

	async handle(message: GitPanelFromWebview): Promise<void> {
		const root = this.session?.ctx.repository.rootUri.fsPath;
		switch (message.type) {
			case 'pickRepo':
				this.picked = message.root;
				this.startSession();
				return;
			case 'browse':
				await vscode.commands.executeCommand('gitStorm.browseBranch', message.branch, root);
				return;
			case 'branchActions':
				await vscode.commands.executeCommand('gitStorm.branches', message.branch, root);
				return;
			default:
				await this.session?.handle(message);
				this.updateTitle();
		}
	}

	private repository(): Repo | undefined {
		const repositories = this.api.repositories as Repo[];
		return repositories.find(candidate => candidate.rootUri.fsPath === this.picked) ?? activeRepository(this.api);
	}

	/** A log for the repository to show; the same one keeps running, with new filters if any. */
	private startSession(): void {
		const channel = this.channel;
		if (!channel || this.api.state !== 'initialized') {
			return;
		}
		const repository = this.repository();
		if (!repository) {
			// Nothing to show: say so rather than loading forever.
			void channel.post({ type: 'branches', branches: { repos: [], local: [], remote: [], tags: [], remotes: [] } });
			return;
		}
		const filters = this.pendingFilters;
		this.pendingFilters = undefined;
		if (this.session && this.session.ctx.repository.rootUri.fsPath === repository.rootUri.fsPath) {
			if (filters) {
				void this.session.setFilters(filters).then(() => this.updateTitle());
			}
			return;
		}
		this.session?.dispose();
		this.session = new LogSession(createRepoContext(this.api, repository), this.diffWindow, message => channel.post(message), filters ?? {}, {
			fileIcon: name => (this.view ? this.icons.icon(name, this.view.webview) : undefined),
			containingBranches: true,
		});
		this.updateTitle();
		void this.refreshBranches();
	}

	/** "Log: main", like WebStorm's tab. */
	private updateTitle(): void {
		if (this.view) {
			this.view.description = this.session?.filters.branch ?? '';
		}
	}

	private watch(repository: Repository): void {
		const root = repository.rootUri.fsPath;
		if (this.listeners.has(root)) {
			return;
		}
		this.listeners.set(
			root,
			repository.state.onDidChange(() => {
				if (root === this.session?.ctx.repository.rootUri.fsPath) {
					this.scheduleBranches();
				}
			}),
		);
		this.updateItem();
		if (!this.session) {
			// The first repository of an open panel: show its log.
			this.startSession();
		}
		this.scheduleBranches();
	}

	private updateItem(): void {
		if (this.api.repositories.length > 0) {
			this.item.show();
		} else {
			this.item.hide();
		}
	}

	private scheduleBranches(): void {
		clearTimeout(this.branchesTimer);
		this.branchesTimer = setTimeout(() => void this.refreshBranches(), 400);
	}

	/** The branch tree of the shown repository; listing branches runs git, so only while visible. */
	private async refreshBranches(): Promise<void> {
		const channel = this.channel;
		const repository = this.session?.ctx.repository;
		if (!channel || !repository || !this.visible) {
			return;
		}
		try {
			const ctx = createRepoContext(this.api, repository);
			const [list, tags] = await Promise.all([ctx.branches.list(), ctx.data.tags()]);
			const item = (branch: BranchInfo): GitBranchItem => ({
				name: branch.name,
				current: branch.current,
				favorite: FAVORITES.has(localName(branch)),
				sync: syncLabel(branch),
			});
			const branches: GitPanelBranches = {
				repos: this.api.repositories.map(candidate => ({ root: candidate.rootUri.fsPath, name: path.basename(candidate.rootUri.fsPath) })),
				root: repository.rootUri.fsPath,
				local: list.branches.filter(branch => !branch.remote).map(item),
				remote: list.branches.filter(branch => branch.remote).map(item),
				tags,
				remotes: [...new Set(list.branches.flatMap(branch => (branch.remote ? [branch.remote] : [])))],
			};
			this.last = branches;
			await channel.post({ type: 'branches', branches });
		} catch (error) {
			void reportError(error);
		}
	}

	private allowIconFiles(): void {
		if (this.view) {
			this.view.webview.options = webviewOptions(this.extensionUri, this.icons.root ? [this.icons.root] : []);
		}
	}

	private postIconFonts(): void {
		if (this.view) {
			void this.channel?.post({ type: 'iconFonts', fonts: this.icons.fonts(this.view.webview) });
		}
	}

	dispose(): void {
		clearTimeout(this.branchesTimer);
		this.session?.dispose();
		this.listeners.forEach(listener => listener.dispose());
		this.subscriptions.forEach(subscription => subscription.dispose());
	}
}
