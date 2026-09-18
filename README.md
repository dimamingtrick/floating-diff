# Floating Diff

Opens Source Control diffs in a floating window instead of a tab, like WebStorm. Esc closes it.

## Usage

- Hover a file in Source Control → click the window icon.
- `Ctrl+Alt+D` (macOS: `⌃⌥D`) → pick a changed file → Enter.
- The window is reused: the next file replaces the current one.
- `Esc` closes the window (after closing find, suggestions, selection, etc.).
- macOS: the window reopens with the size and position it had when you last closed it with `Esc` (no permissions needed).

## Build and install

    npm install
    npm run package
    code --install-extension floating-diff-0.1.0.vsix
    cursor --install-extension floating-diff-0.1.0.vsix

## Develop

    npm run test:unit
    npm run test:integration   # downloads VS Code and opens a test window
