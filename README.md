# Git Convenient

WebStorm-style Git for VS Code and Cursor: diffs in a floating window, a branches popup, a Git Log with a commit graph, browsing a branch without checking it out, and a Git Convenient panel in the Activity Bar.

## Floating diff window

- Click (or double-click, per `workbench.list.openMode`) a file in Source Control, or hover it and click the window icon.
- `Ctrl+Alt+D` (macOS: `⌃⌥D`) → pick a changed file → Enter.
- The window is reused: the next file replaces the current one.
- `Esc` closes the window (after closing find, suggestions, selection, etc.).
- Setting `gitConvenient.openFromSourceControl` (default on): clicks in Source Control open the floating window. This relies on internals of the built-in Git extension; if a VS Code update changes them, clicks open tabs as usual and the icon keeps working.
- macOS: the window reopens with the size and position it had when you last closed it with `Esc` (no permissions needed).

## Branches and Git Log (bottom panel, like WebStorm)

- `⑂ Branches` in the status bar (bottom left) opens the panel next to the terminal and closes it again; `Git Log` (bottom right) and `Git Convenient: Git Log` open it too.
- **Left** — the branches of a repository as a tree: Local, Remote (a folder per remote) and Tags, grouped into folders by the `/` in their names (`feature/…`); the current branch in bold, main/master starred; a search box and, with several repositories, a repository picker. Click a branch for its log, 👁 to browse it, ⋯ for its actions (checkout, merge, rebase, rename, delete…).
- **Middle** — the commits of the selected branch (or all branches) with the graph and the Branch / User / Date / Paths filters, 20 at a time: the next 20 load as you scroll. The search box asks git, so it finds messages in the whole history; a hash (or its start) finds that commit. Right-click a commit for WebStorm's actions: Copy Revision Number, Open Diff, Cherry-Pick, Checkout Revision, Merge into Current Branch, Rebase Current Branch onto This Commit, Revert Commit, New Branch….
- **Paths** searches the files and folders of the repository like Quick Open: tick one or more and the log keeps the commits that change them (Enter takes the highlighted one; a deleted file's path can be typed).
- **File History** — the clock button in an editor's title (or `Git Convenient: File History`) opens the panel with the history of that file, on the branch picked on the left: click another branch to see the file's history there without checking it out.
- **Right** — the files of the selected commit as a tree with file counts (click one for its diff in the floating window), then the message, hash, author, date and the branches that contain it; Open diff, Cherry-pick, Revert and more stay at the bottom.
- The panes resize by dragging their edges. `Git Convenient: Git Log in Editor` shows the log in an editor tab instead.
- The branch name in the Git Convenient panel opens the branch list to switch branches.

## Browse a branch without checkout

- `Git Convenient: Browse Branch…`, the eye button of a branch in the Git Convenient panel, or `Browse files at this branch` in the branches popup.
- Files of the branch tip with a filter; read-only preview, `Diff with my copy`, `Copy to working tree`.
- `Search in branch` (git grep on the tip: match case, whole word, regular expression), the branch history with commits your branch lacks marked, and the diff against your current branch.

## Git Convenient panel

Its own icon in the Activity Bar, one view without collapsible sections. For every repository, like Source Control (with several, each has a header that folds it):

- **Current branch** — click its name to switch branches; incoming/outgoing commits; Fetch / Pull / Push (Git's own commands: Push offers to publish a new branch).
- **Changes** — Staged / Changes / Untracked / Merge groups, as a tree of folders (the default, like WebStorm) or a list (the list/tree button in the view title or its ⋯ menu; `scm.defaultViewMode` picks the start), with the file icons of your icon theme and Git's colors and letters; the same Stage (+), Unstage (−), Discard and Open File buttons on files, folders and groups, and the same context menu, running Git's own commands. Click selects a file (Shift/⌘-click several), double-click opens its diff in the floating window, `⌘↓` (Windows/Linux: `Ctrl+↓`) opens the file itself, `Enter` the diff.
- **Commit** — the message box shares its text with Source Control's; `⌘⏎`/`Ctrl+Enter` commits, `Commit & Push` pushes after. Git's own commit runs, so with nothing staged it asks the same smart-commit question.

The badge on the icon counts pending changes like Source Control's (`scm.countBadge`, `git.countBadge`).

## Build and install

    npm install
    npm run package
    code --install-extension git-convenient-0.4.0.vsix
    cursor --install-extension git-convenient-0.4.0.vsix

## Develop

    npm run test:unit
    npm run test:integration   # downloads VS Code and opens a test window
    npm run preview            # the three screens with sample data: http://localhost:5178/webview/preview/?screen=log (explorer, sidebar; &theme=light)
