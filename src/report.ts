import * as vscode from 'vscode';

/** First line of a git failure: git's own message when there is one. */
export function errorText(error: unknown): string {
	const details = error as { message?: string; stderr?: string } | undefined;
	const text = details?.stderr?.trim() || details?.message || String(error);
	return text.split('\n')[0];
}

export async function reportError(error: unknown): Promise<void> {
	const choice = await vscode.window.showErrorMessage(`Git Convenient: ${errorText(error)}`, 'Show Git Output');
	if (choice) {
		void vscode.commands.executeCommand('git.showOutput');
	}
}

/** Runs a git task with a status bar spinner; resolves to false if it failed (already reported). */
export async function runWithProgress(title: string, task: () => Promise<unknown>): Promise<boolean> {
	try {
		await vscode.window.withProgress({ location: vscode.ProgressLocation.Window, title: `Git Convenient: ${title}` }, task);
		return true;
	} catch (error) {
		void reportError(error);
		return false;
	}
}
