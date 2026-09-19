import * as assert from 'assert';
import * as vscode from 'vscode';
import type { LogPanel } from '../../log/logPanel';
import { createTestRepo, openTestRepo, TestRepo, waitForValue } from './util';

// 45 commits: the log shows them 20 at a time, and git searches all of them.
describe('Git Log pages', function () {
	this.timeout(60000);
	let repo: TestRepo;
	let panel: LogPanel;
	const shown = () => panel.channel.rendered('log', 'latest');

	before(async () => {
		repo = createTestRepo('gitstorm-log-pages-');
		repo.write('a.txt', 'a\n');
		repo.git('add', '.');
		repo.git('commit', '-qm', 'c1');
		for (let i = 2; i <= 45; i++) {
			repo.git('commit', '-q', '--allow-empty', '-m', `c${i}`);
		}
		await openTestRepo(repo.dir, 'a.txt');
		panel = (await vscode.commands.executeCommand<LogPanel>('gitStorm.logInEditor'))!;
	});

	after(async () => {
		await vscode.commands.executeCommand('workbench.action.closeAllEditors');
	});

	it('loads 20 commits at a time up to all of them', async () => {
		await waitForValue(async () => (await shown()) % 20 === 0 && (await shown()) >= 20, true, 'whole pages of 20', 10000);
		for (let i = 0; i < 3; i++) {
			await panel.handle({ type: 'loadMore' });
		}
		await waitForValue(shown, 45, 'all 45', 10000);
	});

	it('searches the messages of the whole history with git', async () => {
		await panel.handle({ type: 'filters', filters: { text: 'C1' } });
		// c1, c10…c19
		await waitForValue(shown, 11, 'eleven matches, pages or not', 10000);
	});

	it('finds a commit by the start of its hash', async () => {
		const hash = repo.git('log', '--format=%H', '--grep=^c7$').trim();
		await panel.handle({ type: 'filters', filters: { text: hash.slice(0, 8) } });
		await waitForValue(shown, 1, 'that commit', 10000);
	});
});
