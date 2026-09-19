/**
 * Picks file icons from a file icon theme (`contributes.iconThemes`) the way
 * VS Code does for the Explorer and Source Control: by file name, then
 * extension (longest first), then language, then the default file icon.
 * Pure, so the extension and its tests can use it without VS Code.
 */

export interface IconAssociations {
	readonly file?: string;
	readonly fileExtensions?: Readonly<Record<string, string>>;
	readonly fileNames?: Readonly<Record<string, string>>;
	readonly languageIds?: Readonly<Record<string, string>>;
	readonly folder?: string;
	readonly folderExpanded?: string;
	readonly folderNames?: Readonly<Record<string, string>>;
	readonly folderNamesExpanded?: Readonly<Record<string, string>>;
}

export interface IconDefinition {
	readonly iconPath?: string;
	readonly fontCharacter?: string;
	readonly fontColor?: string;
	readonly fontId?: string;
	readonly fontSize?: string;
}

export interface FontDefinition {
	readonly id: string;
	readonly src: readonly { readonly path: string; readonly format?: string }[];
	readonly weight?: string;
	readonly style?: string;
	readonly size?: string;
}

export interface IconThemeDocument extends IconAssociations {
	readonly iconDefinitions: Readonly<Record<string, IconDefinition>>;
	readonly fonts?: readonly FontDefinition[];
	readonly light?: IconAssociations;
	readonly highContrast?: IconAssociations;
}

export type ThemeKind = 'dark' | 'light' | 'highContrast';

function first(sections: readonly IconAssociations[], pick: (section: IconAssociations) => string | undefined): string | undefined {
	for (const section of sections) {
		const id = pick(section);
		if (id) {
			return id;
		}
	}
	return undefined;
}

/** The icon definition id for a file; the light and high contrast sections win over the base one. */
export function iconIdFor(theme: IconThemeDocument, fileName: string, languageId: string | undefined, kind: ThemeKind): string | undefined {
	const variant = kind === 'light' ? theme.light : kind === 'highContrast' ? theme.highContrast : undefined;
	const sections = variant ? [variant, theme] : [theme];
	const name = fileName.toLowerCase();
	const byName = first(sections, section => section.fileNames?.[name]);
	if (byName) {
		return byName;
	}
	for (let dot = name.indexOf('.'); dot >= 0; dot = name.indexOf('.', dot + 1)) {
		const byExtension = first(sections, section => section.fileExtensions?.[name.slice(dot + 1)]);
		if (byExtension) {
			return byExtension;
		}
	}
	const byLanguage = languageId ? first(sections, section => section.languageIds?.[languageId]) : undefined;
	return byLanguage ?? first(sections, section => section.file);
}

/** The icon definition id for a folder, open or closed; many themes (Seti) have none. */
export function folderIconIdFor(theme: IconThemeDocument, folderName: string, expanded: boolean, kind: ThemeKind): string | undefined {
	const variant = kind === 'light' ? theme.light : kind === 'highContrast' ? theme.highContrast : undefined;
	const sections = variant ? [variant, theme] : [theme];
	const name = folderName.toLowerCase();
	return (
		(expanded ? first(sections, section => section.folderNamesExpanded?.[name]) : undefined) ??
		first(sections, section => section.folderNames?.[name]) ??
		(expanded ? first(sections, section => section.folderExpanded) : undefined) ??
		first(sections, section => section.folder)
	);
}

/** Icon fonts write characters as CSS escapes (`\E023`); some themes use the character itself. */
export function fontCharacter(value: string): string {
	const escape = /^\\([0-9a-fA-F]{1,6})$/.exec(value);
	return escape ? String.fromCodePoint(parseInt(escape[1], 16)) : value;
}

export interface LanguageContribution {
	readonly id: string;
	readonly extensions?: readonly string[];
	readonly filenames?: readonly string[];
	readonly filenamePatterns?: readonly string[];
}

function globToRegExp(glob: string): RegExp {
	const source = glob.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.');
	return new RegExp(`^${source}$`, 'i');
}

/**
 * The language of a file from its name, as VS Code guesses it before reading
 * the file: the `files.associations` setting, then the file names, name
 * patterns and extensions (longest first) languages declare.
 */
export function languageResolver(
	contributions: readonly LanguageContribution[],
	associations: Readonly<Record<string, string>>,
): (fileName: string) => string | undefined {
	const names = new Map<string, string>();
	const patterns: [RegExp, string][] = [];
	const extensions = new Map<string, string>();
	for (const language of contributions) {
		for (const name of language.filenames ?? []) {
			if (!names.has(name.toLowerCase())) {
				names.set(name.toLowerCase(), language.id);
			}
		}
		// Patterns with folders need the whole path; a file name is all there is here.
		for (const pattern of language.filenamePatterns ?? []) {
			if (!pattern.includes('/')) {
				patterns.push([globToRegExp(pattern), language.id]);
			}
		}
		for (const extension of language.extensions ?? []) {
			if (!extensions.has(extension.toLowerCase())) {
				extensions.set(extension.toLowerCase(), language.id);
			}
		}
	}
	const user = Object.entries(associations)
		.filter(([pattern]) => !pattern.includes('/'))
		.map(([pattern, id]) => [globToRegExp(pattern), id] as const);
	return fileName => {
		const lower = fileName.toLowerCase();
		const byUser = user.find(([pattern]) => pattern.test(fileName));
		if (byUser) {
			return byUser[1];
		}
		const byName = names.get(lower);
		if (byName) {
			return byName;
		}
		const byPattern = patterns.find(([pattern]) => pattern.test(fileName));
		if (byPattern) {
			return byPattern[1];
		}
		for (let dot = lower.indexOf('.'); dot >= 0; dot = lower.indexOf('.', dot + 1)) {
			const byExtension = extensions.get(lower.slice(dot));
			if (byExtension) {
				return byExtension;
			}
		}
		return undefined;
	};
}
