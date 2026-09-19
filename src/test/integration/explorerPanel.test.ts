import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import type { ExplorerPanel } from '../../explorer/explorerPanel';
import { allTabs, createTestRepo, openTestRepo, TestRepo, waitFor } from './util';

// main: a.txt. feature (not checked out): changes a.txt, adds b.txt and src/c.txt.
describe('Branch explorer', function () {
	this.timeout(60000);
	let repo: TestRepo;
	let panel: ExplorerPanel;

	before(async () => {
		repo = createTestRepo('git-convenient-explorer-');
		repo.write('a.txt', 'a\n');
		repo.git('add', '.');
		repo.git('commit', '-qm', 'init');
		repo.git('checkout', '-qb', 'feature');
		repo.write('a.txt', 'a changed\n');
		repo.write('b.txt', 'b\n');
		repo.write('src/c.txt', 'one\nhello world\nthree\n');
		repo.git('add', '.');
		repo.git('commit', '-qm', 'feature work');
		repo.git('checkout', '-q', 'main');
		await openTestRepo(repo.dir, 'a.txt');

		panel = (await vscode.commands.executeCommand<ExplorerPanel>('gitConvenient.browseBranch', 'feature'))!;
		assert.ok(panel, 'gitConvenient.browseBranch returns its panel');
	});

	after(async () => {
		await vscode.commands.executeCommand('workbench.action.closeAllEditors');
	});

	it('shows the files of the branch in its own tab, without checking it out', async () => {
		assert.strictEqual(await panel.channel.rendered('explorer', 'latest'), 3);
		assert.ok(allTabs().some(tab => tab.label === 'feature — browse'), 'tab "feature — browse"');
		assert.strictEqual(repo.git('rev-parse', '--abbrev-ref', 'HEAD').trim(), 'main');
	});

	it('previews a file of the branch', async () => {
		const shown = panel.channel.rendered('file');
		await panel.handle({ type: 'openFile', path: 'src/c.txt' });
		assert.strictEqual(await shown, 3, 'three lines');
	});

	it('searches text in the branch', async () => {
		const found = panel.channel.rendered('search');
		await panel.handle({ type: 'search', query: 'HELLO', options: { matchCase: false, wholeWord: false, regex: false } });
		assert.strictEqual(await found, 1);
	});

	it('copies a file of the branch into the working tree', async () => {
		await panel.handle({ type: 'copyToWorkingTree', path: 'b.txt' });
		const copy = path.join(repo.dir, 'b.txt');
		await waitFor(() => fs.existsSync(copy), 'b.txt copied');
		assert.strictEqual(fs.readFileSync(copy, 'utf8'), 'b\n');
		fs.rmSync(copy);
	});

	it('diffs the branch version of a file with the working copy', async () => {
		const groups = vscode.window.tabGroups.all.length;
		await panel.handle({ type: 'diffWithMine', path: 'a.txt' });
		await waitFor(() => allTabs().some(tab => tab.label === 'a.txt (feature ↔ working tree)'), 'the file diff', 10000);
		await vscode.commands.executeCommand('gitConvenient.close');
		await waitFor(() => vscode.window.tabGroups.all.length === groups, 'floating window closed');
	});

	it('opens the diff against the current branch in the floating window', async () => {
		const groups = vscode.window.tabGroups.all.length;
		await panel.handle({ type: 'openFullDiff' });
		await waitFor(() => allTabs().some(tab => tab.label.startsWith('main ↔ feature')), 'the branch diff', 10000);
		await vscode.commands.executeCommand('gitConvenient.close');
		await waitFor(() => vscode.window.tabGroups.all.length === groups, 'floating window closed');
	});
});
