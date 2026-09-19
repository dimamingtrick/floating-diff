import * as esbuild from 'esbuild';
import { copyFileSync, mkdirSync, rmSync } from 'fs';

const production = process.argv.includes('--production');
const watch = process.argv.includes('--watch');

// Bundles of removed screens must not end up in the package.
rmSync('dist', { recursive: true, force: true });

const extension = await esbuild.context({
	entryPoints: ['src/extension.ts'],
	bundle: true,
	format: 'cjs',
	platform: 'node',
	// ESM builds bundle cleanly (jsonc-parser's UMD one loads its parts at runtime).
	mainFields: ['module', 'main'],
	target: 'node18',
	outfile: 'dist/extension.js',
	external: ['vscode'],
	sourcemap: !production,
	minify: production,
	logLevel: 'info',
});

// One browser bundle per webview screen, Preact included.
const webviews = await esbuild.context({
	entryPoints: {
		log: 'webview/log/index.tsx',
		explorer: 'webview/explorer/index.tsx',
		sidebar: 'webview/sidebar/index.tsx',
		git: 'webview/git/index.tsx',
	},
	bundle: true,
	format: 'iife',
	platform: 'browser',
	target: 'es2022',
	outdir: 'dist/webview',
	jsx: 'automatic',
	jsxImportSource: 'preact',
	sourcemap: production ? false : 'inline',
	minify: production,
	logLevel: 'info',
});

/** Shared styles and VS Code's icon font (codicons) for the webviews. */
function copyStyles() {
	mkdirSync('dist/webview', { recursive: true });
	copyFileSync('webview/common/styles.css', 'dist/webview/styles.css');
	copyFileSync('node_modules/@vscode/codicons/dist/codicon.css', 'dist/webview/codicon.css');
	copyFileSync('node_modules/@vscode/codicons/dist/codicon.ttf', 'dist/webview/codicon.ttf');
}

if (watch) {
	copyStyles();
	await Promise.all([extension.watch(), webviews.watch()]);
} else {
	await Promise.all([extension.rebuild(), webviews.rebuild()]);
	copyStyles();
	await Promise.all([extension.dispose(), webviews.dispose()]);
}
