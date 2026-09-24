import * as assert from 'assert';
import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import type { GitConvenientExports } from '../../extension';
import type { API, GitExtension, Repository, RepositoryOperations } from '../../git';
import type { ChangeRef, SidebarRepo } from '../../shared/protocol';
import type { Sidebar } from '../../sidebar/sidebar';
import { changeGroups } from '../../sidebar/sidebarModel';
import { allTabs, createTestRepo, openTestRepo, TestRepo, waitFor } from './util';

type Repo = Repository & RepositoryOperations;

// Two repositories, like a project with a nested one: `first` (with a bare origin,
// a branch and a tag) has a.ts edited and new.txt untracked; `second` has b.ts
// edited and none of its files is ever opened.
describe('Git Convenient sidebar', function () {
	this.timeout(60000);
	let first: TestRepo;
	let second: TestRepo;
	let repository: Repo;
	let other: Repo;
	let sidebar: Sidebar;
	let origin: string;

	const repoState = (repo: TestRepo): SidebarRepo | undefined => sidebar.snapshot()?.repos.find(candidate => candidate.root === repo.dir);
	const ref = (repo: TestRepo, group: ChangeRef['group'], file: string): ChangeRef => ({ root: repo.dir, group, path: file });
	const staged = () => repository.state.indexChanges.map(change => path.basename(change.uri.fsPath)).sort();

	before(async () => {
		first = createTestRepo('git-convenient-sidebar-');
		origin = path.join(path.dirname(first.dir), 'origin.git');
		execFileSync('git', ['init', '-q', '--bare', origin]);
		first.write('a.ts', 'export const a = 1;\n');
		first.git('add', '.');
		first.git('commit', '-qm', 'init');
		first.git('branch', 'feature');
		first.git('tag', 'v1');
		first.git('remote', 'add', 'origin', origin);
		first.git('push', '-q', '-u', 'origin', 'main');
		second = createTestRepo('git-convenient-sidebar-other-');
		second.write('b.ts', 'export const b = 1;\n');
		second.git('add', '.');
		second.git('commit', '-qm', 'init');

		({ repository } = await openTestRepo(first.dir, 'a.ts'));
		const api: API = vscode.extensions.getExtension<GitExtension>('vscode.git')!.exports.getAPI(1);
		await vscode.commands.executeCommand('git.openRepository', second.dir);
		await waitFor(() => api.getRepository(vscode.Uri.file(second.dir)) !== null, 'second repository open', 15000);
		other = api.getRepository(vscode.Uri.file(second.dir)) as Repo;

		first.write('a.ts', 'export const a = 2;\n');
		first.write('new.txt', 'new\n');
		second.write('b.ts', 'export const b = 2;\n');
		await Promise.all([repository.status(), other.status()]);

		sidebar = vscode.extensions.getExtension<GitConvenientExports>('DimaShraho.git-convenient')!.exports.sidebar!;
		assert.ok(sidebar, 'the extension exposes its sidebar');
		await vscode.commands.executeCommand('workbench.view.extension.gitConvenient');
		await waitFor(() => sidebar.channel !== undefined, 'the Git Convenient view', 10000);
	});

	after(async () => {
		await vscode.commands.executeCommand('workbench.action.closeAllEditors');
	});

	it("shows every repository's changes, without opening their files", async () => {
		await waitFor(() => repoState(first)?.changeCount === 2 && repoState(second)?.changeCount === 1, 'changes of both repositories', 10000);
		assert.deepStrictEqual(repoState(second)!.groups.map(group => [group.label, group.files.map(file => file.path)]), [['Changes', ['b.ts']]]);
		assert.strictEqual(repoState(first)!.current?.name, 'main');
		assert.ok((await sidebar.channel!.rendered('sidebar', 'latest')) >= 3, 'the view shows them');
	});

	it("shows files with the icon theme's icons and Git's letters and colors", async () => {
		await waitFor(() => repoState(first)?.changeCount === 2, 'two changes');
		const files = repoState(first)!.groups.flatMap(group => group.files);
		const ts = files.find(file => file.name === 'a.ts')!;
		assert.deepStrictEqual([ts.letter, ts.decoration, ts.dir], ['M', 'modified', '']);
		assert.ok(ts.icon?.kind === 'glyph' && ts.icon.char.length > 0, `a.ts has an icon of the default theme: ${JSON.stringify(ts.icon)}`);
		assert.ok((sidebar.snapshot()?.iconFonts.length ?? 0) > 0, "the theme's font reaches the view");
		assert.strictEqual(files.find(file => file.name === 'new.txt')?.letter, 'U');
	});

	it('counts pending changes of all repositories on the Activity Bar, like Source Control', async () => {
		await waitFor(() => repoState(first)?.changeCount === 2, 'two changes');
		const total = sidebar.snapshot()!.repos.reduce((sum, repo) => sum + repo.changeCount, 0);
		await waitFor(() => sidebar.badgeView.badge?.value === total, `badge ${total}`);
	});

	it("stages and unstages files with Git's own commands", async () => {
		const row = changeGroups(repository).flatMap(group => group.rows).find(candidate => candidate.name === 'a.ts')!;
		assert.ok(sidebar.actions.gitResource(repository, row), "Git's own resource, so Source Control's commands apply");

		await sidebar.handle({ type: 'change', action: 'stage', items: [ref(first, 'workingTree', 'a.ts')] });
		await waitFor(() => staged().join() === 'a.ts', 'a.ts staged');
		await waitFor(() => repoState(first)?.groups.some(group => group.label === 'Staged Changes') === true, 'Staged Changes shown');

		await sidebar.handle({ type: 'change', action: 'unstage', items: [ref(first, 'index', 'a.ts')] });
		await waitFor(() => staged().length === 0, 'a.ts unstaged');
	});

	it('runs a context menu command on all selected files, and group commands', async () => {
		await sidebar.handle({ type: 'select', items: [ref(first, 'workingTree', 'a.ts'), ref(first, 'workingTree', 'new.txt')] });
		await vscode.commands.executeCommand('gitConvenient.changes.stage', { webviewSection: 'change', root: first.dir, gitConvenientGroup: 'workingTree', path: 'a.ts' });
		await waitFor(() => staged().join() === 'a.ts,new.txt', 'the selection staged');

		await vscode.commands.executeCommand('gitConvenient.changes.unstageAll', { webviewSection: 'changeGroup', root: first.dir, gitConvenientGroup: 'index' });
		await waitFor(() => staged().length === 0, 'everything unstaged');
		assert.strictEqual(other.state.indexChanges.length, 0, 'the other repository is untouched');
	});

	it('opens a change in the floating window', async () => {
		const windows = vscode.window.tabGroups.all.length;
		await sidebar.handle({ type: 'change', action: 'open', items: [ref(second, 'workingTree', 'b.ts')] });
		await waitFor(() => allTabs().some(tab => tab.label.startsWith('b.ts')), 'a diff of b.ts', 10000);
		await vscode.commands.executeCommand('gitConvenient.close');
		await waitFor(() => vscode.window.tabGroups.all.length === windows, 'floating window closed');
	});

	it("commits one repository's staged files with its message box", async () => {
		await sidebar.handle({ type: 'change', action: 'stage', items: [ref(first, 'workingTree', 'a.ts')] });
		await waitFor(() => staged().join() === 'a.ts', 'a.ts staged');

		await sidebar.handle({ type: 'commit', root: first.dir, message: 'from the sidebar', push: false });

		assert.strictEqual(first.git('log', '-1', '--format=%s').trim(), 'from the sidebar');
		assert.strictEqual(first.git('status', '--porcelain'), '?? new.txt\n', 'the untracked file stays out');
		assert.strictEqual(second.git('log', '-1', '--format=%s').trim(), 'init', 'the other repository is untouched');
		await waitFor(() => repository.inputBox.value === '', 'the message box emptied');
	});

	it("pushes a repository with Git's own push", async () => {
		await sidebar.handle({ type: 'sync', root: first.dir, action: 'push' });

		assert.strictEqual(first.git('rev-parse', 'origin/main'), first.git('rev-parse', 'HEAD'));
	});

	it("pulls and pushes the repository of an editor's file, for the buttons in its title", async () => {
		// Someone else pushes to origin; Pull in the title of a.ts brings it in.
		const clone = path.join(path.dirname(first.dir), 'clone');
		execFileSync('git', ['clone', '-q', origin, clone]);
		const run = (...args: string[]) => execFileSync('git', args, { cwd: clone, stdio: 'pipe' }).toString();
		run('config', 'user.email', 'other@example.com');
		run('config', 'user.name', 'Other');
		fs.writeFileSync(path.join(clone, 'remote.ts'), 'export const r = 1;\n');
		run('add', '.');
		run('commit', '-qm', 'from the remote');
		run('push', '-q', 'origin', 'main');
		const remoteCommit = run('rev-parse', 'HEAD').trim();
		// The button knows its own editor's file: no open editor picks the repository here.
		await vscode.commands.executeCommand('workbench.action.closeAllEditors');

		await vscode.commands.executeCommand('gitConvenient.pull', vscode.Uri.file(path.join(first.dir, 'a.ts')));
		await waitFor(() => first.git('rev-parse', 'HEAD').trim() === remoteCommit, 'the remote commit pulled in', 20000);

		first.write('a.ts', 'export const a = 3;\n');
		first.git('commit', '-qam', 'pushed from the title');
		await vscode.commands.executeCommand('gitConvenient.push', vscode.Uri.file(path.join(first.dir, 'a.ts')));

		await waitFor(() => first.git('rev-parse', 'origin/main') === first.git('rev-parse', 'HEAD'), 'the commit pushed', 20000);
		assert.strictEqual(second.git('log', '-1', '--format=%s').trim(), 'init', 'the other repository is untouched');
	});

	it('switches between a list and a tree of files, like Source Control', async () => {
		await vscode.commands.executeCommand('gitConvenient.viewAsTree');
		await waitFor(() => sidebar.snapshot()?.viewMode === 'tree', 'tree view');
		await vscode.commands.executeCommand('gitConvenient.viewAsList');
		await waitFor(() => sidebar.snapshot()?.viewMode === 'list', 'list view');
	});

	it("runs a folder's context menu command on the files in it", async () => {
		first.write('src/deep/c.ts', 'export const c = 1;\n');
		await repository.status();
		await waitFor(() => repoState(first)?.groups.some(group => group.files.some(file => file.path === 'src/deep/c.ts')) === true, 'src/deep/c.ts listed');

		await vscode.commands.executeCommand('gitConvenient.changes.stage', { webviewSection: 'changeFolder', root: first.dir, gitConvenientGroup: 'workingTree', path: 'src' });
		await waitFor(() => staged().join() === 'c.ts', 'the folder staged');

		await vscode.commands.executeCommand('gitConvenient.changes.unstageAll', { webviewSection: 'changeGroup', root: first.dir, gitConvenientGroup: 'index' });
		await waitFor(() => staged().length === 0, 'unstaged again');
	});

	it('puts the cursor on the first change when it opens a file', async () => {
		await vscode.commands.executeCommand('workbench.action.closeAllEditors');
		first.write('long.ts', Array.from({ length: 40 }, (_, i) => `const line${i + 1} = ${i + 1};`).join('\n') + '\n');
		first.git('add', 'long.ts');
		first.git('commit', '-qm', 'long file');
		first.write('long.ts', Array.from({ length: 40 }, (_, i) => `const line${i + 1} = ${i === 24 ? 999 : i + 1};`).join('\n') + '\n');
		await repository.status();
		await waitFor(() => repoState(first)?.groups.some(group => group.files.some(file => file.path === 'long.ts')) === true, 'long.ts listed');

		await sidebar.handle({ type: 'change', action: 'openFile', items: [ref(first, 'workingTree', 'long.ts')] });

		await waitFor(() => vscode.window.activeTextEditor?.document.uri.path.endsWith('long.ts') === true, 'long.ts in an editor', 10000);
		await waitFor(() => vscode.window.activeTextEditor?.selection.active.line === 24, 'the cursor on the changed line', 10000);
	});

	it('copies the relative paths of the selected files from the context menu', async () => {
		await sidebar.handle({ type: 'select', items: [ref(first, 'workingTree', 'src/deep/c.ts'), ref(first, 'workingTree', 'a.ts')] });

		await vscode.commands.executeCommand('gitConvenient.changes.copyPath', { webviewSection: 'change', root: first.dir, gitConvenientGroup: 'workingTree', path: 'a.ts' });

		assert.strictEqual(await vscode.env.clipboard.readText(), 'src/deep/c.ts\na.ts');
	});

	it('copies only the clicked file when it is outside the selection', async () => {
		await sidebar.handle({ type: 'select', items: [ref(first, 'workingTree', 'a.ts')] });

		await vscode.commands.executeCommand('gitConvenient.changes.copyPath', { webviewSection: 'change', root: first.dir, gitConvenientGroup: 'workingTree', path: 'src/deep/c.ts' });

		assert.strictEqual(await vscode.env.clipboard.readText(), 'src/deep/c.ts');
	});
});
