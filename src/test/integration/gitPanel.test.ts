import * as assert from 'assert';
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
		repo = createTestRepo('gitstorm-git-panel-');
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
		second = createTestRepo('gitstorm-git-panel-other-');
		second.write('b.txt', 'b\n');
		second.git('add', '.');
		second.git('commit', '-qm', 'init');
		await openTestRepo(repo.dir, 'a.txt');
		const api: API = vscode.extensions.getExtension<GitExtension>('vscode.git')!.exports.getAPI(1);
		await vscode.commands.executeCommand('git.openRepository', second.dir);
		await waitFor(() => api.getRepository(vscode.Uri.file(second.dir)) !== null, 'second repository open', 15000);

		panel = (await vscode.commands.executeCommand<GitPanel>('gitStorm.log'))!;
		assert.ok(panel, 'gitStorm.log returns the Git panel');
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
		await vscode.commands.executeCommand('gitStorm.log', 'feature/two');
		await waitFor(() => panel.session?.filters.branch === 'feature/two', 'the branch filter', 10000);
	});

	it("runs WebStorm's commit actions from the context menu", async () => {
		const menu = (hash: string) => ({ webview: 'gitStorm.branchesPanel', webviewSection: 'commit', hash });
		await vscode.commands.executeCommand('gitStorm.commit.cherryPick', menu(repo.git('rev-parse', 'feature/two').trim()));
		await waitFor(() => repo.git('log', '-1', '--format=%s').trim() === 'two', 'two cherry-picked onto main', 10000);

		await vscode.commands.executeCommand('gitStorm.commit.merge', menu(repo.git('rev-parse', 'feature/one').trim()));
		await waitFor(() => repo.git('log', '-1', '--format=%P').trim().split(' ').length === 2, 'a merge commit on main', 10000);
		assert.ok(repo.git('ls-files').includes('src/one.txt'), 'feature/one merged');
	});

	it('switches to another repository', async () => {
		await panel.handle({ type: 'pickRepo', root: second.dir });
		await waitFor(() => panel.session?.ctx.repository.rootUri.fsPath === second.dir, 'the other log', 10000);
		await waitFor(() => panel.snapshot()?.root === second.dir, 'its branches', 10000);
	});

	it('closes like the terminal when toggled', async () => {
		await vscode.commands.executeCommand('gitStorm.toggleBranches');
		await waitFor(() => !panel.visible, 'the panel is hidden', 10000);
	});
});
