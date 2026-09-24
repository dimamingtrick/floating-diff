import * as vscode from 'vscode';
import type { RepoContext } from '../repoContext';
import { runWithProgress } from '../report';
import { askBranchName } from './branchesPopup';

/** The actions of a branch's context menu in the Branches panel, like WebStorm's. */
export type BranchCommand = 'pull' | 'checkout' | 'merge' | 'rebase' | 'newBranch';

/**
 * Runs `command` on the branch named `name`, which need not be the checked-out
 * one: Pull fast-forwards it where it lies, the rest work from the current branch.
 */
export async function runBranchCommand(ctx: RepoContext, command: BranchCommand, name: string): Promise<void> {
	const list = await ctx.branches.list();
	const branch = list.branches.find(candidate => candidate.name === name);
	if (!branch) {
		void vscode.window.showInformationMessage(`Git Convenient: there is no branch "${name}" any more.`);
		return;
	}
	const current = list.current?.name ?? 'HEAD';
	switch (command) {
		case 'pull':
			await runWithProgress(`Pulling ${branch.name}`, () => ctx.branches.pull(branch));
			return;
		case 'checkout':
			await runWithProgress(`Checking out ${branch.name}`, () => ctx.branches.checkout(branch, list.branches));
			return;
		case 'merge':
			await runWithProgress(`Merging ${branch.name} into ${current}`, () => ctx.branches.merge(branch));
			return;
		case 'rebase':
			await runWithProgress(`Rebasing ${current} onto ${branch.name}`, () => ctx.branches.rebaseOnto(branch));
			return;
		case 'newBranch': {
			const created = await askBranchName(`New branch from ${branch.name}`);
			if (created) {
				await runWithProgress(`Creating ${created}`, () => ctx.branches.create(created, branch.name));
			}
			return;
		}
	}
}
