# Git Convenient

WebStorm-style Git for VS Code and Cursor: diffs in a floating window, a branches popup, a Git Log with a commit graph, blame on the current line, browsing a branch without checking it out, and a Git Convenient panel in the Activity Bar.

## Floating diff window

- Click (or double-click, per `workbench.list.openMode`) a file in Source Control, or hover it and click the window icon.
- `Ctrl+Alt+D` (macOS: `⌃⌥D`) → pick a changed file → Enter.
- The window is reused: the next file replaces the current one.
- `Esc` closes the window (after closing find, suggestions, selection, etc.), unsaved changes included — the editor asks about them only when no other tab shows the file. The view the diff came from gets the focus back on the file it was opened from, so `⌘↓` and the arrows carry on from there.
- Source Control itself is untouched: a click (or double-click) there opens a tab as it always did. Setting `gitConvenient.openFromSourceControl` (default off) sends those clicks to the floating window instead; it relies on internals of the built-in Git extension, so if a VS Code update changes them, clicks open tabs as usual and the icon keeps working.
- macOS: the window reopens with the size and position it had when you last closed it with `Esc` (no permissions needed).
- Cursor: it opens editor windows only at its fixed size (1024×768) and gives extensions no way to resize or maximize them. So there `Esc` puts the main window in front instead of closing the diff window: maximize it once (double-click its title bar) and the next diffs open in the same maximized window, until you close it with its close button or restart Cursor.

## Branches and Git Log (bottom panel, like WebStorm)

- `⌘⇧B` (Windows/Linux: `Ctrl+Shift+B`) or `⑂ Branches` in the status bar (bottom left) opens the panel next to the terminal and closes it again; `Git Log` (bottom right) and `Git Convenient: Git Log` open it too.
- **Left** — the branches of a repository as a tree: Local, Remote (a folder per remote) and Tags, grouped into folders by the `/` in their names (`feature/…`); the current branch in bold, main/master starred; a search box and, with several repositories, a repository picker. Click a branch for its log, 👁 to browse it, ⋯ for its actions (checkout, merge, rebase, rename, delete…). Right-click a branch for WebStorm's menu: **Pull into This Branch** (a branch that is not checked out is fast-forwarded where it lies, so your working tree stays as it is), Checkout, Merge into Current Branch, Rebase Current Branch onto This Branch, New Branch from This Branch….
- **Middle** — the commits of the selected branch (or all branches) with the graph and the Branch / User / Date / Paths filters, 20 at a time: the next 20 load as you scroll. The search box asks git, so it finds messages in the whole history; a hash (or its start) finds that commit. Right-click a commit for WebStorm's actions: Copy Revision Number, Open Diff, Cherry-Pick, Checkout Revision, Merge into Current Branch, Rebase Current Branch onto This Commit, Revert Commit, New Branch….
- **Paths** searches the files and folders of the repository like Quick Open: tick one or more and the log keeps the commits that change them (Enter takes the highlighted one; a deleted file's path can be typed).
- **Diff with the previous revision** — the clock button on the left of an editor's title: the file against its newest commit. Click it again in that diff and it steps one commit further back, and again, like WebStorm's Compare with Previous Version; the tab says which two revisions it shows and the message of the newer one (`app.ts (c3d4e5f ↔ a1b2c3d · fix: the second one)`). Renames are followed.
- **File History** — the ⇄ button next to it (or `Git Convenient: File History`) opens the panel with the history of that file, on the branch picked on the left: click another branch to see the file's history there without checking it out. Next to it, **Pull** and **Push** run Git's own commands on that file's repository.
- **Right** — the files of the selected commit as a tree with file counts (click selects a file, double-click or `Enter` opens its diff in the floating window, `⌘↓` — Windows/Linux `Ctrl+↓` — opens the file itself on the first line that commit changed, like WebStorm's Jump to Source; a file the commit removed opens as that commit had it; right-click for Open File and Copy Relative Path), then the message, hash, author, date and the branches that contain it; Open diff, Cherry-pick, Revert and more stay at the bottom.
- The panes resize by dragging their edges, and so does the commit details section under the files on the right: drag the line above it. Both are remembered. `Git Convenient: Git Log in Editor` shows the log in an editor tab instead.
- The branch name in the Git Convenient panel opens the branch list to switch branches.

## Line blame

- The line the cursor is on says who last changed it and when, greyed at its end: `You, 14 months ago • feat: the callout`.
- Hover that note for the author and their address, the commit's date and message, and **Open diff** (the commit's change to this file, in the floating window), **File History** and **Copy hash**.
- Lines you have not committed say `You • Uncommitted changes`; unsaved edits keep the other lines right, because the blame reads what the editor holds.
- `gitConvenient.lineBlame` (default on) turns it off.

## Browse a branch without checkout

- `Git Convenient: Browse Branch…`, the eye button of a branch in the Git Convenient panel, or `Browse files at this branch` in the branches popup.
- Files of the branch tip with a filter; read-only preview, `Diff with my copy`, `Copy to working tree`.
- `Search in branch` (git grep on the tip: match case, whole word, regular expression), the branch history with commits your branch lacks marked, and the diff against your current branch.

## Git Convenient panel

`⌘⇧G` (Windows/Linux: `Ctrl+Shift+G`) opens it; it has its own icon in the Activity Bar, one view without collapsible sections. For every repository, like Source Control (with several, each has a header that folds it):

- **Current branch** — click its name to switch branches; incoming/outgoing commits; Fetch / Pull / Push (Git's own commands: Push offers to publish a new branch).
- **Changes** — Staged / Changes / Untracked / Merge groups, as a tree of folders (the default, like WebStorm) or a list (the list/tree button in the view title or its ⋯ menu; `scm.defaultViewMode` picks the start), with the file icons of your icon theme and Git's colors and letters; the same Stage (+), Unstage (−), Discard and Open File buttons on files, folders and groups, and the same context menu, running Git's own commands — plus **Copy Relative Path**, which copies one path per selected file. Click selects a file (Shift/⌘-click several), double-click opens its diff in the floating window, `⌘↓` (Windows/Linux: `Ctrl+↓`) opens the file itself on its first change, `Enter` the diff.
- **Commit** — the message box sits above the files, like Source Control's, and shares its text with it; `⌘⏎`/`Ctrl+Enter` commits, `Commit & Push` pushes after. Git's own commit runs, so with nothing staged it asks the same smart-commit question.

The badge on the icon counts pending changes like Source Control's (`scm.countBadge`, `git.countBadge`).

`⌘⇧G` and `⌘⇧B` take these keys from VS Code's Find Previous and Run Build Task; remap them in Keyboard Shortcuts (`gitConvenient.sidebar.focus`, `gitConvenient.toggleBranches`) if you want the originals back.

## Build and install

    npm install
    npm run package
    code --install-extension git-convenient-0.6.0.vsix
    cursor --install-extension git-convenient-0.6.0.vsix

## Develop

    npm run test:unit
    npm run test:integration   # downloads VS Code and opens a test window
    npm run test:cursor        # the floating window tests in Cursor (/Applications/Cursor.app)
    npm run preview            # the three screens with sample data: http://localhost:5178/webview/preview/?screen=log (explorer, sidebar; &theme=light)

Releases: bump the version and push to `main`, see [RELEASING.md](RELEASING.md).
