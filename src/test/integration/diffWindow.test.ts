import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import { DiffWindow, DiffWindowState, tabMatches } from '../../diffWindow';
import type { OpenRequest } from '../../openRequest';
import { Bounds, MacWindowBoundsReader, WindowSizeMemory } from '../../windowBounds';
import { waitFor } from './util';

describe('DiffWindow', () => {
	// Cursor opens new windows at a fixed size only, so remembering their size is VS Code's.
	const sized = vscode.env.appName.includes('Cursor') ? it.skip : it;
	const macOnly = process.platform === 'darwin' ? it : it.skip;
	let dir: string;
	let win: DiffWindow;
	let groupsBefore: number;

	function diff(name: string): Extract<OpenRequest, { kind: 'diff' }> {
		const left = path.join(dir, `${name}.orig`);
		const right = path.join(dir, name);
		fs.writeFileSync(left, 'old\n');
		fs.writeFileSync(right, 'new\n');
		return { kind: 'diff', left: vscode.Uri.file(left), right: vscode.Uri.file(right), title: `${name} (Working Tree)` };
	}

	before(() => {
		dir = fs.mkdtempSync(path.join(os.tmpdir(), 'git-convenient-'));
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

	it('opens a floating window even when the main window shows no editor', async () => {
		// Cursor gives an editor meant for a new window to an empty main window.
		await vscode.commands.executeCommand('workbench.action.closeAllEditors');
		await waitFor(() => vscode.window.tabGroups.all.every(g => g.tabs.length === 0), 'no editors');
		groupsBefore = vscode.window.tabGroups.all.length;
		const req = diff('c.txt');
		await win.show(req);

		await waitFor(() => vscode.window.tabGroups.all.length === groupsBefore + 1, 'a floating window');
		// Cursor moves the editor a moment after the window opens.
		await new Promise(resolve => setTimeout(resolve, 1500));
		assert.strictEqual(vscode.window.tabGroups.all.length, groupsBefore + 1, 'the window stays');
		const group = win.resolveGroup();
		assert.ok(group && group.viewColumn > groupsBefore, `ours is the new window, not column ${group?.viewColumn}`);
		const main = vscode.window.tabGroups.all.filter(g => g.viewColumn <= groupsBefore);
		assert.ok(main.every(g => !g.tabs.some(t => tabMatches(t, req))), 'nothing left in the main window');
	});

	it('can create the window empty and then open the diff in it, as Cursor needs', async () => {
		win.dispose();
		win = new DiffWindow({ emptyWindowFirst: true });
		const req = diff('d.txt');
		await win.show(req);

		await waitFor(() => vscode.window.tabGroups.all.length === groupsBefore + 1, 'new group');
		const group = win.resolveGroup();
		assert.ok(group && group.viewColumn > groupsBefore, 'the new window');
		await waitFor(() => group.tabs.length === 1 && tabMatches(group.tabs[0], req), 'the diff in it');

		const next = diff('e.txt');
		await win.show(next);
		assert.strictEqual(vscode.window.tabGroups.all.length, groupsBefore + 1, 'the same window');
		await waitFor(() => win.resolveGroup()?.tabs.length === 1 && tabMatches(win.resolveGroup()!.tabs[0], next), 'the next diff replaces it');
	});

	it('opens one window for two diffs asked for at once, like a double click', async () => {
		const first = diff('f.txt');
		const second = diff('g.txt');
		await Promise.all([win.show(first), win.show(second)]);

		await waitFor(() => vscode.window.tabGroups.all.length === groupsBefore + 1, 'a new window');
		await new Promise(resolve => setTimeout(resolve, 500));
		assert.strictEqual(vscode.window.tabGroups.all.length, groupsBefore + 1, 'no second window');
		await waitFor(() => win.resolveGroup()?.tabs.length === 1 && tabMatches(win.resolveGroup()!.tabs[0], second), 'the second diff in it');
	});

	it('closes the diff that a closed window hands to the main window', async () => {
		const req = diff('h.txt');
		await win.show(req);
		await waitFor(() => vscode.window.tabGroups.all.length === groupsBefore + 1, 'new group');

		// A moment later, as a person would (Cursor ignores it while a moved window settles),
		// what the window's close button does: its editors move to the main window.
		await new Promise(resolve => setTimeout(resolve, 800));
		await vscode.commands.executeCommand('workbench.action.restoreEditorsToMainWindow');

		await waitFor(() => vscode.window.tabGroups.all.length === groupsBefore, 'the window is gone');
		await waitFor(() => !vscode.window.tabGroups.all.some(g => g.tabs.some(t => tabMatches(t, req))), 'no diff left in the main window');
	});

	it('closes its window on Esc unless it keeps it', async () => {
		win.dispose();
		win = new DiffWindow({ keepWindow: false });
		await win.show(diff('p.txt'));
		await waitFor(() => vscode.window.tabGroups.all.length === groupsBefore + 1, 'new group');

		await win.dismiss();

		await waitFor(() => vscode.window.tabGroups.all.length === groupsBefore, 'the window is gone');
	});

	it('closes its window on Esc even when the file has unsaved changes', async () => {
		win.dispose();
		win = new DiffWindow({ keepWindow: false });
		const req = diff('dirty.txt');
		// The file is open and edited in the main window, as it is when its diff is opened to see those edits.
		const document = await vscode.workspace.openTextDocument(req.right);
		await vscode.window.showTextDocument(document, { viewColumn: vscode.ViewColumn.One });
		const edit = new vscode.WorkspaceEdit();
		edit.insert(req.right, new vscode.Position(0, 0), 'unsaved\n');
		assert.ok(await vscode.workspace.applyEdit(edit), 'the edit applied');
		assert.ok(document.isDirty, 'the file has unsaved changes');
		await win.show(req);
		await waitFor(() => vscode.window.tabGroups.all.length === groupsBefore + 1, 'new group');

		await win.dismiss();

		await waitFor(() => vscode.window.tabGroups.all.length === groupsBefore, 'the window is gone');
		await vscode.window.showTextDocument(document, { viewColumn: vscode.ViewColumn.One });
		await vscode.commands.executeCommand('workbench.action.files.revert');
		await waitFor(() => !document.isDirty, 'the edit reverted for the next tests');
	});

	it('gives the focus back to the view the diff was opened from', async () => {
		win.dispose();
		win = new DiffWindow({ keepWindow: false });
		let returned = 0;
		await win.show(diff('back.txt'), { returnFocus: async () => { returned += 1; } });
		await waitFor(() => vscode.window.tabGroups.all.length === groupsBefore + 1, 'new group');

		await win.dismiss();

		await waitFor(() => returned === 1, 'the view got the focus back');
		// A diff opened from somewhere else does not send the focus there again.
		await win.show(diff('back2.txt'));
		await win.dismiss();
		await new Promise(resolve => setTimeout(resolve, 300));
		assert.strictEqual(returned, 1, 'only the view that opened the diff is focused');
	});

	it('gives the focus back when the window is closed by its button', async () => {
		win.dispose();
		win = new DiffWindow({ keepWindow: false });
		let returned = 0;
		const req = diff('x-button.txt');
		await win.show(req, { returnFocus: async () => { returned += 1; } });
		await waitFor(() => vscode.window.tabGroups.all.length === groupsBefore + 1, 'new group');

		// What the window's close button does: its editors move to the main window.
		await new Promise(resolve => setTimeout(resolve, 800));
		await vscode.commands.executeCommand('workbench.action.restoreEditorsToMainWindow');

		await waitFor(() => returned === 1, 'the view got the focus back', 10000);
		await waitFor(() => !vscode.window.tabGroups.all.some(g => g.tabs.some(t => tabMatches(t, req))), 'no diff left in the main window');
	});

	it('keeps its window on Esc when asked to, and shows the next diff in it', async () => {
		win.dispose();
		win = new DiffWindow({ keepWindow: true });
		await win.show(diff('q.txt'));
		await waitFor(() => vscode.window.tabGroups.all.length === groupsBefore + 1, 'new group');
		const column = win.resolveGroup()?.viewColumn;

		await win.dismiss();
		await new Promise(resolve => setTimeout(resolve, 500));
		assert.strictEqual(vscode.window.tabGroups.all.length, groupsBefore + 1, 'the window stays');
		const kept = vscode.window.tabGroups.all.find(g => g.viewColumn === column);
		assert.ok(kept?.tabs.length === 1 && kept.tabs[0].input instanceof vscode.TabInputWebview, 'a page the editor does not bring back after a restart, instead of the diff');

		const next = diff('r.txt');
		await win.show(next);
		assert.strictEqual(vscode.window.tabGroups.all.length, groupsBefore + 1, 'no second window');
		assert.strictEqual(win.resolveGroup()?.viewColumn, column, 'the same window');
		await waitFor(() => win.resolveGroup()?.tabs.length === 1 && tabMatches(win.resolveGroup()!.tabs[0], next), 'the next diff in it');
	});

	function memoryState(): DiffWindowState {
		const values = new Map<string, unknown>();
		return { get: key => values.get(key), update: async (key, value) => { values.set(key, value); } };
	}

	it('finds the window it kept again after a restart', async () => {
		const state = memoryState();
		win.dispose();
		win = new DiffWindow({ keepWindow: true, state });
		await win.show(diff('t.txt'));
		await waitFor(() => vscode.window.tabGroups.all.length === groupsBefore + 1, 'new group');
		// A restart: the editor brings the window back and the extension starts again.
		win.dispose();
		win = new DiffWindow({ keepWindow: true, state });
		assert.ok(win.resolveGroup(), 'ours again before the next diff, so Esc works on it');

		const next = diff('u.txt');
		await win.show(next);

		assert.strictEqual(vscode.window.tabGroups.all.length, groupsBefore + 1, 'no second window');
		await waitFor(() => win.resolveGroup()?.tabs.length === 1 && tabMatches(win.resolveGroup()!.tabs[0], next), 'the next diff replaces the old one');
	});

	it('does not take the main window for its own after a restart', async () => {
		const state = memoryState();
		const req = diff('v.txt');
		win.dispose();
		win = new DiffWindow({ keepWindow: true, state });
		await win.show(req);
		await win.close();
		await waitFor(() => vscode.window.tabGroups.all.length === groupsBefore, 'closed');
		// The same diff, opened in the main window by other means.
		await vscode.commands.executeCommand('vscode.diff', req.left, req.right, req.title, { viewColumn: vscode.ViewColumn.One, preview: false });
		win.dispose();
		win = new DiffWindow({ keepWindow: true, state });
		try {
			await win.show(diff('w.txt'));

			await waitFor(() => vscode.window.tabGroups.all.length === groupsBefore + 1, 'a window of its own');
			assert.ok(vscode.window.tabGroups.all[0].tabs.some(t => tabMatches(t, req)), 'the main window keeps its diff');
		} finally {
			const mainTabs = vscode.window.tabGroups.all[0].tabs.filter(t => tabMatches(t, req));
			await vscode.window.tabGroups.close(mainTabs);
		}
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

	sized('asks for the remembered size only when it opens a new window', async () => {
		const memory = recordingMemory();
		win.dispose();
		win = new DiffWindow({ sizeMemory: memory });

		await win.show(diff('a.txt'));
		await win.show(diff('b.txt'));

		assert.deepStrictEqual(memory.calls, ['savedBounds']);
	});

	sized('remembers the size before closing the window', async () => {
		const memory = recordingMemory();
		win.dispose();
		win = new DiffWindow({ sizeMemory: memory });
		await win.show(diff('a.txt'));
		await waitFor(() => vscode.window.tabGroups.all.length === groupsBefore + 1, 'new group');

		await win.close();

		assert.strictEqual(memory.calls[memory.calls.length - 1], 'remember');
	});

	const sizedOnMac = process.platform === 'darwin' && !vscode.env.appName.includes('Cursor') ? it : it.skip;
	const near = (actual: number, expected: number) => Math.abs(actual - expected) <= 2;

	async function waitForFront(reader: MacWindowBoundsReader, test: (front: Bounds | undefined) => boolean, what: string): Promise<void> {
		let front: Bounds | undefined;
		for (let attempt = 0; attempt < 40; attempt++) {
			front = await reader.read();
			if (test(front)) {
				return;
			}
			await new Promise(resolve => setTimeout(resolve, 50));
		}
		assert.fail(`${what}; the front window: ${JSON.stringify(front)}`);
	}

	const sameBounds = (a: Bounds | undefined, b: Bounds | undefined) => JSON.stringify(a) === JSON.stringify(b);

	macOnly('puts the main window in front of the window it keeps on Esc, and its window back for the next diff (real window)', async () => {
		win.dispose();
		win = new DiffWindow({ keepWindow: true });
		const reader = new MacWindowBoundsReader(process.ppid);
		try {
			const main = await reader.read();
			await win.show(diff('s.txt'));
			await waitForFront(reader, front => !sameBounds(front, main), 'the diff window in front');

			await win.dismiss();
			await waitForFront(reader, front => sameBounds(front, main), 'the main window in front');
			assert.strictEqual(vscode.window.tabGroups.all.length, groupsBefore + 1, 'the diff window stays');

			await win.show(diff('x.txt'));
			await waitForFront(reader, front => !sameBounds(front, main), 'the diff window in front again');
		} finally {
			reader.dispose();
		}
	});

	macOnly('puts the diff in a window of its own (real window)', async () => {
		const reader = new MacWindowBoundsReader(process.ppid);
		try {
			const main = await reader.read();
			await win.show(diff('a.txt'));

			let front: Bounds | undefined;
			for (let attempt = 0; attempt < 40 && (!front || JSON.stringify(front) === JSON.stringify(main)); attempt++) {
				await new Promise(resolve => setTimeout(resolve, 50));
				front = await reader.read();
			}
			assert.notDeepStrictEqual(front, main, `a new window is in front, not the main one: ${JSON.stringify(front)}`);
		} finally {
			reader.dispose();
		}
	});

	sizedOnMac('opens the new window with the remembered size (real window)', async () => {
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

	sizedOnMac('remembers the real size of the window when it closes', async () => {
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

	it('shows a multi-file diff in the floating window as one tab', async () => {
		const a = diff('a.txt');
		const b = diff('b.txt');
		const req: OpenRequest = {
			kind: 'changes', title: 'probe compare',
			resources: [a, b].map(r => (r.kind === 'diff' ? { label: r.right, original: r.left, modified: r.right } : { label: vscode.Uri.file(dir) })),
		};

		await win.show(req);

		const group = win.resolveGroup();
		assert.ok(group, 'our group is known');
		await waitFor(() => group.tabs.length === 1 && group.tabs[0].label.startsWith('probe compare'), 'one multi-diff tab');
		assert.strictEqual(vscode.window.tabGroups.all.length, groupsBefore + 1);
		assert.ok(tabMatches(group.tabs[0], req));
		await waitFor(() => win.isFocused, 'focused on the multi-diff');
	});

	it('closes the window', async () => {
		await win.show(diff('a.txt'));
		await waitFor(() => vscode.window.tabGroups.all.length === groupsBefore + 1, 'new group');

		await win.close();

		await waitFor(() => vscode.window.tabGroups.all.length === groupsBefore, 'group removed');
		assert.strictEqual(win.resolveGroup(), undefined);
	});
});
