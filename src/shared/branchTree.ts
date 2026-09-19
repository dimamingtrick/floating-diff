/** A branch for the tree: the current one and favorites (main, master) go first. */
export interface BranchTreeItem {
	/** The full name: `feature/x`, or `origin/feature/x` for a remote branch. */
	readonly name: string;
	readonly current: boolean;
	readonly favorite: boolean;
}

export interface BranchTreeNode<T extends BranchTreeItem = BranchTreeItem> {
	readonly kind: 'folder' | 'branch';
	/** What the row shows: a folder's name, or the last part of the branch name. */
	readonly label: string;
	/** A folder's full path, or the branch's full name. */
	readonly path: string;
	readonly children: readonly BranchTreeNode<T>[];
	readonly item?: T;
}

interface Building<T extends BranchTreeItem> {
	kind: 'folder' | 'branch';
	label: string;
	path: string;
	children: Building<T>[];
	item?: T;
}

const rank = (node: Building<BranchTreeItem>) => (node.item?.current ? 0 : node.item?.favorite ? 1 : node.kind === 'folder' ? 2 : 3);

/**
 * Branches as folders by the `/` in their names, like WebStorm: the current
 * branch and favorites first, then folders, then the others, each by name.
 * `prefix` (a remote's `origin/`) is left out of the tree but kept in paths.
 */
export function branchTree<T extends BranchTreeItem>(items: readonly T[], prefix = ''): BranchTreeNode<T>[] {
	const root: Building<T> = { kind: 'folder', label: '', path: '', children: [] };
	for (const item of items) {
		const parts = (item.name.startsWith(prefix) ? item.name.slice(prefix.length) : item.name).split('/');
		let node = root;
		for (const part of parts.slice(0, -1)) {
			let folder = node.children.find(child => child.kind === 'folder' && child.label === part);
			if (!folder) {
				folder = { kind: 'folder', label: part, path: `${node.path || prefix}${node.path ? '/' : ''}${part}`, children: [] };
				node.children.push(folder);
			}
			node = folder;
		}
		node.children.push({ kind: 'branch', label: parts[parts.length - 1], path: item.name, children: [], item });
	}
	const sort = (nodes: Building<T>[]) => {
		nodes.sort((a, b) => rank(a) - rank(b) || a.label.localeCompare(b.label, undefined, { sensitivity: 'base' }));
		nodes.forEach(node => sort(node.children));
	};
	sort(root.children);
	return root.children;
}
