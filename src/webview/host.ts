import { randomBytes } from 'crypto';
import * as vscode from 'vscode';
import type { CommonFromWebview } from '../shared/protocol';

export type WebviewEntry = 'log' | 'explorer' | 'sidebar' | 'git';

/** Scripts on; files only from the bundle folder and `extraRoots` (e.g. the file icon theme). */
export function webviewOptions(extensionUri: vscode.Uri, extraRoots: readonly vscode.Uri[] = []): vscode.WebviewOptions {
	return { enableScripts: true, localResourceRoots: [vscode.Uri.joinPath(extensionUri, 'dist', 'webview'), ...extraRoots] };
}

function escapeHtml(text: string): string {
	return text.replace(/[&<>"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[ch] ?? ch);
}

/**
 * The page of a webview: its bundle and the shared styles, scripts allowed by
 * nonce only. `part` tells a script that serves several views which one it is.
 */
export function webviewHtml(webview: vscode.Webview, extensionUri: vscode.Uri, entry: WebviewEntry, title: string, part?: string): string {
	const nonce = randomBytes(16).toString('base64');
	const asset = (file: string) => webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'dist', 'webview', file));
	const csp = [
		"default-src 'none'",
		`style-src ${webview.cspSource} 'unsafe-inline'`,
		`script-src 'nonce-${nonce}'`,
		`img-src ${webview.cspSource} data:`,
		`font-src ${webview.cspSource}`,
	].join('; ');
	return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="${csp}">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<link rel="stylesheet" href="${asset('codicon.css')}">
<link rel="stylesheet" href="${asset('styles.css')}">
</head>
<body>
<div id="app"${part ? ` data-part="${escapeHtml(part)}"` : ''}></div>
<script nonce="${nonce}" src="${asset(`${entry}.js`)}"></script>
</body>
</html>`;
}

/**
 * Typed messaging with one webview. `ready` resolves when its script runs;
 * `rendered(view)` resolves with the item count the next time that view shows
 * data, or right away with the last count when asked for the `latest`.
 */
export class WebviewChannel<In extends { readonly type: string }, Out> implements vscode.Disposable {
	readonly ready: Promise<void>;
	private markReady: () => void = () => { };
	private readonly waiting = new Map<string, ((count: number) => void)[]>();
	private readonly last = new Map<string, number>();
	private readonly subscription: vscode.Disposable;

	constructor(private readonly webview: vscode.Webview, handler: (message: In) => unknown, onError: (error: unknown) => void) {
		this.ready = new Promise(resolve => {
			this.markReady = resolve;
		});
		this.subscription = webview.onDidReceiveMessage((message: In | CommonFromWebview) => {
			if (message.type === 'ready') {
				this.markReady();
			} else if (message.type === 'rendered') {
				const { view, count } = message as Extract<CommonFromWebview, { type: 'rendered' }>;
				this.last.set(view, count);
				for (const resolve of this.waiting.get(view) ?? []) {
					resolve(count);
				}
				this.waiting.delete(view);
			}
			Promise.resolve()
				.then(() => handler(message as In))
				.catch(onError);
		});
	}

	async post(message: Out): Promise<void> {
		await this.ready;
		await this.webview.postMessage(message);
	}

	rendered(view: string, which: 'next' | 'latest' = 'next'): Promise<number> {
		const last = this.last.get(view);
		if (which === 'latest' && last !== undefined) {
			return Promise.resolve(last);
		}
		return new Promise(resolve => {
			this.waiting.set(view, [...(this.waiting.get(view) ?? []), resolve]);
		});
	}

	dispose(): void {
		this.subscription.dispose();
	}
}
