import * as assert from 'assert';
import { execSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import type { GitExtension } from '../../git';
import { waitFor } from './util';

interface InternalResource {
	readonly resourceUri: vscode.Uri;
	readonly command: vscode.Command;
}

interface InternalRepository {
	readonly workingTreeGroup: { readonly resourceStates: readonly InternalResource[] };
}

// Exercises the real Git extension internals the redirect depends on.
describe('Source Control redirect', () => {
	it('makes clicking a changed file in Source Control open the floating window', async function () {
		this.timeout(30000);
		const repoDir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'floating-diff-scm-')));
		const git = (args: string) => execSync(`git ${args}`, { cwd: repoDir, stdio: 'ignore' });
		git('init -q');
		git('config user.email test@example.com');
		git('config user.name Test');
		fs.writeFileSync(path.join(repoDir, 'a.txt'), 'old\n');
		git('add a.txt');
		git('commit -qm init');
		fs.writeFileSync(path.join(repoDir, 'a.txt'), 'new\n');

		await vscode.extensions.getExtension('local.floating-diff')!.activate();
		const gitExtension = vscode.extensions.getExtension<GitExtension>('vscode.git')!;
		const model = (gitExtension.isActive ? gitExtension.exports : await gitExtension.activate()).model as { repositories: InternalRepository[] };
		await vscode.commands.executeCommand('git.openRepository', repoDir);

		const changed = () => model.repositories
			.flatMap(repository => repository.workingTreeGroup.resourceStates)
			.find(resource => resource.resourceUri.fsPath === path.join(repoDir, 'a.txt'));
		await waitFor(() => changed()?.command.command === 'floatingDiff.openScmResource', 'Source Control click redirected', 15000);

		// What the Source Control view runs on click / double-click.
		const groupsBefore = vscode.window.tabGroups.all.length;
		const click = changed()!.command;
		await vscode.commands.executeCommand(click.command, ...(click.arguments ?? []));

		const showsDiff = (group: vscode.TabGroup) => group.tabs.some(tab =>
			tab.input instanceof vscode.TabInputTextDiff && tab.input.modified.fsPath === path.join(repoDir, 'a.txt'));
		await waitFor(() => vscode.window.tabGroups.all.length === groupsBefore + 1
			&& vscode.window.tabGroups.all.some(showsDiff), 'the diff in a floating window');
		assert.ok(!vscode.window.tabGroups.all[0].tabs.some(tab => tab.input instanceof vscode.TabInputTextDiff), 'no diff tab in the main window');

		await vscode.commands.executeCommand('floatingDiff.close');
		await waitFor(() => vscode.window.tabGroups.all.length === groupsBefore, 'window closed');
	});

	it('does the same for a new (untracked) file', async function () {
		this.timeout(30000);
		const repoDir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'floating-diff-scm-new-')));
		execSync('git init -q', { cwd: repoDir, stdio: 'ignore' });
		const newFile = path.join(repoDir, 'new.txt');
		fs.writeFileSync(newFile, 'brand new\n');

		const gitExtension = vscode.extensions.getExtension<GitExtension>('vscode.git')!;
		const model = gitExtension.exports.model as { repositories: InternalRepository[] };
		await vscode.commands.executeCommand('git.openRepository', repoDir);
		const untracked = () => model.repositories
			.flatMap(repository => repository.workingTreeGroup.resourceStates)
			.find(resource => resource.resourceUri.fsPath === newFile);
		await waitFor(() => untracked()?.command.command === 'floatingDiff.openScmResource', 'untracked click redirected', 15000);

		const groupsBefore = vscode.window.tabGroups.all.length;
		const click = untracked()!.command;
		await vscode.commands.executeCommand(click.command, ...(click.arguments ?? []));

		await waitFor(() => vscode.window.tabGroups.all.length === groupsBefore + 1 && vscode.window.tabGroups.all.some(group =>
			group.tabs.some(tab => tab.input instanceof vscode.TabInputText && tab.input.uri.fsPath === newFile)), 'the new file in a floating window');

		await vscode.commands.executeCommand('floatingDiff.close');
		await waitFor(() => vscode.window.tabGroups.all.length === groupsBefore, 'window closed');
	});
});
