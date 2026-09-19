import * as fs from 'fs';
import { parse } from 'jsonc-parser';
import * as vscode from 'vscode';
import type { FileIcon, FileIconFont } from '../shared/protocol';
import { folderIconIdFor, fontCharacter, IconAssociations, iconIdFor, IconThemeDocument, LanguageContribution, languageResolver, ThemeKind } from './fileIcons';

interface LoadedTheme {
	readonly document: IconThemeDocument;
	/** Folder of the theme file: its icon and font paths are relative to it. */
	readonly folder: vscode.Uri;
	/** The extension that brings the theme; webviews need to read from it. */
	readonly root: vscode.Uri;
}

const lowerKeys = (map: Readonly<Record<string, string>> | undefined) =>
	map && Object.fromEntries(Object.entries(map).map(([key, value]) => [key.toLowerCase(), value]));

function normalize<T extends IconAssociations>(section: T): T {
	return {
		...section,
		fileNames: lowerKeys(section.fileNames),
		fileExtensions: lowerKeys(section.fileExtensions),
		folderNames: lowerKeys(section.folderNames),
		folderNamesExpanded: lowerKeys(section.folderNamesExpanded),
	};
}

function loadTheme(id: string): LoadedTheme | undefined {
	for (const extension of vscode.extensions.all) {
		const themes = (extension.packageJSON?.contributes?.iconThemes ?? []) as { id?: string; path?: string }[];
		const contribution = themes.find(theme => theme.id === id);
		if (!contribution?.path) {
			continue;
		}
		const file = vscode.Uri.joinPath(extension.extensionUri, contribution.path);
		try {
			const document = parse(fs.readFileSync(file.fsPath, 'utf8')) as IconThemeDocument;
			return {
				document: {
					...normalize(document),
					light: document.light && normalize(document.light),
					highContrast: document.highContrast && normalize(document.highContrast),
				},
				folder: vscode.Uri.joinPath(file, '..'),
				root: extension.extensionUri,
			};
		} catch {
			return undefined;
		}
	}
	return undefined;
}

function languageContributions(): LanguageContribution[] {
	return vscode.extensions.all
		.flatMap(extension => (extension.packageJSON?.contributes?.languages ?? []) as LanguageContribution[])
		.filter(language => typeof language?.id === 'string');
}

function themeKind(): ThemeKind {
	switch (vscode.window.activeColorTheme.kind) {
		case vscode.ColorThemeKind.Light:
		case vscode.ColorThemeKind.HighContrastLight:
			return 'light';
		case vscode.ColorThemeKind.HighContrast:
			return 'highContrast';
		default:
			return 'dark';
	}
}

/** The active file icon theme, so a webview can show file icons like the Explorer and Source Control. */
export class FileIconTheme implements vscode.Disposable {
	private theme: LoadedTheme | undefined;
	private language: (fileName: string) => string | undefined = () => undefined;
	private readonly emitter = new vscode.EventEmitter<void>();
	/** The theme, the color theme (light icons) or the languages changed. */
	readonly onDidChange = this.emitter.event;
	private readonly subscriptions: vscode.Disposable[];

	constructor() {
		this.reload();
		const reload = () => {
			this.reload();
			this.emitter.fire();
		};
		this.subscriptions = [
			this.emitter,
			vscode.workspace.onDidChangeConfiguration(e => {
				if (e.affectsConfiguration('workbench.iconTheme') || e.affectsConfiguration('files.associations')) {
					reload();
				}
			}),
			vscode.extensions.onDidChange(reload),
			vscode.window.onDidChangeActiveColorTheme(() => this.emitter.fire()),
		];
	}

	/** Where the theme's fonts and images live. */
	get root(): vscode.Uri | undefined {
		return this.theme?.root;
	}

	icon(fileName: string, webview: vscode.Webview): FileIcon | undefined {
		const theme = this.theme;
		return theme && this.render(iconIdFor(theme.document, fileName, this.language(fileName), themeKind()), webview);
	}

	/** A folder's icon, open or closed; undefined for themes without folder icons. */
	folderIcon(folderName: string, expanded: boolean, webview: vscode.Webview): FileIcon | undefined {
		const theme = this.theme;
		return theme && this.render(folderIconIdFor(theme.document, folderName, expanded, themeKind()), webview);
	}

	private render(id: string | undefined, webview: vscode.Webview): FileIcon | undefined {
		const theme = this.theme;
		const definition = theme && id ? theme.document.iconDefinitions[id] : undefined;
		if (!theme || !definition) {
			return undefined;
		}
		if (definition.iconPath) {
			return { kind: 'image', src: webview.asWebviewUri(vscode.Uri.joinPath(theme.folder, definition.iconPath)).toString() };
		}
		const font = theme.document.fonts?.find(candidate => candidate.id === definition.fontId) ?? theme.document.fonts?.[0];
		if (!definition.fontCharacter || !font) {
			return undefined;
		}
		return {
			kind: 'glyph',
			font: font.id,
			char: fontCharacter(definition.fontCharacter),
			color: definition.fontColor,
			size: definition.fontSize ?? font.size,
		};
	}

	fonts(webview: vscode.Webview): FileIconFont[] {
		const theme = this.theme;
		return (theme?.document.fonts ?? []).flatMap(font => {
			const [src] = font.src;
			return theme && src
				? [{ id: font.id, src: webview.asWebviewUri(vscode.Uri.joinPath(theme.folder, src.path)).toString(), format: src.format, weight: font.weight, style: font.style }]
				: [];
		});
	}

	private reload(): void {
		const id = vscode.workspace.getConfiguration('workbench').get<string | null>('iconTheme');
		this.theme = id ? loadTheme(id) : undefined;
		this.language = languageResolver(languageContributions(), vscode.workspace.getConfiguration('files').get<Record<string, string>>('associations') ?? {});
	}

	dispose(): void {
		this.subscriptions.forEach(subscription => subscription.dispose());
	}
}
