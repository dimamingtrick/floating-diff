import { groupBranches, syncLabel, type BranchInfo } from '../branches/branchModel';
import type { BranchList } from '../branches/branchService';
import { Change, Repository, RepositoryState, Status } from '../git';
import type { ChangeGroupKind, SidebarBranch, SidebarGroup } from '../shared/protocol';

function item(branch: BranchInfo): SidebarBranch {
	return { name: branch.name, sync: syncLabel(branch), current: branch.current, kind: branch.remote ? 'remote' : 'local' };
}

/** Recent, Local, one group per remote, then Tags; empty groups are left out. */
export function sidebarGroups(list: BranchList, tags: readonly string[]): SidebarGroup[] {
	const groups: SidebarGroup[] = [];
	for (const group of groupBranches(list.branches, list.recent, false)) {
		if (group.title === 'Recent') {
			// The current branch has its own card.
			const others = group.branches.filter(branch => !branch.current);
			if (others.length > 0) {
				groups.push({ title: group.title, items: others.map(item) });
			}
			continue;
		}
		if (group.title !== 'Remote') {
			groups.push({ title: group.title, items: group.branches.map(item) });
			continue;
		}
		const byRemote = new Map<string, BranchInfo[]>();
		for (const branch of group.branches) {
			const remote = branch.remote ?? '';
			byRemote.set(remote, [...(byRemote.get(remote) ?? []), branch]);
		}
		for (const [remote, branches] of byRemote) {
			groups.push({ title: `Remotes / ${remote}`, items: branches.map(item) });
		}
	}
	if (tags.length > 0) {
		groups.push({ title: 'Tags', items: tags.map(name => ({ name, sync: '', current: false, kind: 'tag' })) });
	}
	return groups;
}

export type { ChangeGroupKind };

/** One uncommitted file of the Changes view. */
export interface ChangeRow {
	readonly group: ChangeGroupKind;
	readonly change: Change;
	/** From the repository root, `/`-separated. */
	readonly path: string;
	readonly name: string;
	readonly dir: string;
}

export interface ChangeGroupRows {
	readonly group: ChangeGroupKind;
	readonly label: string;
	readonly rows: readonly ChangeRow[];
}

const GROUP_LABELS: Record<ChangeGroupKind, string> = {
	merge: 'Merge Changes',
	index: 'Staged Changes',
	workingTree: 'Changes',
	untracked: 'Untracked Changes',
};

/** The groups of Source Control in its order; like there, only Changes shows while empty. */
export function changeGroups(repository: Repository): ChangeGroupRows[] {
	const root = `${repository.rootUri.path.replace(/\/$/, '')}/`;
	const group = (kind: ChangeGroupKind, changes: readonly Change[]): ChangeGroupRows => ({
		group: kind,
		label: GROUP_LABELS[kind],
		rows: changes.map(change => {
			const full = change.uri.path;
			const path = full.startsWith(root) ? full.slice(root.length) : full;
			const slash = path.lastIndexOf('/');
			return { group: kind, change, path, name: path.slice(slash + 1), dir: slash < 0 ? '' : path.slice(0, slash) };
		}),
	});
	const { mergeChanges, indexChanges, workingTreeChanges, untrackedChanges = [] } = repository.state;
	return [group('merge', mergeChanges), group('index', indexChanges), group('workingTree', workingTreeChanges), group('untracked', untrackedChanges)].filter(
		g => g.group === 'workingTree' || g.rows.length > 0,
	);
}

export interface StatusDecoration {
	/** Git's letter: M, A, D, R, C, U, I, T or ! for conflicts. */
	readonly letter: string;
	/** Which of Git's decoration colors; deletions are also struck through. */
	readonly decoration: string;
	readonly text: string;
}

const CONFLICTS: Partial<Record<Status, string>> = {
	[Status.ADDED_BY_US]: 'Added By Us',
	[Status.ADDED_BY_THEM]: 'Added By Them',
	[Status.DELETED_BY_US]: 'Deleted By Us',
	[Status.DELETED_BY_THEM]: 'Deleted By Them',
	[Status.BOTH_ADDED]: 'Both Added',
	[Status.BOTH_DELETED]: 'Both Deleted',
	[Status.BOTH_MODIFIED]: 'Both Modified',
};

const DECORATIONS: Partial<Record<Status, StatusDecoration>> = {
	[Status.INDEX_MODIFIED]: { letter: 'M', decoration: 'stageModified', text: 'Index Modified' },
	[Status.MODIFIED]: { letter: 'M', decoration: 'modified', text: 'Modified' },
	[Status.INDEX_ADDED]: { letter: 'A', decoration: 'added', text: 'Index Added' },
	[Status.INTENT_TO_ADD]: { letter: 'A', decoration: 'added', text: 'Intent to Add' },
	[Status.INDEX_DELETED]: { letter: 'D', decoration: 'stageDeleted', text: 'Index Deleted' },
	[Status.DELETED]: { letter: 'D', decoration: 'deleted', text: 'Deleted' },
	[Status.INDEX_RENAMED]: { letter: 'R', decoration: 'renamed', text: 'Index Renamed' },
	[Status.INTENT_TO_RENAME]: { letter: 'R', decoration: 'renamed', text: 'Intent to Rename' },
	[Status.INDEX_COPIED]: { letter: 'C', decoration: 'renamed', text: 'Index Copied' },
	[Status.UNTRACKED]: { letter: 'U', decoration: 'untracked', text: 'Untracked' },
	[Status.IGNORED]: { letter: 'I', decoration: 'ignored', text: 'Ignored' },
	[Status.TYPE_CHANGED]: { letter: 'T', decoration: 'modified', text: 'Type Changed' },
};

/** The letter, color and words Git uses for a file status in Source Control. */
export function statusDecoration(status: Status): StatusDecoration {
	const conflict = CONFLICTS[status];
	if (conflict) {
		return { letter: '!', decoration: 'conflict', text: `Conflict: ${conflict}` };
	}
	return DECORATIONS[status] ?? { letter: '', decoration: 'modified', text: '' };
}

export interface CountSettings {
	/** git.countBadge */
	readonly countBadge: 'all' | 'tracked' | 'off';
	/** git.untrackedChanges */
	readonly untrackedChanges: 'mixed' | 'separate' | 'hidden';
}

/** The number Git gives Source Control for one repository. */
export function repositoryCount(state: RepositoryState, settings: CountSettings): number {
	const { mergeChanges, indexChanges, workingTreeChanges, untrackedChanges = [] } = state;
	if (settings.countBadge === 'off') {
		return 0;
	}
	let count = mergeChanges.length + indexChanges.length + workingTreeChanges.length;
	if (settings.countBadge === 'tracked' && settings.untrackedChanges === 'mixed') {
		count -= workingTreeChanges.filter(change => change.status === Status.UNTRACKED || change.status === Status.IGNORED).length;
	}
	if (settings.countBadge === 'all' && settings.untrackedChanges === 'separate') {
		count += untrackedChanges.length;
	}
	return count;
}

/** The Activity Bar badge like Source Control's (scm.countBadge): all repositories, the focused one, or none. */
export function changesBadge(counts: readonly number[], mode: 'all' | 'focused' | 'off', focused: number): { value: number; tooltip: string } | undefined {
	const value = mode === 'off' ? 0 : mode === 'focused' ? counts[focused] ?? 0 : counts.reduce((sum, count) => sum + count, 0);
	return value > 0 ? { value, tooltip: `${value} pending ${value === 1 ? 'change' : 'changes'}` } : undefined;
}
