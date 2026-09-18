import * as vscode from 'vscode';
import { DiffWindow } from './diffWindow';
import type { GitExtension } from './git';
import { fromScmCommand } from './openRequest';
import { pickChange } from './pickChange';
import { GitInternals, ScmOpenRedirect } from './scmRedirect';
import { Bounds, MacWindowBoundsReader, WindowSizeMemory } from './windowBounds';

const BOUNDS_KEY = 'floatingDiff.windowBounds';
const OPEN_SCM_RESOURCE = 'floatingDiff.openScmResource';

export async function activate(context: vscode.ExtensionContext): Promise<void> {
	const log = vscode.window.createOutputChannel('Floating Diff', { log: true });
	context.subscriptions.push(log);
	const diffWindow = new DiffWindow({
		sizeMemory: createSizeMemory(context, log),
		log: message => log.info(message),
	});
	let redirect: ScmOpenRedirect | undefined;
	context.subscriptions.push(
		diffWindow,
		// Runs for the window icon and, through the redirect, for clicks on Source Control files.
		vscode.commands.registerCommand(OPEN_SCM_RESOURCE, async (state?: vscode.SourceControlResourceState) => {
			if (!state) {
				return;
			}
			const command = redirect ? redirect.originalCommand(state) : state.command;
			const req = fromScmCommand(command);
			if (req) {
				await diffWindow.show(req);
			} else if (command) {
				// e.g. the merge editor: keep the regular click behavior
				await vscode.commands.executeCommand(command.command, ...(command.arguments ?? []));
			}
		}),
		vscode.commands.registerCommand('floatingDiff.pickChange', () => pickChange(diffWindow)),
		vscode.commands.registerCommand('floatingDiff.close', () => diffWindow.close()),
	);
	redirect = await setUpScmRedirect(context, log);
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

/** Makes clicks on Source Control files behave like the window icon (see ScmOpenRedirect). */
async function setUpScmRedirect(context: vscode.ExtensionContext, log: vscode.LogOutputChannel): Promise<ScmOpenRedirect | undefined> {
	const extension = vscode.extensions.getExtension<GitExtension>('vscode.git');
	const git = extension && (extension.isActive ? extension.exports : await extension.activate());
	const model = git?.model as GitInternals | undefined;
	if (!git?.enabled || !Array.isArray(model?.repositories)) {
		log.warn('Source Control clicks keep opening tabs: the Git extension internals are unavailable.');
		return undefined;
	}
	const redirect = new ScmOpenRedirect(model, { commandId: OPEN_SCM_RESOURCE, log: message => log.info(message) });
	const enabled = () => vscode.workspace.getConfiguration('floatingDiff').get<boolean>('openFromSourceControl', true);
	// Git lists its files a moment after startup: retry on every change until installed.
	const apply = () => void redirect.setEnabled(enabled());
	const api = git.getAPI(1);
	context.subscriptions.push(
		vscode.workspace.onDidChangeConfiguration(e => {
			if (e.affectsConfiguration('floatingDiff.openFromSourceControl')) {
				apply();
			}
		}),
		...api.repositories.map(repository => repository.state.onDidChange(apply)),
		api.onDidOpenRepository(repository => context.subscriptions.push(repository.state.onDidChange(apply))),
		// Give Source Control its own commands back when the extension goes away.
		{ dispose: () => void redirect.setEnabled(false) },
	);
	apply();
	return redirect;
}

export function deactivate(): void {}
