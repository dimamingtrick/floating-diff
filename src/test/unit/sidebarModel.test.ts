import * as assert from 'assert';
import type { Uri } from 'vscode';
import type { BranchInfo } from '../../branches/branchModel';
import { Change, Repository, RepositoryState, Status } from '../../git';
import { changeGroups, changesBadge, repositoryCount, sidebarGroups, statusDecoration } from '../../sidebar/sidebarModel';

function branch(name: string, extra: Partial<BranchInfo> = {}): BranchInfo {
	return { name, ahead: 0, behind: 0, current: false, merged: false, ...extra };
}

function fileUri(path: string): Uri {
	return { scheme: 'file', path, toString: () => `file://${path}` } as unknown as Uri;
}

function change(path: string, status: Status): Change {
	const uri = fileUri(path);
	return { uri, originalUri: uri, renameUri: undefined, status };
}

function repo(state: Partial<RepositoryState>): Repository {
	return {
		rootUri: fileUri('/repo'),
		state: { indexChanges: [], workingTreeChanges: [], mergeChanges: [], remotes: [], onDidChange: () => ({ dispose: () => { } }), ...state },
	};
}

describe('sidebarGroups', () => {
	it('lists recent, local, each remote and tags', () => {
		const main = branch('main', { current: true, ahead: 1 });
		const feature = branch('feature', { behind: 2, upstream: 'origin/feature' });
		const list = {
			branches: [feature, main, branch('origin/main', { remote: 'origin' }), branch('upstream/dev', { remote: 'upstream' })],
			// The current branch is on its own card, not in Recent.
			recent: ['main', 'feature', 'gone'],
			current: main,
		};

		assert.deepStrictEqual(sidebarGroups(list, ['v1.0']), [
			{ title: 'Recent', items: [{ name: 'feature', sync: '↓2', current: false, kind: 'local' }] },
			{
				title: 'Local',
				items: [
					{ name: 'main', sync: '↑1', current: true, kind: 'local' },
					{ name: 'feature', sync: '↓2', current: false, kind: 'local' },
				],
			},
			{ title: 'Remotes / origin', items: [{ name: 'origin/main', sync: '', current: false, kind: 'remote' }] },
			{ title: 'Remotes / upstream', items: [{ name: 'upstream/dev', sync: '', current: false, kind: 'remote' }] },
			{ title: 'Tags', items: [{ name: 'v1.0', sync: '', current: false, kind: 'tag' }] },
		]);
	});

	it('leaves out empty groups', () => {
		const main = branch('main', { current: true });
		assert.deepStrictEqual(sidebarGroups({ branches: [main], recent: [], current: main }, []).map(g => g.title), ['Local']);
	});
});

describe('changeGroups', () => {
	it('lists conflicts, staged, changed and untracked files like Source Control, with paths from the repository', () => {
		const repository = repo({
			mergeChanges: [change('/repo/conflict.ts', Status.BOTH_MODIFIED)],
			indexChanges: [change('/repo/src/staged.ts', Status.INDEX_ADDED)],
			workingTreeChanges: [change('/repo/README.md', Status.MODIFIED)],
			untrackedChanges: [change('/repo/src/deep/new.ts', Status.UNTRACKED)],
		});

		const groups = changeGroups(repository);

		assert.deepStrictEqual(groups.map(g => [g.group, g.label]), [
			['merge', 'Merge Changes'],
			['index', 'Staged Changes'],
			['workingTree', 'Changes'],
			['untracked', 'Untracked Changes'],
		]);
		assert.deepStrictEqual(groups.flatMap(g => g.rows.map(r => [r.group, r.path, r.name, r.dir])), [
			['merge', 'conflict.ts', 'conflict.ts', ''],
			['index', 'src/staged.ts', 'staged.ts', 'src'],
			['workingTree', 'README.md', 'README.md', ''],
			['untracked', 'src/deep/new.ts', 'new.ts', 'src/deep'],
		]);
		assert.strictEqual(groups[1].rows[0].change, repository.state.indexChanges[0], 'rows keep the Git change');
	});

	it('always shows Changes and leaves out the other groups while they are empty', () => {
		assert.deepStrictEqual(changeGroups(repo({})).map(g => [g.group, g.rows.length]), [['workingTree', 0]]);
	});
});

describe('statusDecoration', () => {
	it("gives Git's letter, color and description of a status", () => {
		assert.deepStrictEqual(statusDecoration(Status.MODIFIED), { letter: 'M', decoration: 'modified', text: 'Modified' });
		assert.deepStrictEqual(statusDecoration(Status.INDEX_MODIFIED), { letter: 'M', decoration: 'stageModified', text: 'Index Modified' });
		assert.deepStrictEqual(statusDecoration(Status.UNTRACKED), { letter: 'U', decoration: 'untracked', text: 'Untracked' });
		assert.deepStrictEqual(statusDecoration(Status.DELETED), { letter: 'D', decoration: 'deleted', text: 'Deleted' });
		assert.deepStrictEqual(statusDecoration(Status.BOTH_MODIFIED), { letter: '!', decoration: 'conflict', text: 'Conflict: Both Modified' });
	});
});

describe('changes badge', () => {
	const state = repo({
		mergeChanges: [change('/repo/c.ts', Status.BOTH_MODIFIED)],
		indexChanges: [change('/repo/s.ts', Status.INDEX_ADDED)],
		workingTreeChanges: [change('/repo/m.ts', Status.MODIFIED), change('/repo/u.ts', Status.UNTRACKED)],
	}).state;

	it("counts a repository's changes like Git (git.countBadge)", () => {
		assert.strictEqual(repositoryCount(state, { countBadge: 'all', untrackedChanges: 'mixed' }), 4);
		assert.strictEqual(repositoryCount(state, { countBadge: 'tracked', untrackedChanges: 'mixed' }), 3);
		assert.strictEqual(repositoryCount(state, { countBadge: 'off', untrackedChanges: 'mixed' }), 0);
		const separate = repo({ workingTreeChanges: [change('/repo/m.ts', Status.MODIFIED)], untrackedChanges: [change('/repo/u.ts', Status.UNTRACKED)] }).state;
		assert.strictEqual(repositoryCount(separate, { countBadge: 'all', untrackedChanges: 'separate' }), 2);
		assert.strictEqual(repositoryCount(separate, { countBadge: 'tracked', untrackedChanges: 'separate' }), 1);
	});

	it('sums repositories like Source Control (scm.countBadge)', () => {
		assert.deepStrictEqual(changesBadge([3, 1], 'all', 1), { value: 4, tooltip: '4 pending changes' });
		assert.deepStrictEqual(changesBadge([3, 1], 'focused', 1), { value: 1, tooltip: '1 pending change' });
		assert.strictEqual(changesBadge([3, 1], 'off', 0), undefined);
		assert.strictEqual(changesBadge([0], 'all', 0), undefined);
	});
});
