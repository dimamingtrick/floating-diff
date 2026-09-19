import * as assert from 'assert';
import { branchTree, BranchTreeNode } from '../../shared/branchTree';

const item = (name: string, extra: { current?: boolean; favorite?: boolean } = {}) => ({ name, current: false, favorite: false, sync: '', ...extra });
const shape = (nodes: readonly BranchTreeNode[]): unknown[] =>
	nodes.map(node => (node.kind === 'folder' ? { [`${node.label}/`]: shape(node.children) } : `${node.label} (${node.path})`));

describe('branchTree', () => {
	it('groups branches into folders by their names, like WebStorm', () => {
		const tree = branchTree([item('feature/checkout-v2'), item('eslint'), item('feature/search/facets'), item('main', { favorite: true }), item('my_branch', { current: true })]);

		assert.deepStrictEqual(shape(tree), [
			'my_branch (my_branch)',
			'main (main)',
			{ 'feature/': [{ 'search/': ['facets (feature/search/facets)'] }, 'checkout-v2 (feature/checkout-v2)'] },
			'eslint (eslint)',
		]);
		assert.strictEqual(tree[2].kind === 'folder' && tree[2].path, 'feature');
	});

	it('names a node without a prefix, for remotes', () => {
		const tree = branchTree([item('origin/main', { favorite: true }), item('origin/depend/x')], 'origin/');

		assert.deepStrictEqual(shape(tree), ['main (origin/main)', { 'depend/': ['x (origin/depend/x)'] }]);
	});
});
