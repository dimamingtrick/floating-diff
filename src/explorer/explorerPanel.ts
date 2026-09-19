import * as vscode from 'vscode';
import type { DiffWindow } from '../diffWindow';
import type { RepoContext } from '../repoContext';
import { errorText, reportError, runWithProgress } from '../report';
import type { ExplorerCommit, ExplorerFromWebview, ExplorerToWebview, FileChange, FilePreview, SearchOptions } from '../shared/protocol';
import { WebviewChannel, webviewHtml, webviewOptions } from '../webview/host';

const short = (hash: string) => hash.slice(0, 7);
/** Commits of the branch in the Commits tab. */
const HISTORY = 300;

/** Asks for a branch to browse; undefined when cancelled. */
export async function pickBranchToBrowse(ctx: RepoContext): Promise<string | undefined> {
	const { local, remote } = await ctx.data.branchNames();
	const current = ctx.repository.state.HEAD?.name;
	const section = (label: string, names: readonly string[], icon: string): vscode.QuickPickItem[] =>
		names.length === 0
			? []
			: [
				{ label, kind: vscode.QuickPickItemKind.Separator },
				...names.map(name => ({ label: name, description: name === current ? 'current' : undefined, iconPath: new vscode.ThemeIcon(icon) })),
			];
	const pick = await vscode.window.showQuickPick([...section('Local', local, 'git-branch'), ...section('Remote', remote, 'cloud')], {
		title: 'Browse Branch',
		placeHolder: 'A branch to browse without checking it out',
	});
	return pick?.label;
}

/**
 * The "<branch> — browse" tab: files, commits and text search of a branch
 * read straight from git, so the working tree stays as it is. One per branch.
 */
export class ExplorerPanel implements vscode.Disposable {
	private static readonly panels = new Map<string, ExplorerPanel>();

	static show(extensionUri: vscode.Uri, ctx: RepoContext, diffWindow: DiffWindow, branch: string): ExplorerPanel {
		const key = `${ctx.repository.rootUri.toString()}\0${branch}`;
		const existing = ExplorerPanel.panels.get(key);
		if (existing) {
			existing.panel.reveal();
			return existing;
		}
		const created = new ExplorerPanel(extensionUri, ctx, diffWindow, branch, key);
		ExplorerPanel.panels.set(key, created);
		return created;
	}

	readonly channel: WebviewChannel<ExplorerFromWebview, ExplorerToWebview>;
	private readonly panel: vscode.WebviewPanel;
	private readonly subscriptions: vscode.Disposable[] = [];
	/** The checked-out branch as people read it: its name, or a short hash when detached. */
	private current = 'HEAD';
	private base: string | undefined;
	private diff: FileChange[] = [];
	private commits: ExplorerCommit[] = [];
	private head: string | undefined;
	private reloadTimer: ReturnType<typeof setTimeout> | undefined;

	private constructor(
		private readonly extensionUri: vscode.Uri,
		private readonly ctx: RepoContext,
		private readonly diffWindow: DiffWindow,
		private readonly branch: string,
		private readonly key: string,
	) {
		const title = `${branch} — browse`;
		this.panel = vscode.window.createWebviewPanel('gitStorm.explorer', title, diffWindow.editorColumn(), {
			...webviewOptions(extensionUri),
			retainContextWhenHidden: true,
		});
		this.panel.webview.html = webviewHtml(this.panel.webview, extensionUri, 'explorer', title);
		this.channel = new WebviewChannel(this.panel.webview, message => this.handle(message), reportError);
		this.head = ctx.repository.state.HEAD?.commit;
		this.subscriptions.push(
			this.channel,
			this.panel.onDidDispose(() => this.dispose()),
			// Everything is relative to the current branch: reload when it moves.
			ctx.repository.state.onDidChange(() => {
				const head = ctx.repository.state.HEAD?.commit;
				if (head !== this.head) {
					this.head = head;
					clearTimeout(this.reloadTimer);
					this.reloadTimer = setTimeout(() => void this.load(), 400);
				}
			}),
		);
		void this.load();
	}

	async handle(message: ExplorerFromWebview): Promise<void> {
		switch (message.type) {
			case 'openFile':
				return this.openFile(message.path, message.line);
			case 'search':
				return this.search(message.query, message.options);
			case 'diffWithMine':
				return this.diffWithMine(message.path);
			case 'copyToWorkingTree':
				return this.copyToWorkingTree(message.path);
			case 'diffFile':
				return this.diffWindow.show(this.ctx.diffs.file(message.file, this.base, this.branch, this.compareTitle()));
			case 'openFullDiff':
				return this.openFullDiff();
			case 'openCommit':
				return this.openCommit(message.commit);
			case 'cherryPick':
				return this.cherryPick();
			case 'checkout':
				return this.checkout();
			case 'pickBranch': {
				const branch = await pickBranchToBrowse(this.ctx);
				if (branch) {
					ExplorerPanel.show(this.extensionUri, this.ctx, this.diffWindow, branch);
				}
				return;
			}
		}
	}

	private compareTitle(): string {
		return `${this.current} ↔ ${this.branch}`;
	}

	private async load(): Promise<void> {
		const { data, repository } = this.ctx;
		const head = repository.state.HEAD;
		this.current = head?.name ?? (head?.commit ? short(head.commit) : 'HEAD');
		try {
			const [history, files, names, counts, ahead, base] = await Promise.all([
				data.log({ ref: this.branch, limit: HISTORY }),
				data.tree(this.branch),
				data.branchNames(),
				data.aheadBehind('HEAD', this.branch),
				data.commitsBetween('HEAD', this.branch),
				// Unrelated histories have no merge base: compare with HEAD itself.
				data.mergeBase('HEAD', this.branch).catch(() => undefined),
			]);
			this.base = base ?? 'HEAD';
			this.diff = await data.diffStat(this.base, this.branch);
			const notInCurrent = new Set(ahead.map(commit => commit.hash));
			this.commits = history.map(({ hash, parents, subject, author, date }) => ({ hash, parents, subject, author, date, ahead: notInCurrent.has(hash) }));
			const tip = history[0];
			await this.channel.post({
				type: 'init',
				data: {
					info: {
						branch: this.branch,
						current: this.current,
						remote: names.remote.includes(this.branch),
						tip: { hash: tip?.hash ?? '', subject: tip?.subject ?? '', author: tip?.author ?? '', date: tip?.date ?? 0 },
						ahead: counts.ahead,
						behind: counts.behind,
					},
					files,
					diff: this.diff,
					commits: this.commits,
				},
			});
		} catch (error) {
			void reportError(error);
		}
	}

	private async openFile(path: string, line?: number): Promise<void> {
		let file: FilePreview;
		try {
			file = { path, line, ...(await this.ctx.data.file(this.branch, path)) };
		} catch {
			file = { path, missing: true };
		}
		await this.channel.post({ type: 'file', file });
	}

	private async search(query: string, options: SearchOptions): Promise<void> {
		try {
			await this.channel.post({ type: 'search', query, hits: await this.ctx.data.grep(this.branch, query, options) });
		} catch (error) {
			// Mostly an invalid regular expression: show git's message in place of results.
			await this.channel.post({ type: 'search', query, hits: [], error: errorText(error) });
		}
	}

	private async hasWorkingCopy(path: string): Promise<boolean> {
		const uri = vscode.Uri.joinPath(this.ctx.repository.rootUri, path);
		return vscode.workspace.fs.stat(uri).then(
			stat => stat.type === vscode.FileType.File,
			() => false,
		);
	}

	private async diffWithMine(path: string): Promise<void> {
		const hasCopy = await this.hasWorkingCopy(path);
		if (!hasCopy) {
			vscode.window.setStatusBarMessage(`GitStorm: ${path} is not in your working tree`, 4000);
		}
		await this.diffWindow.show(this.ctx.diffs.withWorkingTree(path, this.branch, hasCopy));
	}

	private async copyToWorkingTree(path: string): Promise<void> {
		if (await this.hasWorkingCopy(path)) {
			if (await this.ctx.data.sameAsWorkingFile(this.branch, path)) {
				void vscode.window.showInformationMessage(`GitStorm: your ${path} is already the same as on ${this.branch}.`);
				return;
			}
			const answer = await vscode.window.showWarningMessage(
				`Replace ${path} with the version from ${this.branch}?`,
				{ modal: true, detail: 'Your copy of this file differs. Its uncommitted changes will be lost; the staged version is kept.' },
				'Replace',
			);
			if (answer !== 'Replace') {
				return;
			}
		}
		if (await runWithProgress(`Copying ${path} from ${this.branch}`, () => this.ctx.data.restoreFile(this.branch, path))) {
			vscode.window.setStatusBarMessage(`GitStorm: copied ${path} from ${this.branch}`, 4000);
			await this.ctx.repository.status();
		}
	}

	private async openFullDiff(): Promise<void> {
		const req = this.ctx.diffs.files(this.diff, this.base, this.branch, this.compareTitle());
		if (req) {
			await this.diffWindow.show(req);
		} else {
			void vscode.window.showInformationMessage(`GitStorm: ${this.branch} changes nothing compared to ${this.current}.`);
		}
	}

	private async openCommit(commit: ExplorerCommit): Promise<void> {
		const parent = commit.parents[0];
		const { files } = await this.ctx.data.commit(commit.hash, parent);
		const req = this.ctx.diffs.files(files, parent, commit.hash, `${short(commit.hash)} ${commit.subject}`);
		if (req) {
			await this.diffWindow.show(req);
		} else {
			void vscode.window.showInformationMessage('GitStorm: this commit changes no files.');
		}
	}

	private async cherryPick(): Promise<void> {
		const candidates = this.commits.filter(commit => commit.ahead);
		if (candidates.length === 0) {
			void vscode.window.showInformationMessage(`GitStorm: ${this.branch} has no commits that ${this.current} doesn't have.`);
			return;
		}
		const picks = await vscode.window.showQuickPick(
			candidates.map(commit => ({ label: commit.subject, description: `${short(commit.hash)} · ${commit.author}`, commit })),
			{ title: `Cherry-pick from ${this.branch} into ${this.current}`, placeHolder: 'Commits to apply, oldest first', canPickMany: true },
		);
		if (!picks?.length) {
			return;
		}
		// The list is newest first; apply in history order.
		const ordered = picks.map(pick => pick.commit).sort((a, b) => candidates.indexOf(b) - candidates.indexOf(a));
		const label = ordered.length === 1 ? short(ordered[0].hash) : `${ordered.length} commits`;
		await runWithProgress(`Cherry-picking ${label}`, async () => {
			try {
				for (const commit of ordered) {
					await this.ctx.data.cherryPick(commit.hash);
				}
			} finally {
				await this.ctx.repository.status();
			}
		});
	}

	private async checkout(): Promise<void> {
		const list = await this.ctx.branches.list();
		const branch = list.branches.find(b => b.name === this.branch);
		if (!branch) {
			void vscode.window.showErrorMessage(`GitStorm: ${this.branch} is not a branch.`);
			return;
		}
		await runWithProgress(`Checking out ${this.branch}`, () => this.ctx.branches.checkout(branch, list.branches));
	}

	dispose(): void {
		if (ExplorerPanel.panels.get(this.key) === this) {
			ExplorerPanel.panels.delete(this.key);
		}
		clearTimeout(this.reloadTimer);
		this.subscriptions.forEach(subscription => subscription.dispose());
	}
}
