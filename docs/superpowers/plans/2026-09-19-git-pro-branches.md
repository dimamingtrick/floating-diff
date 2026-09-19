# Git Pro, часть 1 — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Переименовать Floating Diff в Git Pro и добавить ветку в статус-баре и popup веток (Quick Pick) с поиском, группами и действиями.

**Architecture:** Чистый модуль `branchModel` разбирает вывод git и строит группы/действия (unit-тесты). `BranchService` выполняет операции через Git API и свой git (интеграционные тесты на настоящих репозиториях). `BranchesPopup` — один Quick Pick с двумя страницами (ветки, действия). Сравнения открываются как дифф по многим файлам в существующем плавающем окне (`OpenRequest` вида `changes`).

**Tech Stack:** TypeScript ~5.9, VS Code API 1.105 (`@types/vscode` 1.105.0), встроенный Git API v1, mocha, @vscode/test-cli.

**Spec:** `docs/superpowers/specs/2026-09-19-git-pro-branches-design.md`

## Global Constraints

- `engines.vscode: ^1.105.0`, `@types/vscode` ровно `1.105.0`.
- Id расширения `local.git-pro`, `displayName: Git Pro`, `version: 0.2.0`.
- Команды: `gitPro.openScmResource`, `gitPro.pickChange`, `gitPro.close`, `gitPro.branches`. Context key `gitPro.diffFocused`. Настройка `gitPro.openFromSourceControl`.
- Тексты UI на английском с префиксом `Git Pro: `.
- Сетевые операции только через Git API; свой git — только локальные команды (`for-each-ref`, `reflog`, `branch`, `rebase`, `merge-base`).
- Rebase — всегда своим git (в Git API 1.105 его нет).
- Не коммитить без явной просьбы пользователя.

---

### Task 1: Переименование в Git Pro

**Files:** Modify `package.json`, `README.md`, `src/extension.ts`, `src/diffWindow.ts`, `src/pickChange.ts`, `src/test/integration/extension.test.ts`, `src/test/integration/scmRedirect.test.ts`, `src/test/integration/diffWindow.test.ts`.

- [ ] **Step 1: Тесты на новые id (падают)** — в `extension.test.ts` id расширения `local.git-pro` и команды `gitPro.openScmResource`, `gitPro.pickChange`, `gitPro.close`; в `scmRedirect.test.ts` ожидаемая команда `gitPro.openScmResource`, закрытие `gitPro.close`, id `local.git-pro`.
- [ ] **Step 2: Run** `npm run test:integration` → FAIL (`extension is installed in the test host`).
- [ ] **Step 3: Переименовать** — `package.json`: `name: git-pro`, `displayName: Git Pro`, `version: 0.2.0`, описание `WebStorm-style Git for VS Code: branches popup, diffs in a floating window.`; все `floatingDiff.*` → `gitPro.*`; `floatingDiff.focused` → `gitPro.diffFocused`; категория `Git Pro`; заголовок `gitPro.close` — `Close Diff Window`; секция настроек `Git Pro`. Код: константы и строки `floatingDiff` → `gitPro`, `Floating Diff:` → `Git Pro:`, канал вывода `Git Pro`, `BOUNDS_KEY = 'gitPro.windowBounds'`, `getConfiguration('gitPro')`. README: заголовок `Git Pro`, имя `.vsix` `git-pro-0.2.0.vsix`, настройка `gitPro.openFromSourceControl`.
- [ ] **Step 4: Run** `npm test` → PASS (64 unit, 11 integration).

### Task 2: `branchModel` — разбор git и построение списка

**Files:** Create `src/branches/branchModel.ts`, test `src/test/unit/branchModel.test.ts`.

**Interfaces — Produces:** `BranchInfo`, `FOR_EACH_REF_FORMAT`, `parseBranches(out, merged)`, `parseLines(out)`, `parseRecent(reflog, limit?)`, `syncLabel({ahead, behind})`, `branchDescription(b)`, `groupBranches(branches, recent, searching)`, `isValidBranchName(name)`, `localName(b)`, `BranchAction`, `ActionItem`, `branchActions(b, current)`.

- [ ] **Step 1: Падающие тесты** — `src/test/unit/branchModel.test.ts`:

```ts
import * as assert from 'assert';
import {
	BranchInfo, branchActions, branchDescription, groupBranches, isValidBranchName, localName, parseBranches, parseLines, parseRecent, syncLabel,
} from '../../branches/branchModel';

const ref = (...fields: string[]) => fields.join('\0');

function branch(name: string, extra: Partial<BranchInfo> = {}): BranchInfo {
	return { name, ahead: 0, behind: 0, current: false, merged: false, ...extra };
}

describe('parseBranches', () => {
	const output = [
		ref('refs/heads/main', 'origin/main', 'ahead 1, behind 2', '*'),
		ref('refs/heads/feature/x', 'origin/feature/x', 'ahead 3', ' '),
		ref('refs/heads/old', 'origin/old', 'gone', ' '),
		ref('refs/heads/topic', '', '', ' '),
		ref('refs/remotes/origin/HEAD', '', '', ' '),
		ref('refs/remotes/origin/main', '', '', ' '),
		ref('refs/remotes/upstream/feature/y', '', '', ' '),
		'',
	].join('\n');
	const branches = parseBranches(output, new Set(['topic', 'main']));

	it('reads local branches with upstream, ahead/behind and current', () => {
		assert.deepStrictEqual(branches.slice(0, 4), [
			{ name: 'main', upstream: 'origin/main', ahead: 1, behind: 2, current: true, merged: false },
			{ name: 'feature/x', upstream: 'origin/feature/x', ahead: 3, behind: 0, current: false, merged: false },
			{ name: 'old', upstream: 'origin/old', ahead: 0, behind: 0, current: false, merged: false },
			{ name: 'topic', upstream: undefined, ahead: 0, behind: 0, current: false, merged: true },
		]);
	});

	it('reads remote branches and skips origin/HEAD', () => {
		assert.deepStrictEqual(branches.slice(4), [
			{ name: 'origin/main', remote: 'origin', ahead: 0, behind: 0, current: false, merged: false },
			{ name: 'upstream/feature/y', remote: 'upstream', ahead: 0, behind: 0, current: false, merged: false },
		]);
	});
});

describe('parseLines', () => {
	it('splits and trims non-empty lines', () => {
		assert.deepStrictEqual(parseLines(' main\nfeature/x \n\n'), ['main', 'feature/x']);
	});
});

describe('parseRecent', () => {
	const reflog = [
		'checkout: moving from feature/x to main',
		'commit: wip',
		'checkout: moving from main to feature/x',
		'checkout: moving from topic to 1a2b3c4d',
		'checkout: moving from main to topic',
		'checkout: moving from topic to main',
	].join('\n');

	it('lists checked-out branches newest first, unique, without detached hashes', () => {
		assert.deepStrictEqual(parseRecent(reflog), ['main', 'feature/x', 'topic']);
	});

	it('stops at the limit', () => {
		assert.deepStrictEqual(parseRecent(reflog, 2), ['main', 'feature/x']);
	});
});

describe('labels', () => {
	it('shows behind before ahead', () => {
		assert.strictEqual(syncLabel({ ahead: 1, behind: 2 }), '↓2 ↑1');
		assert.strictEqual(syncLabel({ ahead: 3, behind: 0 }), '↑3');
		assert.strictEqual(syncLabel({ ahead: 0, behind: 0 }), '');
	});

	it('describes current and merged branches with their sync', () => {
		assert.strictEqual(branchDescription(branch('main', { current: true, ahead: 1, behind: 2 })), 'current  ↓2 ↑1');
		assert.strictEqual(branchDescription(branch('topic', { merged: true })), 'merged');
		assert.strictEqual(branchDescription(branch('x')), '');
	});
});

describe('groupBranches', () => {
	const main = branch('main', { current: true });
	const zeta = branch('zeta');
	const alpha = branch('alpha');
	const remote = branch('origin/main', { remote: 'origin' });

	it('shows Recent, Local (current first, then by name) and Remote', () => {
		const groups = groupBranches([zeta, remote, alpha, main], ['zeta', 'gone', 'main'], false);
		assert.deepStrictEqual(groups.map(g => [g.title, g.branches.map(b => b.name)]), [
			['Recent', ['zeta', 'main']],
			['Local', ['main', 'alpha', 'zeta']],
			['Remote', ['origin/main']],
		]);
	});

	it('hides Recent while searching and drops empty groups', () => {
		const groups = groupBranches([main], ['main'], true);
		assert.deepStrictEqual(groups.map(g => g.title), ['Local']);
	});
});

describe('isValidBranchName', () => {
	it('accepts usual names', () => {
		for (const name of ['main', 'feature/checkout-v2', 'fix_1.2']) {
			assert.ok(isValidBranchName(name), name);
		}
	});

	it('rejects what git rejects', () => {
		for (const name of ['', 'has space', 'a..b', '-x', '/x', 'x/', 'x.lock', 'x.', 'a:b', 'a~b', 'a^b', 'a?b', 'a*b', 'a[b', 'a\\b', '@', 'a@{b', 'a//b', '.x', 'a/.b']) {
			assert.ok(!isValidBranchName(name), name);
		}
	});
});

describe('localName', () => {
	it('strips the remote from remote branches', () => {
		assert.strictEqual(localName(branch('origin/feature/x', { remote: 'origin' })), 'feature/x');
		assert.strictEqual(localName(branch('main')), 'main');
	});
});

describe('branchActions', () => {
	const actions = (b: BranchInfo) => branchActions(b, 'main').map(a => a.label);

	it('offers everything for another local branch', () => {
		assert.deepStrictEqual(actions(branch('feature/x')), [
			'Checkout', 'Compare with main', 'Show diff with working tree',
			'New branch from feature/x…', 'Merge feature/x into main', 'Rebase main onto feature/x',
			'Rename…', 'Delete',
		]);
	});

	it('limits the current branch to safe actions', () => {
		assert.deepStrictEqual(actions(branch('main', { current: true })), ['Show diff with working tree', 'New branch from main…', 'Rename…']);
	});

	it('offers pull with rebase instead of rename/delete for remote branches', () => {
		assert.deepStrictEqual(actions(branch('origin/feature/x', { remote: 'origin' })), [
			'Checkout', 'Compare with main', 'Show diff with working tree',
			'New branch from origin/feature/x…', 'Merge origin/feature/x into main', 'Rebase main onto origin/feature/x',
			'Pull into main using rebase',
		]);
	});
});
```

- [ ] **Step 2: Run** `npm run test:unit` → FAIL (`Cannot find module '../../branches/branchModel'`).
- [ ] **Step 3: Реализация** — `src/branches/branchModel.ts`:

```ts
/** A local or remote-tracking branch as the branches popup shows it. */
export interface BranchInfo {
	/** `main`, or `origin/feature/x` for a remote branch. */
	readonly name: string;
	/** Remote of a remote branch (`origin`). */
	readonly remote?: string;
	/** Upstream of a local branch (`origin/main`). */
	readonly upstream?: string;
	readonly ahead: number;
	readonly behind: number;
	readonly current: boolean;
	/** A local branch fully merged into the current one. */
	readonly merged: boolean;
}

/** `git for-each-ref` format read by `parseBranches`: NUL-separated fields, one ref per line. */
export const FOR_EACH_REF_FORMAT = '%(refname)%00%(upstream:short)%00%(upstream:track,nobracket)%00%(HEAD)';

function count(track: string, word: 'ahead' | 'behind'): number {
	const match = new RegExp(`${word} (\\d+)`).exec(track);
	return match ? Number(match[1]) : 0;
}

export function parseBranches(forEachRef: string, merged: ReadonlySet<string>): BranchInfo[] {
	const branches: BranchInfo[] = [];
	for (const line of forEachRef.split('\n')) {
		const [ref = '', upstream = '', track = '', head = ''] = line.split('\0');
		if (ref.startsWith('refs/heads/')) {
			const name = ref.slice('refs/heads/'.length);
			const current = head === '*';
			branches.push({ name, upstream: upstream || undefined, ahead: count(track, 'ahead'), behind: count(track, 'behind'), current, merged: !current && merged.has(name) });
		} else if (ref.startsWith('refs/remotes/')) {
			const name = ref.slice('refs/remotes/'.length);
			const slash = name.indexOf('/');
			if (slash > 0 && !name.endsWith('/HEAD')) {
				branches.push({ name, remote: name.slice(0, slash), ahead: 0, behind: 0, current: false, merged: false });
			}
		}
	}
	return branches;
}

export function parseLines(output: string): string[] {
	return output.split('\n').map(line => line.trim()).filter(Boolean);
}

const CHECKOUT = /^checkout: moving from .+ to (.+)$/;
const HASH = /^[0-9a-f]{7,40}$/;

/** Branches from `git reflog --format=%gs`, most recently checked out first. */
export function parseRecent(reflogSubjects: string, limit = 5): string[] {
	const names: string[] = [];
	for (const line of reflogSubjects.split('\n')) {
		const name = CHECKOUT.exec(line.trim())?.[1];
		if (name && !HASH.test(name) && !names.includes(name)) {
			names.push(name);
			if (names.length === limit) {
				break;
			}
		}
	}
	return names;
}

export function syncLabel(branch: { readonly ahead: number; readonly behind: number }): string {
	return [branch.behind ? `↓${branch.behind}` : '', branch.ahead ? `↑${branch.ahead}` : ''].filter(Boolean).join(' ');
}

export function branchDescription(branch: BranchInfo): string {
	const tag = branch.current ? 'current' : branch.merged ? 'merged' : '';
	return [tag, syncLabel(branch)].filter(Boolean).join('  ');
}

export interface BranchGroup {
	readonly title: 'Recent' | 'Local' | 'Remote';
	readonly branches: readonly BranchInfo[];
}

export function groupBranches(branches: readonly BranchInfo[], recent: readonly string[], searching: boolean): BranchGroup[] {
	const local = branches.filter(b => !b.remote).sort((a, b) => Number(b.current) - Number(a.current) || a.name.localeCompare(b.name));
	const remote = branches.filter(b => b.remote).sort((a, b) => a.name.localeCompare(b.name));
	const byName = new Map(local.map(b => [b.name, b] as const));
	// While searching, Recent would repeat the Local matches.
	const recentBranches = searching ? [] : recent.flatMap(name => byName.get(name) ?? []);
	const groups: BranchGroup[] = [
		{ title: 'Recent', branches: recentBranches },
		{ title: 'Local', branches: local },
		{ title: 'Remote', branches: remote },
	];
	return groups.filter(group => group.branches.length > 0);
}

/** The subset of `git check-ref-format` rules users run into. */
export function isValidBranchName(name: string): boolean {
	return name.length > 0
		&& name !== '@'
		&& !/[\s~^:?*[\\\x00-\x1f\x7f]/.test(name)
		&& !name.includes('..') && !name.includes('@{') && !name.includes('//')
		&& !name.startsWith('-') && !name.startsWith('/')
		&& !name.endsWith('/') && !name.endsWith('.') && !name.endsWith('.lock')
		&& !name.split('/').some(part => part.startsWith('.'));
}

export function localName(branch: BranchInfo): string {
	return branch.remote ? branch.name.slice(branch.remote.length + 1) : branch.name;
}

export type BranchAction = 'checkout' | 'compare' | 'diffWorkingTree' | 'newBranch' | 'merge' | 'rebase' | 'pullRebase' | 'rename' | 'delete';

export interface ActionItem {
	readonly action: BranchAction;
	readonly label: string;
	/** Actions of one group sit between separators. */
	readonly group: 1 | 2 | 3;
}

/** The popup's actions for `branch`; `current` is the checked-out branch. */
export function branchActions(branch: BranchInfo, current: string): ActionItem[] {
	const other = !branch.current;
	const items: (ActionItem | false)[] = [
		other && { action: 'checkout', label: 'Checkout', group: 1 },
		other && { action: 'compare', label: `Compare with ${current}`, group: 1 },
		{ action: 'diffWorkingTree', label: 'Show diff with working tree', group: 1 },
		{ action: 'newBranch', label: `New branch from ${branch.name}…`, group: 2 },
		other && { action: 'merge', label: `Merge ${branch.name} into ${current}`, group: 2 },
		other && { action: 'rebase', label: `Rebase ${current} onto ${branch.name}`, group: 2 },
		!!branch.remote && { action: 'pullRebase', label: `Pull into ${current} using rebase`, group: 2 },
		!branch.remote && { action: 'rename', label: 'Rename…', group: 3 },
		!branch.remote && other && { action: 'delete', label: 'Delete', group: 3 },
	];
	return items.filter((item): item is ActionItem => item !== false);
}
```

- [ ] **Step 4: Run** `npm run test:unit` → PASS.

### Task 3: Дифф по многим файлам (`changes`) в плавающем окне

**Files:** Modify `src/openRequest.ts`, `src/diffWindow.ts`; tests `src/test/unit/openRequest.test.ts`, `src/test/integration/diffWindow.test.ts`.

**Interfaces — Produces:** `ChangeResource { label: Uri; original?: Uri; modified?: Uri }`; `OpenRequest` вида `{ kind: 'changes'; title: string; resources: readonly ChangeResource[] }`; `showsDocument` знает `changes`; `DiffWindow.show` принимает `changes`.

- [ ] **Step 1: Падающие тесты** — в `openRequest.test.ts` (describe `showsDocument`):

```ts
	it('matches any side of a multi-file request', () => {
		const other = fileUri('/repo/src/b.ts');
		const changes: OpenRequest = { kind: 'changes', title: 'main ↔ x', resources: [{ label: A, original: left, modified: A }, { label: other, modified: other }] };
		assert.strictEqual(showsDocument(changes, toGitUri(A, '~')), true);
		assert.strictEqual(showsDocument(changes, fileUri('/repo/src/b.ts')), true);
		assert.strictEqual(showsDocument(changes, OLD), false);
	});
```

В `diffWindow.test.ts`:

```ts
	it('shows a multi-file diff in the floating window as one tab', async () => {
		const a = diff('a.txt');
		const b = diff('b.txt');
		const req: OpenRequest = {
			kind: 'changes', title: 'probe compare',
			resources: [a, b].map(r => r.kind === 'diff' ? { label: r.right, original: r.left, modified: r.right } : { label: r.uri }),
		};

		await win.show(req);

		const group = win.resolveGroup();
		assert.ok(group, 'our group is known');
		await waitFor(() => group.tabs.length === 1 && group.tabs[0].label.startsWith('probe compare'), 'one multi-diff tab');
		assert.strictEqual(vscode.window.tabGroups.all.length, groupsBefore + 1);
		assert.ok(tabMatches(group.tabs[0], req));
	});
```

- [ ] **Step 2: Run** unit + integration → FAIL (type error on `kind: 'changes'`).
- [ ] **Step 3: Реализация** — `openRequest.ts`: тип `ChangeResource`, вариант `changes` в `OpenRequest`, `showsDocument`:

```ts
export interface ChangeResource {
	readonly label: Uri;
	/** Missing for added files. */
	readonly original?: Uri;
	/** Missing for deleted files. */
	readonly modified?: Uri;
}

export type OpenRequest =
	| { readonly kind: 'diff'; readonly left: Uri; readonly right: Uri; readonly title: string }
	| { readonly kind: 'file'; readonly uri: Uri; readonly title: string }
	| { readonly kind: 'changes'; readonly title: string; readonly resources: readonly ChangeResource[] };

export function showsDocument(req: OpenRequest | undefined, uri: Uri | undefined): boolean {
	if (!req || !uri) {
		return false;
	}
	const key = uri.toString();
	const same = (candidate: Uri | undefined) => candidate?.toString() === key;
	switch (req.kind) {
		case 'diff': return same(req.left) || same(req.right);
		case 'file': return same(req.uri);
		case 'changes': return req.resources.some(r => same(r.label) || same(r.original) || same(r.modified));
	}
}
```

`diffWindow.ts`:
- `tabMatches` для `changes`: вкладка с `input.textDiffs` (массив) и `label === title` или `label.startsWith(title + ' (')`.
- `sameRequest` для `changes`: одинаковые `title` и число `resources`.
- `open()` принимает только `diff | file` (тип `Exclude<OpenRequest, {kind:'changes'}>`).
- `show(req)`: для `changes` — `showChanges(req)`:

```ts
  private async showChanges(req: ChangesRequest): Promise<void> {
    const first = req.resources[0];
    if (!first) {
      return;
    }
    // A plain diff first: it creates (sized) or reuses our window and focuses it,
    // so the multi-file diff below opens in our window, the active group.
    const placeholder: SingleRequest = first.original && first.modified
      ? { kind: "diff", left: first.original, right: first.modified, title: req.title }
      : { kind: "file", uri: first.modified ?? first.original ?? first.label, title: req.title };
    await this.showSingle(placeholder);
    await vscode.commands.executeCommand(
      "vscode.changes",
      req.title,
      req.resources.map((r) => [r.label, r.original, r.modified]),
    );
    const group = this.resolveGroup();
    this.current = req;
    const leftovers = group?.tabs.filter((t) => tabMatches(t, placeholder) && !t.isDirty) ?? [];
    if (leftovers.length > 0) {
      await vscode.window.tabGroups.close(leftovers, true);
    }
    this.sync();
  }
```

(Текущий `show` переименовывается в `showSingle(req: SingleRequest)`; `show` выбирает между ними.)

- [ ] **Step 4: Run** `npm test` → PASS.

### Task 4: `gitRunner` и `BranchService`

**Files:** Create `src/branches/gitRunner.ts`, `src/branches/branchService.ts`; modify `src/git.ts`; test `src/test/integration/branchService.test.ts`.

**Interfaces — Consumes:** `branchModel` (Task 2), `OpenRequest` вида `changes` (Task 3). **Produces:** `GitRunner`, `createGitRunner(gitPath, cwd)`, `BranchService { list(); checkout(b, all); create(name, from?); rename(b, name); delete(b, force?); merge(b); rebaseOnto(b); pullRebase(b); compare(b, current); diffWithWorkingTree(b) }`, `BranchList { branches; recent; current? }`.

- [ ] **Step 1: Типы Git API** — `src/git.ts`: `Branch { name?; commit?; upstream?: {remote; name}; ahead?; behind? }`; `RepositoryState.HEAD?: Branch`; `RepositoryOperations { status(); checkout(treeish); createBranch(name, checkout, ref?); deleteBranch(name, force?); merge(ref); fetch(remote?, ref?); diffBetween(ref1, ref2): Promise<Change[]>; diffWith(ref): Promise<Change[]> }`; `API.git: { path: string }`; `API.getRepository(uri): (Repository & RepositoryOperations) | null`.
- [ ] **Step 2: Падающий интеграционный тест** — `branchService.test.ts`: во временной папке bare-репозиторий `origin.git` и рабочий `work` (`git init -b main`, identity в `git config`, коммит `a.txt`, `remote add origin`, `push -u origin main`; ветка `feature` с коммитом `b.txt`, `push -u origin feature`; ветка `topic` без новых коммитов; `push origin main:refs/heads/remote-only`; `fetch`; `checkout main`). `git.openRepository(work)`, дождаться `api.getRepository(Uri.file(work))`. `service = new BranchService(repo, createGitRunner(api.git.path, work), api.toGitUri)`. Кейсы:
  1. `list()`: current `main`; локальные `feature`, `topic`; удалённые `origin/feature`, `origin/remote-only`, нет `origin/HEAD`; `topic.merged === true`, `feature.merged === false`; `recent` содержит `main`.
  2. `checkout(feature)` → `repo.state.HEAD.name === 'feature'`.
  3. `checkout(origin/remote-only)` → локальная `remote-only` с `upstream === 'origin/remote-only'`.
  4. `create('new-one', 'main')` → HEAD `new-one`.
  5. `rename(topic, 'topic2')` → в `list()` есть `topic2`, нет `topic`.
  6. `delete(topic2)` → нет `topic2`.
  7. `compare(feature, 'main')` → `changes`, среди `resources` метка `b.txt`, у неё нет `original` (файл добавлен).
  8. `diffWithWorkingTree(main)` после правки `a.txt` → `changes` с `a.txt`, `modified` — рабочий файл.
  9. `merge(feature)` на `main` → `b.txt` есть в рабочем дереве.
- [ ] **Step 3: Run** `npm run test:integration` → FAIL (нет модулей).
- [ ] **Step 4: Реализация** — `gitRunner.ts`:

```ts
import { execFile } from 'child_process';

/** Runs git with `args` in the repository and resolves with its stdout. */
export type GitRunner = (args: readonly string[]) => Promise<string>;

export function createGitRunner(gitPath: string, cwd: string): GitRunner {
	return args => new Promise((resolve, reject) => {
		execFile(gitPath, [...args], { cwd, maxBuffer: 16 * 1024 * 1024 }, (error, stdout, stderr) => {
			if (error) {
				reject(new Error(stderr.trim() || error.message));
			} else {
				resolve(stdout);
			}
		});
	});
}
```

`branchService.ts`:

```ts
import type { Uri } from 'vscode';
import { Change, Repository, RepositoryOperations, Status } from '../git';
import type { ChangeResource, OpenRequest } from '../openRequest';
import { BranchInfo, FOR_EACH_REF_FORMAT, localName, parseBranches, parseLines, parseRecent } from './branchModel';
import type { GitRunner } from './gitRunner';

export interface BranchList {
	readonly branches: BranchInfo[];
	readonly recent: string[];
	readonly current?: BranchInfo;
}

const ADDED = new Set([Status.INDEX_ADDED, Status.UNTRACKED, Status.INTENT_TO_ADD]);
const DELETED = new Set([Status.INDEX_DELETED, Status.DELETED]);

/** Branch operations of one repository: Git API for anything networked, plain git for local refs. */
export class BranchService {
	constructor(
		readonly repository: Repository & RepositoryOperations,
		private readonly git: GitRunner,
		private readonly toGitUri: (uri: Uri, ref: string) => Uri,
	) { }

	async list(): Promise<BranchList> {
		const [refs, merged, reflog] = await Promise.all([
			this.git(['for-each-ref', `--format=${FOR_EACH_REF_FORMAT}`, 'refs/heads', 'refs/remotes']),
			this.git(['for-each-ref', '--merged=HEAD', '--format=%(refname:short)', 'refs/heads']).catch(() => ''),
			this.git(['reflog', '--format=%gs', '-n', '300']).catch(() => ''),
		]);
		const branches = parseBranches(refs, new Set(parseLines(merged)));
		return { branches, recent: parseRecent(reflog), current: branches.find(b => b.current) };
	}

	/** A remote branch checks out as a local tracking branch, like WebStorm. */
	async checkout(branch: BranchInfo, all: readonly BranchInfo[]): Promise<void> {
		const name = localName(branch);
		if (!branch.remote || all.some(b => !b.remote && b.name === name)) {
			await this.repository.checkout(name);
			return;
		}
		await this.repository.createBranch(name, true, branch.name);
		await this.git(['branch', `--set-upstream-to=${branch.name}`, name]);
		await this.repository.status();
	}

	create(name: string, from?: string): Promise<void> {
		return this.repository.createBranch(name, true, from);
	}

	async rename(branch: BranchInfo, newName: string): Promise<void> {
		await this.git(['branch', '-m', branch.name, newName]);
		await this.repository.status();
	}

	delete(branch: BranchInfo, force = false): Promise<void> {
		return this.repository.deleteBranch(branch.name, force);
	}

	merge(branch: BranchInfo): Promise<void> {
		return this.repository.merge(branch.name);
	}

	async rebaseOnto(branch: BranchInfo): Promise<void> {
		try {
			await this.git(['rebase', branch.name]);
		} finally {
			await this.repository.status();
		}
	}

	async pullRebase(branch: BranchInfo): Promise<void> {
		await this.repository.fetch(branch.remote, localName(branch));
		await this.rebaseOnto(branch);
	}

	/** What `branch` changed since it forked from `current` (`current...branch`). */
	async compare(branch: BranchInfo, current: string): Promise<OpenRequest | undefined> {
		const [changes, base] = await Promise.all([
			this.repository.diffBetween(current, branch.name),
			this.git(['merge-base', current, branch.name]).then(out => out.trim()),
		]);
		return this.request(`${current} ↔ ${branch.name}`, changes, uri => this.toGitUri(uri, base), uri => this.toGitUri(uri, branch.name));
	}

	async diffWithWorkingTree(branch: BranchInfo): Promise<OpenRequest | undefined> {
		const changes = await this.repository.diffWith(branch.name);
		return this.request(`${branch.name} ↔ working tree`, changes, uri => this.toGitUri(uri, branch.name), uri => uri);
	}

	private request(title: string, changes: readonly Change[], left: (uri: Uri) => Uri, right: (uri: Uri) => Uri): OpenRequest | undefined {
		if (changes.length === 0) {
			return undefined;
		}
		const resources = changes.map((change): ChangeResource => ({
			label: change.uri,
			original: ADDED.has(change.status) ? undefined : left(change.originalUri),
			modified: DELETED.has(change.status) ? undefined : right(change.uri),
		}));
		return { kind: 'changes', title, resources };
	}
}
```

- [ ] **Step 5: Run** `npm test` → PASS.

### Task 5: Popup, статус-бар и подключение

**Files:** Create `src/branches/branchesPopup.ts`, `src/branches/statusBar.ts`; modify `src/extension.ts`, `package.json`; test `src/test/integration/extension.test.ts`.

- [ ] **Step 1: Падающий тест** — в `extension.test.ts` список команд дополняется `gitPro.branches`.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: `package.json`** — команда `{ "command": "gitPro.branches", "title": "Branches…", "category": "Git Pro", "icon": "$(git-branch)" }`.
- [ ] **Step 4: `statusBar.ts`**:

```ts
import * as vscode from 'vscode';
import type { Repository } from '../git';
import { syncLabel } from './branchModel';

/** `$(git-branch) main* ↓2 ↑1` on the left of the status bar; opens the branches popup. */
export class BranchStatusItem implements vscode.Disposable {
	private readonly item = vscode.window.createStatusBarItem('gitPro.branch', vscode.StatusBarAlignment.Left, 10000);

	constructor(private readonly repository: () => Repository | undefined) {
		this.item.name = 'Git Pro Branch';
		this.item.command = 'gitPro.branches';
		this.item.tooltip = 'Git Pro: Branches';
	}

	update(): void {
		const state = this.repository()?.state;
		const head = state?.HEAD;
		if (!state || !head) {
			this.item.hide();
			return;
		}
		const name = head.name ?? head.commit?.slice(0, 8) ?? 'HEAD';
		const dirty = state.workingTreeChanges.length + state.indexChanges.length > 0 ? '*' : '';
		const sync = syncLabel({ ahead: head.ahead ?? 0, behind: head.behind ?? 0 });
		this.item.text = `$(git-branch) ${name}${dirty}${sync ? ` ${sync}` : ''}`;
		this.item.show();
	}

	dispose(): void {
		this.item.dispose();
	}
}
```

- [ ] **Step 5: `branchesPopup.ts`** — один `QuickPick` с двумя страницами:
  - страница веток: `title: 'Git Branches'`, `placeholder: 'Search branches and remotes… (Enter: checkout)'`, кнопка заголовка `$(add)` «New branch»; элементы: разделитель `<group> · <N>` и строки `{ label: name, description: branchDescription(b), iconPath: remote ? $(cloud) : current ? $(git-branch) цвета charts.blue : $(git-branch), buttons: [$(ellipsis) More actions], branch }`; на `onDidChangeValue` элементы перестраиваются (`searching = value !== ''`); если значение допустимо (`isValidBranchName`) и не совпадает с именем ветки — первым идёт `{ label: '$(add) Create branch "<v>"', alwaysShow: true, create: v }`;
  - Enter: ветка → `checkout`; create → `create(v)`;
  - кнопка `…` → страница действий: `title` = имя ветки, кнопка `QuickInputButtons.Back`, элементы `branchActions(b, current)` с разделителями между группами; Enter → действие; Back → страница веток;
  - `$(add)` → `showInputBox` (валидация `isValidBranchName`) → `create(name)`;
  - действия: `newBranch` → InputBox → `create(name, b.name)`; `rename` → InputBox со значением → `rename`; `delete` → модальное `Delete branch "<b>"?` → `delete(b)`; ошибка с `not fully merged` → модальное `Branch "<b>" is not fully merged. Delete anyway?` → `delete(b, true)`; `compare`/`diffWorkingTree` → запрос → `diffWindow.show(req)`, `undefined` → `Git Pro: no differences.`; прочие — соответствующий метод сервиса;
  - каждое действие в `withProgress({ location: ProgressLocation.Window, title })`; ошибка → `showErrorMessage('Git Pro: ' + message, 'Show Git Output')` → `git.showOutput`.
- [ ] **Step 6: `extension.ts`** — Git API получается один раз (`getGitApi`); `activeRepository()` = репозиторий файла активного редактора, иначе первый; регистрируется `gitPro.branches` (без репозитория — `Git Pro: no Git repository is open.`); `BranchStatusItem.update` подписан на `state.onDidChange` каждого репозитория (и новых через `onDidOpenRepository`) и на `onDidChangeActiveTextEditor`.
- [ ] **Step 7: Run** `npm test` → PASS.

### Task 6: Сборка и установка

- [ ] **Step 1:** `npm run package` → `git-pro-0.2.0.vsix`.
- [ ] **Step 2:** `code --uninstall-extension local.floating-diff` и `code --install-extension git-pro-0.2.0.vsix --force`; `code --list-extensions --show-versions | grep -E 'floating-diff|git-pro'` → только `local.git-pro@0.2.0`.
- [ ] **Step 3:** Передать ручной чек-лист (спека, раздел 8).
