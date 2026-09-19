# Git Pro, части 2–4 — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Git Log с графом, просмотр ветки без checkout и панель Git Pro в Activity Bar.

**Architecture:** Чистые разборщики git и раскладка графа (unit-тесты) → `GitData` поверх `GitRunner` (интеграционные тесты на временных репозиториях) → три webview на Preact с общим протоколом сообщений; каждая панель сообщает `ready`/`rendered`, что проверяют интеграционные тесты.

**Tech Stack:** TypeScript ~5.9, VS Code API 1.105, Preact 10 (TSX) + esbuild, mocha, @vscode/test-cli.

**Spec:** `docs/superpowers/specs/2026-09-19-git-pro-parts-2-4-design.md`

## Global Constraints

- Не коммитить без явной просьбы пользователя.
- Сетевые операции и commit — только Git API; свой git — чтение и локальные операции.
- Цвета только из токенов темы VS Code; внешних ресурсов в webview нет; CSP с nonce.
- Тексты UI на английском; ошибки — `Git Pro: <текст>` + «Show Git Output».
- Горячих клавиш не добавлять.

---

### Task 1: Разборщики git (`src/data/parse.ts`)

**Produces:** `LOG_FORMAT`, `parseLog(out): LogCommit[]` (`hash, parents[], author, email, date(ms), refs: RefLabel[], subject`), `parseRefs(decorations): RefLabel[]` (`{name, kind: 'head'|'local'|'remote'|'tag'}`), `parseNumstat(out)`, `parseNameStatus(out)`, `mergeFileStats(nameStatus, numstat): FileChange[]` (`status, path, oldPath?, added?, deleted?`), `parseLsTree(out): string[]`, `parseGrep(out, ref): GrepHit[]` (`path, line, text`), `parseAheadBehind(out): {ahead, behind}`.

- [x] Unit-тесты на каждый разборщик (включая rename `R100`, бинарный numstat `-\t-`, `HEAD -> main, origin/main, tag: v1`, пустой вывод, пути с `:` в grep) → FAIL → реализация → PASS.

### Task 2: Раскладка графа (`src/graph/lanes.ts`)

**Produces:** `layoutGraph(commits: {hash, parents}[]): GraphRow[]`, `GraphRow { lane, color, width, lines: GraphLine[] }`, `GraphLine { from: {lane, y: 'top'|'mid'}, to: {lane, y: 'mid'|'bottom'}, color }`.

Алгоритм: массив дорожек (ожидаемый хеш или null). Коммит занимает первую дорожку, ждущую его (иначе первую свободную); остальные дорожки, ждущие его, сходятся в узел (линии top→mid) и освобождаются; сквозные дорожки — вертикаль top→bottom; первая родительская дорожка — mid→bottom той же дорожки; остальные родители — существующая дорожка, ждущая родителя, или новая, линия mid→bottom к ней. Цвет дорожки назначается при её открытии и живёт до закрытия.

- [x] Unit-тесты: линейная история (одна дорожка), ветка + merge (две дорожки, сходятся), два параллельных ответвления, родитель вне списка (линия уходит вниз), octopus (3 родителя), повторное использование освобождённой дорожки → FAIL → реализация → PASS.

### Task 3: `GitData` (`src/data/gitData.ts`)

**Produces:** `log({ref?, all?, author?, since?, path?, skip?, limit}): LogCommit[]`, `authors(): string[]`, `commit(hash): {body, files: FileChange[]}`, `tree(ref): string[]`, `file(ref, path): {text?, binary?, tooLarge?}`, `grep(ref, query, {matchCase, wholeWord, regex}): GrepHit[]`, `diffStat(base, ref): FileChange[]`, `mergeBase(a, b)`, `aheadBehind(base, ref)`, `commitsBetween(base, ref): LogCommit[]`, `refs(): {local, remote, tags}`, `cherryPick(hash)`, `revert(hash)`.

- [x] Интеграционный тест на временном репозитории (ветки, merge, rename, бинарный файл, тег) → FAIL → реализация → PASS.

### Task 4: Webview-инфраструктура

- [x] `preact` в dependencies; `esbuild.mjs` собирает `webview/{log,explorer,sidebar}/index.tsx` → `dist/webview/*.js` (iife, browser, jsx automatic, preact) и копирует `webview/common/styles.css` → `dist/webview/styles.css`; `webview/tsconfig.json` (DOM, jsx react-jsx, jsxImportSource preact); `npm run compile` проверяет типы обоих tsconfig.
- [x] `src/shared/protocol.ts` — типы сообщений; `src/webview/host.ts` — `webviewHtml(webview, extensionUri, entry, title)` (CSP с nonce) и `WebviewChannel` (post, onMessage, `ready: Promise<void>`, `rendered` события).
- [x] `webview/common/` — `vscode.ts` (`acquireVsCodeApi`), `icons.tsx` (inline SVG из макета), `styles.css` (токены темы), компоненты `RefBadge`, `StatusLetter`, `SearchInput`.
- [x] `.vscodeignore` пропускает `dist/webview/**`.

### Task 5: Git Log (`src/log/logPanel.ts`, `webview/log/`)

- [x] Интеграционный тест: `executeCommand('gitPro.log')` на временном репозитории → вкладка «Git Log» открыта, webview прислал `rendered` с числом строк = числу коммитов; выбор коммита → детали с файлами (сообщение `rendered` для деталей) → FAIL → реализация → PASS.
- [x] Панель: загрузка лога с фильтрами, граф, детали, действия (Open diff, Cherry-pick, Revert, Copy hash, Checkout commit, New branch from here), «Load more», фильтр по ветке из аргумента команды.

### Task 6: Просмотр ветки (`src/explorer/explorerPanel.ts`, `webview/explorer/`)

- [x] Интеграционный тест: `executeCommand('gitPro.browseBranch', 'feature')` → вкладка «feature — browse», `rendered` с числом файлов дерева; поиск через сообщение → результаты; выбор файла → содержимое → FAIL → реализация → PASS.
- [x] Popup веток: действие «Browse files at this branch».

### Task 7: Панель Git Pro (`src/sidebar/sidebarView.ts`, `webview/sidebar/`, `media/git-pro.svg`)

- [x] `package.json`: viewsContainers.activitybar `gitPro`, views `gitPro.sidebar` (type webview), команды `gitPro.fetch`, `gitPro.log`, `gitPro.branches` в `view/title`.
- [x] Интеграционный тест: открытие вида (`workbench.view.extension.gitPro`) → `rendered` с числом веток и изменений, клик по изменению, коммит всего при пустом индексе, публикация ветки без upstream → FAIL → реализация → PASS. Бейдж — unit-тест `incomingBadge`.
- [x] Commit / Commit & Push, Fetch/Pull/Push, фильтр, группы, действия при наведении, Changes, клик по ветке → лог с фильтром.
- [x] Статус-бар: `$(history) Git Log` справа.

### Task 8: Сборка, превью, установка

- [x] Страница превью `webview/preview/` (вне пакета; `npm run preview`) с данными из временного репозитория, прочитанными кодом расширения, и токенами Dark/Light Modern; скриншоты трёх экранов в браузере.
- [x] `npm test` зелёный; `npm run package`; установка `git-pro-0.3.0.vsix`.
