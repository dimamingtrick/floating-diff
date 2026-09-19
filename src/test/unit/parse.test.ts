import * as assert from 'assert';
import {
	mergeFileStats, parseAheadBehind, parseGrep, parseLog, parseLsTree, parseNameStatus, parseNumstat, parseRefs,
} from '../../data/parse';

const US = '\x1f';

describe('parseRefs', () => {
	it('reads full decorations', () => {
		assert.deepStrictEqual(
			parseRefs('HEAD -> refs/heads/main, refs/remotes/origin/main, refs/remotes/origin/HEAD, tag: refs/tags/v2.4.0, refs/heads/feature/x, refs/stash'),
			[
				{ name: 'main', kind: 'head' },
				{ name: 'origin/main', kind: 'remote' },
				{ name: 'v2.4.0', kind: 'tag' },
				{ name: 'feature/x', kind: 'local' },
			],
		);
	});

	it('reads a detached HEAD and nothing', () => {
		assert.deepStrictEqual(parseRefs('HEAD'), [{ name: 'HEAD', kind: 'head' }]);
		assert.deepStrictEqual(parseRefs(''), []);
	});
});

describe('parseLog', () => {
	it('reads commits with parents, dates and refs', () => {
		const out = [
			['a1', 'b2 c3', 'Dima M.', 'dima@example.com', '1789740120', 'HEAD -> refs/heads/main', 'Merge pull request #482'].join(US),
			['b2', '', 'Olena K.', 'olena@example.com', '1789738000', '', 'init: first commit'].join(US),
			'',
		].join('\n');

		assert.deepStrictEqual(parseLog(out), [
			{ hash: 'a1', parents: ['b2', 'c3'], author: 'Dima M.', email: 'dima@example.com', date: 1789740120000, refs: [{ name: 'main', kind: 'head' }], subject: 'Merge pull request #482' },
			{ hash: 'b2', parents: [], author: 'Olena K.', email: 'olena@example.com', date: 1789738000000, refs: [], subject: 'init: first commit' },
		]);
	});
});

describe('file changes', () => {
	const nameStatus = 'M\0src/a.ts\0R063\0old.txt\0new.txt\0A\0bin.dat\0D\0gone.ts\0';
	const numstat = '3\t1\tsrc/a.ts\0' + '1\t0\t\0old.txt\0new.txt\0' + '-\t-\tbin.dat\0' + '0\t12\tgone.ts\0';

	it('reads name-status with renames', () => {
		assert.deepStrictEqual(parseNameStatus(nameStatus), [
			{ status: 'M', path: 'src/a.ts' },
			{ status: 'R', path: 'new.txt', oldPath: 'old.txt' },
			{ status: 'A', path: 'bin.dat' },
			{ status: 'D', path: 'gone.ts' },
		]);
	});

	it('reads numstat with renames and binary files', () => {
		assert.deepStrictEqual(parseNumstat(numstat), [
			{ path: 'src/a.ts', added: 3, deleted: 1 },
			{ path: 'new.txt', added: 1, deleted: 0 },
			{ path: 'bin.dat', added: undefined, deleted: undefined },
			{ path: 'gone.ts', added: 0, deleted: 12 },
		]);
	});

	it('merges both into file changes', () => {
		assert.deepStrictEqual(mergeFileStats(parseNameStatus(nameStatus), parseNumstat(numstat)), [
			{ status: 'M', path: 'src/a.ts', added: 3, deleted: 1 },
			{ status: 'R', path: 'new.txt', oldPath: 'old.txt', added: 1, deleted: 0 },
			{ status: 'A', path: 'bin.dat', added: undefined, deleted: undefined },
			{ status: 'D', path: 'gone.ts', added: 0, deleted: 12 },
		]);
	});
});

describe('parseLsTree', () => {
	it('lists paths', () => {
		assert.deepStrictEqual(parseLsTree('a.txt\0dir x/b:c.txt\0'), ['a.txt', 'dir x/b:c.txt']);
		assert.deepStrictEqual(parseLsTree(''), []);
	});
});

describe('parseGrep', () => {
	it('reads hits and strips the ref prefix, keeping colons in paths', () => {
		const out = 'feature/x:dir x/b:c.txt\x002\x00hello\nfeature/x:renamed.txt\x001\x00hello world: yes\n';
		assert.deepStrictEqual(parseGrep(out, 'feature/x'), [
			{ path: 'dir x/b:c.txt', line: 2, text: 'hello' },
			{ path: 'renamed.txt', line: 1, text: 'hello world: yes' },
		]);
	});
});

describe('parseAheadBehind', () => {
	it('reads left (behind) and right (ahead) counts', () => {
		assert.deepStrictEqual(parseAheadBehind('3\t12\n'), { behind: 3, ahead: 12 });
		assert.deepStrictEqual(parseAheadBehind(''), { behind: 0, ahead: 0 });
	});
});
