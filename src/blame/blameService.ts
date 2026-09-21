import type { GitRunner } from '../branches/gitRunner';
import { BlameLine, parseBlamePorcelain } from './blame';

export interface BlameRequest {
	/** The file, relative to the repository root, with forward slashes. */
	readonly path: string;
	/** The line to blame, counting from 1. */
	readonly line: number;
	/** The text an editor holds, when it differs from the file on disk. */
	readonly contents?: string;
	/** Changes whenever the text does; the blame of the old text is then dropped. */
	readonly key: string;
}

/**
 * `git blame` one line at a time, keeping the answers while the file stays as
 * it is: a cursor moving up and down a file runs git once per line it visits.
 */
export class BlameService {
	private readonly files = new Map<string, { key: string; lines: Map<number, Promise<BlameLine | undefined>> }>();

	constructor(private readonly git: GitRunner) { }

	line(request: BlameRequest): Promise<BlameLine | undefined> {
		const cached = this.files.get(request.path);
		const file = cached?.key === request.key ? cached : { key: request.key, lines: new Map<number, Promise<BlameLine | undefined>>() };
		this.files.set(request.path, file);
		const blamed = file.lines.get(request.line) ?? this.run(request);
		file.lines.set(request.line, blamed);
		return blamed;
	}

	/** Drops every answer, e.g. after a commit rewrites what the lines belong to. */
	clear(): void {
		this.files.clear();
	}

	private run(request: BlameRequest): Promise<BlameLine | undefined> {
		const range = `${request.line},${request.line}`;
		// `--contents -` blames the text the editor holds, so unsaved edits keep the line numbers honest.
		const args = ['blame', '--line-porcelain', '-L', range, ...(request.contents === undefined ? [] : ['--contents', '-']), '--', request.path];
		// A file git does not track, a line past the end: git says so on stderr and there is nothing to show.
		return this.git(args, request.contents).then(parseBlamePorcelain, () => undefined);
	}
}
