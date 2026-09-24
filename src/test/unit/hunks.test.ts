import * as assert from 'assert';
import { firstHunkLine } from '../../data/hunks';

describe('firstHunkLine', () => {
	const diff = (...lines: string[]) => ['diff --git a/app.ts b/app.ts', 'index 1111111..2222222 100644', '--- a/app.ts', '+++ b/app.ts', ...lines].join('\n');

	it('takes the line of the first hunk in the new file', () => {
		assert.strictEqual(firstHunkLine(diff('@@ -10,3 +12,4 @@', '+added')), 12);
	});

	it('reads a hunk without a line count', () => {
		assert.strictEqual(firstHunkLine(diff('@@ -7 +7 @@', '-old', '+new')), 7);
	});

	it('ignores the hunks after the first one', () => {
		assert.strictEqual(firstHunkLine(diff('@@ -10,0 +11,1 @@', '+one', '@@ -40,0 +42,1 @@', '+two')), 11);
	});

	it('points at the line before lines that were only removed', () => {
		assert.strictEqual(firstHunkLine(diff('@@ -1,2 +0,0 @@', '-gone')), 1);
	});

	it('takes the new file of a merge diff, whose hunks carry one range per parent', () => {
		assert.strictEqual(firstHunkLine('@@@ -1,2 -1,3 +5,4 @@@'), 5);
	});

	it('has no line for a file the diff does not change', () => {
		assert.strictEqual(firstHunkLine(''), undefined);
	});

	it('is not fooled by added lines that look like a hunk header', () => {
		assert.strictEqual(firstHunkLine(diff('@@ -3,0 +4,1 @@', '+@@ -99,0 +99,9 @@')), 4);
	});
});
