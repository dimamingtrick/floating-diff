import * as assert from 'assert';
import { buildFileTree, compactFolders, filterPaths, TreeNode, visibleRows } from '../../shared/fileTree';

describe('file tree', () => {
	const paths = ['src/cart/totals.ts', 'README.md', 'src/cart/Cart.tsx', 'src/api/promo.ts', 'package.json'];

	it('builds folders first, then files, both sorted', () => {
		const rows = visibleRows(buildFileTree(paths), new Set());

		assert.deepStrictEqual(rows.map(r => `${'  '.repeat(r.depth)}${r.node.name}${r.node.isDir ? '/' : ''}`), [
			'src/',
			'  api/',
			'    promo.ts',
			'  cart/',
			'    Cart.tsx',
			'    totals.ts',
			'package.json',
			'README.md',
		]);
		assert.strictEqual(rows.find(r => r.node.name === 'totals.ts')?.node.path, 'src/cart/totals.ts');
	});

	it('hides the contents of collapsed folders', () => {
		const rows = visibleRows(buildFileTree(paths), new Set(['src/cart']));

		assert.deepStrictEqual(rows.map(r => r.node.path), ['src', 'src/api', 'src/api/promo.ts', 'src/cart', 'package.json', 'README.md']);
	});

	it('filters paths by a case-insensitive substring', () => {
		assert.deepStrictEqual(filterPaths(paths, 'CART'), ['src/cart/totals.ts', 'src/cart/Cart.tsx']);
		assert.deepStrictEqual(filterPaths(paths, ''), paths);
	});
});

describe('compactFolders', () => {
	it('joins folders that only hold one folder, like Source Control', () => {
		const tree = compactFolders(buildFileTree(['a/b/c/x.ts', 'a/b/c/y.ts', 'a/d.ts', 'top.ts']));
		const shape = (nodes: readonly TreeNode[]): unknown[] => nodes.map(node => (node.isDir ? { [`${node.name} (${node.path})`]: shape(node.children) } : node.name));

		assert.deepStrictEqual(shape(tree), [{ 'a (a)': [{ 'b/c (a/b/c)': ['x.ts', 'y.ts'] }, 'd.ts'] }, 'top.ts']);
	});

	it('keeps a folder with a single file as it is', () => {
		assert.deepStrictEqual(compactFolders(buildFileTree(['src/only.ts'])).map(node => node.name), ['src']);
	});
});
