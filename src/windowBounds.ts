import { spawn } from 'child_process';

export interface Bounds {
	readonly x: number;
	readonly y: number;
	readonly width: number;
	readonly height: number;
}

export interface BoundsStore {
	get(): Bounds | undefined;
	set(bounds: Bounds): Thenable<void>;
}

/** Reads the bounds of the frontmost window of this VS Code instance. */
export interface WindowBoundsReader {
	read(): Promise<Bounds | undefined>;
	/** Starts the reader ahead of the first read, so that read stays fast. */
	warmUp(): void;
	dispose(): void;
}

const MIN_SIZE = 200;

export function parseBounds(output: string): Bounds | undefined {
	const parts = output.trim().split(',').map(part => Number(part.trim()));
	if (parts.length !== 4 || parts.some(n => !Number.isFinite(n))) {
		return undefined;
	}
	const [x, y, width, height] = parts;
	if (width < MIN_SIZE || height < MIN_SIZE) {
		return undefined;
	}
	return { x, y, width, height };
}

/**
 * JXA helper: for every "<pid>" line on stdin, prints the bounds of that
 * process's frontmost on-screen window as "x,y,width,height" (or an empty
 * line). CoreGraphics window bounds need no macOS permissions, unlike UI
 * scripting. Exits when stdin closes, i.e. when the extension host goes away.
 */
const HELPER_SCRIPT = String.raw`
ObjC.import('Foundation');
ObjC.import('CoreGraphics');
ObjC.import('stdlib');
function frontmost(pid) {
	const onScreenWithoutDesktop = 1 | 16;
	const list = ObjC.castRefToObject($.CGWindowListCopyWindowInfo(onScreenWithoutDesktop, 0));
	for (let i = 0; i < Number(list.count); i++) {
		const w = list.objectAtIndex(i);
		if (ObjC.unwrap(w.objectForKey('kCGWindowOwnerPID')) !== pid || ObjC.unwrap(w.objectForKey('kCGWindowLayer')) !== 0) {
			continue;
		}
		const b = ObjC.deepUnwrap(w.objectForKey('kCGWindowBounds'));
		if (b.Width >= ${MIN_SIZE} && b.Height >= ${MIN_SIZE}) {
			return [b.X, b.Y, b.Width, b.Height].join(',');
		}
	}
	return '';
}
function run() {
	const input = $.NSFileHandle.fileHandleWithStandardInput;
	const output = $.NSFileHandle.fileHandleWithStandardOutput;
	for (;;) {
		const data = input.availableData;
		if (Number(data.length) === 0) {
			$.exit(0);
		}
		const text = ObjC.unwrap($.NSString.alloc.initWithDataEncoding(data, $.NSUTF8StringEncoding));
		for (const line of text.split('\n')) {
			const pid = parseInt(line, 10);
			if (!isNaN(pid)) {
				output.writeData($(frontmost(pid) + '\n').dataUsingEncoding($.NSUTF8StringEncoding));
			}
		}
	}
}`;

/** The part of a child process the reader uses; replaceable in tests. */
export interface HelperProcess {
	readonly stdin: NodeJS.WritableStream;
	readonly stdout: NodeJS.ReadableStream;
	on(event: 'exit', listener: (code: number | null) => void): unknown;
	kill(): boolean;
}

function spawnHelper(): HelperProcess {
	return spawn('osascript', ['-l', 'JavaScript', '-e', HELPER_SCRIPT], { stdio: ['pipe', 'pipe', 'ignore'] });
}

interface PendingRead {
	settled: boolean;
	resolve(line: string): void;
}

/** Reads window bounds through a long-lived osascript helper: ~1 ms per read. */
export class MacWindowBoundsReader implements WindowBoundsReader {
	private helper: HelperProcess | undefined;
	private buffer = '';
	private readonly pending: PendingRead[] = [];
	private readonly spawn: () => HelperProcess;
	private readonly timeoutMs: number;

	constructor(private readonly pid: number, options: { spawn?: () => HelperProcess; timeoutMs?: number } = {}) {
		this.spawn = options.spawn ?? spawnHelper;
		this.timeoutMs = options.timeoutMs ?? 300;
	}

	warmUp(): void {
		this.ensureHelper();
	}

	read(): Promise<Bounds | undefined> {
		const helper = this.ensureHelper();
		return new Promise(resolve => {
			const read: PendingRead = {
				settled: false,
				resolve: line => {
					read.settled = true;
					clearTimeout(timer);
					resolve(parseBounds(line));
				},
			};
			const timer = setTimeout(() => {
				read.settled = true;
				resolve(undefined);
			}, this.timeoutMs);
			this.pending.push(read);
			helper.stdin.write(`${this.pid}\n`);
		});
	}

	dispose(): void {
		this.helper?.kill();
		this.helper = undefined;
	}

	private ensureHelper(): HelperProcess {
		if (this.helper) {
			return this.helper;
		}
		const helper = this.spawn();
		this.helper = helper;
		this.buffer = '';
		helper.stdout.on('data', (chunk: Buffer | string) => this.onData(String(chunk)));
		helper.on('exit', () => {
			if (this.helper === helper) {
				this.helper = undefined;
			}
			// Every request sent to this helper is lost: answer them with "no window".
			for (const read of this.pending.splice(0)) {
				if (!read.settled) {
					read.resolve('');
				}
			}
		});
		return helper;
	}

	private onData(chunk: string): void {
		this.buffer += chunk;
		let newline: number;
		while ((newline = this.buffer.indexOf('\n')) >= 0) {
			const line = this.buffer.slice(0, newline);
			this.buffer = this.buffer.slice(newline + 1);
			// Answers arrive in request order; a timed-out read still consumes its answer.
			const read = this.pending.shift();
			if (read && !read.settled) {
				read.resolve(line);
			}
		}
	}
}

/** Remembers the floating window size across windows and workspaces. */
export class WindowSizeMemory {
	constructor(
		private readonly reader: WindowBoundsReader,
		private readonly store: BoundsStore,
		private readonly onError: (error: unknown) => void,
	) { }

	savedBounds(): Bounds | undefined {
		return this.store.get();
	}

	async remember(): Promise<void> {
		try {
			const bounds = await this.reader.read();
			if (bounds) {
				await this.store.set(bounds);
			}
		} catch (error) {
			this.onError(error);
		}
	}
}
