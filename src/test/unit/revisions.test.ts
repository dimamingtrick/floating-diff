import * as assert from 'assert';
import { FileRevision, parseFileRevisions, revisionTitle, stepBack } from '../../data/revisions';

const RS = '\x1e';
const US = '\x1f';

const LOG = [
	`${RS}a1b2c3d4e5f60718293a4b5c6d7e8f9012345678${US}fix: the second one${US}Olena K.${US}1660570860`,
	'',
	'src/app.ts',
	`${RS}b2c3d4e5f60718293a4b5c6d7e8f901234567890${US}Merge branch 'feature'${US}Dima Shraho${US}1660000000`,
	'',
	`${RS}c3d4e5f60718293a4b5c6d7e8f90123456789012${US}feat: the first two${US}Dima Shraho${US}1659000000`,
	'',
	'src/old.ts',
	'',
].join('\n');

describe('parseFileRevisions', () => {
	it('reads the commits of a file, newest first, with the name it had', () => {
		assert.deepStrictEqual(parseFileRevisions(LOG), [
			{ hash: 'a1b2c3d4e5f60718293a4b5c6d7e8f9012345678', subject: 'fix: the second one', author: 'Olena K.', date: 1660570860000, path: 'src/app.ts' },
			// A merge that changed nothing lists no name: the file kept the one it had.
			{ hash: 'b2c3d4e5f60718293a4b5c6d7e8f901234567890', subject: "Merge branch 'feature'", author: 'Dima Shraho', date: 1660000000000, path: 'src/app.ts' },
			{ hash: 'c3d4e5f60718293a4b5c6d7e8f90123456789012', subject: 'feat: the first two', author: 'Dima Shraho', date: 1659000000000, path: 'src/old.ts' },
		]);
	});

	it('reads nothing from a file git has no commits for', () => {
		assert.deepStrictEqual(parseFileRevisions(''), []);
		assert.deepStrictEqual(parseFileRevisions('\n'), []);
	});
});

describe('stepBack', () => {
	const revisions = parseFileRevisions(LOG);

	it('starts at the newest commit against the working tree', () => {
		assert.deepStrictEqual(stepBack(revisions), { older: revisions[0] });
	});

	it('steps from a commit to the one before it', () => {
		assert.deepStrictEqual(stepBack(revisions, revisions[0].hash), { older: revisions[1], newer: revisions[0] });
		assert.deepStrictEqual(stepBack(revisions, revisions[1].hash), { older: revisions[2], newer: revisions[1] });
	});

	it('stops at the commit that added the file', () => {
		assert.strictEqual(stepBack(revisions, revisions[2].hash), undefined);
		assert.strictEqual(stepBack([]), undefined);
	});

	it('steps from the newest change when the commit itself changed nothing here', () => {
		// `git log <ref>` starts at the newest commit at or before `ref`.
		assert.deepStrictEqual(stepBack(revisions, 'deadbeefdeadbeefdeadbeefdeadbeefdeadbeef'), { older: revisions[1], newer: revisions[0] });
	});
});

describe('revisionTitle', () => {
	const older: FileRevision = { hash: 'c3d4e5f60718293a4b5c6d7e8f90123456789012', subject: 'feat: the first two', author: 'Dima', date: 1, path: 'src/old.ts' };
	const newer: FileRevision = { hash: 'a1b2c3d4e5f60718293a4b5c6d7e8f9012345678', subject: 'fix: the second one', author: 'Olena K.', date: 2, path: 'src/app.ts' };

	it('names both sides and the commit being shown', () => {
		assert.strictEqual(revisionTitle('app.ts', older, newer), 'app.ts (c3d4e5f ↔ a1b2c3d · fix: the second one)');
	});

	it('names the working tree, with the commit it is compared against', () => {
		assert.strictEqual(revisionTitle('app.ts', newer), 'app.ts (a1b2c3d ↔ working tree · fix: the second one)');
	});

	it('cuts a long message short', () => {
		const long = { ...newer, subject: 'fix: a very long message about everything that changed here' };

		assert.strictEqual(revisionTitle('app.ts', long), 'app.ts (a1b2c3d ↔ working tree · fix: a very long message abo…)');
	});
});
