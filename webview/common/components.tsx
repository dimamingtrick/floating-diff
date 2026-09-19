import type { ComponentChildren, JSX } from 'preact';
import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import { placePopup } from '../../src/shared/popup';
import type { FileChange, FileIcon, FileIconFont, RefLabel } from '../../src/shared/protocol';
import { ChevronDown, SearchIcon } from './icons';

/** A branch or tag label; `color` tints a local branch like its graph lane. */
export function RefBadge({ refLabel, color }: { refLabel: RefLabel; color?: string }) {
	const text = refLabel.kind === 'head' && refLabel.name !== 'HEAD' ? `HEAD → ${refLabel.name}` : refLabel.name;
	const style = color && refLabel.kind === 'local' ? { borderColor: color, color } : undefined;
	return <span class={`ref ref-${refLabel.kind}`} style={style} title={text}>{text}</span>;
}

export function StatusLetter({ status }: { status: string }) {
	return <span class={`st st-${status}`}>{status}</span>;
}

export function SearchInput(props: {
	id: string;
	label: string;
	placeholder: string;
	value: string;
	onInput: (value: string) => void;
	onKeyDown?: (event: KeyboardEvent) => void;
	autoFocus?: boolean;
	className?: string;
}) {
	const input = useRef<HTMLInputElement>(null);
	// `autofocus` only works on page load; this also covers inputs shown later (a tab, a popup),
	// before the next paint, so no key typed right away is lost.
	useLayoutEffect(() => {
		if (props.autoFocus) {
			input.current?.focus();
		}
	}, []);
	return (
		<span class={`search ${props.className ?? ''}`}>
			<label class="sr-only" for={props.id}>{props.label}</label>
			<span class="search-icon"><SearchIcon size={13} /></span>
			<input
				ref={input}
				id={props.id}
				class="input"
				type="text"
				placeholder={props.placeholder}
				value={props.value}
				onInput={e => props.onInput((e.target as HTMLInputElement).value)}
				onKeyDown={props.onKeyDown}
			/>
		</span>
	);
}

const fontFamily = (id: string) => `gitstorm-icons-${id.replace(/[^\w-]/g, '_')}`;

/** The @font-face rules of the file icon theme. */
export function IconFonts({ fonts }: { fonts: readonly FileIconFont[] }) {
	const css = fonts
		.map(font => `@font-face { font-family: "${fontFamily(font.id)}"; src: url("${font.src}")${font.format ? ` format("${font.format}")` : ''}; font-weight: ${font.weight ?? 'normal'}; font-style: ${font.style ?? 'normal'}; }`)
		.join('\n');
	return <style>{css}</style>;
}

/** A file icon of the icon theme; the codicon `fallback`, if given, when the theme has none. */
export function IconView({ icon, fallback }: { icon?: FileIcon; fallback?: string }) {
	if (!icon) {
		return fallback ? <span class="file-icon"><i class={`codicon codicon-${fallback}`} aria-hidden="true" /></span> : null;
	}
	if (icon.kind === 'image') {
		return <span class="file-icon"><img src={icon.src} alt="" /></span>;
	}
	return <span class="file-icon glyph" style={{ fontFamily: fontFamily(icon.font), color: icon.color, fontSize: icon.size }}>{icon.char}</span>;
}

export interface MenuItem {
	readonly label: string;
	readonly checked?: boolean;
	readonly danger?: boolean;
	readonly separator?: boolean;
	readonly onSelect?: () => void;
}

/**
 * The open popup of the button in `root`: placed in the window next to it, not
 * in its pane, so no pane that scrolls or clips its content hides it; closes
 * on a click outside or Escape.
 */
export function usePopup<P extends HTMLElement>(open: boolean, close: () => void, align: 'left' | 'right' = 'left') {
	const root = useRef<HTMLSpanElement>(null);
	const popup = useRef<P>(null);
	useLayoutEffect(() => {
		const anchor = root.current;
		const element = popup.current;
		if (!open || !anchor || !element) {
			return;
		}
		// Measured in the window's corner, where nothing squeezes it.
		Object.assign(element.style, { left: '0px', top: '0px', maxWidth: '', maxHeight: '' });
		const measured = element.getBoundingClientRect();
		const size = { width: Math.ceil(measured.width), height: Math.ceil(measured.height) };
		const place = (event?: Event) => {
			// Scrolling the popup's own list moves nothing.
			if (event?.target instanceof Node && element.contains(event.target)) {
				return;
			}
			const spot = placePopup(anchor.getBoundingClientRect(), size, { width: window.innerWidth, height: window.innerHeight }, align);
			Object.assign(element.style, { left: `${spot.left}px`, top: `${spot.top}px`, maxWidth: `${spot.maxWidth}px`, maxHeight: `${spot.maxHeight}px` });
		};
		place();
		window.addEventListener('resize', place);
		document.addEventListener('scroll', place, true);
		return () => {
			window.removeEventListener('resize', place);
			document.removeEventListener('scroll', place, true);
		};
	}, [open, align]);
	useEffect(() => {
		if (!open) {
			return;
		}
		const onEvent = (event: Event) => {
			if (event instanceof KeyboardEvent ? event.key === 'Escape' : !root.current?.contains(event.target as Node)) {
				close();
			}
		};
		document.addEventListener('mousedown', onEvent);
		document.addEventListener('keydown', onEvent);
		return () => {
			document.removeEventListener('mousedown', onEvent);
			document.removeEventListener('keydown', onEvent);
		};
	}, [open]);
	return { root, popup };
}

/** A button with a popup list; closes on outside click, Escape or a choice. */
export function Dropdown(props: { label: ComponentChildren; items: readonly MenuItem[]; className?: string; ariaLabel?: string; align?: 'left' | 'right'; caret?: boolean }) {
	const [open, setOpen] = useState(false);
	const { root, popup } = usePopup<HTMLDivElement>(open, () => setOpen(false), props.align);
	return (
		<span class="dropdown" ref={root}>
			<button class={props.className ?? 'btn'} aria-label={props.ariaLabel} aria-expanded={open} onClick={() => setOpen(!open)}>
				{props.label}
				{props.caret !== false && <ChevronDown size={12} />}
			</button>
			{open && (
				<div class="menu" role="menu" ref={popup}>
					{props.items.map((item, i) =>
						item.separator ? (
							<div key={i} class="menu-sep" />
						) : (
							<button
								key={i}
								role="menuitem"
								class={`menu-item ${item.danger ? 'danger' : ''}`}
								onClick={() => {
									setOpen(false);
									item.onSelect?.();
								}}
							>
								<span class="menu-check">{item.checked ? '✓' : ''}</span>
								<span class="grow ellipsis">{item.label}</span>
							</button>
						),
					)}
				</div>
			)}
		</span>
	);
}

export function Empty({ title, hint }: { title: string; hint?: string }) {
	return (
		<div class="empty">
			<div class="empty-title">{title}</div>
			{hint && <div>{hint}</div>}
		</div>
	);
}

export function splitPath(path: string): { name: string; dir: string } {
	const slash = path.lastIndexOf('/');
	return slash < 0 ? { name: path, dir: '' } : { name: path.slice(slash + 1), dir: path.slice(0, slash) };
}

/** One changed file: status, name, folder, +added −deleted. */
export function FileRow(props: { file: FileChange; onOpen: () => void; indent?: number; selected?: boolean }) {
	const { name, dir } = splitPath(props.file.path);
	return (
		<button class={`row file-row ${props.selected ? 'sel' : ''}`} style={{ paddingLeft: `${12 + (props.indent ?? 0)}px` }} onClick={props.onOpen} title={props.file.oldPath ? `${props.file.oldPath} → ${props.file.path}` : props.file.path}>
			<StatusLetter status={props.file.status} />
			<span class="file-name">{name}</span>
			<span class="grow ellipsis faint small">{props.indent === undefined ? dir : ''}</span>
			{props.file.added !== undefined && <span class="mono small add">+{props.file.added}</span>}
			{props.file.deleted !== undefined && <span class="mono small del">−{props.file.deleted}</span>}
			{props.file.added === undefined && <span class="mono small muted">bin</span>}
		</button>
	);
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "18 Sep 14:02", with the year when it is not this year. */
export function formatDate(ms: number): string {
	const date = new Date(ms);
	const pad = (n: number) => String(n).padStart(2, '0');
	const year = date.getFullYear() === new Date().getFullYear() ? '' : ` ${date.getFullYear()}`;
	return `${pad(date.getDate())} ${MONTHS[date.getMonth()]}${year} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function initials(name: string): string {
	const parts = name.trim().split(/\s+/);
	return ((parts[0]?.[0] ?? '') + (parts[1]?.[0] ?? '')).toUpperCase() || '?';
}

export function shortHash(hash: string): string {
	return hash.slice(0, 7);
}

export type Children = JSX.Element | JSX.Element[] | string | null | false;
