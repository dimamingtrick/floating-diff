import { execFile } from 'child_process';

export interface Bounds {
	readonly x: number;
	readonly y: number;
	readonly width: number;
	readonly height: number;
}

/** Reads and moves the frontmost window, but only when its title contains `title`. */
export interface WindowBoundsDriver {
	read(title: string): Promise<Bounds | undefined>;
	/** Resolves to false when the window never showed up with a matching title. */
	apply(bounds: Bounds, title: string): Promise<boolean>;
}

export interface BoundsStore {
	get(): Bounds | undefined;
	set(bounds: Bounds): Thenable<void>;
}

export type ScriptRunner = (script: string) => Promise<string>;

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

function quote(text: string): string {
	return `"${text.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

export function readScript(title: string): string {
	return [
		'tell application "System Events"',
		'set w to window 1 of (first process whose frontmost is true)',
		`if name of w does not contain ${quote(title)} then return ""`,
		'set {x, y} to position of w',
		'set {wd, ht} to size of w',
		'return (x as text) & "," & (y as text) & "," & (wd as text) & "," & (ht as text)',
		'end tell',
	].join('\n');
}

export function applyScript(bounds: Bounds, title: string): string {
	const round = (n: number) => Math.round(n);
	return [
		'tell application "System Events"',
		'set w to window 1 of (first process whose frontmost is true)',
		`if name of w does not contain ${quote(title)} then return "miss"`,
		`set position of w to {${round(bounds.x)}, ${round(bounds.y)}}`,
		`set size of w to {${round(bounds.width)}, ${round(bounds.height)}}`,
		'return "ok"',
		'end tell',
	].join('\n');
}

/** macOS denies UI scripting until the app gets Accessibility (and Automation) permission. */
export function isPermissionError(error: unknown): boolean {
	const message = error instanceof Error ? error.message : String(error);
	return /-1719|-1743|-25211|assistive access|not authori[sz]ed/i.test(message);
}

export function runOsascript(script: string): Promise<string> {
	const args = script.split('\n').flatMap(line => ['-e', line]);
	return new Promise((resolve, reject) => {
		execFile('osascript', args, { timeout: 3000 }, (error, stdout, stderr) => {
			if (error) {
				reject(new Error(stderr.trim() || error.message));
			} else {
				resolve(stdout);
			}
		});
	});
}

/** Window bounds through macOS System Events (AppleScript UI scripting). */
export class MacWindowBounds implements WindowBoundsDriver {
	private readonly attempts: number;
	private readonly delayMs: number;

	constructor(private readonly run: ScriptRunner = runOsascript, options: { attempts?: number; delayMs?: number } = {}) {
		this.attempts = options.attempts ?? 10;
		this.delayMs = options.delayMs ?? 100;
	}

	async read(title: string): Promise<Bounds | undefined> {
		return parseBounds(await this.run(readScript(title)));
	}

	async apply(bounds: Bounds, title: string): Promise<boolean> {
		// The new window gets its title only after the diff has rendered.
		for (let attempt = 0; attempt < this.attempts; attempt++) {
			if ((await this.run(applyScript(bounds, title))).trim() === 'ok') {
				return true;
			}
			await new Promise(resolve => setTimeout(resolve, this.delayMs));
		}
		return false;
	}
}

/** Remembers the floating window size across windows and workspaces. */
export class WindowSizeMemory {
	constructor(
		private readonly driver: WindowBoundsDriver,
		private readonly store: BoundsStore,
		private readonly onError: (error: unknown) => void,
	) { }

	async remember(title: string): Promise<void> {
		try {
			const bounds = await this.driver.read(title);
			if (bounds) {
				await this.store.set(bounds);
			}
		} catch (error) {
			this.onError(error);
		}
	}

	async restore(title: string): Promise<void> {
		const bounds = this.store.get();
		if (!bounds) {
			return;
		}
		try {
			await this.driver.apply(bounds, title);
		} catch (error) {
			this.onError(error);
		}
	}
}
