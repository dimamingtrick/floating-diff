import * as vscode from "vscode";
import { OpenRequest, showsDocument } from "./openRequest";
import type { Bounds } from "./windowBounds";

/** Internal workbench command: creates a floating editor window and focuses its group. */
const NEW_WINDOW_COMMAND = "workbench.action.newEmptyEditorWindow";
/** Internal editor group id meaning "a new floating window" (VS Code's AUX_WINDOW_GROUP). */
const AUX_WINDOW_GROUP = -3;
const FOCUSED_CONTEXT_KEY = "floatingDiff.focused";
const NEW_GROUP_TIMEOUT_MS = 1000;

export function tabMatches(tab: vscode.Tab, req: OpenRequest): boolean {
  const input = tab.input;
  if (req.kind === "diff") {
    return (
      input instanceof vscode.TabInputTextDiff &&
      input.original.toString() === req.left.toString() &&
      input.modified.toString() === req.right.toString()
    );
  }
  return (
    input instanceof vscode.TabInputText &&
    input.uri.toString() === req.uri.toString()
  );
}

function sameRequest(a: OpenRequest, b: OpenRequest): boolean {
  if (a.kind === "diff" && b.kind === "diff") {
    return (
      a.left.toString() === b.left.toString() &&
      a.right.toString() === b.right.toString()
    );
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

/** The group showing `req`; floating windows come after the main window, so the highest column wins. */
function findGroupShowing(req: OpenRequest): vscode.TabGroup | undefined {
  return vscode.window.tabGroups.all
    .filter((g) => g.tabs.some((t) => tabMatches(t, req)))
    .sort((a, b) => b.viewColumn - a.viewColumn)[0];
}

/** Keeps the size of the floating window between windows. */
export interface SizeMemory {
  savedBounds(): Bounds | undefined;
  /** Saves the size of the frontmost window, which must be ours. */
  remember(): Promise<void>;
}

export interface DiffWindowOptions {
  readonly sizeMemory?: SizeMemory;
  readonly log?: (message: string) => void;
}

/** One reusable floating window that shows a single diff at a time. */
export class DiffWindow implements vscode.Disposable {
  private group: vscode.TabGroup | undefined;
  private current: OpenRequest | undefined;
  private focused = false;
  private warnedFallback = false;
  private readonly subscriptions: vscode.Disposable[];

  constructor(private readonly options: DiffWindowOptions = {}) {
    this.subscriptions = [
      vscode.window.tabGroups.onDidChangeTabGroups((e) => {
        if (this.group && e.closed.includes(this.group)) {
          this.log("our window closed");
          this.group = undefined;
          this.current = undefined;
        }
        this.sync();
      }),
      vscode.window.tabGroups.onDidChangeTabs(() => this.sync()),
      vscode.window.onDidChangeActiveTextEditor(() => this.sync()),
    ];
  }

  /** Whether our floating window is the active one (drives the Esc keybinding). */
  get isFocused(): boolean {
    return this.focused;
  }

  /** The editor group of our floating window, or undefined when it is closed. */
  resolveGroup(): vscode.TabGroup | undefined {
    if (this.group && vscode.window.tabGroups.all.includes(this.group)) {
      return this.group;
    }
    // Older builds (e.g. Cursor) recreate TabGroup objects on layout changes.
    this.group = this.current ? findGroupShowing(this.current) : undefined;
    return this.group;
  }

  async show(req: OpenRequest): Promise<void> {
    const previous = this.current;
    let group = this.resolveGroup();
    this.log(`show "${req.title}": reusing column ${column(group)}`);

    if (group) {
      await this.open(req, group.viewColumn);
    } else {
      group = await this.openInNewWindow(req);
    }

    this.current = req;
    this.group =
      group ?? findGroupShowing(req) ?? vscode.window.tabGroups.activeTabGroup;
    if (previous && !sameRequest(previous, req)) {
      const stale = this.group.tabs.filter(
        (t) => tabMatches(t, previous) && !t.isDirty,
      );
      if (stale.length > 0) {
        await vscode.window.tabGroups.close(stale, true);
      }
    }
    this.sync();
  }

  async close(): Promise<void> {
    const group = this.resolveGroup();
    const req = this.current;
    this.log(`close: ours ${column(group)}, current "${req?.title ?? "none"}"`);
    if (!group || !req) {
      return;
    }
    // Esc was pressed in our window, so it is the frontmost one right now.
    await this.options.sizeMemory?.remember();
    const ours = group.tabs.filter((t) => tabMatches(t, req));
    if (ours.length > 0) {
      await vscode.window.tabGroups.close(ours);
    }
    // With `workbench.editor.closeEmptyGroups: false` the empty group, and so the window, stays open.
    if (
      vscode.window.tabGroups.all.includes(group) &&
      group.tabs.length === 0
    ) {
      await vscode.window.tabGroups.close(group);
    }
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
    req: OpenRequest,
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
    req: OpenRequest,
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
      `new window${bounds ? ` at ${bounds.width}x${bounds.height}` : ""}: column ${column(group)} after ${Date.now() - start}ms`,
    );
    return group;
  }

  /** Fallback: create an empty floating window first, then open `req` in it. */
  private async openInEmptyWindow(
    req: OpenRequest,
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
    return group;
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

  private warnFallback(): void {
    if (this.warnedFallback) {
      return;
    }
    this.warnedFallback = true;
    void vscode.window.showWarningMessage(
      "Floating Diff: floating windows are unavailable, opened as a regular tab.",
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
        `focused=${focused} (ours ${column(group)}, active ${column(active)}, active editor ours ${showsOurs})`,
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
