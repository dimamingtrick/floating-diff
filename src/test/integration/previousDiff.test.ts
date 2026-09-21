import * as assert from 'assert';
import * as path from 'path';
import * as vscode from 'vscode';
import { createTestRepo, openTestRepo, TestRepo, waitFor } from './util';

// WebStorm's Compare with Previous Version: the button next to File History walks
// back through the commits of the file, one click at a time.
describe('Diff with the previous revision', function () {
	this.timeout(60000);
	let repo: TestRepo;
	/** Newest first: fix, rename, first. */
	let hashes: string[];

	const activeDiff = () => {
		const input = vscode.window.tabGroups.activeTabGroup.activeTab?.input;
		return input instanceof vscode.TabInputTextDiff ? input : undefined;
	};
	const refOf = (uri: vscode.Uri) => (JSON.parse(uri.query) as { ref: string }).ref;
	const step = () => vscode.commands.executeCommand('gitConvenient.diffWithPrevious', vscode.Uri.file(path.join(repo.dir, 'app.ts')));
	const waitForLeft = (hash: string) =>
		waitFor(() => {
			const diff = activeDiff();
			return diff !== undefined && diff.original.scheme === 'git' && refOf(diff.original) === hash;
		}, `the diff whose older side is ${hash.slice(0, 7)}`, 15000);

	before(async () => {
		repo = createTestRepo('git-convenient-previous-');
		repo.write('old.ts', 'one\ntwo\n');
		repo.git('add', '.');
		repo.git('commit', '-qm', 'feat: the first two');
		repo.git('mv', 'old.ts', 'app.ts');
		repo.write('app.ts', 'one\ntwo\nthree\n');
		repo.git('commit', '-qam', 'refactor: rename it');
		repo.write('app.ts', 'one\ntwo\nthree and a half\n');
		repo.git('commit', '-qam', 'fix: the second one');
		repo.write('app.ts', 'one\ntwo\nthree and a half\nnot committed\n');
		hashes = repo.git('log', '--format=%H').trim().split('\n');
		await openTestRepo(repo.dir, 'app.ts');
	});

	after(async () => {
		await vscode.commands.executeCommand('workbench.action.closeAllEditors');
	});

	it('compares the working tree with the newest commit of the file', async () => {
		await step();

		await waitForLeft(hashes[0]);
		const diff = activeDiff()!;
		assert.strictEqual(diff.modified.scheme, 'file', 'the working tree is on the right');
		assert.strictEqual(vscode.window.tabGroups.activeTabGroup.activeTab?.label, `app.ts (${hashes[0].slice(0, 7)} ↔ working tree · fix: the second one)`);
	});

	it('steps back one commit at a time, through the rename', async () => {
		await step();

		await waitForLeft(hashes[1]);
		assert.strictEqual(refOf(activeDiff()!.modified), hashes[0]);
		assert.strictEqual(
			vscode.window.tabGroups.activeTabGroup.activeTab?.label,
			`app.ts (${hashes[1].slice(0, 7)} ↔ ${hashes[0].slice(0, 7)} · fix: the second one)`,
		);

		await step();

		await waitForLeft(hashes[2]);
		const older = activeDiff()!;
		assert.strictEqual(refOf(older.modified), hashes[1]);
		assert.ok(older.original.path.endsWith('old.ts'), `the file had its old name: ${older.original.path}`);
		assert.strictEqual(
			vscode.window.tabGroups.activeTabGroup.activeTab?.label,
			`app.ts (${hashes[2].slice(0, 7)} ↔ ${hashes[1].slice(0, 7)} · refactor: rename it)`,
		);
	});

	it('stays put at the commit that added the file', async () => {
		const label = vscode.window.tabGroups.activeTabGroup.activeTab?.label;

		await step();
		await new Promise(resolve => setTimeout(resolve, 500));

		assert.strictEqual(vscode.window.tabGroups.activeTabGroup.activeTab?.label, label);
	});
});
