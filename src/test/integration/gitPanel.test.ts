import * as assert from 'assert';
import * as path from 'path';
import * as vscode from 'vscode';
import type { GitPanel } from '../../branches/gitPanel';
import type { API, GitExtension } from '../../git';
import { createTestRepo, openTestRepo, TestRepo, waitFor, waitForValue } from './util';

// The Git panel at the bottom, like WebStorm's: main (2 commits), feature/one (+1) and
// feature/two (+1) grouped in a folder, a tag; a second repository to pick.
describe('Git panel', function () {
	this.timeout(60000);
	let repo: TestRepo;
	let second: TestRepo;
	let panel: GitPanel;

	before(async () => {
		repo = createTestRepo('git-convenient-git-panel-');
		repo.write('a.txt', 'a\n');
		repo.git('add', '.');
		repo.git('commit', '-qm', 'init');
		repo.git('tag', 'v1');
		repo.git('checkout', '-qb', 'feature/one');
		repo.write('src/one.txt', 'one\n');
		repo.git('add', '.');
		repo.git('commit', '-qm', 'one');
		repo.git('checkout', '-q', 'main');
		repo.git('checkout', '-qb', 'feature/two');
		repo.write('two.txt', 'two\n');
		repo.git('add', '.');
		repo.git('commit', '-qm', 'two');
		repo.git('checkout', '-q', 'main');
		repo.write('a.txt', 'a2\n');
		repo.git('commit', '-qam', 'main change');
		second = createTestRepo('git-convenient-git-panel-other-');
		second.write('b.txt', 'b\n');
		second.git('add', '.');
		second.git('commit', '-qm', 'init');
		await openTestRepo(repo.dir, 'a.txt');
		const api: API = vscode.extensions.getExtension<GitExtension>('vscode.git')!.exports.getAPI(1);
		await vscode.commands.executeCommand('git.openRepository', second.dir);
		await waitFor(() => api.getRepository(vscode.Uri.file(second.dir)) !== null, 'second repository open', 15000);

		panel = (await vscode.commands.executeCommand<GitPanel>('gitConvenient.log'))!;
		assert.ok(panel, 'gitConvenient.log returns the Git panel');
	});

	after(async () => {
		await vscode.commands.executeCommand('workbench.action.closePanel');
		await vscode.commands.executeCommand('workbench.action.closeAllEditors');
	});

	it("opens at the bottom with the active file's branches and log", async () => {
		await waitFor(() => panel.visible && panel.snapshot()?.root === repo.dir, 'the panel with the repository', 10000);
		const branches = panel.snapshot()!;
		assert.deepStrictEqual(branches.local.map(branch => [branch.name, branch.current, branch.favorite]), [
			['feature/one', false, false],
			['feature/two', false, false],
			['main', true, true],
		]);
		assert.deepStrictEqual(branches.tags, ['v1']);
		// All branches: init, one, two, main change.
		await waitForValue(() => panel.channel!.rendered('log', 'latest'), 4, 'the log of all branches', 10000);
	});

	it('shows the commits of a branch picked in the tree', async () => {
		const shown = panel.channel!.rendered('log');
		await panel.handle({ type: 'filters', filters: { branch: 'feature/one' } });
		assert.strictEqual(await shown, 2, 'init and one');
		assert.strictEqual(panel.session?.filters.branch, 'feature/one');
	});

	it('opens on a branch from the Git Log command', async () => {
		await vscode.commands.executeCommand('gitConvenient.log', 'feature/two');
		await waitFor(() => panel.session?.filters.branch === 'feature/two', 'the branch filter', 10000);
	});

	it('shows the history of a file with File History, on the branch picked on the left', async () => {
		// The Git Log command left feature/two picked: a.txt changed there only in init.
		await vscode.commands.executeCommand('gitConvenient.fileHistory', vscode.Uri.file(path.join(repo.dir, 'a.txt')));
		await waitFor(() => panel.session?.filters.paths?.[0] === 'a.txt', 'the file filter', 10000);
		assert.deepStrictEqual(panel.session?.filters, { branch: 'feature/two', paths: ['a.txt'] });
		await waitForValue(() => panel.channel!.rendered('log', 'latest'), 1, 'init only', 10000);
		// Another branch, without checking it out: init and main change.
		await panel.handle({ type: 'filters', filters: { ...panel.session!.filters, branch: 'main' } });
		await waitForValue(() => panel.channel!.rendered('log', 'latest'), 2, 'the history of a.txt on main', 10000);
	});

	it('finds the files of the repository for the Paths filter', async () => {
		const items = await panel.session!.searchPaths('a.t');

		assert.deepStrictEqual(items.map(item => item.path), ['a.txt']);
		assert.ok(items[0].icon, 'with the icon of the icon theme');
	});

	it("opens the file itself on ⌘↓, and its version from the commit when the commit removed it", async () => {
		const main = repo.git('rev-parse', 'main').trim();
		await vscode.commands.executeCommand('workbench.action.closeAllEditors');
		await waitFor(() => vscode.window.activeTextEditor === undefined, 'no editor open');
		await panel.handle({ type: 'openSource', hash: main, file: { path: 'a.txt', status: 'M' } });
		await waitFor(() => vscode.window.activeTextEditor?.document.uri.fsPath === path.join(repo.dir, 'a.txt'), 'a.txt in an editor', 10000);
		assert.strictEqual(vscode.window.activeTextEditor!.document.uri.scheme, 'file', 'the working tree file, not a revision');

		repo.write('temp.txt', 'temp\n');
		repo.git('add', '.');
		repo.git('commit', '-qm', 'add temp');
		repo.git('rm', '-q', 'temp.txt');
		repo.git('commit', '-qm', 'remove temp');
		await panel.handle({ type: 'openSource', hash: repo.git('rev-parse', 'HEAD').trim(), file: { path: 'temp.txt', status: 'D' } });

		await waitFor(() => vscode.window.activeTextEditor?.document.uri.path.endsWith('temp.txt') === true, 'temp.txt in an editor', 10000);
		const editor = vscode.window.activeTextEditor!;
		assert.strictEqual(editor.document.uri.scheme, 'git', 'the version before the commit removed it');
		assert.strictEqual(editor.document.getText(), 'temp\n');
	});

	it("runs WebStorm's commit actions from the context menu", async () => {
		const menu = (hash: string) => ({ webview: 'gitConvenient.branchesPanel', webviewSection: 'commit', hash });
		await vscode.commands.executeCommand('gitConvenient.commit.cherryPick', menu(repo.git('rev-parse', 'feature/two').trim()));
		await waitFor(() => repo.git('log', '-1', '--format=%s').trim() === 'two', 'two cherry-picked onto main', 10000);

		await vscode.commands.executeCommand('gitConvenient.commit.merge', menu(repo.git('rev-parse', 'feature/one').trim()));
		await waitFor(() => repo.git('log', '-1', '--format=%P').trim().split(' ').length === 2, 'a merge commit on main', 10000);
		assert.ok(repo.git('ls-files').includes('src/one.txt'), 'feature/one merged');
	});

	it("runs WebStorm's branch actions from the branch context menu", async () => {
		const menu = (branch: string) => ({ webview: 'gitConvenient.branchesPanel', webviewSection: 'branch', branch, root: repo.dir });
		repo.git('branch', 'menu-checkout', 'main');

		await vscode.commands.executeCommand('gitConvenient.branch.checkout', menu('menu-checkout'));
		await waitFor(() => repo.git('rev-parse', '--abbrev-ref', 'HEAD').trim() === 'menu-checkout', 'on menu-checkout', 10000);
		await vscode.commands.executeCommand('gitConvenient.branch.checkout', menu('main'));
		await waitFor(() => repo.git('rev-parse', '--abbrev-ref', 'HEAD').trim() === 'main', 'back on main', 10000);

		repo.git('checkout', '-q', '-b', 'menu-merge', 'main');
		repo.write('menu.txt', 'menu\n');
		repo.git('add', '.');
		repo.git('commit', '-qm', 'from the branch menu');
		// A commit of main that menu-merge does not have, so merging cannot fast-forward.
		repo.git('checkout', '-q', 'main');
		repo.write('kept.txt', 'kept\n');
		repo.git('add', '.');
		repo.git('commit', '-qm', 'kept on main');
		const mainTip = repo.git('rev-parse', 'main').trim();

		await vscode.commands.executeCommand('gitConvenient.branch.merge', menu('menu-merge'));

		await waitFor(() => repo.git('ls-files').includes('menu.txt'), 'menu-merge merged into main', 10000);
		const parents = repo.git('log', '-1', '--format=%P').trim().split(' ');
		assert.deepStrictEqual(parents, [mainTip, repo.git('rev-parse', 'menu-merge').trim()], 'a merge commit, not a rebase');
	});

	it('rebases the current branch onto a branch from its context menu', async () => {
		repo.git('checkout', '-q', '-b', 'menu-onto', 'main');
		repo.write('onto.txt', 'onto\n');
		repo.git('add', '.');
		repo.git('commit', '-qm', 'onto');
		repo.git('checkout', '-q', 'main');
		repo.write('rebased.txt', 'rebased\n');
		repo.git('add', '.');
		repo.git('commit', '-qm', 'to replay');

		await vscode.commands.executeCommand('gitConvenient.branch.rebase', { webview: 'gitConvenient.branchesPanel', webviewSection: 'branch', branch: 'menu-onto', root: repo.dir });

		await waitFor(() => repo.git('ls-files').includes('onto.txt'), 'main rebased onto menu-onto', 10000);
		assert.strictEqual(repo.git('log', '-1', '--format=%s').trim(), 'to replay', 'the commit of main is replayed on top');
		assert.ok(repo.git('ls-files').includes('rebased.txt'));
	});

	it('puts the cursor on the first change when it opens the file of a commit', async () => {
		await vscode.commands.executeCommand('workbench.action.closeAllEditors');
		repo.write('long.txt', Array.from({ length: 40 }, (_, i) => `line ${i + 1}`).join('\n') + '\n');
		repo.git('add', '.');
		repo.git('commit', '-qm', 'long file');
		repo.write('long.txt', Array.from({ length: 40 }, (_, i) => `line ${i + 1}${i === 29 ? ' changed' : ''}`).join('\n') + '\n');
		repo.git('commit', '-qam', 'change line 30');
		const hash = repo.git('rev-parse', 'HEAD').trim();

		await panel.handle({ type: 'openSource', hash, file: { path: 'long.txt', status: 'M' } });

		await waitFor(() => vscode.window.activeTextEditor?.document.uri.path.endsWith('long.txt') === true, 'long.txt in an editor', 10000);
		assert.strictEqual(vscode.window.activeTextEditor?.selection.active.line, 29, 'the cursor is on the changed line');
	});

	it("opens a file of a commit and copies its path from the file context menu", async () => {
		await vscode.commands.executeCommand('workbench.action.closeAllEditors');
		const context = {
			webview: 'gitConvenient.branchesPanel',
			webviewSection: 'commitFile',
			hash: repo.git('rev-parse', 'HEAD').trim(),
			path: 'src/one.txt',
			file: { path: 'src/one.txt', status: 'A' },
		};

		await vscode.commands.executeCommand('gitConvenient.file.copyPath', context);
		assert.strictEqual(await vscode.env.clipboard.readText(), 'src/one.txt');

		await vscode.commands.executeCommand('gitConvenient.file.open', context);
		await waitFor(() => vscode.window.activeTextEditor?.document.uri.path.endsWith('src/one.txt') === true, 'one.txt in an editor', 10000);
		assert.strictEqual(vscode.window.activeTextEditor?.document.uri.scheme, 'file', 'the file itself, not a revision');
	});

	it('switches to another repository', async () => {
		await panel.handle({ type: 'pickRepo', root: second.dir });
		await waitFor(() => panel.session?.ctx.repository.rootUri.fsPath === second.dir, 'the other log', 10000);
		await waitFor(() => panel.snapshot()?.root === second.dir, 'its branches', 10000);
	});

	it('closes like the terminal when toggled', async () => {
		await vscode.commands.executeCommand('gitConvenient.toggleBranches');
		await waitFor(() => !panel.visible, 'the panel is hidden', 10000);
	});
});
