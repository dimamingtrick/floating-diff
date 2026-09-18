import * as vscode from 'vscode';
import type { API, GitExtension } from './git';

/** The built-in Git extension API, or undefined when Git is missing or disabled. */
export async function getGitApi(): Promise<API | undefined> {
	const extension = vscode.extensions.getExtension<GitExtension>('vscode.git');
	if (!extension) {
		return undefined;
	}
	const git = extension.isActive ? extension.exports : await extension.activate();
	return git?.enabled ? git.getAPI(1) : undefined;
}
