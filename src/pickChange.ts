import * as path from 'path';
import * as vscode from 'vscode';
import type { DiffWindow } from './diffWindow';
import { getGitApi } from './gitApi';
import { ChangeGroup, ChangeItem, indexRenameOf, listChanges, statusLetter } from './gitChanges';
import { fromChange } from './openRequest';

const GROUP_LABELS: Record<ChangeGroup, string> = {
	index: 'Staged Changes',
	workingTree: 'Changes',
	untracked: 'Untracked Changes',
};

interface ChangePick extends vscode.QuickPickItem {
	readonly item?: ChangeItem;
}

export async function pickChange(diffWindow: DiffWindow): Promise<void> {
	const api = await getGitApi();
	if (!api) {
		void vscode.window.showErrorMessage('GitStorm: the built-in Git extension is disabled.');
		return;
	}
	const items = listChanges(api);
	if (items.length === 0) {
		void vscode.window.showInformationMessage('GitStorm: no changes.');
		return;
	}

	const multiRepo = api.repositories.length > 1;
	const picks: ChangePick[] = [];
	let section = '';
	for (const item of items) {
		const key = `${item.repository.rootUri.toString()}|${item.group}`;
		if (key !== section) {
			section = key;
			const repoName = path.basename(item.repository.rootUri.fsPath);
			const label = multiRepo ? `${GROUP_LABELS[item.group]} · ${repoName}` : GROUP_LABELS[item.group];
			picks.push({ label, kind: vscode.QuickPickItemKind.Separator });
		}
		const folder = path.relative(item.repository.rootUri.fsPath, path.dirname(item.change.uri.fsPath));
		const letter = statusLetter(item.change.status);
		picks.push({
			label: path.basename(item.change.uri.fsPath),
			description: [folder, letter].filter(Boolean).join('  '),
			item,
		});
	}

	const picked = await vscode.window.showQuickPick(picks, {
		placeHolder: 'Open change in a floating window',
		matchOnDescription: true,
	});
	if (!picked?.item) {
		return;
	}
	const { repository, change } = picked.item;
	const req = fromChange(change, {
		toGitUri: (uri, ref) => api.toGitUri(uri, ref),
		indexRenameOf: uri => indexRenameOf(repository, uri),
	});
	if (req) {
		await diffWindow.show(req);
	}
}
