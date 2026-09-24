import * as assert from 'assert';
import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import type { BranchInfo } from '../../branches/branchModel';
import { BranchService } from '../../branches/branchService';
import { createGitRunner } from '../../branches/gitRunner';
import type { API, GitExtension, Repository, RepositoryOperations } from '../../git';
import { waitFor } from './util';

// Real repositories: `work` with a bare `origin`, driven through the Git extension.
describe('BranchService', function () {
	this.timeout(60000);
	let work: string;
	let api: API;
	let repo: Repository & RepositoryOperations;
	let service: BranchService;

	const git = (cwd: string, ...args: string[]) => execFileSync('git', args, { cwd, stdio: 'pipe' }).toString();
	const write = (name: string, text: string) => fs.writeFileSync(path.join(work, name), text);
	async function branch(name: string): Promise<BranchInfo> {
		const found = (await service.list()).branches.find(b => b.name === name);
		assert.ok(found, `branch ${name} exists`);
		return found;
	}

	before(async () => {
		const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'git-convenient-branches-')));
		const origin = path.join(root, 'origin.git');
		work = path.join(root, 'work');
		git(root, 'init', '-q', '--bare', origin);
		fs.mkdirSync(work);
		git(work, 'init', '-q', '-b', 'main');
		git(work, 'config', 'user.email', 'test@example.com');
		git(work, 'config', 'user.name', 'Test');
		write('a.txt', 'a\n');
		git(work, 'add', 'a.txt');
		git(work, 'commit', '-qm', 'init');
		git(work, 'remote', 'add', 'origin', origin);
		git(work, 'push', '-q', '-u', 'origin', 'main');
		git(work, 'checkout', '-q', '-b', 'feature');
		write('b.txt', 'b\n');
		git(work, 'add', 'b.txt');
		git(work, 'commit', '-qm', 'feature');
		git(work, 'push', '-q', '-u', 'origin', 'feature');
		git(work, 'checkout', '-q', 'main');
		git(work, 'branch', 'topic');
		git(work, 'push', '-q', 'origin', 'main:refs/heads/remote-only');
		git(work, 'fetch', '-q', 'origin');

		const extension = vscode.extensions.getExtension<GitExtension>('vscode.git')!;
		api = (extension.isActive ? extension.exports : await extension.activate()).getAPI(1);
		await vscode.commands.executeCommand('git.openRepository', work);
		await waitFor(() => api.getRepository(vscode.Uri.file(work)) !== null, 'repository open', 15000);
		repo = api.getRepository(vscode.Uri.file(work))!;
		service = new BranchService(repo, createGitRunner(api.git.path, work), (uri, ref) => api.toGitUri(uri, ref));
	});

	it('lists local and remote branches with current, merged and recent', async () => {
		const list = await service.list();
		const names = list.branches.map(b => b.name);

		assert.strictEqual(list.current?.name, 'main');
		for (const name of ['main', 'feature', 'topic', 'origin/main', 'origin/feature', 'origin/remote-only']) {
			assert.ok(names.includes(name), name);
		}
		assert.strictEqual((await branch('topic')).merged, true);
		assert.strictEqual((await branch('feature')).merged, false);
		assert.strictEqual((await branch('feature')).upstream, 'origin/feature');
		assert.ok(list.recent.includes('main'), `recent: ${list.recent.join(', ')}`);
	});

	it('checks out a local branch', async () => {
		await service.checkout(await branch('feature'), (await service.list()).branches);
		await waitFor(() => repo.state.HEAD?.name === 'feature', 'on feature');
	});

	it('checks out a remote branch as a local tracking branch', async () => {
		await service.checkout(await branch('origin/remote-only'), (await service.list()).branches);

		const local = await branch('remote-only');
		assert.ok(local.current);
		assert.strictEqual(local.upstream, 'origin/remote-only');
	});

	it('creates a branch from another one and checks it out', async () => {
		await service.create('new-one', 'main');
		await waitFor(() => repo.state.HEAD?.name === 'new-one', 'on new-one');
	});

	it('renames a branch', async () => {
		await service.rename(await branch('topic'), 'topic2');

		const names = (await service.list()).branches.map(b => b.name);
		assert.ok(names.includes('topic2') && !names.includes('topic'), names.join(', '));
	});

	it('deletes a branch', async () => {
		await service.delete(await branch('topic2'));

		assert.ok(!(await service.list()).branches.some(b => b.name === 'topic2'));
	});

	it('compares a branch with the current one from their merge base', async () => {
		const req = await service.compare(await branch('feature'), 'main');

		assert.ok(req && req.kind === 'changes');
		assert.strictEqual(req.title, 'main ↔ feature');
		const added = req.resources.find(r => path.basename(r.label.fsPath) === 'b.txt');
		assert.ok(added, 'b.txt is listed');
		assert.strictEqual(added.original, undefined, 'b.txt was added');
		assert.ok(added.modified);
	});

	it('diffs a branch with the working tree', async () => {
		await service.checkout(await branch('main'), (await service.list()).branches);
		await waitFor(() => repo.state.HEAD?.name === 'main', 'on main');
		write('a.txt', 'changed\n');
		try {
			const req = await service.diffWithWorkingTree(await branch('main'));

			assert.ok(req && req.kind === 'changes');
			const changed = req.resources.find(r => path.basename(r.label.fsPath) === 'a.txt');
			assert.ok(changed, 'a.txt is listed');
			assert.strictEqual(changed.modified?.fsPath, path.join(work, 'a.txt'));
		} finally {
			git(work, 'checkout', '--', 'a.txt');
		}
	});

	it('merges a branch into the current one', async () => {
		await service.merge(await branch('feature'));

		assert.ok(fs.existsSync(path.join(work, 'b.txt')));
	});

	it('pulls a branch that is not checked out, without touching the working tree', async () => {
		// A commit someone else pushed to origin/feature.
		const other = path.join(path.dirname(work), 'other');
		git(path.dirname(work), 'clone', '-q', '-b', 'feature', path.join(path.dirname(work), 'origin.git'), other);
		git(other, 'config', 'user.email', 'other@example.com');
		git(other, 'config', 'user.name', 'Other');
		fs.writeFileSync(path.join(other, 'c.txt'), 'c\n');
		git(other, 'add', 'c.txt');
		git(other, 'commit', '-qm', 'from elsewhere');
		git(other, 'push', '-q', 'origin', 'feature');
		const pushed = git(other, 'rev-parse', 'HEAD').trim();

		await service.pull(await branch('feature'));

		assert.strictEqual(git(work, 'rev-parse', 'feature').trim(), pushed, 'feature moved to the pushed commit');
		assert.strictEqual(git(work, 'rev-parse', '--abbrev-ref', 'HEAD').trim(), 'main', 'still on main');
		assert.ok(!fs.existsSync(path.join(work, 'c.txt')), 'the working tree is untouched');
	});

	it('says why a branch without an upstream cannot be pulled', async () => {
		await assert.rejects(() => service.pull({ name: 'new-one', ahead: 0, behind: 0, current: false, merged: false }), /no upstream/);
	});
});
