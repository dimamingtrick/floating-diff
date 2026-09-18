import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import { DiffWindow, tabMatches } from '../../diffWindow';
import type { OpenRequest } from '../../openRequest';

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

	it('closes the window', async () => {
		await win.show(diff('a.txt'));
		await waitFor(() => vscode.window.tabGroups.all.length === groupsBefore + 1, 'new group');

		await win.close();

		await waitFor(() => vscode.window.tabGroups.all.length === groupsBefore, 'group removed');
		assert.strictEqual(win.resolveGroup(), undefined);
	});
});
