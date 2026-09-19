import * as fs from 'fs';
import * as path from 'path';
import { defineConfig } from '@vscode/test-cli';

// The floating window tests in Cursor, which treats floating windows its own way: `npm run test:cursor`.
// Without a folder Cursor opens its agent layout, where editors do not work the same.
const root = path.dirname(new URL(import.meta.url).pathname);
const data = (name) => path.join(root, '.vscode-test', name);
fs.mkdirSync(data('cursor-workspace'), { recursive: true });

export default defineConfig({
	files: 'out/test/integration/diffWindow.test.js',
	useInstallation: { fromPath: '/Applications/Cursor.app/Contents/MacOS/Cursor' },
	workspaceFolder: data('cursor-workspace'),
	// Short paths: Cursor's IPC socket goes in the user data folder.
	launchArgs: ['--user-data-dir', data('cursor-user-data'), '--extensions-dir', data('cursor-extensions'), '--skip-welcome', '--skip-release-notes'],
	mocha: { ui: 'bdd', timeout: 20000 },
});
