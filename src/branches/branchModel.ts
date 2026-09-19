/** A local or remote-tracking branch as the branches popup shows it. */
export interface BranchInfo {
	/** `main`, or `origin/feature/x` for a remote branch. */
	readonly name: string;
	/** Remote of a remote branch (`origin`). */
	readonly remote?: string;
	/** Upstream of a local branch (`origin/main`). */
	readonly upstream?: string;
	readonly ahead: number;
	readonly behind: number;
	readonly current: boolean;
	/** A local branch fully merged into the current one. */
	readonly merged: boolean;
}

/** `git for-each-ref` format read by `parseBranches`: NUL-separated fields, one ref per line. */
export const FOR_EACH_REF_FORMAT = '%(refname)%00%(upstream:short)%00%(upstream:track,nobracket)%00%(HEAD)';

function count(track: string, word: 'ahead' | 'behind'): number {
	const match = new RegExp(`${word} (\\d+)`).exec(track);
	return match ? Number(match[1]) : 0;
}

export function parseBranches(forEachRef: string, merged: ReadonlySet<string>): BranchInfo[] {
	const branches: BranchInfo[] = [];
	for (const line of forEachRef.split('\n')) {
		const [ref = '', upstream = '', track = '', head = ''] = line.split('\0');
		if (ref.startsWith('refs/heads/')) {
			const name = ref.slice('refs/heads/'.length);
			const current = head === '*';
			branches.push({ name, upstream: upstream || undefined, ahead: count(track, 'ahead'), behind: count(track, 'behind'), current, merged: !current && merged.has(name) });
		} else if (ref.startsWith('refs/remotes/')) {
			const name = ref.slice('refs/remotes/'.length);
			const slash = name.indexOf('/');
			if (slash > 0 && !name.endsWith('/HEAD')) {
				branches.push({ name, remote: name.slice(0, slash), ahead: 0, behind: 0, current: false, merged: false });
			}
		}
	}
	return branches;
}

export function parseLines(output: string): string[] {
	return output.split('\n').map(line => line.trim()).filter(Boolean);
}

const CHECKOUT = /^checkout: moving from .+ to (.+)$/;
const HASH = /^[0-9a-f]{7,40}$/;

/** Branches from `git reflog --format=%gs`, most recently checked out first. */
export function parseRecent(reflogSubjects: string, limit = 5): string[] {
	const names: string[] = [];
	for (const line of reflogSubjects.split('\n')) {
		const name = CHECKOUT.exec(line.trim())?.[1];
		if (name && !HASH.test(name) && !names.includes(name)) {
			names.push(name);
			if (names.length === limit) {
				break;
			}
		}
	}
	return names;
}

export function syncLabel(branch: { readonly ahead: number; readonly behind: number }): string {
	return [branch.behind ? `↓${branch.behind}` : '', branch.ahead ? `↑${branch.ahead}` : ''].filter(Boolean).join(' ');
}

export function branchDescription(branch: BranchInfo): string {
	const tag = branch.current ? 'current' : branch.merged ? 'merged' : '';
	return [tag, syncLabel(branch)].filter(Boolean).join('  ');
}

export interface BranchGroup {
	readonly title: 'Recent' | 'Local' | 'Remote';
	readonly branches: readonly BranchInfo[];
}

export function groupBranches(branches: readonly BranchInfo[], recent: readonly string[], searching: boolean): BranchGroup[] {
	const local = branches.filter(b => !b.remote).sort((a, b) => Number(b.current) - Number(a.current) || a.name.localeCompare(b.name));
	const remote = branches.filter(b => b.remote).sort((a, b) => a.name.localeCompare(b.name));
	const byName = new Map(local.map(b => [b.name, b] as const));
	// While searching, Recent would repeat the Local matches; the current branch is first in Local anyway.
	const recentBranches = searching ? [] : recent.flatMap(name => byName.get(name) ?? []).filter(b => !b.current);
	const groups: BranchGroup[] = [
		{ title: 'Recent', branches: recentBranches },
		{ title: 'Local', branches: local },
		{ title: 'Remote', branches: remote },
	];
	return groups.filter(group => group.branches.length > 0);
}

/** The subset of `git check-ref-format` rules users run into. */
export function isValidBranchName(name: string): boolean {
	return name.length > 0
		&& name !== '@'
		&& !/[\s~^:?*[\\\x00-\x1f\x7f]/.test(name)
		&& !name.includes('..') && !name.includes('@{') && !name.includes('//')
		&& !name.startsWith('-') && !name.startsWith('/')
		&& !name.endsWith('/') && !name.endsWith('.') && !name.endsWith('.lock')
		&& !name.split('/').some(part => part.startsWith('.'));
}

export function localName(branch: BranchInfo): string {
	return branch.remote ? branch.name.slice(branch.remote.length + 1) : branch.name;
}

export type BranchAction = 'checkout' | 'browse' | 'compare' | 'diffWorkingTree' | 'newBranch' | 'merge' | 'rebase' | 'pullRebase' | 'rename' | 'delete';

export interface ActionItem {
	readonly action: BranchAction;
	readonly label: string;
	/** Actions of one group sit between separators. */
	readonly group: 1 | 2 | 3;
}

/** The popup's actions for `branch`; `current` is the checked-out branch. */
export function branchActions(branch: BranchInfo, current: string): ActionItem[] {
	const other = !branch.current;
	const items: (ActionItem | false)[] = [
		other && { action: 'checkout', label: 'Checkout', group: 1 },
		{ action: 'browse', label: 'Browse files at this branch', group: 1 },
		other && { action: 'compare', label: `Compare with ${current}`, group: 1 },
		{ action: 'diffWorkingTree', label: 'Show diff with working tree', group: 1 },
		{ action: 'newBranch', label: `New branch from ${branch.name}…`, group: 2 },
		other && { action: 'merge', label: `Merge ${branch.name} into ${current}`, group: 2 },
		other && { action: 'rebase', label: `Rebase ${current} onto ${branch.name}`, group: 2 },
		!!branch.remote && { action: 'pullRebase', label: `Pull into ${current} using rebase`, group: 2 },
		!branch.remote && { action: 'rename', label: 'Rename…', group: 3 },
		!branch.remote && other && { action: 'delete', label: 'Delete', group: 3 },
	];
	return items.filter((item): item is ActionItem => item !== false);
}
