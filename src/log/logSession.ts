import * as path from 'path';
import * as vscode from 'vscode';
import { askBranchName } from '../branches/branchesPopup';
import type { FileChange, LogCommit } from '../data/parse';
import type { DiffWindow } from '../diffWindow';
import { layoutGraph } from '../graph/lanes';
import type { RepoContext } from '../repoContext';
import { reportError, runWithProgress } from '../report';
import * as pathSearch from '../shared/pathSearch';
import type { FileIcon, LogAction, LogFilters, LogFromWebview, LogRow, LogToWebview, PathItem } from '../shared/protocol';

/** Commits per page: the next page loads when the list is scrolled to its end. */
export const PAGE = 20;
const SINCE: Record<NonNullable<LogFilters['since']>, string> = { day: '1 day ago', week: '7 days ago', month: '30 days ago' };
const short = (hash: string) => hash.slice(0, 7);

async function exists(uri: vscode.Uri): Promise<boolean> {
	try {
		await vscode.workspace.fs.stat(uri);
		return true;
	} catch {
		return false;
	}
}

export interface LogSessionOptions {
	/** Adds file icons to commit details. */
	readonly fileIcon?: (fileName: string) => FileIcon | undefined;
	/** Adds the branches that contain a commit to its details. */
	readonly containingBranches?: boolean;
}

/**
 * The log of one repository for a webview: commit graph with filters, commit
 * details and the actions on commits. The Git Log tab and the Git panel at the
 * bottom both run one.
 */
export class LogSession implements vscode.Disposable {
	private commits: LogCommit[] = [];
	private total = 0;
	private authors: string[] | undefined;
	private selected: string | undefined;
	private head: string | undefined;
	private reloadTimer: ReturnType<typeof setTimeout> | undefined;
	/** The tracked files, for the Paths filter; listed again after any change. */
	private files: Promise<string[]> | undefined;
	private readonly subscription: vscode.Disposable;
	/** Loads run one after another, so pages never ask for the same place twice. */
	private queue: Promise<void> = Promise.resolve();

	constructor(
		readonly ctx: RepoContext,
		private readonly diffWindow: DiffWindow,
		private readonly post: (message: LogToWebview) => Promise<void>,
		private currentFilters: LogFilters = {},
		private readonly options: LogSessionOptions = {},
	) {
		this.head = ctx.repository.state.HEAD?.commit;
		// New commits, checkouts, pulls: reload once things settle.
		this.subscription = ctx.repository.state.onDidChange(() => {
			this.files = undefined;
			const head = ctx.repository.state.HEAD?.commit;
			if (head !== this.head) {
				this.head = head;
				clearTimeout(this.reloadTimer);
				this.reloadTimer = setTimeout(() => void this.load(), 400);
			}
		});
		void this.load();
	}

	get filters(): LogFilters {
		return this.currentFilters;
	}

	async setFilters(filters: LogFilters): Promise<void> {
		this.currentFilters = filters;
		await this.load();
	}

	async handle(message: LogFromWebview): Promise<void> {
		switch (message.type) {
			case 'filters':
				return this.setFilters(message.filters);
			case 'select':
				this.selected = message.hash;
				return this.showDetails(message.hash);
			case 'loadMore':
				return this.load(true);
			case 'searchPaths':
				return this.post({ type: 'paths', query: message.query, items: await this.searchPaths(message.query) });
			case 'refresh':
				return this.load();
			case 'openFile': {
				const parent = this.find(message.hash)?.parents[0];
				return this.diffWindow.show(this.ctx.diffs.file(message.file, parent, message.hash, short(message.hash)));
			}
			case 'openSource':
				return this.openSource(message.hash, message.file);
			case 'openCommit':
				return this.openCommit(message.hash);
			case 'action':
				return this.action(message.action, message.hash);
		}
	}

	/**
	 * WebStorm's Jump to Source: the file itself in an editor. A file the commit
	 * removed, or one gone since, opens read-only as that commit had it.
	 */
	private async openSource(hash: string, file: FileChange): Promise<void> {
		const working = vscode.Uri.joinPath(this.ctx.repository.rootUri, file.path);
		const removed = file.status === 'D';
		const uri = !removed && (await exists(working))
			? working
			: removed
				? this.ctx.diffs.revision(file.oldPath ?? file.path, `${hash}^`)
				: this.ctx.diffs.revision(file.path, hash);
		await vscode.window.showTextDocument(uri, { preview: false });
	}

	private find(hash: string): LogCommit | undefined {
		return this.commits.find(commit => commit.hash === hash);
	}

	load(append = false): Promise<void> {
		// A failed load (already reported) must not stop the next ones.
		this.queue = this.queue.catch(() => undefined).then(() => this.fetch(append));
		return this.queue;
	}

	private async fetch(append: boolean): Promise<void> {
		if (append && this.commits.length >= this.total) {
			return;
		}
		await this.post({ type: 'busy', busy: true });
		try {
			const { data } = this.ctx;
			const { branch, author, since, paths } = this.currentFilters;
			const text = this.currentFilters.text?.trim() || undefined;
			const filter = { ref: branch, author, since: since && SINCE[since], paths: paths?.length ? paths : undefined, text };
			// A hash (or its start) finds that commit, like WebStorm's filter.
			const byHash = !append && text && /^[0-9a-f]{4,40}$/i.test(text) ? await data.commitByHash(text) : undefined;
			if (byHash) {
				this.commits = [byHash];
				this.total = 1;
			} else {
				const [page, total] = await Promise.all([
					data.log({ ...filter, skip: append ? this.commits.length : 0, limit: PAGE }),
					append ? Promise.resolve(this.total) : data.count(filter).catch(() => undefined),
				]);
				// New commits between two pages shift the next one: keep each commit once.
				const known = new Set(append ? this.commits.map(commit => commit.hash) : []);
				this.commits = append ? [...this.commits, ...page.filter(commit => !known.has(commit.hash))] : page;
				this.total = total ?? (page.length === PAGE ? this.commits.length + 1 : this.commits.length);
			}
			// Everyone who committed, for the User filter; loaded once.
			this.authors ??= await data.authors().catch(() => [...new Set(this.commits.map(commit => commit.author))].sort((a, b) => a.localeCompare(b)));
			const graph = layoutGraph(this.commits);
			const rows: LogRow[] = this.commits.map((commit, i) => ({
				hash: commit.hash,
				parents: commit.parents,
				subject: commit.subject,
				author: commit.author,
				email: commit.email,
				date: commit.date,
				refs: commit.refs,
				graph: graph[i],
			}));
			const head = this.ctx.repository.state.HEAD?.commit;
			if (!this.selected || !this.find(this.selected)) {
				this.selected = head && this.find(head) ? head : this.commits[0]?.hash;
			}
			await this.post({
				type: 'log',
				data: {
					rows,
					graphWidth: graph.reduce((max, row) => Math.max(max, row.width), 1),
					filters: this.currentFilters,
					branches: await this.ctx.data.branchNames(),
					authors: this.authors,
					total: Math.max(this.total, this.commits.length),
					canLoadMore: this.commits.length < this.total,
					selected: this.selected,
				},
			});
			if (this.selected) {
				await this.showDetails(this.selected);
			}
		} catch (error) {
			await this.post({ type: 'busy', busy: false });
			void reportError(error);
		}
	}

	/** Files and folders for the Paths filter: those that match `query`, or the filtered ones for an empty query. */
	async searchPaths(query: string): Promise<PathItem[]> {
		const listing = (this.files ??= this.ctx.data.files());
		const files = await listing.catch(error => {
			if (this.files === listing) {
				this.files = undefined;
			}
			throw error;
		});
		const found = query.trim()
			? pathSearch.searchPaths(files, query)
			: (this.currentFilters.paths ?? []).map(item => (files.some(file => file.startsWith(`${item}/`)) ? { path: item, folder: true } : { path: item }));
		const fileIcon = this.options.fileIcon;
		return found.map(item => (item.folder || !fileIcon ? item : { ...item, icon: fileIcon(path.posix.basename(item.path)) }));
	}

	private async showDetails(hash: string): Promise<void> {
		const [details, branches] = await Promise.all([
			this.ctx.data.commit(hash, this.find(hash)?.parents[0]),
			this.options.containingBranches ? this.ctx.data.branchesContaining(hash).catch(() => []) : Promise.resolve(undefined),
		]);
		const fileIcon = this.options.fileIcon;
		const icons = fileIcon ? Object.fromEntries(details.files.flatMap(file => {
			const icon = fileIcon(path.posix.basename(file.path));
			return icon ? [[file.path, icon] as const] : [];
		})) : undefined;
		await this.post({ type: 'details', details: { hash, body: details.body, files: details.files, branches, icons } });
	}

	private async openCommit(hash: string): Promise<void> {
		const commit = this.find(hash);
		const { files } = await this.ctx.data.commit(hash, commit?.parents[0]);
		const req = this.ctx.diffs.files(files, commit?.parents[0], hash, `${short(hash)} ${commit?.subject ?? ''}`.trim());
		if (req) {
			await this.diffWindow.show(req);
		} else {
			void vscode.window.showInformationMessage('Git Convenient: this commit changes no files.');
		}
	}

	private async action(action: LogAction, hash: string): Promise<void> {
		const { repository, data } = this.ctx;
		const done = async (task: () => Promise<unknown>) => {
			await task();
			await repository.status();
		};
		switch (action) {
			case 'copyHash':
				await vscode.env.clipboard.writeText(hash);
				vscode.window.setStatusBarMessage(`Git Convenient: copied ${short(hash)}`, 2000);
				return;
			case 'cherryPick':
				await runWithProgress(`Cherry-picking ${short(hash)}`, () => done(() => data.cherryPick(hash)));
				return;
			case 'revert':
				await runWithProgress(`Reverting ${short(hash)}`, () => done(() => data.revert(hash)));
				return;
			case 'checkout': {
				const answer = await vscode.window.showWarningMessage(
					`Check out ${short(hash)}?`,
					{ modal: true, detail: 'You will be in "detached HEAD" state: new commits belong to no branch until you create one.' },
					'Checkout',
				);
				if (answer === 'Checkout') {
					await runWithProgress(`Checking out ${short(hash)}`, () => repository.checkout(hash));
				}
				return;
			}
			case 'merge': {
				const current = repository.state.HEAD?.name ?? 'HEAD';
				await runWithProgress(`Merging ${short(hash)} into ${current}`, () => done(() => repository.merge(hash)));
				return;
			}
			case 'rebase': {
				const current = repository.state.HEAD?.name ?? 'HEAD';
				const answer = await vscode.window.showWarningMessage(
					`Rebase ${current} onto ${short(hash)}?`,
					{ modal: true, detail: `The commits of ${current} that ${short(hash)} does not have are replayed on top of it.` },
					'Rebase',
				);
				if (answer === 'Rebase') {
					await runWithProgress(`Rebasing ${current} onto ${short(hash)}`, async () => {
						try {
							await this.ctx.git(['rebase', hash]);
						} finally {
							await repository.status();
						}
					});
				}
				return;
			}
			case 'newBranch': {
				const name = await askBranchName(`New branch from ${short(hash)}`);
				if (name) {
					await runWithProgress(`Creating ${name}`, () => repository.createBranch(name, true, hash));
				}
				return;
			}
		}
	}

	dispose(): void {
		clearTimeout(this.reloadTimer);
		this.subscription.dispose();
	}
}
