export interface PathMatch {
	readonly path: string;
	/** A folder: its commits are those of every file in it. */
	readonly folder?: boolean;
}

/**
 * Files, and the folders they are in, whose path has every word of `query` in
 * any case, best first: names that start with the last word, then names that
 * have it, then the rest; shorter paths first.
 */
export function searchPaths(files: readonly string[], query: string, limit = 100): PathMatch[] {
	const words = query.toLowerCase().split(/\s+/).filter(Boolean);
	if (words.length === 0) {
		return [];
	}
	const last = words[words.length - 1];
	const found: { readonly match: PathMatch; readonly rank: number }[] = [];
	const consider = (match: PathMatch) => {
		const lower = match.path.toLowerCase();
		if (words.every(word => lower.includes(word))) {
			const name = lower.slice(lower.lastIndexOf('/') + 1);
			found.push({ match, rank: name.startsWith(last) ? 0 : name.includes(last) ? 1 : 2 });
		}
	};
	const folders = new Set<string>();
	for (const file of files) {
		for (let slash = file.indexOf('/'); slash > 0; slash = file.indexOf('/', slash + 1)) {
			folders.add(file.slice(0, slash));
		}
	}
	folders.forEach(folder => consider({ path: folder, folder: true }));
	files.forEach(file => consider({ path: file }));
	found.sort((a, b) => a.rank - b.rank || a.match.path.length - b.match.path.length || a.match.path.localeCompare(b.match.path));
	return found.slice(0, limit).map(entry => entry.match);
}
