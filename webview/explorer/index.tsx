import { render, type JSX } from 'preact';
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { ExplorerCommit, ExplorerData, ExplorerFromWebview, ExplorerInfo, ExplorerToWebview, FilePreview, GrepHit, SearchOptions } from '../../src/shared/protocol';
import { buildFileTree, filterPaths, visibleRows } from '../../src/shared/fileTree';
import { Empty, formatDate, SearchInput, shortHash, splitPath, StatusLetter } from '../common/components';
import { BranchIcon, ChevronDown, ChevronRight, CloudIcon, CompareIcon, EyeIcon, FileIcon, FolderIcon } from '../common/icons';
import { post, useMessages, useRendered } from '../common/vscode';

const send = (message: ExplorerFromWebview) => post(message);

/** Rendering more rows or lines than this makes the page sluggish. */
const MAX_TREE_ROWS = 3000;
const MAX_PREVIEW_LINES = 5000;
const MAX_HITS = 1000;

type Tab = 'files' | 'commits' | 'search';
const TABS: readonly (readonly [Tab, string])[] = [
	['search', 'Search in branch'],
	['files', 'Files'],
	['commits', 'Commits'],
];
interface SearchResult {
	readonly query: string;
	readonly hits: readonly GrepHit[];
	readonly error?: string;
}

function Header({ info }: { info: ExplorerInfo }) {
	return (
		<div class="x-head">
			<span class="x-branch-icon">{info.remote ? <CloudIcon size={16} /> : <BranchIcon size={16} />}</span>
			<div class="x-head-text">
				<div class="x-title">
					<span class="ellipsis">{info.branch}</span>
					<span class="readonly-chip">read-only</span>
				</div>
				<div class="x-meta" title={info.tip.subject}>
					{info.ahead} commits ahead · {info.behind} behind <b>{info.current}</b> · tip {shortHash(info.tip.hash)} · {info.tip.author}, {formatDate(info.tip.date)} · you stay on <b>{info.current}</b>, nothing is checked out
				</div>
			</div>
			<span class="grow" />
			<button class="btn" onClick={() => send({ type: 'openFullDiff' })}>
				<CompareIcon size={13} />
				Compare with {info.current}
			</button>
			<button class="btn" onClick={() => send({ type: 'cherryPick' })}>Cherry-pick…</button>
			<button class="btn primary" onClick={() => send({ type: 'checkout' })}>Checkout</button>
		</div>
	);
}

/** Large trees start with every folder collapsed. */
function initiallyCollapsed(files: readonly string[]): Set<string> {
	const collapsed = new Set<string>();
	if (files.length > 200) {
		for (const file of files) {
			for (let slash = file.indexOf('/'); slash > 0; slash = file.indexOf('/', slash + 1)) {
				collapsed.add(file.slice(0, slash));
			}
		}
	}
	return collapsed;
}

function FileTree({ data, selected, onOpen }: { data: ExplorerData; selected?: string; onOpen: (path: string) => void }) {
	const [filter, setFilter] = useState('');
	const [collapsed, setCollapsed] = useState(() => initiallyCollapsed(data.files));
	const status = useMemo(() => new Map(data.diff.map(file => [file.path, file.status] as const)), [data.diff]);
	const paths = useMemo(() => filterPaths(data.files, filter), [data.files, filter]);
	const filtering = filter.trim() !== '';
	// While filtering: matching files with their full paths, no folders.
	const rows = useMemo(
		() => (filtering ? paths.map(path => ({ node: { name: path, path, isDir: false, children: [] }, depth: 0 })) : visibleRows(buildFileTree(paths), collapsed)),
		[paths, collapsed, filtering],
	);
	const toggle = (path: string) => {
		const next = new Set(collapsed);
		if (!next.delete(path)) {
			next.add(path);
		}
		setCollapsed(next);
	};
	return (
		<div class="x-tree">
			<div class="pad">
				<SearchInput id="file-filter" label="Filter files" placeholder="Filter files in this branch…" value={filter} onInput={setFilter} />
			</div>
			<div class="section-title" style={{ cursor: 'default' }}>
				Files at {shortHash(data.info.tip.hash)}
				<span class="count">{paths.length}</span>
			</div>
			<div class="fill scroll" role="tree" aria-label={`Files at ${data.info.branch}`}>
				{rows.slice(0, MAX_TREE_ROWS).map(({ node, depth }) => {
					if (node.isDir) {
						const open = filtering || !collapsed.has(node.path);
						return (
							<button key={node.path} class="row" role="treeitem" aria-expanded={open} style={{ paddingLeft: `${6 + depth * 14}px` }} onClick={() => toggle(node.path)}>
								{open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
								<span class="ic-dir"><FolderIcon size={14} /></span>
								<span class="grow ellipsis">{node.name}</span>
							</button>
						);
					}
					const change = status.get(node.path);
					return (
						<button key={node.path} class={`row ${node.path === selected ? 'sel' : ''}`} role="treeitem" style={{ paddingLeft: `${filtering ? 12 : 25 + depth * 14}px` }} onClick={() => onOpen(node.path)} title={node.path}>
							<span class="ic-file"><FileIcon size={14} /></span>
							<span class="grow ellipsis">{node.name}</span>
							{change && <StatusLetter status={change} />}
						</button>
					);
				})}
				{rows.length > MAX_TREE_ROWS && <div class="empty">Showing the first {MAX_TREE_ROWS} rows. Filter to find a file.</div>}
				{paths.length === 0 && <Empty title="No files match the filter" />}
			</div>
		</div>
	);
}

function lineCount(file: FilePreview): number {
	if (file.text === undefined) {
		return 0;
	}
	const lines = file.text.split('\n');
	return lines[lines.length - 1] === '' ? lines.length - 1 : lines.length;
}

function Code({ file }: { file: FilePreview }) {
	const root = useRef<HTMLDivElement>(null);
	const lines = useMemo(() => (file.text ?? '').split('\n').slice(0, lineCount(file)), [file]);
	useEffect(() => {
		const line = root.current?.querySelector('.code-line.hl');
		if (line) {
			line.scrollIntoView({ block: 'center' });
		} else {
			root.current?.scrollTo(0, 0);
		}
	}, [file]);
	return (
		<div class="code" ref={root}>
			{lines.slice(0, MAX_PREVIEW_LINES).map((text, i) => (
				<div key={i} class={`code-line ${i + 1 === file.line ? 'hl' : ''}`}>
					<span class="ln">{i + 1}</span>
					<span>{text || ' '}</span>
				</div>
			))}
			{lines.length > MAX_PREVIEW_LINES && <div class="empty">Showing the first {MAX_PREVIEW_LINES} of {lines.length} lines. Use “Diff with my copy” to see the whole file.</div>}
		</div>
	);
}

function FilePane({ info, path, file }: { info: ExplorerInfo; path?: string; file?: FilePreview }) {
	if (!path) {
		return <Empty title="Select a file on the left" hint="Files are read straight from the branch — your working tree is untouched." />;
	}
	const current = file?.path === path ? file : undefined;
	return (
		<>
			<div class="banner">
				<EyeIcon size={13} />
				<span class="grow ellipsis">
					Read-only preview of <span class="mono">{path}</span> at {info.branch} — your working tree is untouched.
				</span>
				<button class="btn" onClick={() => send({ type: 'diffWithMine', path })}>Diff with my copy</button>
				<button class="btn" onClick={() => send({ type: 'copyToWorkingTree', path })}>Copy to working tree</button>
			</div>
			{!current ? (
				<div class="code" />
			) : current.missing ? (
				<Empty title={`${path} does not exist at ${info.branch}`} />
			) : current.binary ? (
				<Empty title="Binary file" hint="There is no text preview for binary files." />
			) : current.tooLarge ? (
				<Empty title="The file is larger than 1 MB" hint="Use “Diff with my copy” to open it in the editor." />
			) : (
				<Code file={current} />
			)}
		</>
	);
}

function CommitList({ info, commits }: { info: ExplorerInfo; commits: readonly ExplorerCommit[] }) {
	if (commits.length === 0) {
		return <Empty title={`${info.branch} has no commits`} />;
	}
	return (
		<div class="fill scroll" style={{ paddingTop: '4px' }}>
			{commits.map((commit, i) => (
				<button key={commit.hash} class={`row commit-row ${commit.ahead ? 'ahead' : ''}`} onClick={() => send({ type: 'openCommit', commit })} title={`${commit.subject} — open its changes`}>
					<span class="commit-graph">
						<span class={`line ${i === 0 ? 'first' : ''} ${i === commits.length - 1 ? 'last' : ''}`} />
						<span class="dot" />
					</span>
					{commit.ahead && <span class="ahead-chip">not in {info.current}</span>}
					<span class="grow ellipsis">{commit.subject}</span>
					<span class="c-hash mono">{shortHash(commit.hash)}</span>
					<span class="c-author ellipsis">{commit.author}</span>
					<span class="c-date">{formatDate(commit.date)}</span>
				</button>
			))}
		</div>
	);
}

/** The same matches git found, for highlighting (JS and git regular expressions mostly agree). */
function matcher(query: string, options: SearchOptions): RegExp | undefined {
	if (!query) {
		return undefined;
	}
	const source = options.regex ? query : query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
	try {
		return new RegExp(options.wholeWord ? `\\b(?:${source})\\b` : source, options.matchCase ? 'g' : 'gi');
	} catch {
		return undefined;
	}
}

function Highlight({ text, pattern }: { text: string; pattern?: RegExp }) {
	if (!pattern) {
		return <>{text}</>;
	}
	const parts: (string | JSX.Element)[] = [];
	let last = 0;
	for (const match of text.matchAll(pattern)) {
		if (!match[0]) {
			break;
		}
		parts.push(text.slice(last, match.index), <mark key={match.index}>{match[0]}</mark>);
		last = match.index + match[0].length;
	}
	parts.push(text.slice(last));
	return <>{parts}</>;
}

function SearchPane(props: {
	info: ExplorerInfo;
	query: string;
	setQuery: (query: string) => void;
	options: SearchOptions;
	setOptions: (options: SearchOptions) => void;
	result?: SearchResult;
	searching: boolean;
	onOpen: (path: string, line: number) => void;
}) {
	const { options, result } = props;
	const pattern = useMemo(() => (result ? matcher(result.query, options) : undefined), [result, options]);
	const byFile = useMemo(() => {
		const files = new Map<string, GrepHit[]>();
		for (const hit of result?.hits ?? []) {
			files.set(hit.path, [...(files.get(hit.path) ?? []), hit]);
		}
		return [...files];
	}, [result]);
	const toggle = (key: keyof SearchOptions, label: string, text: string) => (
		<button class={`toggle-btn ${options[key] ? 'on' : ''}`} title={label} aria-label={label} aria-pressed={options[key]} onClick={() => props.setOptions({ ...options, [key]: !options[key] })}>
			{text}
		</button>
	);
	const matchCount = result?.hits.length ?? 0;
	return (
		<>
			<div class="search-bar">
				<SearchInput id="text-search" label={`Search text in ${props.info.branch}`} placeholder={`Search text in ${props.info.branch}…`} value={props.query} onInput={props.setQuery} autoFocus />
				{toggle('matchCase', 'Match case', 'Aa')}
				{toggle('wholeWord', 'Match whole word', 'ab')}
				{toggle('regex', 'Use regular expression', '.*')}
			</div>
			{(props.searching || (result && matchCount > 0)) && (
				<div class="result-label">
					{props.searching
						? 'Searching…'
						: `${matchCount >= MAX_HITS ? `First ${MAX_HITS}` : matchCount} ${matchCount === 1 ? 'match' : 'matches'} in ${byFile.length} ${byFile.length === 1 ? 'file' : 'files'} · ${props.info.branch}`}
				</div>
			)}
			<div class="fill scroll">
				{result?.error && <Empty title="Search failed" hint={result.error} />}
				{result && !result.error && matchCount === 0 && <Empty title="No matches in this branch" />}
				{!result && !props.searching && <Empty title={`Search the files of ${props.info.branch}`} hint="Nothing is checked out — git searches the branch tip." />}
				{byFile.map(([path, hits]) => {
					const { name, dir } = splitPath(path);
					return (
						<div key={path} class="result-group">
							<div class="result-file">
								<FileIcon size={13} />
								<span class="rf-name">{name}</span>
								<span class="rf-dir">{dir}</span>
								<span class="grow" />
								<span class="rf-count">{hits.length} {hits.length === 1 ? 'match' : 'matches'}</span>
							</div>
							{hits.map(hit => (
								<button key={hit.line} class="row result-hit" onClick={() => props.onOpen(path, hit.line)}>
									<span class="ln">{hit.line}</span>
									<span class="grow ellipsis hit-text">
										<Highlight text={hit.text.trimStart().slice(0, 400)} pattern={pattern} />
									</span>
								</button>
							))}
						</div>
					);
				})}
			</div>
		</>
	);
}

function DiffPanel({ data }: { data: ExplorerData }) {
	const { diff, info } = data;
	const added = diff.reduce((sum, file) => sum + (file.added ?? 0), 0);
	const deleted = diff.reduce((sum, file) => sum + (file.deleted ?? 0), 0);
	const total = added + deleted || 1;
	return (
		<div class="x-diff">
			<div class="x-diff-head">
				<div class="x-diff-title">Diff vs {info.current}</div>
				<div class="x-stat">
					<b>{diff.length}</b>
					<span>{diff.length === 1 ? 'file' : 'files'} changed</span>
					<span class="grow" />
					<span class="mono add">+{added}</span>
					<span class="mono del">−{deleted}</span>
				</div>
				<div class="x-bar">
					<span style={{ width: `${(added / total) * 100}%` }} />
					<span style={{ width: `${(deleted / total) * 100}%` }} />
				</div>
			</div>
			<div class="fill scroll" style={{ paddingTop: '4px' }}>
				{diff.map(file => {
					const { name, dir } = splitPath(file.path);
					return (
						<button key={file.path} class="row x-diff-row" title={file.oldPath ? `${file.oldPath} → ${file.path}` : file.path} onClick={() => send({ type: 'diffFile', file })}>
							<StatusLetter status={file.status} />
							<span class="x-diff-name">
								<span class="n">{name}</span>
								<span class="d">{dir}</span>
							</span>
							{file.added === undefined ? (
								<span class="mono muted">bin</span>
							) : (
								<>
									<span class="mono add">+{file.added}</span>
									<span class="mono del">−{file.deleted}</span>
								</>
							)}
						</button>
					);
				})}
				{diff.length === 0 && <Empty title={`No differences with ${info.current}`} />}
			</div>
			<div class="x-diff-foot">
				<button class="btn" disabled={diff.length === 0} onClick={() => send({ type: 'openFullDiff' })}>Open full diff in editor</button>
				<button class="btn" onClick={() => send({ type: 'pickBranch' })}>Pick another branch</button>
			</div>
		</div>
	);
}

function App() {
	const [data, setData] = useState<ExplorerData>();
	const [tab, setTab] = useState<Tab>('files');
	const [path, setPath] = useState<string>();
	const [file, setFile] = useState<FilePreview>();
	const [query, setQuery] = useState('');
	const [options, setOptions] = useState<SearchOptions>({ matchCase: false, wholeWord: false, regex: false });
	const [result, setResult] = useState<SearchResult>();
	const [searching, setSearching] = useState(false);
	const lastSearch = useRef<string>();

	useMessages<ExplorerToWebview>(message => {
		if (message.type === 'init') {
			setData(message.data);
		} else if (message.type === 'file') {
			setPath(message.file.path);
			setFile(message.file);
		} else if (lastSearch.current === undefined || message.query === lastSearch.current) {
			// Answers to older queries arrive late while typing: skip them.
			setResult(message);
			setSearching(false);
		}
	});

	useEffect(() => {
		if (!query) {
			lastSearch.current = undefined;
			setResult(undefined);
			setSearching(false);
			return;
		}
		const timer = setTimeout(() => {
			lastSearch.current = query;
			setSearching(true);
			send({ type: 'search', query, options });
		}, 300);
		return () => clearTimeout(timer);
	}, [query, options]);

	useRendered('explorer', data?.files.length, data);
	useRendered('file', file && lineCount(file), file);
	useRendered('search', result?.hits.length, result);

	const open = (next: string, line?: number) => {
		setPath(next);
		setTab('files');
		send({ type: 'openFile', path: next, line });
	};

	if (!data) {
		return <div class="explorer"><div class="busy-bar" /></div>;
	}
	return (
		<div class="explorer">
			<Header info={data.info} />
			<div class="x-body">
				<FileTree data={data} selected={path} onOpen={open} />
				<div class="x-center">
					<div class="x-tabs">
						<div class="segmented" role="tablist">
							{TABS.map(([key, label]) => (
								<button key={key} role="tab" aria-selected={tab === key} class={tab === key ? 'on' : ''} onClick={() => setTab(key)}>
									{label}
								</button>
							))}
						</div>
						<span class="grow" />
						<span class="small faint ellipsis">
							{tab === 'search'
								? 'Nothing is checked out — the search runs on the branch tip'
								: tab === 'files'
									? 'Click a file on the left to preview it'
									: `${data.info.ahead} commits ahead of ${data.info.current}`}
						</span>
					</div>
					{tab === 'files' && <FilePane info={data.info} path={path} file={file} />}
					{tab === 'commits' && <CommitList info={data.info} commits={data.commits} />}
					{tab === 'search' && (
						<SearchPane info={data.info} query={query} setQuery={setQuery} options={options} setOptions={setOptions} result={result} searching={searching} onOpen={open} />
					)}
				</div>
				<DiffPanel data={data} />
			</div>
		</div>
	);
}

render(<App />, document.getElementById('app')!);
