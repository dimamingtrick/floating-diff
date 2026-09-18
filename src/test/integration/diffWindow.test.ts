import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import { DiffWindow, tabMatches } from '../../diffWindow';
import type { OpenRequest } from '../../openRequest';
import { Bounds, MacWindowBoundsReader, WindowSizeMemory } from '../../windowBounds';

async function waitFor(condition: () => boolean, what: string, timeoutMs = 5000): Promise<void> {
	const start = Date.now();
	while (!condition()) {
		if (Date.now() - start > timeoutMs) {
			throw new Error(`Timed out waiting for: ${what}`);
		}
		await new Promise(resolve => setTimeout(resolve, 50));
	}
}

describe('DiffWindow', () => {
	let dir: string;
	let win: DiffWindow;
	let groupsBefore: number;

	function diff(name: string): OpenRequest {
		const left = path.join(dir, `${name}.orig`);
		const right = path.join(dir, name);
		fs.writeFileSync(left, 'old\n');
		fs.writeFileSync(right, 'new\n');
		return { kind: 'diff', left: vscode.Uri.file(left), right: vscode.Uri.file(right), title: `${name} (Working Tree)` };
	}

	before(() => {
		dir = fs.mkdtempSync(path.join(os.tmpdir(), 'floating-diff-'));
	});

	beforeEach(() => {
		groupsBefore = vscode.window.tabGroups.all.length;
		win = new DiffWindow();
	});

	afterEach(async () => {
		await win.close();
		win.dispose();
		await waitFor(() => vscode.window.tabGroups.all.length === groupsBefore, 'window closed after test');
	});

	it('opens the first diff in a new floating window group', async () => {
		const req = diff('a.txt');
		await win.show(req);

		await waitFor(() => vscode.window.tabGroups.all.length === groupsBefore + 1, 'new group');
		const group = win.resolveGroup();
		assert.ok(group, 'our group is known');
		assert.strictEqual(group.tabs.length, 1);
		assert.ok(tabMatches(group.tabs[0], req), 'the tab shows the requested diff');
		assert.ok(group.tabs[0].input instanceof vscode.TabInputTextDiff);
	});

	it('reuses the window for the next file and keeps a single tab', async () => {
		await win.show(diff('a.txt'));
		await waitFor(() => vscode.window.tabGroups.all.length === groupsBefore + 1, 'new group');

		const second = diff('b.txt');
		await win.show(second);

		assert.strictEqual(vscode.window.tabGroups.all.length, groupsBefore + 1);
		const group = win.resolveGroup();
		assert.ok(group);
		await waitFor(() => group.tabs.length === 1, 'single tab');
		assert.ok(tabMatches(group.tabs[0], second));
	});

	function recordingMemory(saved?: Bounds) {
		const calls: string[] = [];
		return {
			calls,
			savedBounds: () => { calls.push('savedBounds'); return saved; },
			remember: async () => { calls.push('remember'); },
		};
	}

	it('asks for the remembered size only when it opens a new window', async () => {
		const memory = recordingMemory();
		win.dispose();
		win = new DiffWindow({ sizeMemory: memory });

		await win.show(diff('a.txt'));
		await win.show(diff('b.txt'));

		assert.deepStrictEqual(memory.calls, ['savedBounds']);
	});

	it('remembers the size before closing the window', async () => {
		const memory = recordingMemory();
		win.dispose();
		win = new DiffWindow({ sizeMemory: memory });
		await win.show(diff('a.txt'));
		await waitFor(() => vscode.window.tabGroups.all.length === groupsBefore + 1, 'new group');

		await win.close();

		assert.deepStrictEqual(memory.calls, ['savedBounds', 'remember']);
	});

	const macOnly = process.platform === 'darwin' ? it : it.skip;
	const near = (actual: number, expected: number) => Math.abs(actual - expected) <= 2;

	macOnly('opens the new window with the remembered size (real window)', async () => {
		const wanted: Bounds = { x: 140, y: 120, width: 900, height: 640 };
		win.dispose();
		win = new DiffWindow({ sizeMemory: { savedBounds: () => wanted, remember: async () => { } } });
		const reader = new MacWindowBoundsReader(process.ppid);
		try {
			await win.show(diff('a.txt'));

			let actual: Bounds | undefined;
			for (let attempt = 0; attempt < 40 && !(actual && near(actual.width, 900)); attempt++) {
				actual = await reader.read();
				await new Promise(resolve => setTimeout(resolve, 50));
			}
			assert.ok(actual && near(actual.width, 900) && near(actual.height, 640), `window bounds: ${JSON.stringify(actual)}`);
		} finally {
			reader.dispose();
		}
	});

	macOnly('remembers the real size of the window when it closes', async () => {
		let saved: Bounds | undefined;
		const reader = new MacWindowBoundsReader(process.ppid);
		const memory = new WindowSizeMemory(reader, { get: () => saved, set: async b => { saved = b; } }, e => { throw e; });
		win.dispose();
		win = new DiffWindow({ sizeMemory: memory });
		try {
			await win.show(diff('a.txt'));
			await waitFor(() => vscode.window.tabGroups.all.length === groupsBefore + 1, 'new group');

			await win.close();

			assert.ok(saved && near(saved.width, 1024) && near(saved.height, 768), `saved bounds: ${JSON.stringify(saved)}`);
		} finally {
			reader.dispose();
		}
	});

	it('reports focus while its diff is the active editor', async () => {
		await win.show(diff('a.txt'));
		await waitFor(() => win.isFocused, 'focused after show');

		await win.close();
		await waitFor(() => !win.isFocused, 'not focused after close');
	});

	it('closes the window', async () => {
		await win.show(diff('a.txt'));
		await waitFor(() => vscode.window.tabGroups.all.length === groupsBefore + 1, 'new group');

		await win.close();

		await waitFor(() => vscode.window.tabGroups.all.length === groupsBefore, 'group removed');
		assert.strictEqual(win.resolveGroup(), undefined);
	});
});
