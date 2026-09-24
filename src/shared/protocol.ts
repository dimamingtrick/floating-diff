/**
 * Messages between the extension and its webviews. Type-only: the webview
 * bundles import it too, so it must not pull in `vscode` or Node modules.
 */
import type { FileChange, GrepHit, RefLabel } from '../data/parse';
import type { GraphLine, GraphRow } from '../graph/lanes';

export type { FileChange, GrepHit, RefLabel, GraphLine, GraphRow };

/** The groups of uncommitted files, as Source Control names them in Git. */
export type ChangeGroupKind = 'merge' | 'index' | 'workingTree' | 'untracked';

/** Every webview says `ready` once its script runs, and `rendered` after showing data (tests wait for it). */
export type CommonFromWebview =
	| { readonly type: 'ready' }
	| { readonly type: 'rendered'; readonly view: string; readonly count: number };

// ---- Git Log ----

export interface LogRow {
	readonly hash: string;
	readonly parents: readonly string[];
	readonly subject: string;
	readonly author: string;
	readonly email: string;
	readonly date: number;
	readonly refs: readonly RefLabel[];
	readonly graph: GraphRow;
}

export interface LogFilters {
	/** A branch name; all branches when missing. */
	readonly branch?: string;
	readonly author?: string;
	readonly since?: 'day' | 'week' | 'month';
	/** Commits that change any of these files or folders. */
	readonly paths?: readonly string[];
	/** Commits whose message contains this text; a hash (or its start) finds that commit. */
	readonly text?: string;
}

export interface LogData {
	readonly rows: readonly LogRow[];
	readonly graphWidth: number;
	readonly filters: LogFilters;
	readonly branches: { readonly local: readonly string[]; readonly remote: readonly string[] };
	readonly authors: readonly string[];
	/** Commits the filters find; `rows` holds the pages loaded so far. */
	readonly total: number;
	readonly canLoadMore: boolean;
	/** Commit to select, e.g. HEAD after loading. */
	readonly selected?: string;
}

export interface CommitDetails {
	readonly hash: string;
	readonly body: string;
	readonly files: readonly FileChange[];
	/** Branches that contain the commit (the Git panel shows them). */
	readonly branches?: readonly string[];
	/** File icons of the icon theme by path (the Git panel shows them). */
	readonly icons?: Readonly<Record<string, FileIcon>>;
}

/** A file or folder of the repository, found for the Paths filter. */
export interface PathItem {
	readonly path: string;
	readonly folder?: boolean;
	readonly icon?: FileIcon;
}

export type LogToWebview =
	| { readonly type: 'log'; readonly data: LogData }
	| { readonly type: 'details'; readonly details: CommitDetails }
	| { readonly type: 'busy'; readonly busy: boolean }
	/** The files and folders that match `query`; the filtered ones for an empty query. */
	| { readonly type: 'paths'; readonly query: string; readonly items: readonly PathItem[] }
	/** The diff window closed: put the keyboard back on the row it was opened from. */
	| { readonly type: 'focus' };

export type LogAction = 'cherryPick' | 'revert' | 'copyHash' | 'checkout' | 'newBranch' | 'merge' | 'rebase';

export type LogFromWebview =
	| CommonFromWebview
	| { readonly type: 'filters'; readonly filters: LogFilters }
	| { readonly type: 'select'; readonly hash: string }
	| { readonly type: 'loadMore' }
	| { readonly type: 'searchPaths'; readonly query: string }
	| { readonly type: 'refresh' }
	| { readonly type: 'openFile'; readonly hash: string; readonly file: FileChange }
	/** ⌘↓ on a file: the file itself in an editor, like WebStorm's Jump to Source. */
	| { readonly type: 'openSource'; readonly hash: string; readonly file: FileChange }
	| { readonly type: 'openCommit'; readonly hash: string }
	| { readonly type: 'action'; readonly action: LogAction; readonly hash: string };

// ---- Branch explorer ----

export interface ExplorerInfo {
	readonly branch: string;
	readonly current: string;
	readonly remote: boolean;
	readonly tip: { readonly hash: string; readonly subject: string; readonly author: string; readonly date: number };
	readonly ahead: number;
	readonly behind: number;
}

export interface ExplorerCommit {
	readonly hash: string;
	readonly parents: readonly string[];
	readonly subject: string;
	readonly author: string;
	readonly date: number;
	/** Not in the current branch yet. */
	readonly ahead: boolean;
}

export interface ExplorerData {
	readonly info: ExplorerInfo;
	readonly files: readonly string[];
	/** Changes from the merge base with the current branch to the browsed branch. */
	readonly diff: readonly FileChange[];
	/** Recent history of the branch, newest first. */
	readonly commits: readonly ExplorerCommit[];
}

export interface FilePreview {
	readonly path: string;
	readonly text?: string;
	readonly binary?: boolean;
	readonly tooLarge?: boolean;
	readonly missing?: boolean;
	/** 1-based line to reveal. */
	readonly line?: number;
}

export interface SearchOptions {
	readonly matchCase: boolean;
	readonly wholeWord: boolean;
	readonly regex: boolean;
}

export type ExplorerToWebview =
	| { readonly type: 'init'; readonly data: ExplorerData }
	| { readonly type: 'file'; readonly file: FilePreview }
	| { readonly type: 'search'; readonly query: string; readonly hits: readonly GrepHit[]; readonly error?: string };

export type ExplorerFromWebview =
	| CommonFromWebview
	| { readonly type: 'openFile'; readonly path: string; readonly line?: number }
	| { readonly type: 'search'; readonly query: string; readonly options: SearchOptions }
	| { readonly type: 'diffWithMine'; readonly path: string }
	| { readonly type: 'copyToWorkingTree'; readonly path: string }
	| { readonly type: 'diffFile'; readonly file: FileChange }
	| { readonly type: 'openFullDiff' }
	| { readonly type: 'openCommit'; readonly commit: ExplorerCommit }
	| { readonly type: 'cherryPick' }
	| { readonly type: 'checkout' }
	| { readonly type: 'pickBranch' };

// ---- Sidebar ----

export interface SidebarBranch {
	readonly name: string;
	readonly sync: string;
	readonly current: boolean;
	readonly kind: 'local' | 'remote' | 'tag';
}

export interface SidebarGroup {
	readonly title: string;
	readonly items: readonly SidebarBranch[];
}

/** A file icon of the user's file icon theme: an image, or a character of an icon font. */
export type FileIcon =
	| { readonly kind: 'image'; readonly src: string }
	| { readonly kind: 'glyph'; readonly font: string; readonly char: string; readonly color?: string; readonly size?: string };

export interface FileIconFont {
	readonly id: string;
	readonly src: string;
	readonly format?: string;
	readonly weight?: string;
	readonly style?: string;
}

/** One uncommitted file, as Source Control shows it. */
export interface SidebarFile {
	/** From the repository root, `/`-separated. */
	readonly path: string;
	readonly name: string;
	readonly dir: string;
	/** Git's letter (M, A, D, U, R, C, T, I, ! for conflicts). */
	readonly letter: string;
	/** Git's decoration color: modified, stageModified, added, deleted, stageDeleted, renamed, untracked, ignored, conflict. */
	readonly decoration: string;
	readonly tooltip: string;
	readonly icon?: FileIcon;
}

export interface SidebarChangeGroup {
	readonly group: ChangeGroupKind;
	readonly label: string;
	readonly files: readonly SidebarFile[];
}

export interface SidebarRepo {
	/** The repository root (a file system path); identifies the repository in messages. */
	readonly root: string;
	readonly name: string;
	readonly current?: {
		readonly name: string;
		readonly upstream?: string;
		readonly ahead: number;
		readonly behind: number;
	};
	readonly groups: readonly SidebarChangeGroup[];
	readonly changeCount: number;
}

export interface FolderIcons {
	readonly closed?: FileIcon;
	readonly open?: FileIcon;
}

export interface SidebarState {
	/** Every open repository, in Source Control's order. */
	readonly repos: readonly SidebarRepo[];
	/** Files as a list with their folder, or as a tree of folders (Source Control's View as Tree). */
	readonly viewMode: 'list' | 'tree';
	/** Folders that only hold one folder show as one row (`scm.compactFolders`). */
	readonly compactFolders: boolean;
	readonly iconFonts: readonly FileIconFont[];
	/** Folder icons of the icon theme by lower-case folder name; '' holds the default ones. */
	readonly folderIcons: Readonly<Record<string, FolderIcons>>;
}

/** An uncommitted file in a message: its repository, group and path. */
export interface ChangeRef {
	readonly root: string;
	readonly group: ChangeGroupKind;
	readonly path: string;
}

export type ChangeAction = 'open' | 'openFile' | 'stage' | 'unstage' | 'discard';
export type GroupAction = 'view' | 'stageAll' | 'unstageAll' | 'discardAll';

export type SidebarToWebview =
	| { readonly type: 'state'; readonly state: SidebarState }
	| { readonly type: 'busy'; readonly label?: string }
	/** The commit message of a repository, shared with the box in Source Control. */
	| { readonly type: 'draft'; readonly root: string; readonly value: string }
	/** The diff window closed: put the keyboard back on the file it was opened from. */
	| { readonly type: 'focus' };

export type SidebarFromWebview =
	| CommonFromWebview
	| { readonly type: 'change'; readonly action: ChangeAction; readonly items: readonly ChangeRef[] }
	| { readonly type: 'group'; readonly action: GroupAction; readonly root: string; readonly group: ChangeGroupKind }
	/** The selected files, for the context menu. */
	| { readonly type: 'select'; readonly items: readonly ChangeRef[] }
	| { readonly type: 'commit'; readonly root: string; readonly message: string; readonly push: boolean }
	| { readonly type: 'draft'; readonly root: string; readonly value: string }
	| { readonly type: 'sync'; readonly root: string; readonly action: 'fetch' | 'pull' | 'push' }
	/** Opens the branches list to switch branches. */
	| { readonly type: 'switchBranch'; readonly root: string };

// ---- Git panel (bottom): branches, log, commit — like WebStorm's Git tool window ----

export interface GitBranchItem {
	/** `feature/x`, or `origin/feature/x` for a remote branch. */
	readonly name: string;
	readonly current: boolean;
	/** main and master, like WebStorm's default favorites. */
	readonly favorite: boolean;
	/** `↓2 ↑1` against the upstream. */
	readonly sync: string;
}

export interface GitPanelBranches {
	readonly repos: readonly { readonly root: string; readonly name: string }[];
	/** The repository the panel shows. */
	readonly root?: string;
	readonly local: readonly GitBranchItem[];
	readonly remote: readonly GitBranchItem[];
	readonly tags: readonly string[];
	/** Remote names, so remote branches group under them. */
	readonly remotes: readonly string[];
}

export type GitPanelToWebview =
	| LogToWebview
	| { readonly type: 'branches'; readonly branches: GitPanelBranches }
	| { readonly type: 'iconFonts'; readonly fonts: readonly FileIconFont[] };

export type GitPanelFromWebview =
	| LogFromWebview
	| { readonly type: 'pickRepo'; readonly root: string }
	| { readonly type: 'browse'; readonly branch: string }
	| { readonly type: 'branchActions'; readonly branch: string };
