import * as assert from 'assert';
import { placePopup } from '../../shared/popup';

describe('popup placement', () => {
	const view = { width: 800, height: 400 };

	it('opens under the anchor, at its left edge', () => {
		const anchor = { left: 100, top: 10, right: 200, bottom: 38 };

		assert.deepStrictEqual(placePopup(anchor, { width: 220, height: 150 }, view), { left: 100, top: 42, maxHeight: 150, maxWidth: 220 });
	});

	it('lines up with the right edge of the anchor when asked', () => {
		const anchor = { left: 600, top: 10, right: 628, bottom: 38 };

		assert.strictEqual(placePopup(anchor, { width: 240, height: 120 }, view, 'right').left, 388);
	});

	it('opens above an anchor at the bottom of a short panel', () => {
		const anchor = { left: 300, top: 260, right: 328, bottom: 286 };

		const place = placePopup(anchor, { width: 260, height: 140 }, { width: 800, height: 300 });

		assert.deepStrictEqual([place.top, place.maxHeight], [116, 140]);
	});

	it('shrinks to the room under the anchor when it fits nowhere whole', () => {
		const anchor = { left: 10, top: 8, right: 200, bottom: 36 };

		const place = placePopup(anchor, { width: 220, height: 360 }, { width: 800, height: 250 });

		assert.deepStrictEqual([place.top, place.maxHeight], [40, 206]);
	});

	it('moves left to stay inside the window', () => {
		const anchor = { left: 700, top: 8, right: 780, bottom: 36 };

		assert.strictEqual(placePopup(anchor, { width: 300, height: 100 }, view).left, 496);
	});

	it('is never wider than the window', () => {
		const anchor = { left: 50, top: 8, right: 120, bottom: 36 };

		const place = placePopup(anchor, { width: 500, height: 100 }, { width: 300, height: 400 });

		assert.deepStrictEqual([place.left, place.maxWidth], [4, 292]);
	});
});
