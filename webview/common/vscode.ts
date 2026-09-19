import { useEffect, useRef } from 'preact/hooks';

interface VsCodeApi {
	postMessage(message: unknown): void;
	getState(): unknown;
	setState(state: unknown): void;
}

declare function acquireVsCodeApi(): VsCodeApi;

const api = acquireVsCodeApi();

export function post<T>(message: T): void {
	api.postMessage(message);
}

/** Calls `handler` for every message from the extension. */
export function useMessages<T>(handler: (message: T) => void): void {
	const current = useRef(handler);
	current.current = handler;
	useEffect(() => {
		const listener = (event: MessageEvent) => current.current(event.data as T);
		window.addEventListener('message', listener);
		post({ type: 'ready' });
		return () => window.removeEventListener('message', listener);
	}, []);
}

/** Tells the extension a view finished showing `count` items (integration tests wait for it). */
export function useRendered(view: string, count: number | undefined, key: unknown): void {
	useEffect(() => {
		if (count !== undefined) {
			post({ type: 'rendered', view, count });
		}
	}, [key]);
}

/** State VS Code keeps for this webview, also across restarts for views (e.g. what is collapsed). */
export function getState<T>(): T | undefined {
	return api.getState() as T | undefined;
}

export function setState<T>(state: T): void {
	api.setState(state);
}
