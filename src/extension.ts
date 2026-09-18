import * as vscode from 'vscode';
import { DiffWindow } from './diffWindow';
import { fromScmCommand } from './openRequest';
import { pickChange } from './pickChange';

export function activate(context: vscode.ExtensionContext): void {
	const diffWindow = new DiffWindow();
	context.subscriptions.push(
		diffWindow,
		vscode.commands.registerCommand('floatingDiff.openScmResource', async (state?: vscode.SourceControlResourceState) => {
			const req = fromScmCommand(state?.command);
			if (req) {
				await diffWindow.show(req);
			} else if (state?.command) {
				// e.g. the merge editor: keep the regular click behavior
				await vscode.commands.executeCommand(state.command.command, ...(state.command.arguments ?? []));
			}
		}),
		vscode.commands.registerCommand('floatingDiff.pickChange', () => pickChange(diffWindow)),
		vscode.commands.registerCommand('floatingDiff.close', () => diffWindow.close()),
	);
}

export function deactivate(): void {}
