import * as vscode from 'vscode';
import { DiffWindow, SizeMemory } from './diffWindow';
import { fromScmCommand } from './openRequest';
import { pickChange } from './pickChange';
import { Bounds, isPermissionError, MacWindowBounds, WindowSizeMemory } from './windowBounds';

const BOUNDS_KEY = 'floatingDiff.windowBounds';
const ACCESSIBILITY_SETTINGS = 'x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility';

export function activate(context: vscode.ExtensionContext): void {
	const log = vscode.window.createOutputChannel('Floating Diff', { log: true });
	const diffWindow = new DiffWindow({
		sizeMemory: createSizeMemory(context, log),
		log: message => log.info(message),
	});
	context.subscriptions.push(
		log,
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

/** Window size memory needs macOS UI scripting; other platforms keep VS Code's default size. */
function createSizeMemory(context: vscode.ExtensionContext, log: vscode.LogOutputChannel): SizeMemory | undefined {
	if (process.platform !== 'darwin') {
		return undefined;
	}
	let hintShown = false;
	return new WindowSizeMemory(
		new MacWindowBounds(),
		{
			get: () => context.globalState.get<Bounds>(BOUNDS_KEY),
			set: bounds => context.globalState.update(BOUNDS_KEY, bounds),
		},
		error => {
			log.warn(`Window size: ${error instanceof Error ? error.message : String(error)}`);
			if (isPermissionError(error) && !hintShown) {
				hintShown = true;
				void vscode.window.showWarningMessage(
					`Floating Diff: to remember the window size, allow ${vscode.env.appName} in System Settings → Privacy & Security → Accessibility.`,
					'Open Settings',
				).then(choice => {
					if (choice) {
						void vscode.env.openExternal(vscode.Uri.parse(ACCESSIBILITY_SETTINGS));
					}
				});
			}
		},
	);
}

export function deactivate(): void {}
