/** A folder or file of a path tree; shared by the extension tests and the webviews. */
export interface TreeNode {
	readonly name: string;
	/** Full path from the repository root. */
	readonly path: string;
	readonly isDir: boolean;
	readonly children: TreeNode[];
}

export interface TreeRow {
	readonly node: TreeNode;
	readonly depth: number;
}

const compareNames = (a: TreeNode, b: TreeNode) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });

/** Folders before files, each sorted by name. */
export function buildFileTree(paths: readonly string[]): TreeNode[] {
	const root: TreeNode = { name: '', path: '', isDir: true, children: [] };
	const dirs = new Map<string, TreeNode>([['', root]]);
	const dirFor = (path: string): TreeNode => {
		const existing = dirs.get(path);
		if (existing) {
			return existing;
		}
		const slash = path.lastIndexOf('/');
		const node: TreeNode = { name: path.slice(slash + 1), path, isDir: true, children: [] };
		dirFor(slash < 0 ? '' : path.slice(0, slash)).children.push(node);
		dirs.set(path, node);
		return node;
	};
	for (const path of paths) {
		const slash = path.lastIndexOf('/');
		dirFor(slash < 0 ? '' : path.slice(0, slash)).children.push({ name: path.slice(slash + 1), path, isDir: false, children: [] });
	}
	const sort = (node: TreeNode) => {
		node.children.sort((a, b) => Number(b.isDir) - Number(a.isDir) || compareNames(a, b));
		node.children.forEach(sort);
	};
	sort(root);
	return root.children;
}

/** The rows to show: every node, except the contents of collapsed folders. */
export function visibleRows(nodes: readonly TreeNode[], collapsed: ReadonlySet<string>, depth = 0): TreeRow[] {
	return nodes.flatMap(node => [
		{ node, depth },
		...(node.isDir && !collapsed.has(node.path) ? visibleRows(node.children, collapsed, depth + 1) : []),
	]);
}

/** Joins folders that only hold one folder (`scm.compactFolders`): `src/shared/components`. */
export function compactFolders(nodes: readonly TreeNode[]): TreeNode[] {
	return nodes.map(node => {
		if (!node.isDir) {
			return node;
		}
		let inner = node;
		let name = node.name;
		while (inner.children.length === 1 && inner.children[0].isDir) {
			inner = inner.children[0];
			name = `${name}/${inner.name}`;
		}
		return { name, path: inner.path, isDir: true, children: compactFolders(inner.children) };
	});
}

export function filterPaths(paths: readonly string[], query: string): readonly string[] {
	const needle = query.trim().toLowerCase();
	return needle ? paths.filter(path => path.toLowerCase().includes(needle)) : paths;
}
