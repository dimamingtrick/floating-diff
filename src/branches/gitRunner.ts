import { execFile } from 'child_process';

/** Runs git with `args` in the repository and resolves with its stdout. */
export type GitRunner = (args: readonly string[]) => Promise<string>;

/** A failed git run: `stderr` is git's message, `exitCode` its status. */
export interface GitRunError extends Error {
	readonly exitCode?: number;
	readonly stderr: string;
}

export function createGitRunner(gitPath: string, cwd: string): GitRunner {
	return args => new Promise((resolve, reject) => {
		execFile(gitPath, [...args], { cwd, maxBuffer: 64 * 1024 * 1024 }, (error, stdout, stderr) => {
			if (error) {
				const failure: GitRunError = Object.assign(new Error(stderr.trim() || error.message), {
					exitCode: typeof error.code === 'number' ? error.code : undefined,
					stderr: stderr.trim(),
				});
				reject(failure);
			} else {
				resolve(stdout);
			}
		});
	});
}
