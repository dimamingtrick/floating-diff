import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import type { API, GitExtension, Repository, RepositoryOperations } from '../../git';

export async function waitFor(condition: () => boolean, what: string, timeoutMs = 5000): Promise<void> {
	const start = Date.now();
	while (!condition()) {
		if (Date.now() - start > timeoutMs) {
			throw new Error(`Timed out waiting for: ${what}`);
		}
		await new Promise(resolve => setTimeout(resolve, 50));
	}
}

export interface TestRepo {
	readonly dir: string;
	git(...args: string[]): string;
	write(name: string, text: string): void;
}

/** A fresh repository on `main` with a test identity. */
export function createTestRepo(prefix: string): TestRepo {
	const dir = path.join(fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix))), 'work');
	fs.mkdirSync(dir);
	const repo: TestRepo = {
		dir,
		git: (...args) => execFileSync('git', args, { cwd: dir, stdio: 'pipe' }).toString(),
		write: (name, text) => {
			fs.mkdirSync(path.dirname(path.join(dir, name)), { recursive: true });
			fs.writeFileSync(path.join(dir, name), text);
		},
	};
	repo.git('init', '-q', '-b', 'main');
	repo.git('config', 'user.email', 'test@example.com');
	repo.git('config', 'user.name', 'Test');
	return repo;
}

/** Opens `dir` in the Git extension and makes one of its files the active editor. */
export async function openTestRepo(dir: string, file: string): Promise<{ api: API; repository: Repository & RepositoryOperations }> {
	const extension = vscode.extensions.getExtension<GitExtension>('vscode.git')!;
	const api = (extension.isActive ? extension.exports : await extension.activate()).getAPI(1);
	await vscode.commands.executeCommand('git.openRepository', dir);
	await waitFor(() => api.getRepository(vscode.Uri.file(dir)) !== null, 'repository open', 15000);
	await vscode.window.showTextDocument(vscode.Uri.file(path.join(dir, file)));
	const repository = api.getRepository(vscode.Uri.file(dir)) as Repository & RepositoryOperations;
	return { api, repository };
}

export function allTabs(): vscode.Tab[] {
	return vscode.window.tabGroups.all.flatMap(group => group.tabs);
}

/** Polls `read` (e.g. the latest rendered count) until it returns `expected`. */
export async function waitForValue<T>(read: () => Promise<T>, expected: T, what: string, timeoutMs = 10000): Promise<void> {
	const start = Date.now();
	let last = await read();
	while (last !== expected) {
		if (Date.now() - start > timeoutMs) {
			throw new Error(`Timed out waiting for ${what}: got ${String(last)}, expected ${String(expected)}`);
		}
		await new Promise(resolve => setTimeout(resolve, 100));
		last = await read();
	}
}
