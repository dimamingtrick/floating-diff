import * as vscode from 'vscode';
import { DiffWindow } from './diffWindow';
import { fromScmCommand } from './openRequest';
import { pickChange } from './pickChange';
import { Bounds, MacWindowBoundsReader, WindowSizeMemory } from './windowBounds';

const BOUNDS_KEY = 'floatingDiff.windowBounds';

export function activate(context: vscode.ExtensionContext): void {
	const log = vscode.window.createOutputChannel('Floating Diff', { log: true });
	context.subscriptions.push(log);
	const diffWindow = new DiffWindow({
		sizeMemory: createSizeMemory(context, log),
		log: message => log.info(message),
	});
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

/**
 * Reading window bounds uses macOS CoreGraphics, which needs no permissions.
 * The extension host's parent process owns all windows of this VS Code instance.
 */
function createSizeMemory(context: vscode.ExtensionContext, log: vscode.LogOutputChannel): WindowSizeMemory | undefined {
	if (process.platform !== 'darwin') {
		return undefined;
	}
	const reader = new MacWindowBoundsReader(process.ppid);
	reader.warmUp();
	context.subscriptions.push({ dispose: () => reader.dispose() });
	return new WindowSizeMemory(
		reader,
		{
			get: () => context.globalState.get<Bounds>(BOUNDS_KEY),
			set: bounds => context.globalState.update(BOUNDS_KEY, bounds),
		},
		error => log.warn(`Window size: ${error instanceof Error ? error.message : String(error)}`),
	);
}

export function deactivate(): void {}
