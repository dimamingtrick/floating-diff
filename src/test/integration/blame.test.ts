import * as assert from 'assert';
import * as vscode from 'vscode';
import type { LineBlame } from '../../blame/lineBlame';
import type { GitConvenientExports } from '../../extension';
import { createTestRepo, openTestRepo, TestRepo, waitFor } from './util';

// The blame of the line the cursor is on, like GitLens: app.ts has a line from
// each of two commits, the second one by somebody else.
describe('Line blame', function () {
	this.timeout(60000);
	let repo: TestRepo;
	let blame: LineBlame;
	let second: string;

	const at = async (line: number) => {
		const editor = vscode.window.activeTextEditor!;
		editor.selection = new vscode.Selection(line, 0, line, 0);
		return blame.annotate(editor);
	};

	before(async () => {
		repo = createTestRepo('git-convenient-blame-');
		repo.write('app.ts', 'const one = 1;\nconst two = 2;\n');
		repo.git('add', '.');
		repo.git('commit', '-qm', 'feat: the first two');
		repo.write('app.ts', 'const one = 1;\nconst two = 22;\n');
		repo.git('-c', 'user.name=Olena K.', '-c', 'user.email=olena@example.com', 'commit', '-qam', 'fix: the second one');
		second = repo.git('rev-parse', 'HEAD').trim();
		await openTestRepo(repo.dir, 'app.ts');
		blame = vscode.extensions.getExtension<GitConvenientExports>('DimaShraho.git-convenient')!.exports.blame!;
		assert.ok(blame, 'the extension exports the line blame');
	});

	after(async () => {
		await vscode.workspace.getConfiguration('gitConvenient').update('lineBlame', undefined, vscode.ConfigurationTarget.Global);
		await vscode.commands.executeCommand('workbench.action.closeAllEditors');
	});

	it('names who last changed the line, when, and with which commit', async () => {
		assert.strictEqual((await at(1))?.text, 'Olena K., seconds ago • fix: the second one');
		// The repository's own identity made the first commit.
		assert.strictEqual((await at(0))?.text, 'You, seconds ago • feat: the first two');
	});

	it('gives the commit, its date, message and actions in the tooltip', async () => {
		const note = await at(1);

		const lines = note!.markdown.split('\n');
		assert.match(lines[0], /^\*\*Olena K\.\*\* <olena@example\.com>, seconds ago \(\d{1,2} \w{3} \d{4} \d{2}:\d{2}\)$/);
		assert.strictEqual(lines[2], 'fix: the second one');
		assert.strictEqual(
			lines[4],
			`[Open diff](command:gitConvenient.blame.openDiff) · [File History](command:gitConvenient.fileHistory) · [Copy ${second.slice(0, 7)}](command:gitConvenient.blame.copyHash)`,
		);
	});

	it('blames the text the editor holds, before it is saved', async () => {
		const editor = vscode.window.activeTextEditor!;
		await editor.edit(edit => edit.insert(new vscode.Position(1, 0), 'const added = 0;\n'));

		assert.strictEqual((await at(1))?.text, 'You • Uncommitted changes');
		assert.strictEqual((await at(2))?.text, 'Olena K., seconds ago • fix: the second one');

		await vscode.commands.executeCommand('workbench.action.files.revert');
		await waitFor(() => !editor.document.isDirty, 'the file back as it was');
	});

	it('shows the line it settles on, so its commit is the one Copy takes', async () => {
		await vscode.env.clipboard.writeText('nothing yet');
		const editor = vscode.window.activeTextEditor!;
		editor.selection = new vscode.Selection(1, 0, 1, 0);

		// Long enough for the debounce and git.
		await new Promise(resolve => setTimeout(resolve, 800));
		await vscode.commands.executeCommand('gitConvenient.blame.copyHash');

		assert.strictEqual(await vscode.env.clipboard.readText(), second);
	});

	it('shows nothing while the setting is off', async () => {
		await vscode.workspace.getConfiguration('gitConvenient').update('lineBlame', false, vscode.ConfigurationTarget.Global);
		await vscode.env.clipboard.writeText('nothing yet');
		const editor = vscode.window.activeTextEditor!;
		editor.selection = new vscode.Selection(0, 0, 0, 0);
		await new Promise(resolve => setTimeout(resolve, 500));

		await vscode.commands.executeCommand('gitConvenient.blame.copyHash');

		assert.strictEqual(await vscode.env.clipboard.readText(), 'nothing yet');
		assert.strictEqual(blame.enabled, false);
	});
});
