import * as assert from 'assert';
import * as vscode from 'vscode';
import type { LogPanel } from '../../log/logPanel';
import { allTabs, createTestRepo, openTestRepo, TestRepo, waitFor } from './util';

// main: init → main: change a → merge of feature (by Alice: add b).
describe('Git Log', function () {
	this.timeout(60000);
	let repo: TestRepo;
	let panel: LogPanel;
	const hash = (rev: string) => repo.git('rev-parse', rev).trim();

	before(async () => {
		repo = createTestRepo('git-convenient-log-');
		repo.write('a.txt', 'a\n');
		repo.git('add', '.');
		repo.git('commit', '-qm', 'init');
		repo.git('checkout', '-qb', 'feature');
		repo.write('b.txt', 'b\n');
		repo.git('add', '.');
		repo.git('-c', 'user.name=Alice', 'commit', '-qm', 'feature: add b');
		repo.git('checkout', '-q', 'main');
		repo.write('a.txt', 'a2\n');
		repo.write('src/c.txt', 'c\n');
		repo.git('add', '.');
		repo.git('commit', '-qm', 'main: change a');
		repo.git('merge', '-q', '--no-ff', '-m', "Merge branch 'feature'", 'feature');
		await openTestRepo(repo.dir, 'a.txt');

		panel = (await vscode.commands.executeCommand<LogPanel>('gitConvenient.logInEditor'))!;
		assert.ok(panel, 'gitConvenient.logInEditor returns its panel');
	});

	after(async () => {
		await vscode.commands.executeCommand('workbench.action.closeAllEditors');
	});

	it('shows every commit and the details of HEAD', async () => {
		assert.strictEqual(await panel.channel.rendered('log', 'latest'), 4);
		// HEAD is the merge: against its first parent it adds b.txt.
		assert.strictEqual(await panel.channel.rendered('details', 'latest'), 1);
	});

	it('shows the files of the selected commit', async () => {
		const details = panel.channel.rendered('details');
		await panel.handle({ type: 'select', hash: hash('main~1') });
		assert.strictEqual(await details, 2);
	});

	it('filters by branch, author and path', async () => {
		const byBranch = panel.channel.rendered('log');
		await panel.handle({ type: 'filters', filters: { branch: 'feature' } });
		assert.strictEqual(await byBranch, 2);

		const byAuthor = panel.channel.rendered('log');
		await panel.handle({ type: 'filters', filters: { author: 'Alice' } });
		assert.strictEqual(await byAuthor, 1);

		const byPath = panel.channel.rendered('log');
		await panel.handle({ type: 'filters', filters: { paths: ['src'] } });
		assert.strictEqual(await byPath, 1);

		const all = panel.channel.rendered('log');
		await panel.handle({ type: 'filters', filters: {} });
		assert.strictEqual(await all, 4);
	});

	it('opens all changes of a commit in the floating window', async () => {
		const short = hash('main~1').slice(0, 7);
		const groups = vscode.window.tabGroups.all.length;
		await panel.handle({ type: 'openCommit', hash: hash('main~1') });
		await waitFor(() => allTabs().some(tab => tab.label.startsWith(short)), `a tab for ${short}`, 10000);
		await vscode.commands.executeCommand('gitConvenient.close');
		// Later suites count window groups: leave none behind.
		await waitFor(() => vscode.window.tabGroups.all.length === groups, 'floating window closed');
	});

	it('opens in the main window while the floating window has focus', async () => {
		const groups = vscode.window.tabGroups.all.length;
		const short = hash('main~1').slice(0, 7);
		await panel.handle({ type: 'openCommit', hash: hash('main~1') });
		const floating = () => vscode.window.tabGroups.all.find(group => group.tabs.some(tab => tab.label.startsWith(short)));
		// Its group's `isActive` does not update for auxiliary windows: wait for the tab.
		await waitFor(() => floating() !== undefined, 'the floating window', 10000);
		const logTab = allTabs().find(tab => tab.label === 'Git Log')!;
		await vscode.window.tabGroups.close(logTab);

		await vscode.commands.executeCommand('gitConvenient.logInEditor');

		await waitFor(() => allTabs().some(tab => tab.label === 'Git Log'), 'Git Log reopened');
		assert.ok(!floating()!.tabs.some(tab => tab.label === 'Git Log'), 'Git Log is not in the floating window');
		await vscode.commands.executeCommand('gitConvenient.close');
		await waitFor(() => vscode.window.tabGroups.all.length === groups, 'floating window closed');
	});
});
