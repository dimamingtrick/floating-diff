import * as path from 'path';
import * as vscode from 'vscode';
import { createGitRunner } from '../branches/gitRunner';
import type { DiffWindow } from '../diffWindow';
import type { API, Repository } from '../git';
import type { OpenRequest } from '../openRequest';
import { annotation, BlameAction, BlameLine, hoverMarkdown } from './blame';
import { BlameService } from './blameService';

/** Long enough that holding an arrow key down runs no git at all. */
const DELAY = 200;

/** What the line the cursor is on shows; the tests read it. */
export interface LineAnnotation {
	readonly text: string;
	readonly markdown: string;
	readonly blame: BlameLine;
	readonly root: string;
}

/**
 * The blame of the line the cursor is on, greyed at the end of it, like
 * GitLens: who last changed the line and when, with the commit's message,
 * date and actions in its tooltip.
 */
export class LineBlame implements vscode.Disposable {
	private readonly decoration = vscode.window.createTextEditorDecorationType({
		after: { margin: '0 0 0 3ch', color: new vscode.ThemeColor('editorCodeLens.foreground') },
	});
	private readonly services = new Map<string, BlameService>();
	private readonly emails = new Map<string, Promise<string | undefined>>();
	private readonly watched = new Map<string, vscode.Disposable>();
	private readonly subscriptions: vscode.Disposable[] = [];
	/** The commit the tooltip and its actions belong to. */
	private shown: { root: string; line: number; blame: BlameLine } | undefined;
	private timer: ReturnType<typeof setTimeout> | undefined;
	/** Only the newest run may paint: an older git answer is about a line the cursor has left. */
	private token = 0;

	constructor(private readonly api: API, private readonly diffWindow: DiffWindow) {
		this.subscriptions.push(
			this.decoration,
			vscode.commands.registerCommand('gitConvenient.blame.openDiff', () => this.openDiff()),
			vscode.commands.registerCommand('gitConvenient.blame.copyHash', () => this.copyHash()),
			vscode.window.onDidChangeActiveTextEditor(() => this.schedule()),
			vscode.window.onDidChangeTextEditorSelection(event => {
				if (event.textEditor === vscode.window.activeTextEditor) {
					// The note belongs to the line it was read for: drop it before the cursor leaves.
					if (event.selections[0]?.active.line !== this.shown?.line) {
						this.erase();
					}
					this.schedule();
				}
			}),
			vscode.workspace.onDidChangeTextDocument(event => {
				if (event.document === vscode.window.activeTextEditor?.document) {
					this.erase();
					this.schedule();
				}
			}),
			vscode.workspace.onDidChangeConfiguration(event => {
				if (event.affectsConfiguration('gitConvenient.lineBlame')) {
					this.erase();
					this.schedule();
				}
			}),
			api.onDidOpenRepository(repository => this.watch(repository)),
			api.onDidCloseRepository(repository => {
				const root = repository.rootUri.fsPath;
				this.watched.get(root)?.dispose();
				this.watched.delete(root);
				this.services.delete(root);
				this.emails.delete(root);
			}),
		);
		api.repositories.forEach(repository => this.watch(repository));
		this.schedule();
	}

	get enabled(): boolean {
		return vscode.workspace.getConfiguration('gitConvenient').get<boolean>('lineBlame', true);
	}

	/** The note for the line the cursor is on, or nothing when git has no blame for it. */
	async annotate(editor: vscode.TextEditor): Promise<LineAnnotation | undefined> {
		const document = editor.document;
		const repository = document.uri.scheme === 'file' ? this.api.getRepository(document.uri) : undefined;
		if (!repository) {
			return undefined;
		}
		const root = repository.rootUri.fsPath;
		const relative = path.relative(root, document.uri.fsPath).split(path.sep).join('/');
		const blame = await this.service(root).line({
			path: relative,
			line: editor.selection.active.line + 1,
			// Unsaved edits move lines: blame the text the editor holds, not the file on disk.
			...(document.isDirty ? { contents: document.getText() } : {}),
			key: document.isDirty ? `${document.version}` : 'saved',
		});
		if (!blame) {
			return undefined;
		}
		const me = await this.email(root);
		const now = Date.now();
		const actions: readonly BlameAction[] = blame.uncommitted
			? []
			: [
				{ label: 'Open diff', href: 'command:gitConvenient.blame.openDiff' },
				{ label: 'File History', href: 'command:gitConvenient.fileHistory' },
				{ label: `Copy ${blame.hash.slice(0, 7)}`, href: 'command:gitConvenient.blame.copyHash' },
			];
		return { text: annotation(blame, { now, me }), markdown: hoverMarkdown(blame, { now, me, actions }), blame, root };
	}

	private service(root: string): BlameService {
		const service = this.services.get(root) ?? new BlameService(createGitRunner(this.api.git.path, root));
		this.services.set(root, service);
		return service;
	}

	/** Your own address in this repository, so your commits read "You". */
	private email(root: string): Promise<string | undefined> {
		const asked = this.emails.get(root) ?? createGitRunner(this.api.git.path, root)(['config', 'user.email']).then(out => out.trim() || undefined, () => undefined);
		this.emails.set(root, asked);
		return asked;
	}

	private watch(repository: Repository): void {
		const root = repository.rootUri.fsPath;
		if (this.watched.has(root)) {
			return;
		}
		// A commit, a checkout or a stash gives the lines new owners.
		this.watched.set(root, repository.state.onDidChange(() => {
			this.services.get(root)?.clear();
			this.schedule();
		}));
	}

	private schedule(): void {
		clearTimeout(this.timer);
		this.timer = setTimeout(() => void this.run(), DELAY);
	}

	private async run(): Promise<void> {
		const token = ++this.token;
		const editor = vscode.window.activeTextEditor;
		const annotated = editor && this.enabled ? await this.annotate(editor).catch(() => undefined) : undefined;
		if (token !== this.token || !editor || editor !== vscode.window.activeTextEditor) {
			return;
		}
		if (!annotated) {
			this.erase();
			return;
		}
		const line = editor.selection.active.line;
		const end = editor.document.lineAt(line).range.end;
		const markdown = new vscode.MarkdownString(annotated.markdown);
		// The tooltip's actions are commands of this extension.
		markdown.isTrusted = true;
		this.shown = { root: annotated.root, line, blame: annotated.blame };
		editor.setDecorations(this.decoration, [{ range: new vscode.Range(end, end), renderOptions: { after: { contentText: annotated.text } }, hoverMessage: markdown }]);
	}

	private erase(): void {
		this.shown = undefined;
		vscode.window.visibleTextEditors.forEach(editor => editor.setDecorations(this.decoration, []));
	}

	/** The commit of the line, as the floating window shows any other diff. */
	private async openDiff(): Promise<void> {
		const shown = this.shown;
		if (!shown || shown.blame.uncommitted) {
			return;
		}
		const { blame, root } = shown;
		const at = (relative: string, ref: string) => this.api.toGitUri(vscode.Uri.joinPath(vscode.Uri.file(root), relative), ref);
		const title = `${path.posix.basename(blame.path)} (${blame.hash.slice(0, 7)})`;
		const right = at(blame.path, blame.hash);
		const request: OpenRequest = blame.previous
			? { kind: 'diff', left: at(blame.previous.path, blame.previous.hash), right, title }
			: { kind: 'file', uri: right, title };
		await this.diffWindow.show(request);
	}

	private async copyHash(): Promise<void> {
		const hash = this.shown?.blame.hash;
		if (hash && !this.shown?.blame.uncommitted) {
			await vscode.env.clipboard.writeText(hash);
			vscode.window.setStatusBarMessage(`Git Convenient: copied ${hash.slice(0, 7)}`, 3000);
		}
	}

	dispose(): void {
		clearTimeout(this.timer);
		this.watched.forEach(listener => listener.dispose());
		this.subscriptions.forEach(subscription => subscription.dispose());
	}
}
