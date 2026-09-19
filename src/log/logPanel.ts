import * as vscode from 'vscode';
import type { DiffWindow } from '../diffWindow';
import type { RepoContext } from '../repoContext';
import { reportError } from '../report';
import type { LogFilters, LogFromWebview, LogToWebview } from '../shared/protocol';
import { WebviewChannel, webviewHtml, webviewOptions } from '../webview/host';
import { LogSession } from './logSession';

/** The Git Log in an editor tab (the Git panel at the bottom shows it too). One per window. */
export class LogPanel implements vscode.Disposable {
	private static current: LogPanel | undefined;

	/** The log of the open Git Log tab (its context menu acts on it). */
	static get currentSession(): LogSession | undefined {
		return LogPanel.current?.session;
	}

	/** Shows the log of `ctx`'s repository, optionally with new filters (e.g. one branch). */
	static show(extensionUri: vscode.Uri, ctx: RepoContext, diffWindow: DiffWindow, filters?: LogFilters): LogPanel {
		const existing = LogPanel.current;
		if (existing && existing.session.ctx.repository.rootUri.toString() === ctx.repository.rootUri.toString()) {
			existing.panel.reveal();
			if (filters) {
				void existing.session.setFilters(filters);
			}
			return existing;
		}
		existing?.panel.dispose();
		LogPanel.current = new LogPanel(extensionUri, ctx, diffWindow, filters ?? {});
		return LogPanel.current;
	}

	readonly channel: WebviewChannel<LogFromWebview, LogToWebview>;
	private readonly panel: vscode.WebviewPanel;
	private readonly session: LogSession;
	private readonly subscriptions: vscode.Disposable[] = [];

	private constructor(extensionUri: vscode.Uri, ctx: RepoContext, diffWindow: DiffWindow, filters: LogFilters) {
		this.panel = vscode.window.createWebviewPanel('gitConvenient.log', 'Git Log', diffWindow.editorColumn(), {
			...webviewOptions(extensionUri),
			retainContextWhenHidden: true,
		});
		this.panel.webview.html = webviewHtml(this.panel.webview, extensionUri, 'log', 'Git Log');
		this.channel = new WebviewChannel(this.panel.webview, message => this.handle(message), reportError);
		this.session = new LogSession(ctx, diffWindow, message => this.channel.post(message), filters);
		this.subscriptions.push(this.channel, this.session, this.panel.onDidDispose(() => this.dispose()));
	}

	setFilters(filters: LogFilters): Promise<void> {
		return this.session.setFilters(filters);
	}

	handle(message: LogFromWebview): Promise<void> {
		return this.session.handle(message);
	}

	dispose(): void {
		if (LogPanel.current === this) {
			LogPanel.current = undefined;
		}
		this.subscriptions.forEach(subscription => subscription.dispose());
	}
}
