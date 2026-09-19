import * as path from 'path';
import * as vscode from 'vscode';
import type { DiffWindow } from '../diffWindow';
import type { API, Repository, RepositoryOperations } from '../git';
import { activeRepository, pickRepository } from '../repoContext';
import { reportError } from '../report';
import type { GitInternals } from '../scmRedirect';
import type { ChangeAction, ChangeRef, FolderIcons, GroupAction, SidebarFromWebview, SidebarRepo, SidebarState, SidebarToWebview } from '../shared/protocol';
import { WebviewChannel, webviewHtml, webviewOptions } from '../webview/host';
import { ChangeActions } from './changeActions';
import { FileIconTheme } from './iconTheme';
import { ChangeGroupKind, changeGroups, ChangeRow, changesBadge, CountSettings, repositoryCount, statusDecoration } from './sidebarModel';

type Repo = Repository & RepositoryOperations;
export type SyncAction = 'fetch' | 'pull' | 'push';
type FileAction = ChangeAction | 'ignore' | 'reveal';
type ViewMode = SidebarState['viewMode'];

const SYNC_TITLES: Record<SyncAction, string> = { fetch: 'Fetching', pull: 'Pulling', push: 'Pushing' };
const VIEW_MODE_KEY = 'gitStorm.changesViewMode';

/** What the webview's context menu passes to commands: the element's `data-vscode-context`. */
interface MenuContext {
	readonly webviewSection?: string;
	readonly root?: string;
	readonly gitStormGroup?: ChangeGroupKind;
	/** A file's path, or a folder's for `changeFolder`. */
	readonly path?: string;
}

const sameRef = (a: ChangeRef, b: ChangeRef) => a.root === b.root && a.group === b.group && a.path === b.path;

/**
 * The GitStorm view in the Activity Bar: for every repository, like Source
 * Control, its current branch, uncommitted files (as a list or a tree) and
 * commit box. Commit, fetch, pull, push and the actions on files run Git's
 * own commands, so they ask and behave like Source Control.
 */
export class Sidebar implements vscode.WebviewViewProvider, vscode.Disposable {
	static readonly viewId = 'gitStorm.sidebar';
	/**
	 * A view nobody sees (`when: false`) that carries the Activity Bar badge:
	 * a tree view has its badge from startup, a webview view only once opened.
	 */
	static readonly badgeViewId = 'gitStorm.badge';

	/** Set while the view is open. */
	channel: WebviewChannel<SidebarFromWebview, SidebarToWebview> | undefined;
	readonly actions: ChangeActions;
	readonly badgeView: vscode.TreeView<never>;
	private readonly icons = new FileIconTheme();
	private readonly repositories = new Map<string, { readonly repository: Repo; readonly listener: vscode.Disposable }>();
	private readonly subscriptions: vscode.Disposable[] = [];
	private view: vscode.WebviewView | undefined;
	private selection: readonly ChangeRef[] = [];
	private viewMode: ViewMode;
	private refreshTimer: ReturnType<typeof setTimeout> | undefined;
	private last: SidebarState | undefined;

	constructor(
		private readonly extensionUri: vscode.Uri,
		private readonly api: API,
		diffWindow: DiffWindow,
		scm: GitInternals | undefined,
		private readonly workspaceState: vscode.Memento,
	) {
		this.actions = new ChangeActions(api, diffWindow, scm);
		// A tree by default, like WebStorm's "Group by Directory", unless scm.defaultViewMode is set.
		const configured = vscode.workspace.getConfiguration('scm').inspect<ViewMode>('defaultViewMode');
		this.viewMode =
			workspaceState.get<ViewMode>(VIEW_MODE_KEY) ?? configured?.workspaceFolderValue ?? configured?.workspaceValue ?? configured?.globalValue ?? 'tree';
		this.badgeView = vscode.window.createTreeView<never>(Sidebar.badgeViewId, {
			treeDataProvider: { getChildren: () => [], getTreeItem: element => element },
		});
		const onFile = (action: FileAction) => (context?: MenuContext) => this.fromMenu(action, context);
		const onGroup = (action: GroupAction) => (context?: MenuContext) =>
			context?.root && context.gitStormGroup ? this.runGroup(action, context.root, context.gitStormGroup).catch(reportError) : undefined;
		const command = vscode.commands.registerCommand;
		this.subscriptions.push(
			this.badgeView,
			this.icons,
			vscode.window.registerWebviewViewProvider(Sidebar.viewId, this, { webviewOptions: { retainContextWhenHidden: true } }),
			command('gitStorm.changes.open', onFile('open')),
			command('gitStorm.changes.openFile', onFile('openFile')),
			command('gitStorm.changes.stage', onFile('stage')),
			command('gitStorm.changes.unstage', onFile('unstage')),
			command('gitStorm.changes.discard', onFile('discard')),
			command('gitStorm.changes.ignore', onFile('ignore')),
			command('gitStorm.changes.reveal', onFile('reveal')),
			command('gitStorm.changes.viewGroup', onGroup('view')),
			command('gitStorm.changes.stageAll', onGroup('stageAll')),
			command('gitStorm.changes.unstageAll', onGroup('unstageAll')),
			command('gitStorm.changes.discardAll', onGroup('discardAll')),
			command('gitStorm.changes.refresh', () => Promise.all([...this.repositories.values()].map(({ repository }) => repository.status()))),
			command('gitStorm.viewAsTree', () => this.setViewMode('tree')),
			command('gitStorm.viewAsList', () => this.setViewMode('list')),
			api.onDidOpenRepository(repository => this.add(repository)),
			api.onDidCloseRepository(repository => this.remove(repository)),
			// The focused repository counts for the badge with scm.countBadge = focused.
			vscode.window.onDidChangeActiveTextEditor(() => this.updateBadge()),
			this.icons.onDidChange(() => {
				this.allowIconFiles();
				this.schedule();
			}),
			vscode.workspace.onDidChangeConfiguration(e => {
				if (['git.countBadge', 'scm.countBadge', 'git.untrackedChanges'].some(key => e.affectsConfiguration(key))) {
					this.updateBadge();
				}
				if (e.affectsConfiguration('scm.compactFolders')) {
					this.schedule();
				}
			}),
		);
		void vscode.commands.executeCommand('setContext', 'gitStorm.scmResources', scm !== undefined);
		void vscode.commands.executeCommand('setContext', VIEW_MODE_KEY, this.viewMode);
		api.repositories.forEach(repository => this.add(repository));
		this.updateBadge();
	}

	/** The state the view shows now (tests read it). */
	snapshot(): SidebarState | undefined {
		return this.last;
	}

	resolveWebviewView(view: vscode.WebviewView): void {
		this.view = view;
		this.allowIconFiles();
		view.webview.html = webviewHtml(view.webview, this.extensionUri, 'sidebar', 'GitStorm');
		const channel = new WebviewChannel<SidebarFromWebview, SidebarToWebview>(view.webview, message => this.handle(message), reportError);
		this.channel?.dispose();
		this.channel = channel;
		view.onDidChangeVisibility(() => {
			if (view.visible) {
				this.schedule();
			}
		});
		view.onDidDispose(() => {
			if (this.view === view) {
				this.view = undefined;
				this.channel = undefined;
			}
			channel.dispose();
		});
		for (const { repository } of this.repositories.values()) {
			this.postDraft(repository);
		}
		void this.refresh();
	}

	async handle(message: SidebarFromWebview): Promise<void> {
		switch (message.type) {
			case 'change':
				return this.runFiles(message.action, message.items);
			case 'group':
				return this.runGroup(message.action, message.root, message.group);
			case 'select':
				this.selection = message.items;
				return;
			case 'commit':
				return this.commit(message.root, message.message, message.push);
			case 'draft': {
				const repository = this.repositories.get(message.root)?.repository;
				if (repository) {
					repository.inputBox.value = message.value;
				}
				return;
			}
			case 'sync':
				return this.sync(message.action, message.root);
			case 'switchBranch':
				await vscode.commands.executeCommand('gitStorm.branches', undefined, message.root);
				return;
		}
	}

	/** Git's own Fetch, Pull or Push (Push offers to publish a new branch); without `root`, like Git's commands pick one. */
	async sync(action: SyncAction, root?: string): Promise<void> {
		const repository = root ? this.repositories.get(root)?.repository : await pickRepository(this.api);
		if (!repository) {
			return;
		}
		this.busy(`${SYNC_TITLES[action]}…`);
		try {
			await vscode.commands.executeCommand(`git.${action}`, repository);
		} finally {
			this.busy(undefined);
		}
	}

	private async setViewMode(mode: ViewMode): Promise<void> {
		this.viewMode = mode;
		await this.workspaceState.update(VIEW_MODE_KEY, mode);
		await vscode.commands.executeCommand('setContext', VIEW_MODE_KEY, mode);
		await this.refresh();
	}

	/**
	 * A file menu command applies to the whole selection when the clicked file is
	 * part of it, like in Source Control; on a folder, to its files.
	 */
	private fromMenu(action: FileAction, context: MenuContext | undefined): Promise<void> | undefined {
		const { root, gitStormGroup: group, path: target } = context ?? {};
		const repository = root ? this.repositories.get(root)?.repository : undefined;
		if (!root || !group || target === undefined || !repository) {
			return undefined;
		}
		let targets: readonly ChangeRef[];
		if (context?.webviewSection === 'changeFolder') {
			const rows = changeGroups(repository).find(candidate => candidate.group === group)?.rows ?? [];
			targets = rows.filter(row => row.path.startsWith(`${target}/`)).map(row => ({ root, group, path: row.path }));
		} else {
			const clicked: ChangeRef = { root, group, path: target };
			targets = this.selection.some(ref => sameRef(ref, clicked)) ? this.selection : [clicked];
		}
		return this.runFiles(action, targets).catch(reportError);
	}

	private async runFiles(action: FileAction, refs: readonly ChangeRef[]): Promise<void> {
		for (const [repository, rows] of this.resolve(refs)) {
			switch (action) {
				case 'open':
					await this.actions.open(repository, rows);
					break;
				case 'openFile':
					await this.actions.openFiles(repository, rows);
					break;
				case 'stage':
					await this.actions.stage(repository, rows);
					break;
				case 'unstage':
					await this.actions.unstage(repository, rows);
					break;
				case 'discard':
					await this.actions.discard(repository, rows);
					break;
				case 'ignore':
					await this.actions.ignore(repository, rows);
					break;
				case 'reveal':
					await this.actions.reveal(rows);
					break;
			}
		}
	}

	private async runGroup(action: GroupAction, root: string, group: ChangeGroupKind): Promise<void> {
		const repository = this.repositories.get(root)?.repository;
		if (!repository) {
			return;
		}
		switch (action) {
			case 'view': {
				const rows = changeGroups(repository).find(candidate => candidate.group === group);
				return rows && this.actions.view(repository, rows.label, rows.rows);
			}
			case 'stageAll':
				return this.actions.stageAll(repository, group);
			case 'unstageAll':
				return this.actions.unstageAll(repository);
			case 'discardAll':
				return this.actions.discardAll(repository, group);
		}
	}

	/** Files of messages, found again in Git's current state, by repository. */
	private resolve(refs: readonly ChangeRef[]): Map<Repo, ChangeRow[]> {
		const found = new Map<Repo, ChangeRow[]>();
		for (const [root, entry] of this.repositories) {
			const wanted = refs.filter(ref => ref.root === root);
			if (wanted.length === 0) {
				continue;
			}
			const rows = changeGroups(entry.repository).flatMap(group => group.rows);
			const matching = rows.filter(row => wanted.some(ref => ref.group === row.group && ref.path === row.path));
			if (matching.length > 0) {
				found.set(entry.repository, matching);
			}
		}
		return found;
	}

	/**
	 * Git's own commit with the repository's message box, which Source Control
	 * shows too: the staged files, or its smart-commit question when nothing is staged.
	 */
	private async commit(root: string, message: string, push: boolean): Promise<void> {
		const repository = this.repositories.get(root)?.repository;
		if (!repository) {
			return;
		}
		repository.inputBox.value = message;
		this.busy('Committing…');
		try {
			await vscode.commands.executeCommand('git.commit', repository, push ? 'git.push' : undefined);
		} finally {
			this.busy(undefined);
			// Git empties the box after a commit; a cancelled one keeps the message.
			this.postDraft(repository);
		}
	}

	private busy(label: string | undefined): void {
		void this.channel?.post({ type: 'busy', label });
	}

	private postDraft(repository: Repo): void {
		void this.channel?.post({ type: 'draft', root: repository.rootUri.fsPath, value: repository.inputBox.value });
	}

	private add(repository: Repository): void {
		const root = repository.rootUri.fsPath;
		if (this.repositories.has(root)) {
			return;
		}
		const repo = repository as Repo;
		this.repositories.set(root, { repository: repo, listener: repository.state.onDidChange(() => this.changed()) });
		this.postDraft(repo);
		this.changed();
	}

	private remove(repository: Repository): void {
		const root = repository.rootUri.fsPath;
		this.repositories.get(root)?.listener.dispose();
		this.repositories.delete(root);
		this.changed();
	}

	private changed(): void {
		this.updateBadge();
		this.schedule();
	}

	private schedule(): void {
		clearTimeout(this.refreshTimer);
		this.refreshTimer = setTimeout(() => void this.refresh(), 150);
	}

	/** Source Control's badge: pending changes of all repositories, or of the focused one (scm.countBadge). */
	private updateBadge(): void {
		const repositories = [...this.repositories.values()].map(entry => entry.repository);
		const counts = repositories.map(repository => {
			const git = vscode.workspace.getConfiguration('git', repository.rootUri);
			const settings: CountSettings = {
				countBadge: git.get<CountSettings['countBadge']>('countBadge', 'all'),
				untrackedChanges: git.get<CountSettings['untrackedChanges']>('untrackedChanges', 'mixed'),
			};
			return repositoryCount(repository.state, settings);
		});
		const active = activeRepository(this.api)?.rootUri.fsPath;
		const focused = Math.max(0, repositories.findIndex(repository => repository.rootUri.fsPath === active));
		const mode = vscode.workspace.getConfiguration('scm').get<'all' | 'focused' | 'off'>('countBadge', 'all');
		this.badgeView.badge = changesBadge(counts, mode, focused);
	}

	/** The webview may read the fonts and images of the file icon theme. */
	private allowIconFiles(): void {
		if (this.view) {
			this.view.webview.options = webviewOptions(this.extensionUri, this.icons.root ? [this.icons.root] : []);
		}
	}

	private async refresh(): Promise<void> {
		const { view, channel } = this;
		if (!view || !channel) {
			return;
		}
		const repos = [...this.repositories.values()].map(({ repository }) => this.repoState(repository, view.webview));
		const state: SidebarState = {
			repos,
			viewMode: this.viewMode,
			compactFolders: vscode.workspace.getConfiguration('scm').get<boolean>('compactFolders', true),
			iconFonts: this.icons.fonts(view.webview),
			folderIcons: this.viewMode === 'tree' ? this.folderIcons(repos, view.webview) : {},
		};
		this.last = state;
		await channel.post({ type: 'state', state });
	}

	/** Icons of the folders the tree shows, by lower-case name; '' for any other folder. */
	private folderIcons(repos: readonly SidebarRepo[], webview: vscode.Webview): Record<string, FolderIcons> {
		const names = new Set(repos.flatMap(repo => repo.groups.flatMap(group => group.files.flatMap(file => file.path.toLowerCase().split('/').slice(0, -1)))));
		const iconsOf = (name: string): FolderIcons => ({ closed: this.icons.folderIcon(name, false, webview), open: this.icons.folderIcon(name, true, webview) });
		const fallback = iconsOf('');
		const icons: Record<string, FolderIcons> = fallback.closed || fallback.open ? { '': fallback } : {};
		for (const name of names) {
			// Only names with their own icon; the others use the default one.
			const own = iconsOf(name);
			if (JSON.stringify(own) !== JSON.stringify(fallback)) {
				icons[name] = own;
			}
		}
		return icons;
	}

	private repoState(repository: Repo, webview: vscode.Webview): SidebarRepo {
		const head = repository.state.HEAD;
		const groups = changeGroups(repository);
		return {
			root: repository.rootUri.fsPath,
			name: path.basename(repository.rootUri.fsPath),
			current: head && {
				name: head.name ?? (head.commit ?? 'HEAD').slice(0, 7),
				upstream: head.upstream && `${head.upstream.remote}/${head.upstream.name}`,
				ahead: head.ahead ?? 0,
				behind: head.behind ?? 0,
			},
			groups: groups.map(group => ({
				group: group.group,
				label: group.label,
				files: group.rows.map(row => {
					const status = statusDecoration(row.change.status);
					return {
						path: row.path,
						name: row.name,
						dir: row.dir,
						letter: status.letter,
						decoration: status.decoration,
						tooltip: `${row.path} • ${status.text}`,
						icon: this.icons.icon(row.name, webview),
					};
				}),
			})),
			changeCount: groups.reduce((sum, group) => sum + group.rows.length, 0),
		};
	}

	dispose(): void {
		clearTimeout(this.refreshTimer);
		this.repositories.forEach(entry => entry.listener.dispose());
		this.channel?.dispose();
		this.subscriptions.forEach(subscription => subscription.dispose());
	}
}
