import * as assert from 'assert';
import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { createGitRunner } from '../../branches/gitRunner';
import { GitData } from '../../data/gitData';

describe('GitData', function () {
	this.timeout(30000);
	let repo: string;
	let data: GitData;

	const git = (...args: string[]) => execFileSync('git', args, { cwd: repo, stdio: 'pipe' }).toString();
	const write = (name: string, content: string | Buffer) => fs.writeFileSync(path.join(repo, name), content);
	const commit = (message: string, ...extra: string[]) => git(...extra, 'commit', '-qm', message);

	before(() => {
		repo = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'gitstorm-data-')));
		git('init', '-q', '-b', 'main');
		git('config', 'user.email', 'dima@example.com');
		git('config', 'user.name', 'Dima');
		write('a.txt', 'first line\n');
		git('add', '.');
		commit('init');
		git('tag', 'v1');
		git('checkout', '-q', '-b', 'feature');
		write('b.txt', 'hello feature\nsecond line\n');
		git('add', '.');
		commit('feature: add b');
		write('bin.dat', Buffer.from([0, 1, 2, 0, 3]));
		git('add', '.');
		git('-c', 'user.name=Olena', '-c', 'user.email=olena@example.com', 'commit', '-qm', 'feature: add binary');
		git('checkout', '-q', 'main');
		write('a.txt', 'first line\nmain change\n');
		git('commit', '-qam', 'main: change a');
		data = new GitData(createGitRunner('git', repo));
	});

	it('reads the whole log newest first, with parents and refs', async () => {
		const log = await data.log({ limit: 100 });

		assert.deepStrictEqual(log.map(c => c.subject).sort(), ['feature: add b', 'feature: add binary', 'init', 'main: change a']);
		const tip = log.find(c => c.subject === 'main: change a');
		assert.deepStrictEqual(tip?.refs, [{ name: 'main', kind: 'head' }]);
		const root = log.find(c => c.subject === 'init');
		assert.deepStrictEqual(root?.parents, []);
		assert.ok(root?.refs.some(r => r.kind === 'tag' && r.name === 'v1'));
	});

	it('filters the log by branch, author and path', async () => {
		assert.deepStrictEqual((await data.log({ ref: 'feature', limit: 100 })).map(c => c.subject), ['feature: add binary', 'feature: add b', 'init']);
		assert.deepStrictEqual((await data.log({ author: 'Olena', limit: 100 })).map(c => c.subject), ['feature: add binary']);
		assert.deepStrictEqual((await data.log({ paths: ['b.txt'], limit: 100 })).map(c => c.subject), ['feature: add b']);
		assert.deepStrictEqual((await data.log({ paths: ['b.txt', 'bin.dat'], limit: 100 })).map(c => c.subject), ['feature: add binary', 'feature: add b'], 'any of several files');
	});

	it('pages the log', async () => {
		const first = await data.log({ limit: 2 });
		const next = await data.log({ limit: 2, skip: 2 });

		assert.strictEqual(first.length, 2);
		assert.strictEqual(next.length, 2);
		assert.ok(!next.some(c => first.some(f => f.hash === c.hash)));
	});

	it('reads commit details against the first parent, root commits included', async () => {
		const log = await data.log({ ref: 'feature', limit: 100 });
		const binary = log[0];
		const details = await data.commit(binary.hash, binary.parents[0]);

		assert.deepStrictEqual(details.files, [{ status: 'A', path: 'bin.dat', added: undefined, deleted: undefined }]);
		const root = log[log.length - 1];
		assert.deepStrictEqual((await data.commit(root.hash, undefined)).files, [{ status: 'A', path: 'a.txt', added: 1, deleted: 0 }]);
	});

	it('lists and reads files of a branch without checking it out', async () => {
		assert.deepStrictEqual(await data.tree('feature'), ['a.txt', 'b.txt', 'bin.dat']);
		assert.deepStrictEqual(await data.file('feature', 'b.txt'), { text: 'hello feature\nsecond line\n' });
		assert.deepStrictEqual(await data.file('feature', 'bin.dat'), { binary: true });
		assert.strictEqual(git('rev-parse', '--abbrev-ref', 'HEAD').trim(), 'main', 'still on main');
	});

	it('searches file contents of a branch', async () => {
		const hits = await data.grep('feature', 'HELLO', { matchCase: false, wholeWord: false, regex: false });
		assert.deepStrictEqual(hits, [{ path: 'b.txt', line: 1, text: 'hello feature' }]);
		assert.deepStrictEqual(await data.grep('feature', 'HELLO', { matchCase: true, wholeWord: false, regex: false }), []);
		assert.deepStrictEqual(await data.grep('feature', 'hell', { matchCase: false, wholeWord: true, regex: false }), []);
		assert.strictEqual((await data.grep('feature', 'hel+o', { matchCase: false, wholeWord: false, regex: true })).length, 1);
		assert.deepStrictEqual(await data.grep('feature', '', { matchCase: false, wholeWord: false, regex: false }), []);
	});

	it('compares branches: files, merge base, ahead/behind and commits', async () => {
		const base = await data.mergeBase('main', 'feature');
		const files = await data.diffStat(base, 'feature');

		assert.deepStrictEqual(files, [
			{ status: 'A', path: 'b.txt', added: 2, deleted: 0 },
			{ status: 'A', path: 'bin.dat', added: undefined, deleted: undefined },
		]);
		assert.deepStrictEqual(await data.aheadBehind('main', 'feature'), { ahead: 2, behind: 1 });
		assert.deepStrictEqual((await data.commitsBetween('main', 'feature')).map(c => c.subject), ['feature: add binary', 'feature: add b']);
	});

	it('lists local and remote branch names', async () => {
		assert.deepStrictEqual(await data.branchNames(), { local: ['feature', 'main'], remote: [] });
	});

	it('lists tags newest first', async () => {
		assert.deepStrictEqual(await data.tags(), ['v1']);
	});

	it('tells whether the working copy of a file matches a branch', async () => {
		assert.strictEqual(await data.sameAsWorkingFile('main', 'a.txt'), true);
		assert.strictEqual(await data.sameAsWorkingFile('feature', 'a.txt'), false);
	});

	it('copies a file of a branch into the working tree without staging it', async () => {
		await data.restoreFile('feature', 'b.txt');

		assert.strictEqual(fs.readFileSync(path.join(repo, 'b.txt'), 'utf8'), 'hello feature\nsecond line\n');
		assert.strictEqual(git('status', '--porcelain', '--', 'b.txt'), '?? b.txt\n', 'untracked, not staged');
		fs.rmSync(path.join(repo, 'b.txt'));
	});

	it('lists the branches that contain a commit', async () => {
		const [root] = (await data.log({ ref: 'main', limit: 100 })).filter(commit => commit.parents.length === 0);
		const [featureOnly] = await data.log({ ref: 'feature', limit: 1 });

		assert.deepStrictEqual(await data.branchesContaining(root.hash), ['feature', 'main']);
		assert.deepStrictEqual(await data.branchesContaining(featureOnly.hash), ['feature']);
	});

	it('searches commit messages, ignoring case', async () => {
		assert.deepStrictEqual((await data.log({ text: 'ADD BIN', limit: 100 })).map(c => c.subject), ['feature: add binary']);
		assert.deepStrictEqual((await data.log({ text: 'feature', limit: 1, skip: 1 })).map(c => c.subject), ['feature: add b'], 'pages through the matches');
	});

	it('counts the commits of the same filters, for pages', async () => {
		assert.strictEqual(await data.count({}), 4);
		assert.strictEqual(await data.count({ ref: 'feature' }), 3);
		assert.strictEqual(await data.count({ author: 'Olena' }), 1);
		assert.strictEqual(await data.count({ text: 'FEATURE' }), 2);
		assert.strictEqual(await data.count({ paths: ['b.txt'] }), 1);
		assert.strictEqual(await data.count({ paths: ['a.txt', 'b.txt'] }), 3);
	});

	it('finds a commit by the start of its hash', async () => {
		const [root] = (await data.log({ limit: 100 })).filter(commit => commit.parents.length === 0);

		assert.strictEqual((await data.commitByHash(root.hash.slice(0, 7)))?.subject, 'init');
		assert.strictEqual(await data.commitByHash('deadbeef'), undefined);
	});

	it('lists the files of the checked-out branch', async () => {
		assert.deepStrictEqual(await data.files(), ['a.txt']);
	});

	it('lists every author of all branches', async () => {
		assert.deepStrictEqual(await data.authors(), ['Dima', 'Olena']);
	});
});
