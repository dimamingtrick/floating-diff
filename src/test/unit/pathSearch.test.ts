import * as assert from 'assert';
import { searchPaths } from '../../shared/pathSearch';

describe('path search', () => {
	const files = [
		'README.md',
		'native-app/src/shared/components/ScreenWrapper/ScreenWrapper.tsx',
		'native-app/src/shared/components/ScreenWrapper/index.ts',
		'src/cart/Cart.tsx',
		'src/cart/totals.ts',
		'src/checkout/cartSummary.ts',
		'src/checkout/miniCart.tsx',
	];

	it('finds files and folders, those whose name starts with the query first', () => {
		assert.deepStrictEqual(searchPaths(files, 'screenw'), [
			{ path: 'native-app/src/shared/components/ScreenWrapper', folder: true },
			{ path: 'native-app/src/shared/components/ScreenWrapper/ScreenWrapper.tsx' },
			{ path: 'native-app/src/shared/components/ScreenWrapper/index.ts' },
		]);
	});

	it('ranks names that start with the word, then names that have it, then paths; shorter first', () => {
		assert.deepStrictEqual(searchPaths(files, 'cart').map(item => item.path), [
			'src/cart',
			'src/cart/Cart.tsx',
			'src/checkout/cartSummary.ts',
			'src/checkout/miniCart.tsx',
			'src/cart/totals.ts',
		]);
	});

	it('needs every word of the query, in any order', () => {
		assert.deepStrictEqual(searchPaths(files, 'index shared').map(item => item.path), ['native-app/src/shared/components/ScreenWrapper/index.ts']);
	});

	it('finds nothing for an empty query and stops at the limit', () => {
		assert.deepStrictEqual(searchPaths(files, '  '), []);
		assert.strictEqual(searchPaths(files, 'src', 2).length, 2);
	});
});
