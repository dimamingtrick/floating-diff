import { execFile } from 'child_process';

/** Runs git with `args` in the repository, feeding it `input`, and resolves with its stdout. */
export type GitRunner = (args: readonly string[], input?: string) => Promise<string>;

/** A failed git run: `stderr` is git's message, `exitCode` its status. */
export interface GitRunError extends Error {
	readonly exitCode?: number;
	readonly stderr: string;
}

export function createGitRunner(gitPath: string, cwd: string): GitRunner {
	return (args, input) => new Promise((resolve, reject) => {
		const child = execFile(gitPath, [...args], { cwd, maxBuffer: 64 * 1024 * 1024 }, (error, stdout, stderr) => {
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
		if (input !== undefined) {
			// git that stops reading (a bad revision, a line past the end) breaks the pipe: its exit code says why.
			child.stdin?.on('error', () => undefined);
			child.stdin?.end(input);
		}
	});
}
