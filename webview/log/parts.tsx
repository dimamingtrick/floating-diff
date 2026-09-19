import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { CommitDetails, FileChange, LogAction, LogData, LogFilters, LogFromWebview, LogRow, LogToWebview } from '../../src/shared/protocol';
import { buildFileTree, visibleRows } from '../../src/shared/fileTree';
import { Dropdown, Empty, FileRow, formatDate, initials, RefBadge, SearchInput, shortHash, usePopup } from '../common/components';
import { BranchIcon, ChevronDown, CopyIcon, FolderIcon, ListIcon, MoreIcon, RefreshIcon, TreeIcon } from '../common/icons';
import { post, useRendered } from '../common/vscode';
import { DotCell, GraphCell, graphWidth, laneColor } from './graph';

export const send = (message: LogFromWebview) => post(message);

const SINCE_LABELS = { day: 'Last 24 hours', week: 'Last 7 days', month: 'Last 30 days' } as const;

export function Toolbar(props: { data: LogData }) {
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
	const [pathOpen, setPathOpen] = useState(false);
	const pathPopup = usePopup<HTMLFormElement>(pathOpen, () => setPathOpen(false));
	const [pathDraft, setPathDraft] = useState(filters.path ?? '');
	useEffect(() => setPathDraft(filters.path ?? ''), [filters.path]);

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
			<span class="dropdown" ref={pathPopup.root}>
				<button class={`chip ${filters.path ? 'on' : ''}`} aria-expanded={pathOpen} onClick={() => setPathOpen(!pathOpen)}>
					<span class="ellipsis">{filters.path ? `Path: ${filters.path}` : 'Paths'}</span>
					<ChevronDown size={12} />
				</button>
				{pathOpen && (
					<form
						class="path-pop"
						ref={pathPopup.popup}
						onSubmit={e => {
							e.preventDefault();
							setPathOpen(false);
							setFilters({ path: pathDraft.trim() || undefined });
						}}
					>
						<label class="sr-only" for="path-filter">Filter by path</label>
						<input id="path-filter" class="input" autoFocus placeholder="src/checkout or package.json — Enter to apply" value={pathDraft} onInput={e => setPathDraft((e.target as HTMLInputElement).value)} />
						<div class="hstack" style={{ marginTop: '8px', justifyContent: 'flex-end' }}>
							<button type="button" class="btn" onClick={() => { setPathDraft(''); setPathOpen(false); setFilters({ path: undefined }); }}>Clear</button>
							<button type="submit" class="btn primary">Apply</button>
						</div>
					</form>
				)}
			</span>
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
	if (!props.asTree) {
		return <>{details.files.map(file => <FileRow key={file.path} file={file} onOpen={() => open(file)} />)}</>;
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
					<FileRow key={node.path} file={byPath.get(node.path)!} indent={depth * 14} onOpen={() => open(byPath.get(node.path)!)} />
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
export function useLogState() {
	const [data, setData] = useState<LogData>();
	const [details, setDetails] = useState<CommitDetails>();
	const [busy, setBusy] = useState(true);
	const [selected, setSelected] = useState<string>();

	const onMessage = (message: LogToWebview) => {
		if (message.type === 'log') {
			setData(message.data);
			setSelected(message.data.selected);
			setBusy(false);
		} else if (message.type === 'details') {
			setDetails(message.details);
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
	return { data, details: details?.hash === selected ? details : undefined, busy, selected, row, rows, searching, select, onMessage };
}
