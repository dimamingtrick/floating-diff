import * as assert from 'assert';
import { folderIconIdFor, fontCharacter, iconIdFor, IconThemeDocument, languageResolver } from '../../sidebar/fileIcons';

const theme: IconThemeDocument = {
	iconDefinitions: {},
	file: 'file',
	fileNames: { 'package.json': 'npm', dockerfile: 'docker' },
	fileExtensions: { ts: 'ts-ext', 'd.ts': 'declaration', md: 'markdown' },
	languageIds: { typescriptreact: 'react', typescript: 'typescript-lang' },
	light: { fileExtensions: { md: 'markdown-light' }, file: 'file-light' },
	highContrast: { file: 'file-hc' },
};

describe('iconIdFor', () => {
	it('prefers file names, then the longest extension, then the language, then the default', () => {
		assert.strictEqual(iconIdFor(theme, 'package.json', 'json', 'dark'), 'npm');
		assert.strictEqual(iconIdFor(theme, 'Dockerfile', 'dockerfile', 'dark'), 'docker', 'names ignore case');
		assert.strictEqual(iconIdFor(theme, 'index.d.ts', 'typescript', 'dark'), 'declaration');
		assert.strictEqual(iconIdFor(theme, 'index.ts', 'typescript', 'dark'), 'ts-ext');
		assert.strictEqual(iconIdFor(theme, 'Screen.tsx', 'typescriptreact', 'dark'), 'react');
		assert.strictEqual(iconIdFor(theme, 'notes.txt', 'plaintext', 'dark'), 'file');
	});

	it('uses the light and high contrast variants when the theme has them', () => {
		assert.strictEqual(iconIdFor(theme, 'README.md', 'markdown', 'light'), 'markdown-light');
		assert.strictEqual(iconIdFor(theme, 'notes.txt', undefined, 'light'), 'file-light');
		assert.strictEqual(iconIdFor(theme, 'index.ts', 'typescript', 'light'), 'ts-ext', 'falls back to the base section');
		assert.strictEqual(iconIdFor(theme, 'notes.txt', undefined, 'highContrast'), 'file-hc');
	});
});

describe('folderIconIdFor', () => {
	const folders: IconThemeDocument = {
		iconDefinitions: {},
		folder: 'folder',
		folderExpanded: 'folder-open',
		folderNames: { src: 'folder-src' },
		folderNamesExpanded: { src: 'folder-src-open' },
		light: { folder: 'folder-light' },
	};

	it('uses the folder name, else the default folder, open or closed', () => {
		assert.strictEqual(folderIconIdFor(folders, 'SRC', false, 'dark'), 'folder-src');
		assert.strictEqual(folderIconIdFor(folders, 'src', true, 'dark'), 'folder-src-open');
		assert.strictEqual(folderIconIdFor(folders, 'docs', false, 'dark'), 'folder');
		assert.strictEqual(folderIconIdFor(folders, 'docs', true, 'dark'), 'folder-open');
		assert.strictEqual(folderIconIdFor(folders, 'docs', false, 'light'), 'folder-light');
	});

	it('has none for themes without folder icons', () => {
		assert.strictEqual(folderIconIdFor(theme, 'src', true, 'dark'), undefined);
	});
});

describe('fontCharacter', () => {
	it('reads CSS escapes and keeps literal characters', () => {
		assert.strictEqual(fontCharacter('\\E023'), '');
		assert.strictEqual(fontCharacter('\\f101'), '');
		assert.strictEqual(fontCharacter('A'), 'A');
	});
});

describe('languageResolver', () => {
	const language = languageResolver(
		[
			{ id: 'typescript', extensions: ['.ts', '.cts'] },
			{ id: 'typescriptreact', extensions: ['.tsx'] },
			{ id: 'dockerfile', filenames: ['Dockerfile'], filenamePatterns: ['*.dockerfile'] },
			{ id: 'json', extensions: ['.json'] },
			{ id: 'jsonc', extensions: ['.code-workspace'], filenames: ['tsconfig.json'] },
		],
		{ '*.mdx': 'markdown', 'Jenkinsfile': 'groovy' },
	);

	it('guesses by file name, name pattern and extension, like VS Code without reading the file', () => {
		assert.strictEqual(language('Screen.tsx'), 'typescriptreact');
		assert.strictEqual(language('index.TS'), 'typescript');
		assert.strictEqual(language('Dockerfile'), 'dockerfile');
		assert.strictEqual(language('api.dockerfile'), 'dockerfile');
		assert.strictEqual(language('tsconfig.json'), 'jsonc', 'a file name beats its extension');
		assert.strictEqual(language('notes.unknown'), undefined);
	});

	it('lets the files.associations setting win', () => {
		assert.strictEqual(language('page.mdx'), 'markdown');
		assert.strictEqual(language('Jenkinsfile'), 'groovy');
	});
});
