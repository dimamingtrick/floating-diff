import * as vscode from 'vscode';
import type { DiffWindow } from '../diffWindow';
import type { OpenRequest } from '../openRequest';
import { ActionItem, BranchAction, branchActions, branchDescription, BranchInfo, groupBranches, isValidBranchName } from './branchModel';
import type { BranchList, BranchService } from './branchService';
import { reportError as report, runWithProgress } from '../report';

type Pick = vscode.QuickPickItem & {
	readonly branch?: BranchInfo;
	/** Name of a branch to create from the current one. */
	readonly create?: string;
	readonly action?: ActionItem;
};

const MORE_ACTIONS: vscode.QuickInputButton = { iconPath: new vscode.ThemeIcon('ellipsis'), tooltip: 'More actions' };
const NEW_BRANCH: vscode.QuickInputButton = { iconPath: new vscode.ThemeIcon('add'), tooltip: 'New branch' };

function iconFor(branch: BranchInfo): vscode.ThemeIcon {
	if (branch.remote) {
		return new vscode.ThemeIcon('cloud');
	}
	return branch.current ? new vscode.ThemeIcon('git-branch', new vscode.ThemeColor('charts.blue')) : new vscode.ThemeIcon('git-branch');
}

function isNotFullyMerged(error: unknown): boolean {
	const details = error as { gitErrorCode?: string; message?: string; stderr?: string } | undefined;
	return details?.gitErrorCode === 'BranchNotFullyMerged' || /not fully merged/i.test(`${details?.message} ${details?.stderr}`);
}

export async function askBranchName(title: string, value = ''): Promise<string | undefined> {
	const name = await vscode.window.showInputBox({
		title,
		value,
		prompt: 'Branch name',
		validateInput: text => (isValidBranchName(text.trim()) ? undefined : 'Not a valid branch name'),
	});
	return name?.trim() || undefined;
}

/**
 * The branches popup: one Quick Pick with two pages, the branch list and the
 * actions of one branch. Extensions cannot draw their own popups, so it is
 * VS Code's Quick Pick rather than the mockup's bottom-left popup.
 */
export class BranchesPopup {
	private readonly pick = vscode.window.createQuickPick<Pick>();
	private list: BranchList = { branches: [], recent: [] };
	private page: 'branches' | 'actions' = 'branches';
	private actionsFor: BranchInfo | undefined;
	private search = '';

	constructor(
		private readonly service: BranchService,
		private readonly diffWindow: DiffWindow,
		private readonly browse: (branch: BranchInfo) => unknown,
	) { }

	/** Opens the branch list, or straight the actions of `branchName`. */
	async show(branchName?: string): Promise<void> {
		const pick = this.pick;
		pick.matchOnDescription = false;
		const subscriptions = [
			pick.onDidChangeValue(value => {
				if (this.page === 'branches') {
					pick.items = this.branchItems(value);
				}
			}),
			pick.onDidAccept(() => void this.accept()),
			pick.onDidTriggerItemButton(e => {
				if (e.button === MORE_ACTIONS && e.item.branch) {
					this.showActions(e.item.branch);
				}
			}),
			pick.onDidTriggerButton(button => void this.onButton(button)),
			pick.onDidHide(() => {
				subscriptions.forEach(s => s.dispose());
				pick.dispose();
			}),
		];
		this.showBranches('');
		pick.busy = true;
		pick.show();
		try {
			this.list = await this.service.list();
		} catch (error) {
			pick.hide();
			void report(error);
			return;
		}
		pick.busy = false;
		const initial = branchName ? this.list.branches.find(b => b.name === branchName) : undefined;
		if (initial) {
			this.showActions(initial);
		} else if (this.page === 'branches') {
			pick.items = this.branchItems(pick.value);
		}
	}

	private showBranches(value: string): void {
		const pick = this.pick;
		this.page = 'branches';
		this.actionsFor = undefined;
		pick.title = 'Git Branches';
		pick.placeholder = 'Search branches and remotes… (Enter: checkout)';
		pick.buttons = [NEW_BRANCH];
		pick.value = value;
		pick.items = this.branchItems(value);
	}

	private branchItems(value: string): Pick[] {
		const query = value.trim();
		const lower = query.toLowerCase();
		const items: Pick[] = [];
		if (query && isValidBranchName(query) && !this.list.branches.some(b => b.name === query)) {
			items.push({ label: `$(add) Create branch "${query}"`, alwaysShow: true, create: query });
		}
		// Filter here as well, so the group counters match what is shown.
		const matching = lower ? this.list.branches.filter(b => b.name.toLowerCase().includes(lower)) : this.list.branches;
		for (const group of groupBranches(matching, this.list.recent, query !== '')) {
			items.push({ label: `${group.title} · ${group.branches.length}`, kind: vscode.QuickPickItemKind.Separator });
			for (const branch of group.branches) {
				items.push({ label: branch.name, description: branchDescription(branch), iconPath: iconFor(branch), buttons: [MORE_ACTIONS], branch });
			}
		}
		return items;
	}

	private showActions(branch: BranchInfo): void {
		const pick = this.pick;
		this.search = pick.value;
		this.page = 'actions';
		this.actionsFor = branch;
		pick.title = branch.name;
		pick.placeholder = 'Choose an action';
		pick.buttons = [vscode.QuickInputButtons.Back];
		pick.value = '';
		const items: Pick[] = [];
		let group = 0;
		for (const action of branchActions(branch, this.currentName())) {
			if (group !== 0 && action.group !== group) {
				items.push({ label: '', kind: vscode.QuickPickItemKind.Separator });
			}
			group = action.group;
			items.push({ label: action.label, action });
		}
		pick.items = items;
	}

	private async onButton(button: vscode.QuickInputButton): Promise<void> {
		if (button === vscode.QuickInputButtons.Back) {
			this.showBranches(this.search);
		} else if (button === NEW_BRANCH) {
			this.pick.hide();
			const name = await askBranchName('New branch');
			if (name) {
				await this.run(`Creating ${name}`, () => this.service.create(name));
			}
		}
	}

	private async accept(): Promise<void> {
		const item = this.pick.selectedItems[0] ?? this.pick.activeItems[0];
		const branch = this.actionsFor;
		if (!item) {
			return;
		}
		this.pick.hide();
		if (item.action && branch) {
			await this.perform(item.action.action, branch);
		} else if (item.create) {
			const name = item.create;
			await this.run(`Creating ${name}`, () => this.service.create(name));
		} else if (item.branch && !item.branch.current) {
			await this.perform('checkout', item.branch);
		}
	}

	private async perform(action: BranchAction, branch: BranchInfo): Promise<void> {
		switch (action) {
			case 'checkout':
				await this.run(`Checking out ${branch.name}`, () => this.service.checkout(branch, this.list.branches));
				return;
			case 'browse':
				await this.browse(branch);
				return;
			case 'compare':
				await this.showDiff(() => this.service.compare(branch, this.currentName()));
				return;
			case 'diffWorkingTree':
				await this.showDiff(() => this.service.diffWithWorkingTree(branch));
				return;
			case 'newBranch': {
				const name = await askBranchName(`New branch from ${branch.name}`);
				if (name) {
					await this.run(`Creating ${name}`, () => this.service.create(name, branch.name));
				}
				return;
			}
			case 'merge':
				await this.run(`Merging ${branch.name}`, () => this.service.merge(branch));
				return;
			case 'rebase':
				await this.run(`Rebasing onto ${branch.name}`, () => this.service.rebaseOnto(branch));
				return;
			case 'pullRebase':
				await this.run(`Pulling ${branch.name} with rebase`, () => this.service.pullRebase(branch));
				return;
			case 'rename': {
				const name = await askBranchName(`Rename ${branch.name}`, branch.name);
				if (name && name !== branch.name) {
					await this.run(`Renaming ${branch.name}`, () => this.service.rename(branch, name));
				}
				return;
			}
			case 'delete':
				await this.deleteBranch(branch);
				return;
		}
	}

	private async deleteBranch(branch: BranchInfo): Promise<void> {
		const confirm = await vscode.window.showWarningMessage(`Delete branch "${branch.name}"?`, { modal: true }, 'Delete');
		if (confirm !== 'Delete') {
			return;
		}
		try {
			await this.withProgress(`Deleting ${branch.name}`, () => this.service.delete(branch));
		} catch (error) {
			if (!isNotFullyMerged(error)) {
				void report(error);
				return;
			}
			const force = await vscode.window.showWarningMessage(`Branch "${branch.name}" is not fully merged. Delete anyway?`, { modal: true }, 'Force Delete');
			if (force === 'Force Delete') {
				await this.run(`Deleting ${branch.name}`, () => this.service.delete(branch, true));
			}
		}
	}

	private async showDiff(load: () => Promise<OpenRequest | undefined>): Promise<void> {
		let req: OpenRequest | undefined;
		const loaded = await this.run('Comparing', async () => {
			req = await load();
		});
		if (req) {
			await this.diffWindow.show(req);
		} else if (loaded) {
			void vscode.window.showInformationMessage('GitStorm: no differences.');
		}
	}

	private currentName(): string {
		return this.list.current?.name ?? 'HEAD';
	}

	private run(title: string, task: () => Promise<void>): Promise<boolean> {
		return runWithProgress(title, task);
	}

	private withProgress(title: string, task: () => Promise<void>): Thenable<void> {
		return vscode.window.withProgress({ location: vscode.ProgressLocation.Window, title: `GitStorm: ${title}` }, task);
	}
}
