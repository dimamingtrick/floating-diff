import * as assert from 'assert';
import {
	BranchInfo, branchActions, branchDescription, groupBranches, isValidBranchName, localName, parseBranches, parseLines, parseRecent, pullPlan, syncLabel,
} from '../../branches/branchModel';

const ref = (...fields: string[]) => fields.join('\0');

function branch(name: string, extra: Partial<BranchInfo> = {}): BranchInfo {
	return { name, ahead: 0, behind: 0, current: false, merged: false, ...extra };
}

describe('parseBranches', () => {
	const output = [
		ref('refs/heads/main', 'origin/main', 'ahead 1, behind 2', '*'),
		ref('refs/heads/feature/x', 'origin/feature/x', 'ahead 3', ' '),
		ref('refs/heads/old', 'origin/old', 'gone', ' '),
		ref('refs/heads/topic', '', '', ' '),
		ref('refs/remotes/origin/HEAD', '', '', ' '),
		ref('refs/remotes/origin/main', '', '', ' '),
		ref('refs/remotes/upstream/feature/y', '', '', ' '),
		'',
	].join('\n');
	const branches = parseBranches(output, new Set(['topic', 'main']));

	it('reads local branches with upstream, ahead/behind and current', () => {
		assert.deepStrictEqual(branches.slice(0, 4), [
			{ name: 'main', upstream: 'origin/main', ahead: 1, behind: 2, current: true, merged: false },
			{ name: 'feature/x', upstream: 'origin/feature/x', ahead: 3, behind: 0, current: false, merged: false },
			{ name: 'old', upstream: 'origin/old', ahead: 0, behind: 0, current: false, merged: false },
			{ name: 'topic', upstream: undefined, ahead: 0, behind: 0, current: false, merged: true },
		]);
	});

	it('reads remote branches and skips origin/HEAD', () => {
		assert.deepStrictEqual(branches.slice(4), [
			{ name: 'origin/main', remote: 'origin', ahead: 0, behind: 0, current: false, merged: false },
			{ name: 'upstream/feature/y', remote: 'upstream', ahead: 0, behind: 0, current: false, merged: false },
		]);
	});
});

describe('parseLines', () => {
	it('splits and trims non-empty lines', () => {
		assert.deepStrictEqual(parseLines(' main\nfeature/x \n\n'), ['main', 'feature/x']);
	});
});

describe('parseRecent', () => {
	const reflog = [
		'checkout: moving from feature/x to main',
		'commit: wip',
		'checkout: moving from main to feature/x',
		'checkout: moving from topic to 1a2b3c4d',
		'checkout: moving from main to topic',
		'checkout: moving from topic to main',
	].join('\n');

	it('lists checked-out branches newest first, unique, without detached hashes', () => {
		assert.deepStrictEqual(parseRecent(reflog), ['main', 'feature/x', 'topic']);
	});

	it('stops at the limit', () => {
		assert.deepStrictEqual(parseRecent(reflog, 2), ['main', 'feature/x']);
	});
});

describe('labels', () => {
	it('shows behind before ahead', () => {
		assert.strictEqual(syncLabel({ ahead: 1, behind: 2 }), '↓2 ↑1');
		assert.strictEqual(syncLabel({ ahead: 3, behind: 0 }), '↑3');
		assert.strictEqual(syncLabel({ ahead: 0, behind: 0 }), '');
	});

	it('describes current and merged branches with their sync', () => {
		assert.strictEqual(branchDescription(branch('main', { current: true, ahead: 1, behind: 2 })), 'current  ↓2 ↑1');
		assert.strictEqual(branchDescription(branch('topic', { merged: true })), 'merged');
		assert.strictEqual(branchDescription(branch('x')), '');
	});
});

describe('groupBranches', () => {
	const main = branch('main', { current: true });
	const zeta = branch('zeta');
	const alpha = branch('alpha');
	const remote = branch('origin/main', { remote: 'origin' });

	it('shows Recent (without the current branch, first in Local), Local (current first, then by name) and Remote', () => {
		const groups = groupBranches([zeta, remote, alpha, main], ['main', 'zeta', 'gone'], false);
		assert.deepStrictEqual(groups.map(g => [g.title, g.branches.map(b => b.name)]), [
			['Recent', ['zeta']],
			['Local', ['main', 'alpha', 'zeta']],
			['Remote', ['origin/main']],
		]);
	});

	it('hides Recent while searching and drops empty groups', () => {
		const groups = groupBranches([main], ['main'], true);
		assert.deepStrictEqual(groups.map(g => g.title), ['Local']);
	});

	it('shows no Recent that would only repeat the current branch', () => {
		const groups = groupBranches([main, remote], ['main'], false);
		assert.deepStrictEqual(groups.map(g => g.title), ['Local', 'Remote']);
	});
});

describe('isValidBranchName', () => {
	it('accepts usual names', () => {
		for (const name of ['main', 'feature/checkout-v2', 'fix_1.2']) {
			assert.ok(isValidBranchName(name), name);
		}
	});

	it('rejects what git rejects', () => {
		for (const name of ['', 'has space', 'a..b', '-x', '/x', 'x/', 'x.lock', 'x.', 'a:b', 'a~b', 'a^b', 'a?b', 'a*b', 'a[b', 'a\\b', '@', 'a@{b', 'a//b', '.x', 'a/.b']) {
			assert.ok(!isValidBranchName(name), name);
		}
	});
});

describe('localName', () => {
	it('strips the remote from remote branches', () => {
		assert.strictEqual(localName(branch('origin/feature/x', { remote: 'origin' })), 'feature/x');
		assert.strictEqual(localName(branch('main')), 'main');
	});
});

describe('branchActions', () => {
	const actions = (b: BranchInfo) => branchActions(b, 'main').map(a => a.label);

	it('offers everything for another local branch', () => {
		assert.deepStrictEqual(actions(branch('feature/x')), [
			'Checkout', 'Browse files at this branch', 'Compare with main', 'Show diff with working tree',
			'New branch from feature/x…', 'Merge feature/x into main', 'Rebase main onto feature/x',
			'Rename…', 'Delete',
		]);
	});

	it('limits the current branch to safe actions', () => {
		assert.deepStrictEqual(actions(branch('main', { current: true })), ['Browse files at this branch', 'Show diff with working tree', 'New branch from main…', 'Rename…']);
	});

	it('offers pull with rebase instead of rename/delete for remote branches', () => {
		assert.deepStrictEqual(actions(branch('origin/feature/x', { remote: 'origin' })), [
			'Checkout', 'Browse files at this branch', 'Compare with main', 'Show diff with working tree',
			'New branch from origin/feature/x…', 'Merge origin/feature/x into main', 'Rebase main onto origin/feature/x',
			'Pull into main using rebase',
		]);
	});
});

describe('pullPlan', () => {
	it('pulls the current branch the usual way', () => {
		assert.deepStrictEqual(pullPlan(branch('main', { current: true, upstream: 'origin/main' })), { kind: 'pull' });
	});

	it('fast-forwards another local branch without checking it out', () => {
		assert.deepStrictEqual(pullPlan(branch('feature', { upstream: 'origin/feature' })), { kind: 'fetch', args: ['fetch', 'origin', 'feature:feature'] });
	});

	it('keeps slashes of the branch name out of the remote', () => {
		assert.deepStrictEqual(pullPlan(branch('release/1.0', { upstream: 'origin/release/1.0' })), {
			kind: 'fetch',
			args: ['fetch', 'origin', 'release/1.0:release/1.0'],
		});
	});

	it('follows an upstream that is named differently', () => {
		assert.deepStrictEqual(pullPlan(branch('local', { upstream: 'upstream/main' })), { kind: 'fetch', args: ['fetch', 'upstream', 'main:local'] });
	});

	it('updates a remote branch from its remote', () => {
		assert.deepStrictEqual(pullPlan(branch('origin/feature/x', { remote: 'origin' })), { kind: 'fetch', args: ['fetch', 'origin', 'feature/x'] });
	});

	it('has nothing to pull into a branch without an upstream', () => {
		assert.deepStrictEqual(pullPlan(branch('topic')), { kind: 'none', reason: '"topic" has no upstream branch to pull from.' });
	});

	it('has nothing to pull when the upstream is another local branch', () => {
		assert.deepStrictEqual(pullPlan(branch('topic', { upstream: 'main' })), { kind: 'none', reason: '"topic" tracks "main", which is not a remote branch.' });
	});
});
