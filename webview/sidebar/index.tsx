import { render, type JSX } from 'preact';
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import type {
	ChangeAction,
	ChangeGroupKind,
	ChangeRef,
	FolderIcons,
	GroupAction,
	SidebarChangeGroup,
	SidebarFile,
	SidebarFromWebview,
	SidebarRepo,
	SidebarState,
	SidebarToWebview,
} from '../../src/shared/protocol';
import { buildFileTree, compactFolders, TreeNode } from '../../src/shared/fileTree';
import { Dropdown, Empty, IconFonts, IconView, isJumpToSource, MAC } from '../common/components';
import { BranchIcon } from '../common/icons';
import { getState, post, setState, useMessages, useRendered } from '../common/vscode';
import { installTooltips } from '../common/tooltip';

const send = (message: SidebarFromWebview) => post(message);
const MOD = MAC ? '⌘' : 'Ctrl+';
const keyOf = (ref: ChangeRef) => `${ref.root}\n${ref.group}\n${ref.path}`;
/** Rows indent like VS Code's trees: 8 px a level, then a 16 px slot for the chevron. */
const indent = (depth: number) => ({ paddingLeft: `${4 + depth * 8}px` });

interface ActionButton<A> {
	readonly action: A;
	readonly icon: string;
	readonly title: string;
}

// The buttons Source Control shows on a file, a folder and a group, in its order.
const OPEN_FILE: ActionButton<ChangeAction> = { action: 'openFile', icon: 'go-to-file', title: 'Open File' };
const DISCARD: ActionButton<ChangeAction> = { action: 'discard', icon: 'discard', title: 'Discard Changes' };
const STAGE: ActionButton<ChangeAction> = { action: 'stage', icon: 'add', title: 'Stage Changes' };
const UNSTAGE: ActionButton<ChangeAction> = { action: 'unstage', icon: 'remove', title: 'Unstage Changes' };
const FOLDER_ACTIONS: Record<ChangeGroupKind, readonly ActionButton<ChangeAction>[]> = {
	merge: [STAGE],
	index: [UNSTAGE],
	workingTree: [DISCARD, STAGE],
	untracked: [DISCARD, STAGE],
};
const FILE_ACTIONS: Record<ChangeGroupKind, readonly ActionButton<ChangeAction>[]> = {
	merge: [OPEN_FILE, STAGE],
	index: [OPEN_FILE, UNSTAGE],
	workingTree: [OPEN_FILE, DISCARD, STAGE],
	untracked: [OPEN_FILE, DISCARD, STAGE],
};
const VIEW: ActionButton<GroupAction> = { action: 'view', icon: 'diff-multiple', title: 'View Changes' };
const GROUP_ACTIONS: Record<ChangeGroupKind, readonly ActionButton<GroupAction>[]> = {
	merge: [{ action: 'stageAll', icon: 'add', title: 'Stage All Merge Changes' }],
	index: [VIEW, { action: 'unstageAll', icon: 'remove', title: 'Unstage All Changes' }],
	workingTree: [VIEW, { action: 'discardAll', icon: 'discard', title: 'Discard All Changes' }, { action: 'stageAll', icon: 'add', title: 'Stage All Changes' }],
	untracked: [VIEW, { action: 'discardAll', icon: 'discard', title: 'Discard All Untracked Changes' }, { action: 'stageAll', icon: 'add', title: 'Stage All Untracked Changes' }],
};

const Codicon = ({ name }: { name: string }) => <i class={`codicon codicon-${name}`} aria-hidden="true" />;
const Twistie = ({ open }: { open?: boolean }) => <span class="twistie">{open !== undefined && <Codicon name={open ? 'chevron-down' : 'chevron-right'} />}</span>;

function Buttons<A>({ buttons, label, run }: { buttons: readonly ActionButton<A>[]; label: string; run: (action: A) => void }) {
	return (
		<span class="scm-actions">
			{buttons.map(button => (
				<button
					key={String(button.action)}
					class="action"
					title={button.title}
					aria-label={`${button.title}${label ? `: ${label}` : ''}`}
					onClick={event => {
						event.stopPropagation();
						run(button.action);
					}}
				>
					<Codicon name={button.icon} />
				</button>
			))}
		</span>
	);
}

/** The branch, its sync state and Fetch / Pull / Push; the name opens the branch list to switch. */
function BranchCard({ repo }: { repo: SidebarRepo }) {
	const current = repo.current;
	if (!current) {
		return null;
	}
	const syncAction = (action: 'fetch' | 'pull' | 'push') => send({ type: 'sync', root: repo.root, action });
	const commits = (count: number) => `${count} commit${count === 1 ? '' : 's'}`;
	const pull = current.behind ? `Pull ${commits(current.behind)} from ${current.upstream ?? 'the remote'}` : current.upstream ? `Pull from ${current.upstream}` : 'Pull';
	const push = !current.upstream ? 'Publish the branch to the remote' : current.ahead ? `Push ${commits(current.ahead)} to ${current.upstream}` : `Push to ${current.upstream}`;
	// One row: the branch, then Fetch, Pull and Push; their labels show where the card has room.
	return (
		<div class="card">
			<div class="card-row">
				<button class="card-branch" title="Switch branch" aria-label={`Branch ${current.name}: switch branch`} onClick={() => send({ type: 'switchBranch', root: repo.root })}>
					<span class="card-icon"><BranchIcon size={15} /></span>
					<span class="card-name">{current.name}</span>
					<Codicon name="chevron-down" />
				</button>
				<button class="btn card-btn" title="Fetch: see what is new on the remote; your files stay as they are" aria-label="Fetch" onClick={() => syncAction('fetch')}>
					<Codicon name="repo-fetch" />
					<span class="card-label">Fetch</span>
				</button>
				<button class="btn card-btn" title={pull} aria-label="Pull" onClick={() => syncAction('pull')}>
					<Codicon name="arrow-down" />
					<span class="card-label">Pull</span>
					{current.behind ? <span class="card-count">{current.behind}</span> : null}
				</button>
				<button class="btn card-btn" title={push} aria-label="Push" onClick={() => syncAction('push')}>
					<Codicon name="arrow-up" />
					<span class="card-label">Push</span>
					{current.ahead ? <span class="card-count">{current.ahead}</span> : null}
				</button>
			</div>
		</div>
	);
}

interface ListProps {
	readonly mode: SidebarState['viewMode'];
	readonly compact: boolean;
	readonly folderIcons: SidebarState['folderIcons'];
	readonly selected: ReadonlySet<string>;
	readonly focused?: string;
	readonly isCollapsed: (key: string) => boolean;
	readonly toggle: (key: string) => void;
	readonly click: (ref: ChangeRef, event: MouseEvent) => void;
	readonly open: (ref: ChangeRef) => void;
	readonly contextMenu: (ref: ChangeRef) => void;
	readonly act: (action: ChangeAction, ref: ChangeRef) => void;
	readonly actOnAll: (action: ChangeAction, refs: readonly ChangeRef[]) => void;
	readonly keyDown: (event: KeyboardEvent) => void;
}

const groupKey = (repo: SidebarRepo, group: SidebarChangeGroup) => `group:${repo.root}\n${group.group}`;
const folderKey = (repo: SidebarRepo, group: SidebarChangeGroup, folder: string) => `folder:${repo.root}\n${group.group}\n${folder}`;

function FileRow({ repo, group, file, depth, showDir, list }: { repo: SidebarRepo; group: SidebarChangeGroup; file: SidebarFile; depth: number; showDir: boolean; list: ListProps }) {
	const ref: ChangeRef = { root: repo.root, group: group.group, path: file.path };
	const key = keyOf(ref);
	const context = { webviewSection: 'change', root: repo.root, gitConvenientGroup: group.group, path: file.path, preventDefaultContextMenuItems: true };
	return (
		<div
			class={`scm-row scm-file ${list.selected.has(key) ? 'sel' : ''}`}
			style={indent(depth)}
			role="treeitem"
			aria-selected={list.selected.has(key)}
			tabIndex={list.focused === key ? 0 : -1}
			data-key={key}
			data-vscode-context={JSON.stringify(context)}
			title={file.tooltip}
			onClick={event => list.click(ref, event)}
			onDblClick={() => list.open(ref)}
			onContextMenu={() => list.contextMenu(ref)}
			onKeyDown={list.keyDown}
		>
			<Twistie />
			{file.icon ? <IconView icon={file.icon} /> : <span class="file-icon" />}
			<span class={`scm-name deco-${file.decoration}`}>{file.name}</span>
			{showDir && <span class="scm-dir">{file.dir}</span>}
			<span class="grow" />
			<Buttons buttons={FILE_ACTIONS[group.group]} label={file.name} run={action => list.act(action, ref)} />
			<span class={`scm-letter deco-${file.decoration}`}>{file.letter}</span>
		</div>
	);
}

/** A group's files as Source Control's tree: folders first, single-folder chains joined. */
function FolderTree({ repo, group, list }: { repo: SidebarRepo; group: SidebarChangeGroup; list: ListProps }) {
	const files = useMemo(() => new Map(group.files.map(file => [file.path, file] as const)), [group.files]);
	const tree = useMemo(() => {
		const nodes = buildFileTree(group.files.map(file => file.path));
		return list.compact ? compactFolders(nodes) : nodes;
	}, [group.files, list.compact]);
	const rows: JSX.Element[] = [];
	const walk = (nodes: readonly TreeNode[], depth: number) => {
		for (const node of nodes) {
			const file = files.get(node.path);
			if (!node.isDir && file) {
				rows.push(<FileRow key={node.path} repo={repo} group={group} file={file} depth={depth} showDir={false} list={list} />);
				continue;
			}
			const key = folderKey(repo, group, node.path);
			const open = !list.isCollapsed(key);
			const inside = group.files.filter(candidate => candidate.path.startsWith(`${node.path}/`)).map((candidate): ChangeRef => ({ root: repo.root, group: group.group, path: candidate.path }));
			const icons: FolderIcons | undefined = list.folderIcons[node.name.slice(node.name.lastIndexOf('/') + 1).toLowerCase()] ?? list.folderIcons[''];
			const context = { webviewSection: 'changeFolder', root: repo.root, gitConvenientGroup: group.group, path: node.path, preventDefaultContextMenuItems: true };
			rows.push(
				<div key={`${node.path}/`} class="scm-row scm-folder" style={indent(depth)} role="treeitem" aria-expanded={open} title={node.path} data-vscode-context={JSON.stringify(context)} onClick={() => list.toggle(key)}>
					<Twistie open={open} />
					<IconView icon={open ? icons?.open ?? icons?.closed : icons?.closed} />
					<span class="scm-name">{node.name}</span>
					<span class="grow" />
					<Buttons buttons={FOLDER_ACTIONS[group.group]} label={node.name} run={action => list.actOnAll(action, inside)} />
				</div>,
			);
			if (open) {
				walk(node.children, depth + 1);
			}
		}
	};
	walk(tree, 1);
	return <>{rows}</>;
}

/** Uncommitted files of a repository, grouped like Source Control, as a list or a tree. */
function ChangeList({ repo, list }: { repo: SidebarRepo; list: ListProps }) {
	return (
		<div class="scm-list" role="tree" aria-label={`Changes in ${repo.name}`}>
			{repo.groups.map(group => {
				const key = groupKey(repo, group);
				const open = !list.isCollapsed(key);
				const context = { webviewSection: 'changeGroup', root: repo.root, gitConvenientGroup: group.group, preventDefaultContextMenuItems: true };
				return (
					<div key={group.group}>
						<div class="scm-row scm-group-row" style={indent(0)} role="treeitem" aria-expanded={open} data-vscode-context={JSON.stringify(context)} onClick={() => list.toggle(key)}>
							<Twistie open={open} />
							<span class="scm-group-label">{group.label}</span>
							<span class="grow" />
							{group.files.length > 0 && (
								<Buttons buttons={GROUP_ACTIONS[group.group]} label="" run={action => send({ type: 'group', action, root: repo.root, group: group.group })} />
							)}
							<span class="count-badge">{group.files.length}</span>
						</div>
						{open &&
							(list.mode === 'tree' ? (
								<FolderTree repo={repo} group={group} list={list} />
							) : (
								group.files.map(file => <FileRow key={file.path} repo={repo} group={group} file={file} depth={1} showDir list={list} />)
							))}
					</div>
				);
			})}
		</div>
	);
}

/** The commit message is Source Control's message box too: typing updates it, a commit clears it. */
function CommitBox({ repo, busy, draft }: { repo: SidebarRepo; busy: boolean; draft?: { value: string } }) {
	const [message, setMessage] = useState(draft?.value ?? '');
	const timer = useRef<ReturnType<typeof setTimeout>>();
	useEffect(() => setMessage(draft?.value ?? ''), [draft]);
	const edit = (value: string) => {
		setMessage(value);
		clearTimeout(timer.current);
		timer.current = setTimeout(() => send({ type: 'draft', root: repo.root, value }), 300);
	};
	const commit = (push: boolean) => {
		clearTimeout(timer.current);
		send({ type: 'commit', root: repo.root, message, push });
	};
	const id = `commit-message-${repo.root}`;
	return (
		<div class="sb-commit">
			<label class="sr-only" for={id}>Commit message</label>
			<textarea
				id={id}
				rows={2}
				placeholder={`Message (${MOD}⏎ to commit on ${repo.current?.name ?? 'HEAD'})`}
				value={message}
				onInput={event => edit((event.target as HTMLTextAreaElement).value)}
				onKeyDown={event => {
					if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
						event.preventDefault();
						commit(false);
					}
				}}
			/>
			<div class="split-btn">
				<button class="btn primary" disabled={busy} onClick={() => commit(true)}>Commit &amp; Push</button>
				<Dropdown
					className="btn"
					ariaLabel="Commit options"
					align="right"
					label={null}
					items={[
						{ label: 'Commit', onSelect: () => commit(false) },
						{ label: 'Commit & Push', onSelect: () => commit(true) },
					]}
				/>
			</div>
		</div>
	);
}

interface UiState {
	/** Collapsed repositories, groups and folders (see the keys above). */
	readonly collapsed: readonly string[];
}

function App() {
	const [state, setAppState] = useState<SidebarState>();
	const [busy, setBusy] = useState<string>();
	const [drafts, setDrafts] = useState<Record<string, { value: string }>>({});
	const [selection, setSelection] = useState<readonly ChangeRef[]>([]);
	const [focused, setFocused] = useState<string>();
	const [anchor, setAnchor] = useState<string>();
	const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(() => new Set(getState<UiState>()?.collapsed ?? []));

	useMessages<SidebarToWebview>(message => {
		if (message.type === 'state') {
			setAppState(message.state);
		} else if (message.type === 'busy') {
			setBusy(message.label);
		} else {
			// A new object, so the box takes it even when the text is unchanged.
			setDrafts(current => ({ ...current, [message.root]: { value: message.value } }));
		}
	});

	const multi = (state?.repos.length ?? 0) > 1;
	const isCollapsed = (key: string) => collapsed.has(key);

	// Visible files in screen order, for keyboard moves and Shift ranges.
	const rows = useMemo(() => {
		if (!state) {
			return [];
		}
		const visible: ChangeRef[] = [];
		for (const repo of state.repos) {
			if (multi && collapsed.has(`repo:${repo.root}`)) {
				continue;
			}
			for (const group of repo.groups) {
				if (collapsed.has(groupKey(repo, group))) {
					continue;
				}
				const hidden = (file: SidebarFile) => {
					if (state.viewMode !== 'tree') {
						return false;
					}
					const parts = file.path.split('/');
					return parts.slice(0, -1).some((_, i) => collapsed.has(folderKey(repo, group, parts.slice(0, i + 1).join('/'))));
				};
				// The tree shows folders first: keep its order for keyboard moves.
				const files = state.viewMode === 'tree' ? orderAsTree(group.files) : group.files;
				visible.push(...files.filter(file => !hidden(file)).map((file): ChangeRef => ({ root: repo.root, group: group.group, path: file.path })));
			}
		}
		return visible;
	}, [state, collapsed, multi]);
	const selected = useMemo(() => new Set(selection.map(keyOf)), [selection]);

	// Files that went away (staged, committed…) leave the selection.
	useEffect(() => {
		const present = new Set(rows.map(keyOf));
		if (selection.some(ref => !present.has(keyOf(ref)))) {
			select(selection.filter(ref => present.has(keyOf(ref))));
		}
	}, [rows]);

	useRendered('sidebar', state?.repos.reduce((sum, repo) => sum + repo.changeCount, 0), state);

	function select(items: readonly ChangeRef[]) {
		setSelection(items);
		send({ type: 'select', items });
	}

	function toggle(key: string) {
		const next = new Set(collapsed);
		if (!next.delete(key)) {
			next.add(key);
		}
		setCollapsed(next);
		setState<UiState>({ collapsed: [...next] });
	}

	const list: ListProps = {
		mode: state?.viewMode ?? 'list',
		compact: state?.compactFolders ?? true,
		folderIcons: state?.folderIcons ?? {},
		selected,
		focused: focused ?? (rows[0] && keyOf(rows[0])),
		isCollapsed,
		toggle,
		click: (ref, event) => {
			const key = keyOf(ref);
			setFocused(key);
			if (event.metaKey || event.ctrlKey) {
				select(selected.has(key) ? selection.filter(item => keyOf(item) !== key) : [...selection, ref]);
				setAnchor(key);
				return;
			}
			const from = rows.findIndex(item => keyOf(item) === anchor);
			const to = rows.findIndex(item => keyOf(item) === key);
			if (event.shiftKey && from >= 0 && to >= 0) {
				select(rows.slice(Math.min(from, to), Math.max(from, to) + 1));
				return;
			}
			// A click selects; opening the diff takes a double click.
			select([ref]);
			setAnchor(key);
		},
		open: ref => send({ type: 'change', action: 'open', items: [ref] }),
		contextMenu: ref => {
			if (!selected.has(keyOf(ref))) {
				select([ref]);
				setAnchor(keyOf(ref));
			}
		},
		act: (action, ref) => send({ type: 'change', action, items: selected.has(keyOf(ref)) ? selection : [ref] }),
		actOnAll: (action, refs) => send({ type: 'change', action, items: refs }),
		keyDown: event => {
			const index = rows.findIndex(item => keyOf(item) === (focused ?? anchor));
			if (isJumpToSource(event)) {
				// ⌘↓ (Ctrl+↓ on Windows and Linux): the file itself in the editor, like WebStorm's Jump to Source.
				event.preventDefault();
				const current = rows[index];
				const items = selection.length > 0 ? selection : current ? [current] : [];
				if (items.length > 0) {
					send({ type: 'change', action: 'openFile', items });
				}
			} else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
				event.preventDefault();
				const next = rows[Math.max(0, Math.min(rows.length - 1, index + (event.key === 'ArrowDown' ? 1 : -1)))];
				if (next) {
					select(event.shiftKey ? [...selection.filter(item => keyOf(item) !== keyOf(next)), next] : [next]);
					if (!event.shiftKey) {
						setAnchor(keyOf(next));
					}
					setFocused(keyOf(next));
					document.querySelector<HTMLElement>(`[data-key="${CSS.escape(keyOf(next))}"]`)?.focus();
				}
			} else if (event.key === 'Enter' && selection.length > 0) {
				event.preventDefault();
				send({ type: 'change', action: 'open', items: selection });
			}
		},
	};

	if (!state) {
		return <div class="busy-bar" />;
	}
	if (state.repos.length === 0) {
		return <Empty title="No Git repository" hint="Open a folder that is a Git repository to see its changes." />;
	}
	return (
		<>
			<IconFonts fonts={state.iconFonts} />
			{busy && <div class="busy-bar" title={busy} />}
			{state.repos.map(repo => {
				const open = !multi || !collapsed.has(`repo:${repo.root}`);
				return (
					<section key={repo.root} class="repo">
						{multi && (
							<div class="scm-row repo-header" role="button" aria-expanded={open} title={repo.root} onClick={() => toggle(`repo:${repo.root}`)}>
								<Twistie open={open} />
								<span class="repo-name">{repo.name}</span>
								{repo.current && <span class="repo-branch">{repo.current.name}</span>}
								<span class="grow" />
								{repo.changeCount > 0 && <span class="count-badge">{repo.changeCount}</span>}
							</div>
						)}
						{open && (
							<>
								<BranchCard repo={repo} />
								<ChangeList repo={repo} list={list} />
								{(!multi || repo.changeCount > 0) && <CommitBox repo={repo} busy={busy !== undefined} draft={drafts[repo.root]} />}
							</>
						)}
					</section>
				);
			})}
		</>
	);
}

/** Files in the order the tree shows them: folders (and their files) first, by name. */
function orderAsTree(files: readonly SidebarFile[]): SidebarFile[] {
	const byPath = new Map(files.map(file => [file.path, file] as const));
	const ordered: SidebarFile[] = [];
	const walk = (nodes: readonly TreeNode[]) => {
		for (const node of nodes) {
			const file = byPath.get(node.path);
			if (!node.isDir && file) {
				ordered.push(file);
			} else {
				walk(node.children);
			}
		}
	};
	walk(buildFileTree(files.map(file => file.path)));
	return ordered;
}

installTooltips();
document.body.classList.add('sidebar');
render(<App />, document.getElementById('app')!);
