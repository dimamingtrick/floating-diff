# Floating Diff Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Расширение VS Code/Cursor, которое открывает дифф изменённого файла в отдельном плавающем окне (иконка в Source Control и Quick Pick по ⌃⌥D), Esc закрывает окно.

**Architecture:** Чистые функции решают, *что* открыть (`openRequest.ts`, `gitChanges.ts`), они покрыты unit-тестами без VS Code. `DiffWindow` управляет плавающим окном через внутреннюю команду `workbench.action.newEmptyEditorWindow` и `ViewColumn` группы окна, покрыт интеграционными тестами в настоящем VS Code. `extension.ts` связывает команды, меню и хоткеи.

**Tech Stack:** TypeScript ~5.9, esbuild, mocha, @vscode/test-cli + @vscode/test-electron, @vscode/vsce, @types/vscode 1.90.0.

**Spec:** `docs/superpowers/specs/2026-09-18-floating-diff-design.md`

## Global Constraints

- `engines.vscode: ^1.90.0`; `@types/vscode` ровно `1.90.0` — не использовать API новее.
- `name: floating-diff`, `displayName: Floating Diff`, `publisher: local`, `version: 0.1.0`.
- Идентификаторы команд: `floatingDiff.openScmResource`, `floatingDiff.pickChange`, `floatingDiff.close`; context key `floatingDiff.focused`.
- Хоткеи: `ctrl+alt+d` → `floatingDiff.pickChange`; `escape` → `floatingDiff.close` с условием из спеки 5.5 (копируется дословно).
- Тексты UI на английском: `Floating Diff: the built-in Git extension is disabled.`, `Floating Diff: no changes.`, `Floating Diff: floating windows are unavailable, opened as a regular tab.`
- Не опираться на идентичность объектов `TabGroup` и на запомненный `viewColumn` (спека, раздел 4).

## Уточнения к спеке (решения при планировании)

1. Вместо копии `git.d.ts` — минимальное подмножество типов в `src/git.ts`. Причина: upstream объявляет `Status` как `const enum` в `.d.ts`, esbuild не может такое забандлить. У нас обычный `enum` с теми же числовыми значениями.
2. Функции Git API разделены: чистые (`gitChanges.ts`: `listChanges`, `indexRenameOf`, `statusLetter`) и зависящие от runtime VS Code (`gitApi.ts`: `getGitApi`). Так чистые функции тестируются без VS Code.
3. Фикстура интеграционных тестов — временная папка с обычными файлами, без git: `DiffWindow` работает с любыми URI, маппинг git покрыт unit-тестами.
4. `DiffWindow` помнит ссылку на свою группу и сбрасывает её по `onDidChangeTabGroups(e).closed`. Поиск по содержимому — только fallback, когда объект группы пересоздан (старые сборки, Cursor). Иначе дубль того же диффа в основном окне мог бы «перехватить» окно.

---

### Task 1: Каркас проекта, типы Git и `openRequest.ts`

**Files:**
- Create: `package.json`, `tsconfig.json`, `.gitignore`, `.mocharc.json`
- Create: `src/git.ts`, `src/openRequest.ts`
- Test: `src/test/unit/openRequest.test.ts`

**Interfaces:**
- Produces: `enum Status`, `interface Change/RepositoryState/Repository/API/GitExtension` (`src/git.ts`); `type OpenRequest`, `interface ChangeDeps`, `fromScmCommand(cmd: Command | undefined): OpenRequest | undefined`, `fromChange(change: Change, deps: ChangeDeps): OpenRequest | undefined` (`src/openRequest.ts`).

- [ ] **Step 1: Манифест и конфиги**

`package.json`:

```json
{
  "name": "floating-diff",
  "displayName": "Floating Diff",
  "description": "Open Source Control diffs in a floating window. Esc closes it.",
  "version": "0.1.0",
  "publisher": "local",
  "engines": {
    "vscode": "^1.90.0"
  },
  "categories": [
    "SCM Providers",
    "Other"
  ],
  "scripts": {
    "test:unit": "tsc -p . && mocha"
  }
}
```

`tsconfig.json`:

```json
{
  "compilerOptions": {
    "module": "commonjs",
    "target": "ES2022",
    "lib": ["ES2022"],
    "outDir": "out",
    "rootDir": "src",
    "strict": true,
    "sourceMap": true,
    "skipLibCheck": true,
    "esModuleInterop": true
  },
  "include": ["src"]
}
```

`.mocharc.json`:

```json
{
  "spec": "out/test/unit/**/*.test.js"
}
```

`.gitignore`:

```
node_modules/
out/
dist/
.vscode-test/
*.vsix
```

- [ ] **Step 2: Установить dev-зависимости**

Run: `npm install -D typescript@~5.9.0 @types/vscode@1.90.0 @types/node@20 @types/mocha mocha`
Expected: `added N packages`, без ошибок.

- [ ] **Step 3: Типы Git API — `src/git.ts`**

```ts
import type { Uri } from 'vscode';

/**
 * Subset of the built-in Git extension API
 * (microsoft/vscode: extensions/git/src/api/git.d.ts).
 * Upstream declares `Status` as a `const enum` in a .d.ts, which esbuild cannot
 * bundle, so this is a regular enum. Numeric values must match upstream.
 */
export enum Status {
	INDEX_MODIFIED,
	INDEX_ADDED,
	INDEX_DELETED,
	INDEX_RENAMED,
	INDEX_COPIED,
	MODIFIED,
	DELETED,
	UNTRACKED,
	IGNORED,
	INTENT_TO_ADD,
	INTENT_TO_RENAME,
	TYPE_CHANGED,
	ADDED_BY_US,
	ADDED_BY_THEM,
	DELETED_BY_US,
	DELETED_BY_THEM,
	BOTH_ADDED,
	BOTH_DELETED,
	BOTH_MODIFIED,
}

export interface Change {
	readonly uri: Uri;
	readonly originalUri: Uri;
	readonly renameUri: Uri | undefined;
	readonly status: Status;
}

export interface RepositoryState {
	readonly indexChanges: Change[];
	readonly workingTreeChanges: Change[];
	/** Absent in older VS Code versions. */
	readonly untrackedChanges?: Change[];
	readonly mergeChanges: Change[];
}

export interface Repository {
	readonly rootUri: Uri;
	readonly state: RepositoryState;
}

export interface API {
	readonly repositories: Repository[];
	toGitUri(uri: Uri, ref: string): Uri;
}

export interface GitExtension {
	readonly enabled: boolean;
	getAPI(version: 1): API;
}
```

- [ ] **Step 4: Падающий тест — `src/test/unit/openRequest.test.ts`**

```ts
import * as assert from 'assert';
import type { Command, Uri } from 'vscode';
import { Change, Status } from '../../git';
import { ChangeDeps, fromChange, fromScmCommand, OpenRequest } from '../../openRequest';

// Minimal stand-ins for vscode.Uri: the code under test only uses `path` and `toString()`.
function fileUri(path: string): Uri {
	return { scheme: 'file', path, toString: () => `file://${path}` } as unknown as Uri;
}

function toGitUri(uri: Uri, ref: string): Uri {
	return { scheme: 'git', path: uri.path, toString: () => `git://${uri.path}?ref=${ref}` } as unknown as Uri;
}

function deps(indexRename?: Uri): ChangeDeps {
	return { toGitUri, indexRenameOf: () => indexRename };
}

function plain(req: OpenRequest | undefined): unknown {
	if (!req) {
		return undefined;
	}
	return req.kind === 'diff'
		? { kind: 'diff', left: req.left.toString(), right: req.right.toString(), title: req.title }
		: { kind: 'file', uri: req.uri.toString(), title: req.title };
}

const A = fileUri('/repo/src/a.ts');
const OLD = fileUri('/repo/src/old.ts');
const NEW = fileUri('/repo/src/new.ts');

function change(status: Status, uri: Uri = A, originalUri: Uri = uri): Change {
	return { status, uri, originalUri, renameUri: undefined };
}

describe('fromChange', () => {
	const cases: Array<[string, Change, ChangeDeps, unknown]> = [
		['INDEX_MODIFIED', change(Status.INDEX_MODIFIED), deps(),
			{ kind: 'diff', left: 'git:///repo/src/a.ts?ref=HEAD', right: 'git:///repo/src/a.ts?ref=', title: 'a.ts (Index)' }],
		['INDEX_RENAMED', change(Status.INDEX_RENAMED, NEW, OLD), deps(),
			{ kind: 'diff', left: 'git:///repo/src/old.ts?ref=HEAD', right: 'git:///repo/src/new.ts?ref=', title: 'new.ts (Index)' }],
		['INDEX_ADDED', change(Status.INDEX_ADDED), deps(),
			{ kind: 'file', uri: 'git:///repo/src/a.ts?ref=', title: 'a.ts (Index)' }],
		['INDEX_COPIED', change(Status.INDEX_COPIED), deps(),
			{ kind: 'file', uri: 'git:///repo/src/a.ts?ref=', title: 'a.ts' }],
		['INDEX_DELETED', change(Status.INDEX_DELETED), deps(),
			{ kind: 'file', uri: 'git:///repo/src/a.ts?ref=HEAD', title: 'a.ts (Deleted)' }],
		['DELETED', change(Status.DELETED), deps(),
			{ kind: 'file', uri: 'git:///repo/src/a.ts?ref=HEAD', title: 'a.ts (Deleted)' }],
		['MODIFIED', change(Status.MODIFIED), deps(),
			{ kind: 'diff', left: 'git:///repo/src/a.ts?ref=~', right: 'file:///repo/src/a.ts', title: 'a.ts (Working Tree)' }],
		['MODIFIED renamed in index', change(Status.MODIFIED), deps(NEW),
			{ kind: 'diff', left: 'git:///repo/src/a.ts?ref=~', right: 'file:///repo/src/new.ts', title: 'a.ts (Working Tree)' }],
		['TYPE_CHANGED', change(Status.TYPE_CHANGED), deps(),
			{ kind: 'diff', left: 'git:///repo/src/a.ts?ref=HEAD', right: 'file:///repo/src/a.ts', title: 'a.ts (Type changed)' }],
		['INTENT_TO_RENAME', change(Status.INTENT_TO_RENAME, NEW, OLD), deps(),
			{ kind: 'diff', left: 'git:///repo/src/old.ts?ref=HEAD', right: 'file:///repo/src/new.ts', title: 'new.ts (Intent to add)' }],
		['UNTRACKED', change(Status.UNTRACKED), deps(),
			{ kind: 'file', uri: 'file:///repo/src/a.ts', title: 'a.ts (Untracked)' }],
		['INTENT_TO_ADD', change(Status.INTENT_TO_ADD), deps(),
			{ kind: 'file', uri: 'file:///repo/src/a.ts', title: 'a.ts (Intent to add)' }],
		['IGNORED', change(Status.IGNORED), deps(), undefined],
		['BOTH_MODIFIED', change(Status.BOTH_MODIFIED), deps(), undefined],
		['DELETED_BY_US', change(Status.DELETED_BY_US), deps(), undefined],
	];

	for (const [name, input, d, expected] of cases) {
		it(name, () => {
			assert.deepStrictEqual(plain(fromChange(input, d)), expected);
		});
	}
});

describe('fromScmCommand', () => {
	const L = toGitUri(A, '~');

	it('maps vscode.diff', () => {
		const cmd: Command = { command: 'vscode.diff', title: 'Open', arguments: [L, A, 'a.ts (Working Tree)'] };
		assert.deepStrictEqual(plain(fromScmCommand(cmd)),
			{ kind: 'diff', left: 'git:///repo/src/a.ts?ref=~', right: 'file:///repo/src/a.ts', title: 'a.ts (Working Tree)' });
	});

	it('uses the right basename when vscode.diff has no title', () => {
		const cmd: Command = { command: 'vscode.diff', title: 'Open', arguments: [L, A] };
		assert.deepStrictEqual(plain(fromScmCommand(cmd)),
			{ kind: 'diff', left: 'git:///repo/src/a.ts?ref=~', right: 'file:///repo/src/a.ts', title: 'a.ts' });
	});

	it('maps vscode.open with a title', () => {
		const cmd: Command = { command: 'vscode.open', title: 'Open', arguments: [A, { override: undefined }, 'a.ts (Untracked)'] };
		assert.deepStrictEqual(plain(fromScmCommand(cmd)), { kind: 'file', uri: 'file:///repo/src/a.ts', title: 'a.ts (Untracked)' });
	});

	it('maps vscode.open without a title', () => {
		const cmd: Command = { command: 'vscode.open', title: 'Open', arguments: [A] };
		assert.deepStrictEqual(plain(fromScmCommand(cmd)), { kind: 'file', uri: 'file:///repo/src/a.ts', title: 'a.ts' });
	});

	it('ignores other commands', () => {
		const cmd: Command = { command: 'git.openMergeEditor', title: 'Open Merge', arguments: [A] };
		assert.strictEqual(fromScmCommand(cmd), undefined);
	});

	it('ignores a missing command', () => {
		assert.strictEqual(fromScmCommand(undefined), undefined);
	});

	it('ignores vscode.diff with non-URI arguments', () => {
		const cmd: Command = { command: 'vscode.diff', title: 'Open', arguments: ['a', 'b'] };
		assert.strictEqual(fromScmCommand(cmd), undefined);
	});
});
```

- [ ] **Step 5: Убедиться, что тест падает**

Run: `npm run test:unit`
Expected: FAIL — `tsc` сообщает `Cannot find module '../../openRequest'`.

- [ ] **Step 6: Реализация — `src/openRequest.ts`**

```ts
import * as path from 'path';
import type { Command, Uri } from 'vscode';
import { Change, Status } from './git';

/** What to show in the floating window. */
export type OpenRequest =
	| { readonly kind: 'diff'; readonly left: Uri; readonly right: Uri; readonly title: string }
	| { readonly kind: 'file'; readonly uri: Uri; readonly title: string };

export interface ChangeDeps {
	toGitUri(uri: Uri, ref: string): Uri;
	/** Rename target of `uri` in the index, if the file was renamed there. */
	indexRenameOf(uri: Uri): Uri | undefined;
}

function basename(uri: Uri): string {
	return path.posix.basename(uri.path);
}

function isUri(value: unknown): value is Uri {
	return typeof value === 'object' && value !== null && typeof (value as Uri).path === 'string';
}

/** Reuses the click command of a built-in Git resource state (`vscode.diff` / `vscode.open`). */
export function fromScmCommand(cmd: Command | undefined): OpenRequest | undefined {
	const [first, second, third]: unknown[] = cmd?.arguments ?? [];
	const title = typeof third === 'string' && third !== '' ? third : undefined;
	if (cmd?.command === 'vscode.diff' && isUri(first) && isUri(second)) {
		return { kind: 'diff', left: first, right: second, title: title ?? basename(second) };
	}
	if (cmd?.command === 'vscode.open' && isUri(first)) {
		return { kind: 'file', uri: first, title: title ?? basename(first) };
	}
	return undefined;
}

const TITLE_SUFFIX: Partial<Record<Status, string>> = {
	[Status.INDEX_MODIFIED]: 'Index',
	[Status.INDEX_RENAMED]: 'Index',
	[Status.INDEX_ADDED]: 'Index',
	[Status.MODIFIED]: 'Working Tree',
	[Status.INDEX_DELETED]: 'Deleted',
	[Status.DELETED]: 'Deleted',
	[Status.UNTRACKED]: 'Untracked',
	[Status.INTENT_TO_ADD]: 'Intent to add',
	[Status.INTENT_TO_RENAME]: 'Intent to add',
	[Status.TYPE_CHANGED]: 'Type changed',
};

/**
 * Mirrors getLeftResource/getRightResource/getTitle of the built-in Git
 * extension (extensions/git/src/repository.ts). Merge conflicts are out of scope.
 */
export function fromChange(change: Change, deps: ChangeDeps): OpenRequest | undefined {
	const { uri, originalUri, status } = change;
	const workingTree = (): Uri => deps.indexRenameOf(uri) ?? uri;
	let left: Uri | undefined;
	let right: Uri;
	switch (status) {
		case Status.INDEX_MODIFIED:
		case Status.INDEX_RENAMED:
			left = deps.toGitUri(originalUri, 'HEAD');
			right = deps.toGitUri(uri, '');
			break;
		case Status.INDEX_ADDED:
		case Status.INDEX_COPIED:
			right = deps.toGitUri(uri, '');
			break;
		case Status.INDEX_DELETED:
		case Status.DELETED:
			right = deps.toGitUri(uri, 'HEAD');
			break;
		case Status.MODIFIED:
			left = deps.toGitUri(uri, '~');
			right = workingTree();
			break;
		case Status.TYPE_CHANGED:
		case Status.INTENT_TO_RENAME:
			left = deps.toGitUri(originalUri, 'HEAD');
			right = workingTree();
			break;
		case Status.UNTRACKED:
		case Status.INTENT_TO_ADD:
			right = workingTree();
			break;
		default:
			return undefined;
	}
	const suffix = TITLE_SUFFIX[status];
	const title = suffix ? `${basename(uri)} (${suffix})` : basename(uri);
	return left ? { kind: 'diff', left, right, title } : { kind: 'file', uri: right, title };
}
```

- [ ] **Step 7: Тесты проходят**

Run: `npm run test:unit`
Expected: PASS, 22 passing.

- [ ] **Step 8: Commit**

```bash
git add package.json package-lock.json tsconfig.json .gitignore .mocharc.json src/git.ts src/openRequest.ts src/test/unit/openRequest.test.ts
git commit -m "feat: map Git changes and SCM commands to open requests"
```

---

### Task 2: `gitChanges.ts` — список изменений, rename в индексе, буквы статусов

**Files:**
- Create: `src/gitChanges.ts`
- Test: `src/test/unit/gitChanges.test.ts`

**Interfaces:**
- Consumes: `API`, `Change`, `Repository`, `Status` из `src/git.ts`.
- Produces: `type ChangeGroup = 'index' | 'workingTree' | 'untracked'`, `interface ChangeItem { repository: Repository; group: ChangeGroup; change: Change }`, `listChanges(api: API): ChangeItem[]`, `indexRenameOf(repository: Repository, uri: Uri): Uri | undefined`, `statusLetter(status: Status): string`.

- [ ] **Step 1: Падающий тест — `src/test/unit/gitChanges.test.ts`**

```ts
import * as assert from 'assert';
import type { Uri } from 'vscode';
import { API, Change, Repository, RepositoryState, Status } from '../../git';
import { indexRenameOf, listChanges, statusLetter } from '../../gitChanges';

function fileUri(path: string): Uri {
	return { scheme: 'file', path, toString: () => `file://${path}` } as unknown as Uri;
}

function change(path: string, status: Status, renameUri?: Uri): Change {
	const uri = fileUri(path);
	return { uri, originalUri: uri, renameUri, status };
}

function repo(root: string, state: Partial<RepositoryState>): Repository {
	return {
		rootUri: fileUri(root),
		state: { indexChanges: [], workingTreeChanges: [], mergeChanges: [], ...state },
	};
}

function api(...repositories: Repository[]): API {
	return { repositories, toGitUri: uri => uri };
}

describe('listChanges', () => {
	it('lists index, working tree and untracked changes per repository, skipping merge changes', () => {
		const r1 = repo('/r1', {
			indexChanges: [change('/r1/staged.ts', Status.INDEX_MODIFIED)],
			workingTreeChanges: [change('/r1/edited.ts', Status.MODIFIED)],
			untrackedChanges: [change('/r1/new.ts', Status.UNTRACKED)],
			mergeChanges: [change('/r1/conflict.ts', Status.BOTH_MODIFIED)],
		});
		const r2 = repo('/r2', { workingTreeChanges: [change('/r2/x.ts', Status.DELETED)] });

		const items = listChanges(api(r1, r2)).map(i => `${i.repository.rootUri.path} ${i.group} ${i.change.uri.path}`);

		assert.deepStrictEqual(items, [
			'/r1 index /r1/staged.ts',
			'/r1 workingTree /r1/edited.ts',
			'/r1 untracked /r1/new.ts',
			'/r2 workingTree /r2/x.ts',
		]);
	});

	it('tolerates a missing untrackedChanges field (older VS Code)', () => {
		const r = repo('/r', { workingTreeChanges: [change('/r/a.ts', Status.MODIFIED)] });
		assert.strictEqual(listChanges(api(r)).length, 1);
	});
});

describe('indexRenameOf', () => {
	const target = fileUri('/r/renamed.ts');
	const r = repo('/r', {
		indexChanges: [change('/r/a.ts', Status.INDEX_RENAMED, target), change('/r/b.ts', Status.INDEX_MODIFIED)],
	});

	it('returns the rename target from the index', () => {
		assert.strictEqual(indexRenameOf(r, fileUri('/r/a.ts')), target);
	});

	it('returns undefined when the file was not renamed', () => {
		assert.strictEqual(indexRenameOf(r, fileUri('/r/b.ts')), undefined);
	});

	it('returns undefined when the file is not in the index', () => {
		assert.strictEqual(indexRenameOf(r, fileUri('/r/c.ts')), undefined);
	});
});

describe('statusLetter', () => {
	const cases: Array<[Status, string]> = [
		[Status.INDEX_MODIFIED, 'M'], [Status.MODIFIED, 'M'],
		[Status.INDEX_ADDED, 'A'],
		[Status.INDEX_DELETED, 'D'], [Status.DELETED, 'D'],
		[Status.INDEX_RENAMED, 'R'], [Status.INTENT_TO_RENAME, 'R'],
		[Status.INDEX_COPIED, 'C'],
		[Status.UNTRACKED, 'U'],
		[Status.TYPE_CHANGED, 'T'],
		[Status.INTENT_TO_ADD, 'I'],
		[Status.BOTH_MODIFIED, ''],
	];

	for (const [status, letter] of cases) {
		it(`${Status[status]} -> '${letter}'`, () => {
			assert.strictEqual(statusLetter(status), letter);
		});
	}
});
```

- [ ] **Step 2: Убедиться, что тест падает**

Run: `npm run test:unit`
Expected: FAIL — `Cannot find module '../../gitChanges'`.

- [ ] **Step 3: Реализация — `src/gitChanges.ts`**

```ts
import type { Uri } from 'vscode';
import { API, Change, Repository, Status } from './git';

export type ChangeGroup = 'index' | 'workingTree' | 'untracked';

export interface ChangeItem {
	readonly repository: Repository;
	readonly group: ChangeGroup;
	readonly change: Change;
}

/** All changes the floating window can show; merge conflicts are skipped. */
export function listChanges(api: API): ChangeItem[] {
	const items: ChangeItem[] = [];
	for (const repository of api.repositories) {
		const { indexChanges, workingTreeChanges, untrackedChanges = [] } = repository.state;
		for (const change of indexChanges) {
			items.push({ repository, group: 'index', change });
		}
		for (const change of workingTreeChanges) {
			items.push({ repository, group: 'workingTree', change });
		}
		for (const change of untrackedChanges) {
			items.push({ repository, group: 'untracked', change });
		}
	}
	return items;
}

export function indexRenameOf(repository: Repository, uri: Uri): Uri | undefined {
	const key = uri.toString();
	return repository.state.indexChanges.find(c => c.uri.toString() === key && c.renameUri)?.renameUri;
}

const LETTERS: Partial<Record<Status, string>> = {
	[Status.INDEX_MODIFIED]: 'M',
	[Status.MODIFIED]: 'M',
	[Status.INDEX_ADDED]: 'A',
	[Status.INDEX_DELETED]: 'D',
	[Status.DELETED]: 'D',
	[Status.INDEX_RENAMED]: 'R',
	[Status.INTENT_TO_RENAME]: 'R',
	[Status.INDEX_COPIED]: 'C',
	[Status.UNTRACKED]: 'U',
	[Status.TYPE_CHANGED]: 'T',
	[Status.INTENT_TO_ADD]: 'I',
};

export function statusLetter(status: Status): string {
	return LETTERS[status] ?? '';
}
```

- [ ] **Step 4: Тесты проходят**

Run: `npm run test:unit`
Expected: PASS, 39 passing.

- [ ] **Step 5: Commit**

```bash
git add src/gitChanges.ts src/test/unit/gitChanges.test.ts
git commit -m "feat: list Git changes for the quick pick"
```

---

### Task 3: `DiffWindow` + интеграционные тесты

**Files:**
- Create: `src/diffWindow.ts`, `.vscode-test.mjs`
- Test: `src/test/integration/diffWindow.test.ts`
- Modify: `package.json` (script `test:integration`, devDependencies)

**Interfaces:**
- Consumes: `OpenRequest` из `src/openRequest.ts`.
- Produces: `class DiffWindow implements vscode.Disposable { show(req: OpenRequest): Promise<void>; close(): Promise<void>; resolveGroup(): vscode.TabGroup | undefined; dispose(): void }`, `tabMatches(tab: vscode.Tab, req: OpenRequest): boolean`.

- [ ] **Step 1: Инструменты для интеграционных тестов**

Run: `npm install -D @vscode/test-cli @vscode/test-electron`
Expected: без ошибок.

В `package.json` → `scripts` добавить:

```json
"test:integration": "tsc -p . && vscode-test"
```

`.vscode-test.mjs`:

```js
import { defineConfig } from '@vscode/test-cli';

export default defineConfig({
	files: 'out/test/integration/**/*.test.js',
	version: 'stable',
	mocha: { ui: 'bdd', timeout: 20000 },
});
```

- [ ] **Step 2: Падающий тест — `src/test/integration/diffWindow.test.ts`**

```ts
import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import { DiffWindow, tabMatches } from '../../diffWindow';
import type { OpenRequest } from '../../openRequest';

async function waitFor(condition: () => boolean, what: string, timeoutMs = 5000): Promise<void> {
	const start = Date.now();
	while (!condition()) {
		if (Date.now() - start > timeoutMs) {
			throw new Error(`Timed out waiting for: ${what}`);
		}
		await new Promise(resolve => setTimeout(resolve, 50));
	}
}

describe('DiffWindow', () => {
	let dir: string;
	let win: DiffWindow;
	let groupsBefore: number;

	function diff(name: string): OpenRequest {
		const left = path.join(dir, `${name}.orig`);
		const right = path.join(dir, name);
		fs.writeFileSync(left, 'old\n');
		fs.writeFileSync(right, 'new\n');
		return { kind: 'diff', left: vscode.Uri.file(left), right: vscode.Uri.file(right), title: `${name} (Working Tree)` };
	}

	before(() => {
		dir = fs.mkdtempSync(path.join(os.tmpdir(), 'floating-diff-'));
	});

	beforeEach(() => {
		groupsBefore = vscode.window.tabGroups.all.length;
		win = new DiffWindow();
	});

	afterEach(async () => {
		await win.close();
		win.dispose();
		await waitFor(() => vscode.window.tabGroups.all.length === groupsBefore, 'window closed after test');
	});

	it('opens the first diff in a new floating window group', async () => {
		const req = diff('a.txt');
		await win.show(req);

		await waitFor(() => vscode.window.tabGroups.all.length === groupsBefore + 1, 'new group');
		const group = win.resolveGroup();
		assert.ok(group, 'our group is known');
		assert.strictEqual(group.tabs.length, 1);
		assert.ok(tabMatches(group.tabs[0], req), 'the tab shows the requested diff');
		assert.ok(group.tabs[0].input instanceof vscode.TabInputTextDiff);
	});

	it('reuses the window for the next file and keeps a single tab', async () => {
		await win.show(diff('a.txt'));
		await waitFor(() => vscode.window.tabGroups.all.length === groupsBefore + 1, 'new group');

		const second = diff('b.txt');
		await win.show(second);

		assert.strictEqual(vscode.window.tabGroups.all.length, groupsBefore + 1);
		const group = win.resolveGroup();
		assert.ok(group);
		await waitFor(() => group.tabs.length === 1, 'single tab');
		assert.ok(tabMatches(group.tabs[0], second));
	});

	it('closes the window', async () => {
		await win.show(diff('a.txt'));
		await waitFor(() => vscode.window.tabGroups.all.length === groupsBefore + 1, 'new group');

		await win.close();

		await waitFor(() => vscode.window.tabGroups.all.length === groupsBefore, 'group removed');
		assert.strictEqual(win.resolveGroup(), undefined);
	});
});
```

- [ ] **Step 3: Убедиться, что тест падает**

Run: `npm run test:integration`
Expected: FAIL — `tsc`: `Cannot find module '../../diffWindow'`.

- [ ] **Step 4: Реализация — `src/diffWindow.ts`**

```ts
import * as vscode from 'vscode';
import type { OpenRequest } from './openRequest';

/** Internal workbench command: creates a floating editor window and focuses its group. */
const NEW_WINDOW_COMMAND = 'workbench.action.newEmptyEditorWindow';
const FOCUSED_CONTEXT_KEY = 'floatingDiff.focused';
const NEW_GROUP_TIMEOUT_MS = 1000;

export function tabMatches(tab: vscode.Tab, req: OpenRequest): boolean {
	const input = tab.input;
	if (req.kind === 'diff') {
		return input instanceof vscode.TabInputTextDiff
			&& input.original.toString() === req.left.toString()
			&& input.modified.toString() === req.right.toString();
	}
	return input instanceof vscode.TabInputText && input.uri.toString() === req.uri.toString();
}

function sameRequest(a: OpenRequest, b: OpenRequest): boolean {
	if (a.kind === 'diff' && b.kind === 'diff') {
		return a.left.toString() === b.left.toString() && a.right.toString() === b.right.toString();
	}
	return a.kind === 'file' && b.kind === 'file' && a.uri.toString() === b.uri.toString();
}

/** One reusable floating window that shows a single diff at a time. */
export class DiffWindow implements vscode.Disposable {
	private group: vscode.TabGroup | undefined;
	private current: OpenRequest | undefined;
	private focused = false;
	private warnedFallback = false;
	private readonly subscriptions: vscode.Disposable[];

	constructor() {
		this.subscriptions = [
			vscode.window.tabGroups.onDidChangeTabGroups(e => {
				if (this.group && e.closed.includes(this.group)) {
					this.group = undefined;
					this.current = undefined;
				}
				this.sync();
			}),
			vscode.window.tabGroups.onDidChangeTabs(() => this.sync()),
		];
	}

	/** The editor group of our floating window, or undefined when it is closed. */
	resolveGroup(): vscode.TabGroup | undefined {
		const all = vscode.window.tabGroups.all;
		if (this.group && all.includes(this.group)) {
			return this.group;
		}
		// Older builds (e.g. Cursor) recreate TabGroup objects on layout changes:
		// find the group that shows our request. Floating windows come after the
		// main window, so the highest view column wins.
		const req = this.current;
		this.group = req
			? all.filter(g => g.tabs.some(t => tabMatches(t, req))).sort((a, b) => b.viewColumn - a.viewColumn)[0]
			: undefined;
		return this.group;
	}

	async show(req: OpenRequest): Promise<void> {
		const previous = this.current;
		let group = this.resolveGroup();
		if (!group) {
			group = await this.createWindowGroup();
			if (!group) {
				this.warnFallback();
			}
		}

		const options: vscode.TextDocumentShowOptions = {
			viewColumn: group?.viewColumn ?? vscode.ViewColumn.Active,
			preview: true,
			preserveFocus: false,
		};
		if (req.kind === 'diff') {
			await vscode.commands.executeCommand('vscode.diff', req.left, req.right, req.title, options);
		} else {
			await vscode.commands.executeCommand('vscode.open', req.uri, options, req.title);
		}

		this.group = group ?? vscode.window.tabGroups.activeTabGroup;
		this.current = req;
		if (previous && !sameRequest(previous, req)) {
			const stale = this.group.tabs.filter(t => tabMatches(t, previous) && !t.isDirty);
			if (stale.length > 0) {
				await vscode.window.tabGroups.close(stale, true);
			}
		}
		this.sync();
	}

	async close(): Promise<void> {
		const group = this.resolveGroup();
		const req = this.current;
		if (!group || !req) {
			return;
		}
		const ours = group.tabs.filter(t => tabMatches(t, req));
		if (ours.length > 0) {
			await vscode.window.tabGroups.close(ours);
		}
		// With `workbench.editor.closeEmptyGroups: false` the empty group, and so the window, stays open.
		if (vscode.window.tabGroups.all.includes(group) && group.tabs.length === 0) {
			await vscode.window.tabGroups.close(group);
		}
	}

	dispose(): void {
		for (const subscription of this.subscriptions) {
			subscription.dispose();
		}
		void vscode.commands.executeCommand('setContext', FOCUSED_CONTEXT_KEY, false);
	}

	private async createWindowGroup(): Promise<vscode.TabGroup | undefined> {
		let subscription: vscode.Disposable | undefined;
		let timer: ReturnType<typeof setTimeout> | undefined;
		const opened = new Promise<vscode.TabGroup | undefined>(resolve => {
			timer = setTimeout(() => resolve(undefined), NEW_GROUP_TIMEOUT_MS);
			subscription = vscode.window.tabGroups.onDidChangeTabGroups(e => {
				if (e.opened.length > 0) {
					resolve(e.opened[e.opened.length - 1]);
				}
			});
		});
		try {
			await vscode.commands.executeCommand(NEW_WINDOW_COMMAND);
			return await opened;
		} catch {
			return undefined;
		} finally {
			clearTimeout(timer);
			subscription?.dispose();
		}
	}

	private warnFallback(): void {
		if (this.warnedFallback) {
			return;
		}
		this.warnedFallback = true;
		void vscode.window.showWarningMessage('Floating Diff: floating windows are unavailable, opened as a regular tab.');
	}

	private sync(): void {
		const group = this.resolveGroup();
		const focused = group !== undefined && vscode.window.tabGroups.activeTabGroup === group;
		if (focused !== this.focused) {
			this.focused = focused;
			void vscode.commands.executeCommand('setContext', FOCUSED_CONTEXT_KEY, focused);
		}
	}
}
```

- [ ] **Step 5: Тесты проходят**

Run: `npm run test:integration`
Expected: скачивается VS Code stable в `.vscode-test/`, открывается отдельное окно, `3 passing`. Затем `npm run test:unit` — `39 passing`.

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json .vscode-test.mjs src/diffWindow.ts src/test/integration/diffWindow.test.ts
git commit -m "feat: open diffs in a reusable floating window"
```

---

### Task 4: Команды, Quick Pick, манифест, бандл и `.vsix`

**Files:**
- Create: `src/gitApi.ts`, `src/pickChange.ts`, `src/extension.ts`, `esbuild.mjs`, `.vscodeignore`, `README.md`
- Test: `src/test/integration/extension.test.ts`
- Modify: `package.json` (main, activation, contributes, scripts, devDependencies)

**Interfaces:**
- Consumes: `DiffWindow` (Task 3), `fromScmCommand`, `fromChange` (Task 1), `listChanges`, `indexRenameOf`, `statusLetter`, `ChangeItem`, `ChangeGroup` (Task 2), `API`, `GitExtension` (Task 1).
- Produces: `getGitApi(): Promise<API | undefined>`, `pickChange(diffWindow: DiffWindow): Promise<void>`, `activate(context)`, `deactivate()`; бандл `dist/extension.js`; `floating-diff-0.1.0.vsix`.

- [ ] **Step 1: Бандлер и упаковщик**

Run: `npm install -D esbuild @vscode/vsce`
Expected: без ошибок.

`esbuild.mjs`:

```js
import * as esbuild from 'esbuild';

const production = process.argv.includes('--production');
const watch = process.argv.includes('--watch');

const ctx = await esbuild.context({
	entryPoints: ['src/extension.ts'],
	bundle: true,
	format: 'cjs',
	platform: 'node',
	target: 'node18',
	outfile: 'dist/extension.js',
	external: ['vscode'],
	sourcemap: !production,
	minify: production,
	logLevel: 'info',
});

if (watch) {
	await ctx.watch();
} else {
	await ctx.rebuild();
	await ctx.dispose();
}
```

- [ ] **Step 2: Манифест — итоговый `package.json` (кроме `devDependencies`, их не трогаем)**

```json
{
  "name": "floating-diff",
  "displayName": "Floating Diff",
  "description": "Open Source Control diffs in a floating window. Esc closes it.",
  "version": "0.1.0",
  "publisher": "local",
  "engines": {
    "vscode": "^1.90.0"
  },
  "categories": [
    "SCM Providers",
    "Other"
  ],
  "extensionDependencies": [
    "vscode.git"
  ],
  "main": "./dist/extension.js",
  "activationEvents": [],
  "contributes": {
    "commands": [
      {
        "command": "floatingDiff.openScmResource",
        "title": "Open Diff in Floating Window",
        "icon": "$(multiple-windows)"
      },
      {
        "command": "floatingDiff.pickChange",
        "title": "Open Change…",
        "category": "Floating Diff"
      },
      {
        "command": "floatingDiff.close",
        "title": "Close Window",
        "category": "Floating Diff"
      }
    ],
    "menus": {
      "commandPalette": [
        { "command": "floatingDiff.openScmResource", "when": "false" },
        { "command": "floatingDiff.close", "when": "false" }
      ],
      "scm/resourceState/context": [
        {
          "command": "floatingDiff.openScmResource",
          "group": "inline",
          "when": "scmProvider == git && scmResourceGroup =~ /^(index|workingTree|untracked)$/"
        }
      ]
    },
    "keybindings": [
      {
        "command": "floatingDiff.pickChange",
        "key": "ctrl+alt+d"
      },
      {
        "command": "floatingDiff.close",
        "key": "escape",
        "when": "floatingDiff.focused && isAuxiliaryWindowFocusedContext && !findWidgetVisible && !suggestWidgetVisible && !parameterHintsVisible && !renameInputVisible && !referenceSearchVisible && !inSnippetMode && !inlineSuggestionVisible && !editorHasSelection && !editorHasMultipleSelections && !editorHoverVisible && !notificationToastsVisible && !inQuickOpen && !accessibleViewIsShown"
      }
    ]
  },
  "scripts": {
    "compile": "tsc -p . && node esbuild.mjs",
    "watch": "node esbuild.mjs --watch",
    "test:unit": "tsc -p . && mocha",
    "test:integration": "npm run compile && vscode-test",
    "test": "npm run test:unit && npm run test:integration",
    "vscode:prepublish": "tsc -p . --noEmit && node esbuild.mjs --production",
    "package": "vsce package --no-dependencies --skip-license --allow-missing-repository"
  }
}
```

`.vscodeignore`:

```
**
!dist/extension.js
!README.md
```

- [ ] **Step 3: Падающий smoke-тест — `src/test/integration/extension.test.ts`**

```ts
import * as assert from 'assert';
import * as vscode from 'vscode';

describe('extension', () => {
	it('activates and registers its commands', async () => {
		const extension = vscode.extensions.getExtension('local.floating-diff');
		assert.ok(extension, 'extension is installed in the test host');
		await extension.activate();

		const commands = await vscode.commands.getCommands(true);
		for (const id of ['floatingDiff.openScmResource', 'floatingDiff.pickChange', 'floatingDiff.close']) {
			assert.ok(commands.includes(id), `${id} is registered`);
		}
	});
});
```

- [ ] **Step 4: Убедиться, что тест падает**

Run: `npm run test:integration`
Expected: FAIL — esbuild: `Could not resolve "src/extension.ts"`.

- [ ] **Step 5: `src/gitApi.ts`**

```ts
import * as vscode from 'vscode';
import type { API, GitExtension } from './git';

/** The built-in Git extension API, or undefined when Git is missing or disabled. */
export async function getGitApi(): Promise<API | undefined> {
	const extension = vscode.extensions.getExtension<GitExtension>('vscode.git');
	if (!extension) {
		return undefined;
	}
	const git = extension.isActive ? extension.exports : await extension.activate();
	return git?.enabled ? git.getAPI(1) : undefined;
}
```

- [ ] **Step 6: `src/pickChange.ts`**

```ts
import * as path from 'path';
import * as vscode from 'vscode';
import type { DiffWindow } from './diffWindow';
import { getGitApi } from './gitApi';
import { ChangeGroup, ChangeItem, indexRenameOf, listChanges, statusLetter } from './gitChanges';
import { fromChange } from './openRequest';

const GROUP_LABELS: Record<ChangeGroup, string> = {
	index: 'Staged Changes',
	workingTree: 'Changes',
	untracked: 'Untracked Changes',
};

interface ChangePick extends vscode.QuickPickItem {
	readonly item?: ChangeItem;
}

export async function pickChange(diffWindow: DiffWindow): Promise<void> {
	const api = await getGitApi();
	if (!api) {
		void vscode.window.showErrorMessage('Floating Diff: the built-in Git extension is disabled.');
		return;
	}
	const items = listChanges(api);
	if (items.length === 0) {
		void vscode.window.showInformationMessage('Floating Diff: no changes.');
		return;
	}

	const multiRepo = api.repositories.length > 1;
	const picks: ChangePick[] = [];
	let section = '';
	for (const item of items) {
		const key = `${item.repository.rootUri.toString()}|${item.group}`;
		if (key !== section) {
			section = key;
			const repoName = path.basename(item.repository.rootUri.fsPath);
			const label = multiRepo ? `${GROUP_LABELS[item.group]} · ${repoName}` : GROUP_LABELS[item.group];
			picks.push({ label, kind: vscode.QuickPickItemKind.Separator });
		}
		const folder = path.relative(item.repository.rootUri.fsPath, path.dirname(item.change.uri.fsPath));
		const letter = statusLetter(item.change.status);
		picks.push({
			label: path.basename(item.change.uri.fsPath),
			description: [folder, letter].filter(Boolean).join('  '),
			item,
		});
	}

	const picked = await vscode.window.showQuickPick(picks, {
		placeHolder: 'Open change in a floating window',
		matchOnDescription: true,
	});
	if (!picked?.item) {
		return;
	}
	const { repository, change } = picked.item;
	const req = fromChange(change, {
		toGitUri: (uri, ref) => api.toGitUri(uri, ref),
		indexRenameOf: uri => indexRenameOf(repository, uri),
	});
	if (req) {
		await diffWindow.show(req);
	}
}
```

- [ ] **Step 7: `src/extension.ts`**

```ts
import * as vscode from 'vscode';
import { DiffWindow } from './diffWindow';
import { fromScmCommand } from './openRequest';
import { pickChange } from './pickChange';

export function activate(context: vscode.ExtensionContext): void {
	const diffWindow = new DiffWindow();
	context.subscriptions.push(
		diffWindow,
		vscode.commands.registerCommand('floatingDiff.openScmResource', async (state?: vscode.SourceControlResourceState) => {
			const req = fromScmCommand(state?.command);
			if (req) {
				await diffWindow.show(req);
			} else if (state?.command) {
				// e.g. the merge editor: keep the regular click behavior
				await vscode.commands.executeCommand(state.command.command, ...(state.command.arguments ?? []));
			}
		}),
		vscode.commands.registerCommand('floatingDiff.pickChange', () => pickChange(diffWindow)),
		vscode.commands.registerCommand('floatingDiff.close', () => diffWindow.close()),
	);
}

export function deactivate(): void {}
```

- [ ] **Step 8: `README.md`**

```markdown
# Floating Diff

Opens Source Control diffs in a floating window instead of a tab, like WebStorm. Esc closes it.

## Usage

- Hover a file in Source Control → click the window icon.
- `Ctrl+Alt+D` (macOS: `⌃⌥D`) → pick a changed file → Enter.
- The window is reused: the next file replaces the current one.
- `Esc` closes the window (after closing find, suggestions, selection, etc.).

## Build and install

    npm install
    npm run package
    code --install-extension floating-diff-0.1.0.vsix
    cursor --install-extension floating-diff-0.1.0.vsix

## Develop

    npm run test:unit
    npm run test:integration   # downloads VS Code and opens a test window
```

- [ ] **Step 9: Все тесты проходят**

Run: `npm test`
Expected: unit `39 passing`, integration `4 passing`.

- [ ] **Step 10: Собрать `.vsix`**

Run: `npm run package`
Expected: `DONE  Packaged: .../floating-diff-0.1.0.vsix (3 files, ...)`.

Run: `npx vsce ls --no-dependencies`
Expected: ровно `dist/extension.js`, `package.json`, `README.md`.

- [ ] **Step 11: Commit**

```bash
git add package.json package-lock.json esbuild.mjs .vscodeignore README.md src/gitApi.ts src/pickChange.ts src/extension.ts src/test/integration/extension.test.ts
git commit -m "feat: SCM inline action, change quick pick and Esc to close"
```

---

### Task 5: Установка в VS Code и Cursor

**Files:** нет изменений в коде.

- [ ] **Step 1: Найти CLI редакторов**

Run: `command -v code cursor; ls "/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code" "/Applications/Cursor.app/Contents/Resources/app/bin/cursor"`
Expected: пути к `code` и `cursor`. Если CLI нет в PATH — используем пути внутри `.app`.

- [ ] **Step 2: Установить**

Run: `<code-cli> --install-extension floating-diff-0.1.0.vsix --force`
Run: `<cursor-cli> --install-extension floating-diff-0.1.0.vsix --force`
Expected: `Extension 'floating-diff-0.1.0.vsix' was successfully installed.`

- [ ] **Step 3: Проверить установку**

Run: `<code-cli> --list-extensions --show-versions | grep floating-diff` (и то же для Cursor)
Expected: `local.floating-diff@0.1.0`.

- [ ] **Step 4: Передать ручной чек-лист** (спека, раздел 6) пользователю: после `Developer: Reload Window` проверить иконку, ⌃⌥D, Esc при открытом поиске, неизменный сплит.
