import type { Uri } from 'vscode';
import { Change, Repository, RepositoryOperations, Status } from '../git';
import type { ChangeResource, OpenRequest } from '../openRequest';
import { BranchInfo, FOR_EACH_REF_FORMAT, localName, parseBranches, parseLines, parseRecent, pullPlan } from './branchModel';
import type { GitRunner } from './gitRunner';

export interface BranchList {
	readonly branches: BranchInfo[];
	readonly recent: string[];
	readonly current?: BranchInfo;
}

const ADDED = new Set([Status.INDEX_ADDED, Status.UNTRACKED, Status.INTENT_TO_ADD]);
const DELETED = new Set([Status.INDEX_DELETED, Status.DELETED]);

/** Branch operations of one repository: Git API for anything networked, plain git for local refs. */
export class BranchService {
	constructor(
		readonly repository: Repository & RepositoryOperations,
		private readonly git: GitRunner,
		private readonly toGitUri: (uri: Uri, ref: string) => Uri,
	) { }

	async list(): Promise<BranchList> {
		const [refs, merged, reflog] = await Promise.all([
			this.git(['for-each-ref', `--format=${FOR_EACH_REF_FORMAT}`, 'refs/heads', 'refs/remotes']),
			this.git(['for-each-ref', '--merged=HEAD', '--format=%(refname:short)', 'refs/heads']).catch(() => ''),
			this.git(['reflog', '--format=%gs', '-n', '300']).catch(() => ''),
		]);
		const branches = parseBranches(refs, new Set(parseLines(merged)));
		return { branches, recent: parseRecent(reflog), current: branches.find(b => b.current) };
	}

	/** A remote branch checks out as a local tracking branch, like WebStorm. */
	async checkout(branch: BranchInfo, all: readonly BranchInfo[]): Promise<void> {
		const name = localName(branch);
		if (!branch.remote || all.some(b => !b.remote && b.name === name)) {
			await this.repository.checkout(name);
			return;
		}
		await this.repository.createBranch(name, true, branch.name);
		await this.git(['branch', `--set-upstream-to=${branch.name}`, name]);
		await this.repository.status();
	}

	create(name: string, from?: string): Promise<void> {
		return this.repository.createBranch(name, true, from);
	}

	async rename(branch: BranchInfo, newName: string): Promise<void> {
		await this.git(['branch', '-m', branch.name, newName]);
		await this.repository.status();
	}

	delete(branch: BranchInfo, force = false): Promise<void> {
		return this.repository.deleteBranch(branch.name, force);
	}

	merge(branch: BranchInfo): Promise<void> {
		return this.repository.merge(branch.name);
	}

	async rebaseOnto(branch: BranchInfo): Promise<void> {
		try {
			await this.git(['rebase', branch.name]);
		} finally {
			await this.repository.status();
		}
	}

	/**
	 * Brings a branch up to date without checking it out: fetching its upstream
	 * into it fast-forwards the local ref and leaves the working tree alone.
	 * The checked-out branch pulls the usual way, since its files move too.
	 */
	async pull(branch: BranchInfo): Promise<void> {
		const plan = pullPlan(branch);
		if (plan.kind === 'none') {
			throw new Error(plan.reason);
		}
		if (plan.kind === 'pull') {
			await this.repository.pull();
			return;
		}
		try {
			await this.git(plan.args);
		} finally {
			await this.repository.status();
		}
	}

	async pullRebase(branch: BranchInfo): Promise<void> {
		await this.repository.fetch(branch.remote, localName(branch));
		await this.rebaseOnto(branch);
	}

	/** What `branch` changed since it forked from `current` (`current...branch`). */
	async compare(branch: BranchInfo, current: string): Promise<OpenRequest | undefined> {
		const [changes, base] = await Promise.all([
			this.repository.diffBetween(current, branch.name),
			this.git(['merge-base', current, branch.name]).then(out => out.trim()),
		]);
		return this.request(`${current} ↔ ${branch.name}`, changes, uri => this.toGitUri(uri, base), uri => this.toGitUri(uri, branch.name));
	}

	async diffWithWorkingTree(branch: BranchInfo): Promise<OpenRequest | undefined> {
		const changes = await this.repository.diffWith(branch.name);
		return this.request(`${branch.name} ↔ working tree`, changes, uri => this.toGitUri(uri, branch.name), uri => uri);
	}

	private request(title: string, changes: readonly Change[], left: (uri: Uri) => Uri, right: (uri: Uri) => Uri): OpenRequest | undefined {
		if (changes.length === 0) {
			return undefined;
		}
		const resources = changes.map((change): ChangeResource => ({
			label: change.uri,
			original: ADDED.has(change.status) ? undefined : left(change.originalUri),
			modified: DELETED.has(change.status) ? undefined : right(change.uri),
		}));
		return { kind: 'changes', title, resources };
	}
}
