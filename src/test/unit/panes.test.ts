import * as assert from 'assert';
import { resizeInfo } from '../../shared/panes';

describe('resizeInfo', () => {
	it('grows the commit details as their edge is dragged up', () => {
		assert.strictEqual(resizeInfo(150, -40, 600), 190);
	});

	it('shrinks them as it is dragged down', () => {
		assert.strictEqual(resizeInfo(150, 40, 600), 110);
	});

	it('always leaves room for the files above', () => {
		assert.strictEqual(resizeInfo(150, -1000, 600), 480);
	});

	it('keeps the details at least a couple of lines tall', () => {
		assert.strictEqual(resizeInfo(150, 1000, 600), 60);
	});

	it('gives the details the minimum in a panel too short for both', () => {
		assert.strictEqual(resizeInfo(150, -50, 100), 60);
	});
});
