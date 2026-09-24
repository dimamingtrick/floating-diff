import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { CommitDetails, FileChange, LogAction, LogData, LogFilters, LogFromWebview, LogRow, LogToWebview, PathItem } from '../../src/shared/protocol';
import { buildFileTree, visibleRows } from '../../src/shared/fileTree';
import { Dropdown, Empty, FileRow, formatDate, IconView, initials, RefBadge, SearchInput, shortHash, usePopup } from '../common/components';
import { BranchIcon, ChevronDown, CopyIcon, FolderIcon, ListIcon, MoreIcon, RefreshIcon, TreeIcon } from '../common/icons';
import { post, useRendered } from '../common/vscode';
import { DotCell, GraphCell, graphWidth, laneColor } from './graph';

export const send = (message: LogFromWebview) => post(message);

const SINCE_LABELS = { day: 'Last 24 hours', week: 'Last 7 days', month: 'Last 30 days' } as const;

/** What the extension found for the Paths filter's search. */
export interface PathResults {
	readonly query: string;
	readonly items: readonly PathItem[];
}

const baseName = (file: string) => file.slice(file.lastIndexOf('/') + 1);

/** `text` with the part that matches `word` (in lower case) marked, like Quick Open. */
function Marked({ text, word }: { text: string; word: string }) {
	const at = word ? text.toLowerCase().indexOf(word) : -1;
	if (at < 0) {
		return <>{text}</>;
	}
	return <>{text.slice(0, at)}<mark>{text.slice(at, at + word.length)}</mark>{text.slice(at + word.length)}</>;
}

/**
 * The Paths filter, like WebStorm's: search the files and folders of the
 * repository as in Quick Open, tick one or more, and the log keeps the commits
 * that change them. Enter takes the highlighted one too.
 */
function PathsFilter(props: { paths?: readonly string[]; results?: PathResults; apply: (paths: readonly string[]) => void }) {
	const [open, setOpen] = useState(false);
	const popup = usePopup<HTMLDivElement>(open, () => setOpen(false));
	const [query, setQuery] = useState('');
	const [picked, setPicked] = useState<readonly string[]>([]);
	const [active, setActive] = useState(0);
	const list = useRef<HTMLDivElement>(null);
	const typing = useRef<ReturnType<typeof setTimeout>>();
	// Icons and kinds of the paths found so far, for the ticked ones.
	const known = useRef(new Map<string, PathItem>());
	props.results?.items.forEach(item => known.current.set(item.path, item));
	useEffect(() => {
		list.current?.querySelector('.paths-row.active')?.scrollIntoView({ block: 'nearest' });
	}, [active]);

	const typed = query.trim();
	const words = typed.toLowerCase().split(/\s+/);
	const found = typed ? (props.results?.query.trim() ? props.results.items : []) : picked.map(item => known.current.get(item) ?? { path: item });
	// A path that is not in the working tree any more, like a deleted file, can be typed.
	const asPath = /[/.]/.test(typed) && !/\s/.test(typed) && !found.some(item => item.path === typed);
	const rows: { readonly item: PathItem; readonly typed?: boolean }[] = [...found.map(item => ({ item })), ...(asPath ? [{ item: { path: typed }, typed: true }] : [])];

	const toggleOpen = () => {
		if (!open) {
			setQuery('');
			setPicked(props.paths ?? []);
			setActive(0);
			send({ type: 'searchPaths', query: '' });
		}
		setOpen(!open);
	};
	const search = (value: string) => {
		setQuery(value);
		setActive(0);
		clearTimeout(typing.current);
		typing.current = setTimeout(() => send({ type: 'searchPaths', query: value }), 120);
	};
	const toggle = (file: string) => setPicked(picked.includes(file) ? picked.filter(item => item !== file) : [...picked, file]);
	const apply = (paths: readonly string[]) => {
		setOpen(false);
		props.apply(paths);
	};
	const onKeyDown = (event: KeyboardEvent) => {
		if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
			event.preventDefault();
			setActive(Math.max(0, Math.min(rows.length - 1, active + (event.key === 'ArrowDown' ? 1 : -1))));
		} else if (event.key === 'Enter') {
			event.preventDefault();
			const row = typed ? rows[active] : undefined;
			apply(row && !picked.includes(row.item.path) ? [...picked, row.item.path] : picked);
		}
	};

	const count = props.paths?.length ?? 0;
	return (
		<span class="dropdown" ref={popup.root}>
			<button class={`chip ${count ? 'on' : ''}`} aria-expanded={open} title={props.paths?.join('\n')} onClick={toggleOpen}>
				<span class="ellipsis">{props.paths && count ? `Paths: ${baseName(props.paths[0])}${count > 1 ? ` +${count - 1}` : ''}` : 'Paths'}</span>
				<ChevronDown size={12} />
			</button>
			{open && (
				<div class="paths-pop" ref={popup.popup} role="dialog" aria-label="Filter by files and folders">
					<SearchInput id="paths-search" label="Search files and folders" placeholder="Search files and folders…" value={query} onInput={search} onKeyDown={onKeyDown} autoFocus />
					<div class="paths-list" ref={list} role="listbox" aria-multiselectable="true">
						{rows.map(({ item, typed: asTyped }, i) => {
							const checked = picked.includes(item.path);
							const slash = item.path.lastIndexOf('/');
							return (
								<div
									key={`${asTyped ? 'typed' : 'found'}:${item.path}`}
									class={`paths-row ${i === active ? 'active' : ''}`}
									role="option"
									aria-selected={checked}
									title={item.path}
									// The focus stays in the search field.
									onMouseDown={event => event.preventDefault()}
									onMouseEnter={() => setActive(i)}
									onClick={() => toggle(item.path)}
								>
									<span class={`paths-check ${checked ? 'on' : ''}`}>{checked && <i class="codicon codicon-check" aria-hidden="true" />}</span>
									<IconView icon={item.icon} fallback={item.folder ? 'folder' : 'file'} />
									<span class="paths-name"><Marked text={asTyped ? item.path : item.path.slice(slash + 1)} word={words[words.length - 1]} /></span>
									<span class="paths-dir">{asTyped ? 'as typed' : item.path.slice(0, Math.max(0, slash))}</span>
								</div>
							);
						})}
						{rows.length === 0 && <div class="paths-hint">{typed ? 'No files match.' : 'Type to search the files and folders of the repository.'}</div>}
					</div>
					<div class="paths-foot">
						<span class="grow">{picked.length ? `${picked.length} selected` : 'Tick one or more'}</span>
						<button class="btn" onClick={() => apply([])}>Clear</button>
						<button class="btn primary" onClick={() => apply(picked)}>Apply</button>
					</div>
				</div>
			)}
		</span>
	);
}

export function Toolbar(props: { data: LogData; paths?: PathResults }) {
	const { data } = props;
	const filters = data.filters;
	const setFilters = (change: Partial<LogFilters>) => send({ type: 'filters', filters: { ...filters, ...change } });
	// Git searches the whole history, so typing waits a moment before asking it.
	const [text, setText] = useState(filters.text ?? '');
	const typing = useRef<ReturnType<typeof setTimeout>>();
	useEffect(() => setText(filters.text ?? ''), [filters.text]);
	const search = (value: string) => {
		setText(value);
		clearTimeout(typing.current);
		typing.current = setTimeout(() => setFilters({ text: value.trim() || undefined }), 350);
	};

	const branchItems = [
		{ label: 'All branches', checked: !filters.branch, onSelect: () => setFilters({ branch: undefined }) },
		...(data.branches.local.length ? [{ label: '', separator: true }] : []),
		...data.branches.local.map(name => ({ label: name, checked: filters.branch === name, onSelect: () => setFilters({ branch: name }) })),
		...(data.branches.remote.length ? [{ label: '', separator: true }] : []),
		...data.branches.remote.map(name => ({ label: name, checked: filters.branch === name, onSelect: () => setFilters({ branch: name }) })),
	];
	const authorItems = [
		{ label: 'All users', checked: !filters.author, onSelect: () => setFilters({ author: undefined }) },
		{ label: '', separator: true },
		...data.authors.map(name => ({ label: name, checked: filters.author === name, onSelect: () => setFilters({ author: name }) })),
	];
	const sinceItems = [
		{ label: 'Any time', checked: !filters.since, onSelect: () => setFilters({ since: undefined }) },
		...(Object.keys(SINCE_LABELS) as (keyof typeof SINCE_LABELS)[]).map(key => ({ label: SINCE_LABELS[key], checked: filters.since === key, onSelect: () => setFilters({ since: key }) })),
	];

	return (
		<div class="toolbar">
			<Dropdown
				className={`chip ${filters.branch ? 'on' : ''}`}
				label={<><BranchIcon size={13} /><span class="ellipsis">Branch: {filters.branch ?? 'All branches'}</span></>}
				items={branchItems}
			/>
			<Dropdown className={`chip ${filters.author ? 'on' : ''}`} label={<span class="ellipsis">User: {filters.author ?? 'all'}</span>} items={authorItems} />
			<Dropdown className={`chip ${filters.since ? 'on' : ''}`} label={<span>Date: {filters.since ? SINCE_LABELS[filters.since] : 'all'}</span>} items={sinceItems} />
			<PathsFilter paths={filters.paths} results={props.paths} apply={paths => setFilters({ paths: paths.length > 0 ? paths : undefined })} />
			<SearchInput id="log-search" label="Search commits" placeholder="Search by message or hash…" value={text} onInput={search} />
			<span class="grow" />
			<span class="small muted count">{data.rows.length} of {data.total} commits</span>
			<button class="icon-btn" aria-label="Refresh" title="Refresh" onClick={() => send({ type: 'refresh' })}><RefreshIcon /></button>
		</div>
	);
}

export function CommitTable(props: { data: LogData; rows: readonly LogRow[]; selected?: string; onSelect: (hash: string) => void; searching: boolean }) {
	const body = useRef<HTMLDivElement>(null);
	const { rows, selected } = props;
	const index = rows.findIndex(row => row.hash === selected);
	useEffect(() => {
		body.current?.querySelector('.crow.sel')?.scrollIntoView({ block: 'nearest' });
	}, [selected]);
	const onKeyDown = (e: KeyboardEvent) => {
		const next = e.key === 'ArrowDown' ? index + 1 : e.key === 'ArrowUp' ? index - 1 : -1;
		if (next >= 0 && next < rows.length) {
			e.preventDefault();
			props.onSelect(rows[next].hash);
		} else if (e.key === 'Enter' && selected) {
			send({ type: 'openCommit', hash: selected });
		}
	};
	const lanes = props.searching ? 1 : props.data.graphWidth;
	// Scrolling near the end asks for the next page, once per page.
	const loading = useRef(false);
	useEffect(() => {
		loading.current = false;
		// Pages are short: keep loading while the list does not fill its height.
		const list = body.current;
		if (list && props.data.canLoadMore && list.scrollHeight <= list.clientHeight + 26) {
			loading.current = true;
			send({ type: 'loadMore' });
		}
	}, [props.data]);
	const onScroll = (e: Event) => {
		const list = e.currentTarget as HTMLElement;
		if (props.data.canLoadMore && !loading.current && list.scrollTop + list.clientHeight >= list.scrollHeight - 300) {
			loading.current = true;
			send({ type: 'loadMore' });
		}
	};
	return (
		<div class="table">
			<div class="thead">
				<span style={{ width: `${graphWidth(lanes)}px`, flexShrink: 0 }} />
				<span class="grow">Commit</span>
				<span class="th-author" style={{ width: '120px', paddingLeft: '8px' }}>Author</span>
				<span style={{ width: '104px', textAlign: 'right' }}>Date</span>
			</div>
			<div class="tbody" ref={body} tabIndex={0} onKeyDown={onKeyDown} onScroll={onScroll} aria-label="Commits">
				{rows.map(row => (
					<button
						key={row.hash}
						class={`crow ${row.hash === selected ? 'sel' : ''}`}
						onClick={() => props.onSelect(row.hash)}
						onDblClick={() => send({ type: 'openCommit', hash: row.hash })}
						// VS Code's context menu with the commit actions (webview/context), like WebStorm's.
						onContextMenu={() => props.onSelect(row.hash)}
						data-vscode-context={JSON.stringify({ webviewSection: 'commit', hash: row.hash, preventDefaultContextMenuItems: true })}
						title={`${shortHash(row.hash)} ${row.subject}`}
					>
						{props.searching ? (
							<DotCell color={row.graph.color} />
						) : (
							<GraphCell row={row.graph} lanes={lanes} ring={row.parents.length > 1 || row.refs.some(r => r.kind === 'head')} />
						)}
						<span class="subject">
							{row.refs.map(ref => <RefBadge key={`${ref.kind}:${ref.name}`} refLabel={ref} color={laneColor(row.graph.color)} />)}
							<span class="subject-text">{row.subject}</span>
						</span>
						<span class="author">{row.author}</span>
						<span class="date">{formatDate(row.date)}</span>
					</button>
				))}
				{rows.length === 0 && <Empty title="No commits match the current filters" hint='Clear the search box or pick "All branches".' />}
				{props.data.canLoadMore && (
					<div class="load-more"><button class="btn" onClick={() => send({ type: 'loadMore' })}>Load more</button></div>
				)}
			</div>
		</div>
	);
}

export function FileList(props: { details: CommitDetails; asTree: boolean }) {
	const { details } = props;
	const open = (file: FileChange) => send({ type: 'openFile', hash: details.hash, file });
	// ⌘↓, like WebStorm's Jump to Source: the file itself in an editor.
	const source = (file: FileChange) => send({ type: 'openSource', hash: details.hash, file });
	if (!props.asTree) {
		return <>{details.files.map(file => <FileRow key={file.path} file={file} onOpen={() => open(file)} onSource={() => source(file)} />)}</>;
	}
	const byPath = new Map(details.files.map(file => [file.path, file] as const));
	return (
		<>
			{visibleRows(buildFileTree(details.files.map(file => file.path)), new Set()).map(({ node, depth }) =>
				node.isDir ? (
					<div key={node.path} class="row faint" style={{ paddingLeft: `${12 + depth * 14}px`, cursor: 'default' }}>
						<FolderIcon size={13} />
						<span class="ellipsis">{node.name}</span>
					</div>
				) : (
					<FileRow key={node.path} file={byPath.get(node.path)!} indent={depth * 14} onOpen={() => open(byPath.get(node.path)!)} onSource={() => source(byPath.get(node.path)!)} />
				),
			)}
		</>
	);
}

export function Details(props: { row?: LogRow; details?: CommitDetails; asTree: boolean; setAsTree: (tree: boolean) => void }) {
	const { row, details } = props;
	if (!row) {
		return <div class="details"><Empty title="Select a commit" /></div>;
	}
	const current = details?.hash === row.hash ? details : undefined;
	const action = (name: LogAction) => send({ type: 'action', action: name, hash: row.hash });
	return (
		<div class="details">
			<div class="details-head">
				<div class="details-subject">{row.subject}</div>
				<div class="details-body">{current ? current.body || 'No extended description.' : ' '}</div>
				<div class="details-meta">
					<span class="hash" title={row.hash}>{shortHash(row.hash)}</span>
					<button class="icon-btn" aria-label="Copy hash" title="Copy hash" onClick={() => action('copyHash')}><CopyIcon size={13} /></button>
					{row.refs.map(ref => <RefBadge key={`${ref.kind}:${ref.name}`} refLabel={ref} color={laneColor(row.graph.color)} />)}
				</div>
				<div class="author-line">
					<span class="avatar">{initials(row.author)}</span>
					<span>{row.author} committed on {formatDate(row.date)}</span>
				</div>
			</div>
			<div class="files-head">
				<span class="grow">Changed files ({current?.files.length ?? '…'})</span>
				<button class={`icon-btn ${props.asTree ? 'on' : ''}`} aria-label="Show as tree" title="Show as tree" onClick={() => props.setAsTree(true)}><TreeIcon /></button>
				<button class={`icon-btn ${props.asTree ? '' : 'on'}`} aria-label="Show as list" title="Show as list" onClick={() => props.setAsTree(false)}><ListIcon /></button>
			</div>
			<div class="fill scroll">{current && <FileList details={current} asTree={props.asTree} />}</div>
			<div class="details-actions">
				<button class="btn primary" onClick={() => send({ type: 'openCommit', hash: row.hash })}>Open diff</button>
				<button class="btn" onClick={() => action('cherryPick')}>Cherry-pick</button>
				<button class="btn" onClick={() => action('revert')}>Revert</button>
				<span class="grow" />
				<Dropdown
					className="icon-btn"
					ariaLabel="More commit actions"
					caret={false}
					align="right"
					label={<MoreIcon />}
					items={[
						{ label: 'Copy hash', onSelect: () => action('copyHash') },
						{ label: 'Checkout this commit', onSelect: () => action('checkout') },
						{ label: 'Merge into current branch', onSelect: () => action('merge') },
						{ label: 'Rebase current branch onto this commit', onSelect: () => action('rebase') },
						{ label: 'New branch from here…', onSelect: () => action('newBranch') },
					]}
				/>
			</div>
		</div>
	);
}

/** What a log view keeps: the rows (searched), the selected commit and its details. */
/**
 * Back on the row the diff window was opened from — the file of the commit, else
 * the commit itself — so the keyboard keeps working where the user left off.
 */
export function focusSelectedRow(): void {
	const row = document.querySelector<HTMLElement>('.gp-file.sel') ?? document.querySelector<HTMLElement>('.crow.sel');
	row?.focus();
}

export function useLogState() {
	const [data, setData] = useState<LogData>();
	const [details, setDetails] = useState<CommitDetails>();
	const [busy, setBusy] = useState(true);
	const [selected, setSelected] = useState<string>();
	const [paths, setPaths] = useState<PathResults>();

	const onMessage = (message: LogToWebview) => {
		if (message.type === 'log') {
			setData(message.data);
			setSelected(message.data.selected);
			setBusy(false);
		} else if (message.type === 'details') {
			setDetails(message.details);
		} else if (message.type === 'paths') {
			setPaths({ query: message.query, items: message.items });
		} else if (message.type === 'focus') {
			focusSelectedRow();
		} else {
			setBusy(message.busy);
		}
	};

	const rows = data?.rows ?? [];
	// Found by a search: not neighbors in history, so no graph lines.
	const searching = Boolean(data?.filters.text);
	useRendered('log', data ? rows.length : undefined, data);
	useRendered('details', details?.files.length, details);

	const select = (hash: string) => {
		setSelected(hash);
		send({ type: 'select', hash });
	};
	const row = data?.rows.find(candidate => candidate.hash === selected);
	return { data, details: details?.hash === selected ? details : undefined, busy, selected, row, rows, searching, paths, select, onMessage };
}
