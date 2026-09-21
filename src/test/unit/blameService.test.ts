import * as assert from 'assert';
import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { BlameService } from '../../blame/blameService';
import { createGitRunner, GitRunner } from '../../branches/gitRunner';

describe('BlameService', function () {
	this.timeout(30000);
	let repo: string;
	let blame: BlameService;
	let runs: string[][];

	const git = (...args: string[]) => execFileSync('git', args, { cwd: repo, stdio: 'pipe' }).toString();
	const write = (name: string, content: string) => fs.writeFileSync(path.join(repo, name), content);

	before(() => {
		repo = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'git-convenient-blame-')));
		git('init', '-q', '-b', 'main');
		git('config', 'user.email', 'dima@example.com');
		git('config', 'user.name', 'Dima Shraho');
		write('app.ts', 'const one = 1;\nconst two = 2;\n');
		git('add', '.');
		git('commit', '-qm', 'feat: the first two');
		write('app.ts', 'const one = 1;\nconst two = 22;\n');
		git('-c', 'user.name=Olena K.', '-c', 'user.email=olena@example.com', 'commit', '-qam', 'fix: the second one');
	});

	beforeEach(() => {
		runs = [];
		const real = createGitRunner('git', repo);
		const counting: GitRunner = (args, input) => {
			runs.push([...args]);
			return real(args, input);
		};
		blame = new BlameService(counting);
	});

	it('blames a committed line with its author, date and message', async () => {
		const line = await blame.line({ path: 'app.ts', line: 2, key: 'saved' });

		assert.strictEqual(line?.author, 'Olena K.');
		assert.strictEqual(line?.email, 'olena@example.com');
		assert.strictEqual(line?.summary, 'fix: the second one');
		assert.strictEqual(line?.uncommitted, false);
		assert.ok(Date.now() - line!.date < 60000, 'the commit is dated now');
		assert.strictEqual(line?.previous?.path, 'app.ts');
	});

	it('blames the first line to the commit that added it', async () => {
		const line = await blame.line({ path: 'app.ts', line: 1, key: 'saved' });

		assert.strictEqual(line?.author, 'Dima Shraho');
		assert.strictEqual(line?.summary, 'feat: the first two');
		assert.strictEqual(line?.previous, undefined, 'the commit added the file');
	});

	it('blames what the editor holds, not what the file on disk says', async () => {
		const contents = 'const one = 1;\nconst added = 0;\nconst two = 22;\n';

		const added = await blame.line({ path: 'app.ts', line: 2, contents, key: 'v2' });
		const moved = await blame.line({ path: 'app.ts', line: 3, contents, key: 'v2' });

		assert.strictEqual(added?.uncommitted, true);
		assert.strictEqual(moved?.summary, 'fix: the second one');
	});

	it('runs git once per line while the file stays as it is', async () => {
		await blame.line({ path: 'app.ts', line: 1, key: 'saved' });
		await blame.line({ path: 'app.ts', line: 1, key: 'saved' });
		await blame.line({ path: 'app.ts', line: 2, key: 'saved' });

		assert.strictEqual(runs.length, 2);
	});

	it('forgets the file once the editor changes it', async () => {
		await blame.line({ path: 'app.ts', line: 1, key: 'v1' });
		await blame.line({ path: 'app.ts', line: 1, key: 'v2' });

		assert.strictEqual(runs.length, 2);
	});

	it('gives nothing for a file git knows nothing about', async () => {
		write('scratch.ts', 'const three = 3;\n');

		assert.strictEqual(await blame.line({ path: 'scratch.ts', line: 1, key: 'saved' }), undefined);
		assert.strictEqual(await blame.line({ path: 'app.ts', line: 99, key: 'saved' }), undefined);
	});
});
