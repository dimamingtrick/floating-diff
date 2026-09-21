# Changelog

## 0.6.0

- **Line blame**, like GitLens: the line the cursor is on says who last changed it and when, greyed at its end. Hover that note for the author, the date, the commit message and Open diff / File History / Copy hash. Lines you have not committed say `You • Uncommitted changes`, and unsaved edits keep the other lines right. `gitConvenient.lineBlame` turns it off.
- **Diff with the previous revision**: the clock button in an editor's title compares the file with its newest commit; click it again in that diff and it steps one commit further back, and again, like WebStorm's Compare with Previous Version. The tab says which two revisions it shows and the message of the newer one, and renames are followed. File History moved to the ⇄ button next to it.
- `⌘⇧G` opens the Git Convenient panel, `⌘⇧B` the Branches panel (Windows/Linux: `Ctrl+Shift+G` and `Ctrl+Shift+B`). They take these keys from VS Code's Find Previous and Run Build Task; remap `gitConvenient.sidebar.focus` and `gitConvenient.toggleBranches` to get the originals back.
- **Pull** and **Push** buttons in an editor's title, after File History; they run Git's own commands on that file's repository.
- Branches panel and Git Log: `⌘↓` on a file of a commit opens the file itself, like WebStorm's Jump to Source (`Ctrl+↓` on Windows and Linux). A file the commit removed opens as that commit had it.
- Branches panel: the commit details under the files on the right resize by dragging the line above them, and keep that height. Dragging a pane edge no longer selects text.
- Source Control is left alone: clicking a file there opens a tab again, the way VS Code does it. The floating window stays one click away on the file's window icon, and `gitConvenient.openFromSourceControl` brings the old behaviour back.

## 0.5.0

- Cursor: diffs open in a window of their own. Cursor opens such windows only at a fixed size and gives extensions no way to resize them, so there `Esc` brings the main window forward and keeps the diff window: maximize it once, and the next diffs open in it maximized.
- Cursor: `Esc` works, closing the window no longer leaves its diff in the editor, and a double click no longer opens two windows.
- Branches panel: in the files of a commit, a click selects a file; a double click or `Enter` opens its diff.

## 0.4.0

First release on the Marketplace.

- Diffs open in one floating window that is reused; Esc closes it. Clicks in Source Control open there too.
- The Git Convenient panel in the Activity Bar: the current branch with Fetch, Pull and Push; changes as a tree or a list, staged with Source Control's own commands; the commit box; several repositories.
- The Branches panel at the bottom, like WebStorm: branches grouped in folders, the log with its graph and filters (branch, user, date, files), the files and details of a commit, and WebStorm's commit actions.
- File History from the editor title: the history of a file on any branch, without checking it out.
- Browse the files of a branch without checking it out.
