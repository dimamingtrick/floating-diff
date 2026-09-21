import * as assert from 'assert';
import { annotation, hoverMarkdown, parseBlamePorcelain, relativeTime } from '../../blame/blame';

const PORCELAIN = [
	'c77acce1f0d0a1e6c28d2b7e7f4fd9a1b2c3d4e5 7 9 1',
	'author Dima Shraho',
	'author-mail <dima@example.com>',
	'author-time 1660570860',
	'author-tz +0300',
	'committer Dima Shraho',
	'committer-mail <dima@example.com>',
	'committer-time 1660570860',
	'committer-tz +0300',
	'summary feat: the callout',
	'previous 195f64b0a1b2c3d4e5f60718293a4b5c6d7e8f90 src/old.ts',
	'filename src/app.ts',
	'\tconst callout = true;',
	'',
].join('\n');

const UNCOMMITTED = [
	'0000000000000000000000000000000000000000 7 7 1',
	'author Not Committed Yet',
	'author-mail <not.committed.yet>',
	'author-time 1789740120',
	'author-tz +0300',
	'summary Version of src/app.ts from src/app.ts',
	'previous c77acce1f0d0a1e6c28d2b7e7f4fd9a1b2c3d4e5 src/app.ts',
	'filename src/app.ts',
	'\tconst callout = false;',
	'',
].join('\n');

describe('parseBlamePorcelain', () => {
	it('reads the author, date, summary and previous revision of a line', () => {
		assert.deepStrictEqual(parseBlamePorcelain(PORCELAIN), {
			hash: 'c77acce1f0d0a1e6c28d2b7e7f4fd9a1b2c3d4e5',
			author: 'Dima Shraho',
			email: 'dima@example.com',
			date: 1660570860000,
			summary: 'feat: the callout',
			path: 'src/app.ts',
			tz: 180,
			previous: { hash: '195f64b0a1b2c3d4e5f60718293a4b5c6d7e8f90', path: 'src/old.ts' },
			uncommitted: false,
		});
	});

	it('marks a line that is not committed yet', () => {
		const line = parseBlamePorcelain(UNCOMMITTED);

		assert.strictEqual(line?.uncommitted, true);
		assert.strictEqual(line?.previous?.hash, 'c77acce1f0d0a1e6c28d2b7e7f4fd9a1b2c3d4e5');
	});

	it('reads nothing from empty output', () => {
		assert.strictEqual(parseBlamePorcelain(''), undefined);
		assert.strictEqual(parseBlamePorcelain('fatal: no such path\n'), undefined);
	});
});

describe('relativeTime', () => {
	const now = Date.parse('2026-09-21T12:00:00Z');
	const ago = (ms: number) => relativeTime(now - ms, now);
	const minute = 60000;
	const hour = 60 * minute;
	const day = 24 * hour;

	it('counts seconds, minutes, hours and days', () => {
		assert.strictEqual(ago(5000), 'seconds ago');
		assert.strictEqual(ago(90 * 1000), '1 minute ago');
		assert.strictEqual(ago(42 * minute), '42 minutes ago');
		assert.strictEqual(ago(3 * hour), '3 hours ago');
		assert.strictEqual(ago(29 * day), '29 days ago');
	});

	it('counts months up to a year and a half, then years', () => {
		assert.strictEqual(ago(31 * day), '1 month ago');
		assert.strictEqual(ago(430 * day), '14 months ago');
		assert.strictEqual(ago(550 * day), '1 year ago');
		assert.strictEqual(ago(3 * 365 * day), '3 years ago');
	});

	it('takes a clock that runs behind the commit as now', () => {
		assert.strictEqual(ago(-5 * minute), 'seconds ago');
	});
});

describe('annotation', () => {
	const now = Date.parse('2026-09-21T12:00:00Z');
	const line = parseBlamePorcelain(PORCELAIN)!;

	it('names the author, how long ago and the message', () => {
		assert.strictEqual(annotation(line, { now }), 'Dima Shraho, 4 years ago • feat: the callout');
	});

	it('says You for your own commits', () => {
		assert.strictEqual(annotation(line, { now, me: 'dima@example.com' }), 'You, 4 years ago • feat: the callout');
	});

	it('says uncommitted changes for a line you have not committed', () => {
		assert.strictEqual(annotation(parseBlamePorcelain(UNCOMMITTED)!, { now }), 'You • Uncommitted changes');
	});
});

describe('hoverMarkdown', () => {
	const now = Date.parse('2026-09-21T12:00:00Z');
	const actions = [{ label: 'Open diff', href: 'command:gitConvenient.blame.openDiff' }, { label: 'Copy c77acce', href: 'command:gitConvenient.blame.copyHash' }];

	it('has the author, date, message and the action links', () => {
		const md = hoverMarkdown(parseBlamePorcelain(PORCELAIN)!, { now, me: 'dima@example.com', actions });

		assert.strictEqual(md, [
			'**You** <dima@example.com>, 4 years ago (15 Aug 2022 16:41)',
			'',
			'feat: the callout',
			'',
			'[Open diff](command:gitConvenient.blame.openDiff) · [Copy c77acce](command:gitConvenient.blame.copyHash)',
		].join('\n'));
	});

	it('leaves the links out of a line you have not committed', () => {
		const md = hoverMarkdown(parseBlamePorcelain(UNCOMMITTED)!, { now, actions });

		assert.strictEqual(md, '**You**, uncommitted changes');
	});
});
