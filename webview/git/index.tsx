import { render, type JSX } from 'preact';
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { CommitDetails, FileChange, FileIcon, FileIconFont, GitBranchItem, GitPanelBranches, GitPanelFromWebview, GitPanelToWebview, LogAction, LogData, LogRow } from '../../src/shared/protocol';
import { branchTree, BranchTreeNode } from '../../src/shared/branchTree';
import { buildFileTree, compactFolders, TreeNode } from '../../src/shared/fileTree';
import { resizeInfo } from '../../src/shared/panes';
import { Dropdown, Empty, formatDate, IconFonts, IconView, isJumpToSource, SearchInput, shortHash } from '../common/components';
import { getState, post, setState, useMessages, useRendered } from '../common/vscode';
import { installTooltips } from '../common/tooltip';
import { CommitTable, Toolbar, useLogState } from '../log/parts';

const send = (message: GitPanelFromWebview) => post(message);
const Codicon = ({ name, className }: { name: string; className?: string }) => <i class={`codicon codicon-${name} ${className ?? ''}`} aria-hidden="true" />;
const indent = (depth: number) => ({ paddingLeft: `${6 + depth * 12}px` });

interface UiState {
	readonly collapsed: readonly string[];
	readonly left: number;
	readonly right: number;
	/** Height of the commit details under the files of the commit. */
	readonly info: number;
}
const DEFAULT_UI: UiState = { collapsed: ['root:tags'], left: 240, right: 360, info: 150 };

/** A draggable edge between two panes, side by side or one above the other. */
function Splitter({ onDrag, axis = 'x' }: { onDrag: (delta: number) => void; axis?: 'x' | 'y' }) {
	const start = useRef<number>();
	const along = (event: { clientX: number; clientY: number }) => (axis === 'x' ? event.clientX : event.clientY);
	return (
		<div
			class={`gp-splitter ${axis === 'y' ? 'row' : ''}`}
			role="separator"
			aria-orientation={axis === 'x' ? 'vertical' : 'horizontal'}
			onPointerDown={event => {
				// Without this the drag selects the text of the panes it crosses.
				event.preventDefault();
				start.current = along(event);
				(event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
			}}
			onPointerMove={event => {
				if (start.current !== undefined) {
					onDrag(along(event) - start.current);
					start.current = along(event);
				}
			}}
			onPointerUp={() => {
				start.current = undefined;
			}}
		/>
	);
}

interface TreeProps {
	readonly selected?: string;
	readonly filtering: boolean;
	/** The repository the panel shows; the context menu commands need it. */
	readonly root?: string;
	readonly isCollapsed: (key: string) => boolean;
	readonly toggle: (key: string) => void;
	readonly pick: (branch: string) => void;
}

function BranchNodes({ nodes, depth, scope, tree }: { nodes: readonly BranchTreeNode<GitBranchItem>[]; depth: number; scope: string; tree: TreeProps }) {
	return (
		<>
			{nodes.map(node => {
				if (node.kind === 'folder') {
					const key = `folder:${scope}:${node.path}`;
					const open = tree.filtering || !tree.isCollapsed(key);
					return (
						<div key={key}>
							<div class="gp-row" style={indent(depth)} role="treeitem" aria-expanded={open} onClick={() => tree.toggle(key)}>
								<span class="twistie"><Codicon name={open ? 'chevron-down' : 'chevron-right'} /></span>
								<Codicon name={open ? 'folder-opened' : 'folder'} className="gp-folder-icon" />
								<span class="ellipsis">{node.label}</span>
							</div>
							{open && <BranchNodes nodes={node.children} depth={depth + 1} scope={scope} tree={tree} />}
						</div>
					);
				}
				const item = node.item!;
				const tag = scope === 'tags';
				const icon = tag ? 'tag' : item.current ? 'git-branch' : item.favorite ? 'star-full' : 'git-branch';
				// VS Code's context menu with the branch actions (webview/context), like WebStorm's; tags have none.
				const context = tag ? undefined : { webviewSection: 'branch', branch: node.path, root: tree.root, gitConvenientCurrent: item.current, preventDefaultContextMenuItems: true };
				return (
					<div
						key={node.path}
						class={`gp-row gp-branch ${tree.selected === node.path ? 'sel' : ''} ${item.current ? 'current' : ''} ${item.favorite ? 'favorite' : ''} ${tag ? 'tag' : ''}`}
						style={indent(depth)}
						role="treeitem"
						aria-selected={tree.selected === node.path}
						data-vscode-context={context && JSON.stringify(context)}
						title={item.current ? `${node.path} (current branch)` : node.path}
						onClick={() => tree.pick(node.path)}
					>
						<span class="twistie" />
						<Codicon name={icon} className="gp-branch-icon" />
						<span class="grow ellipsis">{node.label}</span>
						{item.sync && <span class="gp-sync">{item.sync}</span>}
						<span class="gp-actions">
							<button class="action" title="Browse without checkout" aria-label={`Browse ${node.path} without checkout`} onClick={event => { event.stopPropagation(); send({ type: 'browse', branch: node.path }); }}>
								<Codicon name="eye" />
							</button>
							{!tag && (
								<button class="action" title="Branch actions" aria-label={`Actions for ${node.path}`} onClick={event => { event.stopPropagation(); send({ type: 'branchActions', branch: node.path }); }}>
									<Codicon name="ellipsis" />
								</button>
							)}
						</span>
					</div>
				);
			})}
		</>
	);
}

/** Local, Remote (a folder per remote) and Tags, branches grouped into folders by their names. */
function BranchPane({ branches, data, ui }: { branches?: GitPanelBranches; data?: LogData; ui: { isCollapsed: (key: string) => boolean; toggle: (key: string) => void } }) {
	const [filter, setFilter] = useState('');
	const needle = filter.trim().toLowerCase();
	const match = (item: { name: string }) => !needle || item.name.toLowerCase().includes(needle);
	const tree: TreeProps = {
		selected: data?.filters.branch,
		filtering: needle !== '',
		root: branches?.root,
		isCollapsed: ui.isCollapsed,
		toggle: ui.toggle,
		pick: branch => data && send({ type: 'filters', filters: { ...data.filters, branch } }),
	};
	// The tree's data is cached; its rows are built on every render so clicks see the current log.
	const nodes = useMemo(() => {
		if (!branches) {
			return undefined;
		}
		return {
			local: branchTree(branches.local.filter(match)),
			remotes: branches.remotes
				.map(remote => ({ remote, nodes: branchTree(branches.remote.filter(item => item.name.startsWith(`${remote}/`) && match(item)), `${remote}/`) }))
				.filter(entry => entry.nodes.length > 0),
			tags: branchTree(branches.tags.map((name): GitBranchItem => ({ name, current: false, favorite: false, sync: '' })).filter(match)),
		};
	}, [branches, needle]);
	const roots = !nodes
		? []
		: [
				{ key: 'local', label: 'Local', content: <BranchNodes nodes={nodes.local} depth={1} scope="local" tree={tree} />, empty: nodes.local.length === 0 },
				{
					key: 'remote',
					label: 'Remote',
					empty: nodes.remotes.length === 0,
					content: nodes.remotes.map(({ remote, nodes: remoteNodes }) => {
						const key = `folder:remote:${remote}`;
						const open = tree.filtering || !tree.isCollapsed(key);
						return (
							<div key={key}>
								<div class="gp-row" style={indent(1)} role="treeitem" aria-expanded={open} onClick={() => tree.toggle(key)}>
									<span class="twistie"><Codicon name={open ? 'chevron-down' : 'chevron-right'} /></span>
									<Codicon name={open ? 'folder-opened' : 'folder'} className="gp-folder-icon" />
									<span class="ellipsis">{remote}</span>
								</div>
								{open && <BranchNodes nodes={remoteNodes} depth={2} scope={`remote:${remote}`} tree={tree} />}
							</div>
						);
					}),
				},
				{ key: 'tags', label: 'Tags', content: <BranchNodes nodes={nodes.tags} depth={1} scope="tags" tree={tree} />, empty: nodes.tags.length === 0 },
			];
	const repo = branches?.repos.find(candidate => candidate.root === branches.root);
	return (
		<div class="gp-branches">
			<div class="gp-branches-head">
				{branches && branches.repos.length > 1 && (
					<Dropdown
						className="btn repo-pick"
						label={<span class="ellipsis">{repo?.name ?? 'Repository'}</span>}
						items={branches.repos.map(candidate => ({ label: candidate.name, checked: candidate.root === branches.root, onSelect: () => send({ type: 'pickRepo', root: candidate.root }) }))}
					/>
				)}
				<SearchInput id="branch-search" label="Search branches" placeholder="Search branches" value={filter} onInput={setFilter} />
			</div>
			<div class="gp-scroll" role="tree" aria-label="Branches">
				{data && (
					<div class={`gp-row ${data.filters.branch ? '' : 'sel'}`} style={indent(0)} role="treeitem" title="The log of all branches" onClick={() => send({ type: 'filters', filters: { ...data.filters, branch: undefined } })}>
						<span class="twistie" />
						<Codicon name="git-commit" className="gp-branch-icon" />
						<span class="grow">All branches</span>
					</div>
				)}
				{roots.map(root => {
					const key = `root:${root.key}`;
					const open = tree.filtering || !tree.isCollapsed(key);
					if (root.empty && tree.filtering) {
						return null;
					}
					return (
						<div key={key}>
							<div class="gp-row gp-root" style={indent(0)} role="treeitem" aria-expanded={open} onClick={() => tree.toggle(key)}>
								<span class="twistie"><Codicon name={open ? 'chevron-down' : 'chevron-right'} /></span>
								<span class="grow">{root.label}</span>
							</div>
							{open && root.content}
						</div>
					);
				})}
			</div>
		</div>
	);
}

const STATUS_CLASS: Record<string, string> = { A: 'deco-added', M: 'deco-modified', D: 'deco-deleted', R: 'deco-renamed', C: 'deco-renamed', T: 'deco-modified' };

/** The files of the selected commit as a tree with file counts, like WebStorm. */
function FilesTree({ details, ui }: { details: CommitDetails; ui: { isCollapsed: (key: string) => boolean; toggle: (key: string) => void } }) {
	const files = useMemo(() => new Map(details.files.map(file => [file.path, file] as const)), [details]);
	const tree = useMemo(() => compactFolders(buildFileTree(details.files.map(file => file.path))), [details]);
	const count = (node: TreeNode): number => (node.isDir ? node.children.reduce((sum, child) => sum + count(child), 0) : 1);
	const [selected, setSelected] = useState<string>();
	useEffect(() => setSelected(undefined), [details.hash]);
	const rows: JSX.Element[] = [];
	const walk = (nodes: readonly TreeNode[], depth: number) => {
		for (const node of nodes) {
			const file = files.get(node.path);
			if (!node.isDir && file) {
				rows.push(<FileLine key={node.path} file={file} icon={details.icons?.[file.path]} depth={depth} hash={details.hash} selected={selected === file.path} select={() => setSelected(file.path)} />);
				continue;
			}
			const key = `files:${node.path}`;
			const open = !ui.isCollapsed(key);
			const total = count(node);
			rows.push(
				<div key={`${node.path}/`} class="gp-row" style={indent(depth)} role="treeitem" aria-expanded={open} title={node.path} onClick={() => ui.toggle(key)}>
					<span class="twistie"><Codicon name={open ? 'chevron-down' : 'chevron-right'} /></span>
					<Codicon name={open ? 'folder-opened' : 'folder'} className="gp-folder-icon" />
					<span class="ellipsis">{node.name}</span>
					<span class="gp-count">{total} {total === 1 ? 'file' : 'files'}</span>
				</div>,
			);
			if (open) {
				walk(node.children, depth + 1);
			}
		}
	};
	walk(tree, 0);
	return <>{rows}</>;
}

function FileLine(props: { file: FileChange; icon?: FileIcon; depth: number; hash: string; selected: boolean; select: () => void }) {
	const { file, icon, depth, hash, selected } = props;
	const name = file.path.slice(file.path.lastIndexOf('/') + 1);
	const open = () => send({ type: 'openFile', hash, file });
	return (
		<div
			class={`gp-row gp-file ${selected ? 'sel' : ''}`}
			style={indent(depth)}
			role="treeitem"
			aria-selected={selected}
			tabIndex={0}
			data-vscode-context={JSON.stringify({ webviewSection: 'commitFile', hash, path: file.path, file, preventDefaultContextMenuItems: true })}
			title={file.oldPath ? `${file.oldPath} → ${file.path}` : file.path}
			// A click selects; the diff takes a double click (or Enter), like Changes.
			onClick={props.select}
			onContextMenu={props.select}
			onDblClick={open}
			onKeyDown={event => {
				if (isJumpToSource(event)) {
					// ⌘↓ (Ctrl+↓ on Windows and Linux): the file itself in the editor, like WebStorm's Jump to Source.
					event.preventDefault();
					send({ type: 'openSource', hash, file });
				} else if (event.key === 'Enter') {
					event.preventDefault();
					open();
				}
			}}
		>
			<span class="twistie" />
			<IconView icon={icon} fallback="file" />
			<span class={`grow ellipsis ${STATUS_CLASS[file.status] ?? ''} ${file.status === 'D' ? 'strike' : ''}`}>{name}</span>
			{file.added !== undefined && <span class="mono small add">+{file.added}</span>}
			{file.deleted !== undefined && <span class="mono small del">−{file.deleted}</span>}
		</div>
	);
}

/** The commit: message, hash, author, date and the branches that contain it; its buttons stay at the bottom. */
function CommitInfo({ row, details, height }: { row: LogRow; details?: CommitDetails; height: number }) {
	const [all, setAll] = useState(false);
	const branches = details?.branches ?? [];
	const action = (name: LogAction) => send({ type: 'action', action: name, hash: row.hash });
	return (
		<>
		<div class="gp-info" style={{ height: `${height}px` }}>
			<div class="gp-subject">{row.subject}</div>
			{details?.body && <div class="gp-body">{details.body}</div>}
			<div class="gp-meta">
				<button class="gp-hash" title="Copy hash" onClick={() => action('copyHash')}>{shortHash(row.hash)}</button>
				<span class="ellipsis">{row.author} &lt;{row.email}&gt;</span>
			</div>
			<div class="gp-meta muted">{formatDate(row.date)}</div>
			{details?.branches && (
				<div class="gp-meta muted gp-in">
					In {branches.length} {branches.length === 1 ? 'branch' : 'branches'}: {(all ? branches : branches.slice(0, 4)).join(', ')}
					{!all && branches.length > 4 && (
						<>
							… <button class="link" onClick={() => setAll(true)}>Show all</button>
						</>
					)}
				</div>
			)}
		</div>
			<div class="gp-buttons">
				<button class="btn primary" onClick={() => send({ type: 'openCommit', hash: row.hash })}>Open diff</button>
				<button class="btn" onClick={() => action('cherryPick')}>Cherry-pick</button>
				<button class="btn" onClick={() => action('revert')}>Revert</button>
				<Dropdown
					className="btn"
					ariaLabel="More commit actions"
					caret={false}
					align="right"
					label={<Codicon name="ellipsis" />}
					items={[
						{ label: 'Copy hash', onSelect: () => action('copyHash') },
						{ label: 'Checkout this commit', onSelect: () => action('checkout') },
						{ label: 'Merge into current branch', onSelect: () => action('merge') },
						{ label: 'Rebase current branch onto this commit', onSelect: () => action('rebase') },
						{ label: 'New branch from here…', onSelect: () => action('newBranch') },
					]}
				/>
			</div>
		</>
	);
}

function App() {
	const log = useLogState();
	const [branches, setBranches] = useState<GitPanelBranches>();
	const [fonts, setFonts] = useState<readonly FileIconFont[]>([]);
	const [ui, setUi] = useState<UiState>(() => ({ ...DEFAULT_UI, ...getState<UiState>() }));
	useMessages<GitPanelToWebview>(message => {
		if (message.type === 'branches') {
			setBranches(message.branches);
		} else if (message.type === 'iconFonts') {
			setFonts(message.fonts);
		} else {
			log.onMessage(message);
		}
	});
	useRendered('branches', branches && branches.local.length + branches.remote.length + branches.tags.length, branches);

	const update = (next: UiState) => {
		setUi(next);
		setState(next);
	};
	const collapsed = useMemo(() => new Set(ui.collapsed), [ui.collapsed]);
	const tree = useMemo(
		() => ({
			isCollapsed: (key: string) => collapsed.has(key),
			toggle: (key: string) => update({ ...ui, collapsed: collapsed.has(key) ? ui.collapsed.filter(item => item !== key) : [...ui.collapsed, key] }),
		}),
		[ui, collapsed],
	);
	const resize = (side: 'left' | 'right', dx: number) =>
		update({ ...ui, [side]: Math.max(160, Math.min(700, ui[side] + (side === 'left' ? dx : -dx))) });
	const commitPane = useRef<HTMLDivElement>(null);

	return (
		<div class="gp">
			<IconFonts fonts={fonts} />
			{log.busy && <div class="busy-bar" />}
			<div class="gp-pane" style={{ width: `${ui.left}px` }}>
				<BranchPane branches={branches} data={log.data} ui={tree} />
			</div>
			<Splitter onDrag={dx => resize('left', dx)} />
			<div class="gp-pane gp-log">
				{log.data ? (
					<>
						<Toolbar data={log.data} paths={log.paths} />
						<CommitTable data={log.data} rows={log.rows} selected={log.selected} onSelect={log.select} searching={log.searching} />
					</>
				) : branches && !branches.root ? (
					<Empty title="No Git repository" hint="Open a folder that is a Git repository to see its branches and log." />
				) : (
					<Empty title="Loading the log…" />
				)}
			</div>
			<Splitter onDrag={dx => resize('right', dx)} />
			<div class="gp-pane gp-commit" style={{ width: `${ui.right}px` }} ref={commitPane}>
				{log.row ? (
					<>
						<div class="gp-scroll gp-files" role="tree" aria-label="Changed files">
							{log.details ? <FilesTree details={log.details} ui={tree} /> : <div class="empty">…</div>}
						</div>
						<Splitter axis="y" onDrag={dy => update({ ...ui, info: resizeInfo(ui.info, dy, commitPane.current?.clientHeight ?? 600) })} />
						<CommitInfo row={log.row} details={log.details} height={ui.info} />
					</>
				) : (
					<Empty title="Select a commit" />
				)}
			</div>
		</div>
	);
}

installTooltips();
document.body.classList.add('panel');
render(<App />, document.getElementById('app')!);
