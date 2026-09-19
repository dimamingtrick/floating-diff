import * as vscode from "vscode";
import { OpenRequest, restoreRequest, saveRequest, showsDocument } from "./openRequest";
import type { Bounds } from "./windowBounds";

/** Internal workbench command: creates a floating editor window and focuses its group. */
const NEW_WINDOW_COMMAND = "workbench.action.newEmptyEditorWindow";
/** Internal editor group id meaning "a new floating window" (VS Code's AUX_WINDOW_GROUP). */
const AUX_WINDOW_GROUP = -3;
const FOCUSED_CONTEXT_KEY = "gitConvenient.diffFocused";
/** Where the window's diff is remembered for after a restart. */
const SHOWN_KEY = "gitConvenient.diffWindow.shown";
/** The page a kept window shows behind the main one. */
const IDLE_VIEW_TYPE = "gitConvenient.diffWindowIdle";
const IDLE_HTML = `<!DOCTYPE html>
<html><head><meta charset="UTF-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline';"></head>
<body style="margin:0;height:100vh;display:flex;align-items:center;justify-content:center;font:13px var(--vscode-font-family);color:var(--vscode-descriptionForeground)">The next diff opens here.</body></html>`;
const NEW_GROUP_TIMEOUT_MS = 1000;

type ChangesRequest = Extract<OpenRequest, { kind: "changes" }>;
type SingleRequest = Exclude<OpenRequest, ChangesRequest>;

/**
 * A multi-file diff tab: VS Code has `TabInputTextMultiDiff` at runtime, but
 * not in the 1.105 typings, so it is recognized by its `textDiffs` list.
 */
function isMultiDiffTab(tab: vscode.Tab): boolean {
  return Array.isArray((tab.input as { textDiffs?: unknown } | undefined)?.textDiffs);
}

export function tabMatches(tab: vscode.Tab, req: OpenRequest): boolean {
  const input = tab.input;
  switch (req.kind) {
    case "diff":
      return (
        input instanceof vscode.TabInputTextDiff &&
        input.original.toString() === req.left.toString() &&
        input.modified.toString() === req.right.toString()
      );
    case "file":
      return (
        input instanceof vscode.TabInputText &&
        input.uri.toString() === req.uri.toString()
      );
    case "changes":
      // VS Code labels the tab "<title> (<n> files)".
      return (
        isMultiDiffTab(tab) &&
        (tab.label === req.title || tab.label.startsWith(`${req.title} (`))
      );
  }
}

function sameRequest(a: OpenRequest, b: OpenRequest): boolean {
  if (a.kind === "diff" && b.kind === "diff") {
    return (
      a.left.toString() === b.left.toString() &&
      a.right.toString() === b.right.toString()
    );
  }
  if (a.kind === "changes" && b.kind === "changes") {
    return a.title === b.title && a.resources.length === b.resources.length;
  }
  return (
    a.kind === "file" &&
    b.kind === "file" &&
    a.uri.toString() === b.uri.toString()
  );
}

function column(group: vscode.TabGroup | undefined): string {
  return group ? String(group.viewColumn) : "none";
}

/** Every editor group for the log: `1:[a.ts, b.ts]* 2:[c.ts]`, the active one starred. */
function describeGroups(): string {
  return vscode.window.tabGroups.all
    .map((g) => `${g.viewColumn}:[${g.tabs.map((t) => t.label).join(", ")}]${g.isActive ? "*" : ""}`)
    .join(" ");
}

function isIdleTab(tab: vscode.Tab): boolean {
  return tab.input instanceof vscode.TabInputWebview && tab.input.viewType.endsWith(IDLE_VIEW_TYPE);
}

/**
 * The group of our window with a tab passing `test`. Floating windows come
 * after the main window: never the first group, which is the main window's,
 * and the highest column wins (when a window closes, Cursor lists its editors
 * in both windows for a moment).
 */
function findGroup(test: (tab: vscode.Tab) => boolean): vscode.TabGroup | undefined {
  return vscode.window.tabGroups.all
    .filter((g) => g.viewColumn > vscode.ViewColumn.One && g.tabs.some(test))
    .sort((a, b) => b.viewColumn - a.viewColumn)[0];
}

function findGroupShowing(req: OpenRequest): vscode.TabGroup | undefined {
  return findGroup((t) => tabMatches(t, req));
}

/** Keeps the size of the floating window between windows. */
export interface SizeMemory {
  savedBounds(): Bounds | undefined;
  /** Saves the size of the frontmost window, which must be ours. */
  remember(): Promise<void>;
}

/** Where the window remembers its diff between runs: the extension's workspace state. */
export interface DiffWindowState {
  get(key: string): unknown;
  update(key: string, value: unknown): Thenable<void>;
}

export interface DiffWindowOptions {
  readonly sizeMemory?: SizeMemory;
  readonly log?: (message: string) => void;
  /**
   * Create the window empty, then open the editor in it. Cursor (the default
   * there) turns an editor opened "in a new window" into a group of its main
   * window; an empty window it makes for real, but only at a fixed size.
   */
  readonly emptyWindowFirst?: boolean;
  /**
   * Esc puts the main window in front instead of closing the window, so a
   * window the user maximized stays so for the next diffs. Cursor (the default
   * there) opens new windows only at a fixed size and has no way to resize them.
   */
  readonly keepWindow?: boolean;
  /** Remembers the shown diff: after a restart the editor brings the window back with it, and it is ours again. */
  readonly state?: DiffWindowState;
}

/** One reusable floating window that shows a single diff at a time. */
export class DiffWindow implements vscode.Disposable {
  private group: vscode.TabGroup | undefined;
  private current: OpenRequest | undefined;
  private focused = false;
  private warnedFallback = false;
  private readonly emptyWindowFirst: boolean;
  private readonly keepWindow: boolean;
  /** The diff our window showed before a restart, until that window is found again or another opens. */
  private restored: OpenRequest | undefined;
  /** The page our window shows instead of a diff while it is kept behind the main window. */
  private idle: vscode.WebviewPanel | undefined;
  /** Shows run one after another, so a double click cannot open two windows. */
  private queue: Promise<void> = Promise.resolve();
  private readonly subscriptions: vscode.Disposable[];

  constructor(private readonly options: DiffWindowOptions = {}) {
    const inCursor = vscode.env.appName.includes("Cursor");
    this.emptyWindowFirst = options.emptyWindowFirst ?? inCursor;
    this.keepWindow = options.keepWindow ?? inCursor;
    this.restored = restoreRequest(options.state?.get(SHOWN_KEY), (value) => vscode.Uri.parse(value));
    this.subscriptions = [
      vscode.window.tabGroups.onDidChangeTabGroups((e) => {
        if (this.group && e.closed.includes(this.group)) {
          this.log("our window closed");
          const shown = this.current;
          this.group = undefined;
          this.current = undefined;
          // Its close button moves the window's editors to the main window: ours go with the window.
          this.idle?.dispose();
          if (shown && e.opened.length === 0) {
            void this.closeMoved(shown);
          }
        }
        this.sync();
      }),
      vscode.window.tabGroups.onDidChangeTabs(() => this.sync()),
      vscode.window.onDidChangeActiveTextEditor(() => this.sync()),
    ];
    this.sync();
  }

  /** Whether our floating window is the active one (drives the Esc keybinding). */
  get isFocused(): boolean {
    return this.focused;
  }

  /** Where other editors should open: the main window while ours has focus. */
  editorColumn(): vscode.ViewColumn {
    this.sync();
    return this.focused ? vscode.ViewColumn.One : vscode.ViewColumn.Active;
  }

  /** The editor group of our floating window, or undefined when it is closed. */
  resolveGroup(): vscode.TabGroup | undefined {
    if (this.group && vscode.window.tabGroups.all.includes(this.group)) {
      return this.group;
    }
    // Older builds (e.g. Cursor) recreate TabGroup objects on layout changes.
    this.group = this.current
      ? findGroupShowing(this.current)
      : this.idle
        ? findGroup(isIdleTab)
        : this.findRestored();
    if (!this.group && this.idle) {
      // The page left our window: for the main window, when it closed.
      this.idle.dispose();
    }
    return this.group;
  }

  show(req: OpenRequest): Promise<void> {
    const shown = this.queue.then(() => (req.kind === "changes" ? this.showChanges(req) : this.showSingle(req)));
    this.queue = shown.catch(() => undefined);
    return shown;
  }

  private async showSingle(req: SingleRequest): Promise<void> {
    let group = this.resolveGroup();
    const previous = this.current;
    this.log(`show "${req.title}": reusing column ${column(group)}; groups ${describeGroups()}`);

    if (group) {
      await this.open(req, group.viewColumn);
      this.idle?.dispose();
    } else if (this.emptyWindowFirst) {
      group = await this.openInEmptyWindow(req);
    } else {
      group = await this.openInNewWindow(req);
    }

    this.current = req;
    this.restored = undefined;
    this.remember(req);
    // Looked up again: Cursor makes new group and tab objects when editors move between windows.
    this.group =
      findGroupShowing(req) ?? group ?? vscode.window.tabGroups.activeTabGroup;
    if (previous && !sameRequest(previous, req)) {
      await this.closeTabs(previous, this.group.viewColumn);
    }
    this.sync();
  }

  private async showChanges(req: ChangesRequest): Promise<void> {
    const first = req.resources[0];
    if (!first) {
      return;
    }
    // A plain diff first: it creates (sized) or reuses our window and focuses
    // it, so the multi-file diff opens in our window, the active group.
    const placeholder: SingleRequest =
      first.original && first.modified
        ? { kind: "diff", left: first.original, right: first.modified, title: req.title }
        : { kind: "file", uri: first.modified ?? first.original ?? first.label, title: req.title };
    await this.showSingle(placeholder);
    await vscode.commands.executeCommand(
      "vscode.changes",
      req.title,
      req.resources.map((r) => [r.label, r.original, r.modified]),
    );
    const group = this.resolveGroup();
    this.current = req;
    this.remember(req);
    if (group) {
      await this.closeTabs(placeholder, group.viewColumn);
    }
    this.sync();
  }

  async close(): Promise<void> {
    const group = this.resolveGroup();
    const req = this.current;
    this.log(`close: ours ${column(group)}, current "${req?.title ?? "none"}"`);
    this.restored = undefined;
    this.remember(undefined);
    if (!group) {
      return;
    }
    if (req) {
      if (!this.emptyWindowFirst) {
        // Esc was pressed in our window, so it is the frontmost one right now.
        await this.options.sizeMemory?.remember();
      }
      await this.closeTabs(req, group.viewColumn, false);
    }
    this.idle?.dispose();
    // With `workbench.editor.closeEmptyGroups: false` the empty group, and so the window, stays open.
    const left = vscode.window.tabGroups.all.find((g) => g.viewColumn === group.viewColumn);
    if (left && left.tabs.length === 0) {
      await vscode.window.tabGroups.close(left).then(undefined, (error: unknown) => this.log(`closing the window failed: ${String(error)}`));
    }
  }

  /** Esc: closes the window, or puts the main window in front of the window it keeps. */
  async dismiss(): Promise<void> {
    const group = this.resolveGroup();
    if (!this.keepWindow || !group) {
      await this.close();
      return;
    }
    await this.showIdle(group);
    if (!(await this.focusMainWindow())) {
      await this.close();
    }
  }

  /**
   * Swaps the diff for a page the editor does not bring back after a restart,
   * so no window of ours is left over then (Cursor may bring one back empty).
   * Done while the window is in front: opening an editor in it later would
   * bring it to the front.
   */
  private async showIdle(group: vscode.TabGroup): Promise<void> {
    const req = this.current;
    if (!this.idle) {
      const shown = this.nextTab(isIdleTab);
      const idle = vscode.window.createWebviewPanel(IDLE_VIEW_TYPE, "Git Convenient", { viewColumn: group.viewColumn, preserveFocus: true }, {});
      idle.webview.html = IDLE_HTML;
      idle.onDidDispose(() => {
        if (this.idle === idle) {
          this.idle = undefined;
        }
      });
      this.idle = idle;
      // Closing the diff before the page is in the window would close the window.
      await shown;
    }
    this.current = undefined;
    this.remember(undefined);
    if (req) {
      await this.closeTabs(req, group.viewColumn);
    }
  }

  /** Resolves once a tab matching `test` opens, or after a timeout. */
  private nextTab(test: (tab: vscode.Tab) => boolean): Promise<void> {
    return new Promise((resolve) => {
      const done = () => {
        clearTimeout(timer);
        subscription.dispose();
        resolve();
      };
      const timer = setTimeout(done, NEW_GROUP_TIMEOUT_MS);
      const subscription = vscode.window.tabGroups.onDidChangeTabs((e) => {
        if (e.opened.some(test)) {
          done();
        }
      });
    });
  }

  dispose(): void {
    for (const subscription of this.subscriptions) {
      subscription.dispose();
    }
    void vscode.commands.executeCommand(
      "setContext",
      FOCUSED_CONTEXT_KEY,
      false,
    );
  }

  private async open(
    req: SingleRequest,
    viewColumn: vscode.ViewColumn,
  ): Promise<void> {
    const options: vscode.TextDocumentShowOptions = {
      viewColumn,
      preview: true,
      preserveFocus: false,
    };
    if (req.kind === "diff") {
      await vscode.commands.executeCommand(
        "vscode.diff",
        req.left,
        req.right,
        req.title,
        options,
      );
    } else {
      await vscode.commands.executeCommand(
        "vscode.open",
        req.uri,
        options,
        req.title,
      );
    }
  }

  /** Opens `req` in a new floating window, sized like the last one. */
  private async openInNewWindow(
    req: SingleRequest,
  ): Promise<vscode.TabGroup | undefined> {
    const bounds = this.options.sizeMemory?.savedBounds();
    const editorOptions = {
      preview: true,
      preserveFocus: false,
      auxiliary: bounds ? { bounds } : undefined,
    };
    const start = Date.now();
    const newGroup = this.nextNewGroup();
    try {
      // The internal commands accept AUX_WINDOW_GROUP and window bounds,
      // which the public `vscode.diff` / `vscode.open` do not.
      if (req.kind === "diff") {
        await vscode.commands.executeCommand(
          "_workbench.diff",
          req.left,
          req.right,
          req.title,
          [AUX_WINDOW_GROUP, editorOptions],
        );
      } else {
        await vscode.commands.executeCommand(
          "_workbench.open",
          req.uri,
          [AUX_WINDOW_GROUP, editorOptions],
          req.title,
        );
      }
    } catch (error) {
      newGroup.cancel();
      this.log(`opening in a new window failed: ${String(error)}`);
      return this.openInEmptyWindow(req);
    }
    const group = (await newGroup.group) ?? findGroupShowing(req);
    this.log(
      `new window${bounds ? ` at ${bounds.width}x${bounds.height}` : ""}: column ${column(group)} after ${Date.now() - start}ms; groups ${describeGroups()}`,
    );
    return group;
  }

  /** Fallback: create an empty floating window first, then open `req` in it. */
  private async openInEmptyWindow(
    req: SingleRequest,
  ): Promise<vscode.TabGroup | undefined> {
    const newGroup = this.nextNewGroup();
    let group: vscode.TabGroup | undefined;
    try {
      await vscode.commands.executeCommand(NEW_WINDOW_COMMAND);
      group = await newGroup.group;
    } catch (error) {
      newGroup.cancel();
      this.log(`new empty window failed: ${String(error)}`);
    }
    if (!group) {
      this.warnFallback();
    }
    await this.open(req, group?.viewColumn ?? vscode.ViewColumn.Active);
    this.log(`new empty window: column ${column(group)}; groups ${describeGroups()}`);
    return group;
  }

  /**
   * Puts the main window in front, with focus. No command does that, and
   * Cursor even ignores focus moving to the main window from a floating one.
   * But once it has handled a link of its own, the editor focuses its main
   * window, and links to the built-in Git extension it handles without asking
   * (Git acts on "/clone" only).
   */
  private async focusMainWindow(): Promise<boolean> {
    const link = vscode.Uri.parse(`${vscode.env.uriScheme}://vscode.git/git-convenient-focus-main-window`);
    const handled = await vscode.env.openExternal(link).then(undefined, (error: unknown) => {
      this.log(`focusing the main window failed: ${String(error)}`);
      return false;
    });
    this.log(handled ? "the main window is in front of ours" : `not handled: ${link.toString()}`);
    return handled;
  }

  /** The window from before a restart, which the editor brings back with its diff, is ours again: no second window. */
  private findRestored(): vscode.TabGroup | undefined {
    const group = this.restored && findGroupShowing(this.restored);
    if (!group) {
      return undefined;
    }
    this.current = this.restored;
    this.restored = undefined;
    this.log(`the window from before the restart: column ${group.viewColumn}`);
    return group;
  }

  private remember(req: OpenRequest | undefined): void {
    this.options.state?.update(SHOWN_KEY, req && saveRequest(req)).then(undefined, (error: unknown) => this.log(`remembering the diff failed: ${String(error)}`));
  }

  /** Resolves with the next editor group that opens, or undefined after a timeout. */
  private nextNewGroup(): {
    group: Promise<vscode.TabGroup | undefined>;
    cancel(): void;
  } {
    let subscription: vscode.Disposable | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let settle: (group: vscode.TabGroup | undefined) => void = () => {};
    const group = new Promise<vscode.TabGroup | undefined>((resolve) => {
      settle = (value) => {
        clearTimeout(timer);
        subscription?.dispose();
        resolve(value);
      };
      timer = setTimeout(() => settle(undefined), NEW_GROUP_TIMEOUT_MS);
      subscription = vscode.window.tabGroups.onDidChangeTabGroups((e) => {
        if (e.opened.length > 0) {
          settle(e.opened[e.opened.length - 1]);
        }
      });
    });
    return { group, cancel: () => settle(undefined) };
  }

  /** Closes `req` wherever the closing window moved it; once more a moment later, in case it moves after. */
  private async closeMoved(req: OpenRequest): Promise<void> {
    for (const delay of [0, 300]) {
      await new Promise((resolve) => setTimeout(resolve, delay));
      if (this.current && sameRequest(this.current, req)) {
        return; // shown again meanwhile, in a new window
      }
      const moved = vscode.window.tabGroups.all.find((g) => g.tabs.some((t) => tabMatches(t, req) && !t.isDirty));
      if (moved) {
        this.log(`closing "${req.title}", moved to column ${moved.viewColumn} by the closed window`);
        await this.closeTabs(req, undefined);
      }
    }
  }

  /**
   * Closes the tabs showing `req` in the group at `viewColumn` (all groups when
   * undefined), looked up now: Cursor makes new tab objects when editors move
   * between windows, and closing an old one fails.
   */
  private async closeTabs(req: OpenRequest, viewColumn: vscode.ViewColumn | undefined, preserveFocus = true): Promise<void> {
    const tabs = vscode.window.tabGroups.all
      .filter((g) => viewColumn === undefined || g.viewColumn === viewColumn)
      .flatMap((g) => g.tabs.filter((t) => tabMatches(t, req) && !t.isDirty));
    if (tabs.length > 0) {
      await vscode.window.tabGroups.close(tabs, preserveFocus).then(undefined, (error: unknown) => this.log(`closing "${req.title}" failed: ${String(error)}`));
    }
  }

  private warnFallback(): void {
    if (this.warnedFallback) {
      return;
    }
    this.warnedFallback = true;
    void vscode.window.showWarningMessage(
      "Git Convenient: floating windows are unavailable, opened as a regular tab.",
    );
  }

  private sync(): void {
    const group = this.resolveGroup();
    const active = vscode.window.tabGroups.activeTabGroup;
    // `activeTabGroup` can miss that a floating window became active (the
    // group was already active inside its window), so also trust the active
    // editor, which follows real focus.
    const activeDocument = vscode.window.activeTextEditor?.document.uri;
    const showsOurs = showsDocument(this.current, activeDocument);
    const focused = group !== undefined && (active === group || showsOurs);
    if (focused !== this.focused) {
      this.focused = focused;
      this.log(
        `focused=${focused} (ours ${column(group)}, active ${column(active)}, active editor ours ${showsOurs}); groups ${describeGroups()}`,
      );
      void vscode.commands.executeCommand(
        "setContext",
        FOCUSED_CONTEXT_KEY,
        focused,
      );
    }
  }

  private log(message: string): void {
    this.options.log?.(message);
  }
}
