import * as vscode from 'vscode';
import type { OpenRequest } from './openRequest';

/** Internal workbench command: creates a floating editor window and focuses its group. */
const NEW_WINDOW_COMMAND = 'workbench.action.newEmptyEditorWindow';
const FOCUSED_CONTEXT_KEY = 'floatingDiff.focused';
const NEW_GROUP_TIMEOUT_MS = 1000;

export function tabMatches(tab: vscode.Tab, req: OpenRequest): boolean {
	const input = tab.input;
	if (req.kind === 'diff') {
		return input instanceof vscode.TabInputTextDiff
			&& input.original.toString() === req.left.toString()
			&& input.modified.toString() === req.right.toString();
	}
	return input instanceof vscode.TabInputText && input.uri.toString() === req.uri.toString();
}

function sameRequest(a: OpenRequest, b: OpenRequest): boolean {
	if (a.kind === 'diff' && b.kind === 'diff') {
		return a.left.toString() === b.left.toString() && a.right.toString() === b.right.toString();
	}
	return a.kind === 'file' && b.kind === 'file' && a.uri.toString() === b.uri.toString();
}

/** One reusable floating window that shows a single diff at a time. */
export class DiffWindow implements vscode.Disposable {
	private group: vscode.TabGroup | undefined;
	private current: OpenRequest | undefined;
	private focused = false;
	private warnedFallback = false;
	private readonly subscriptions: vscode.Disposable[];

	constructor() {
		this.subscriptions = [
			vscode.window.tabGroups.onDidChangeTabGroups(e => {
				if (this.group && e.closed.includes(this.group)) {
					this.group = undefined;
					this.current = undefined;
				}
				this.sync();
			}),
			vscode.window.tabGroups.onDidChangeTabs(() => this.sync()),
		];
	}

	/** The editor group of our floating window, or undefined when it is closed. */
	resolveGroup(): vscode.TabGroup | undefined {
		const all = vscode.window.tabGroups.all;
		if (this.group && all.includes(this.group)) {
			return this.group;
		}
		// Older builds (e.g. Cursor) recreate TabGroup objects on layout changes:
		// find the group that shows our request. Floating windows come after the
		// main window, so the highest view column wins.
		const req = this.current;
		this.group = req
			? all.filter(g => g.tabs.some(t => tabMatches(t, req))).sort((a, b) => b.viewColumn - a.viewColumn)[0]
			: undefined;
		return this.group;
	}

	async show(req: OpenRequest): Promise<void> {
		const previous = this.current;
		let group = this.resolveGroup();
		if (!group) {
			group = await this.createWindowGroup();
			if (!group) {
				this.warnFallback();
			}
		}

		const options: vscode.TextDocumentShowOptions = {
			viewColumn: group?.viewColumn ?? vscode.ViewColumn.Active,
			preview: true,
			preserveFocus: false,
		};
		if (req.kind === 'diff') {
			await vscode.commands.executeCommand('vscode.diff', req.left, req.right, req.title, options);
		} else {
			await vscode.commands.executeCommand('vscode.open', req.uri, options, req.title);
		}

		this.group = group ?? vscode.window.tabGroups.activeTabGroup;
		this.current = req;
		if (previous && !sameRequest(previous, req)) {
			const stale = this.group.tabs.filter(t => tabMatches(t, previous) && !t.isDirty);
			if (stale.length > 0) {
				await vscode.window.tabGroups.close(stale, true);
			}
		}
		this.sync();
	}

	async close(): Promise<void> {
		const group = this.resolveGroup();
		const req = this.current;
		if (!group || !req) {
			return;
		}
		const ours = group.tabs.filter(t => tabMatches(t, req));
		if (ours.length > 0) {
			await vscode.window.tabGroups.close(ours);
		}
		// With `workbench.editor.closeEmptyGroups: false` the empty group, and so the window, stays open.
		if (vscode.window.tabGroups.all.includes(group) && group.tabs.length === 0) {
			await vscode.window.tabGroups.close(group);
		}
	}

	dispose(): void {
		for (const subscription of this.subscriptions) {
			subscription.dispose();
		}
		void vscode.commands.executeCommand('setContext', FOCUSED_CONTEXT_KEY, false);
	}

	private async createWindowGroup(): Promise<vscode.TabGroup | undefined> {
		let subscription: vscode.Disposable | undefined;
		let timer: ReturnType<typeof setTimeout> | undefined;
		const opened = new Promise<vscode.TabGroup | undefined>(resolve => {
			timer = setTimeout(() => resolve(undefined), NEW_GROUP_TIMEOUT_MS);
			subscription = vscode.window.tabGroups.onDidChangeTabGroups(e => {
				if (e.opened.length > 0) {
					resolve(e.opened[e.opened.length - 1]);
				}
			});
		});
		try {
			await vscode.commands.executeCommand(NEW_WINDOW_COMMAND);
			return await opened;
		} catch {
			return undefined;
		} finally {
			clearTimeout(timer);
			subscription?.dispose();
		}
	}

	private warnFallback(): void {
		if (this.warnedFallback) {
			return;
		}
		this.warnedFallback = true;
		void vscode.window.showWarningMessage('Floating Diff: floating windows are unavailable, opened as a regular tab.');
	}

	private sync(): void {
		const group = this.resolveGroup();
		const focused = group !== undefined && vscode.window.tabGroups.activeTabGroup === group;
		if (focused !== this.focused) {
			this.focused = focused;
			void vscode.commands.executeCommand('setContext', FOCUSED_CONTEXT_KEY, focused);
		}
	}
}
