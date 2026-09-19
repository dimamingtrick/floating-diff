# Changelog

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
