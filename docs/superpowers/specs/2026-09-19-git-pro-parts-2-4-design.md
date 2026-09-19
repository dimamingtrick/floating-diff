# Git Pro, части 2–4 — Git Log, просмотр ветки, панель

- Дата: 2026-09-19
- Статус: пользователь попросил довести реализацию до конца без промежуточных согласований; решения ниже приняты по дизайну и помечены там, где он недостижим
- Источник: холст «VS Code Git — WebStorm-style» — Main/MainLight (Git Log), BranchExplorer/BranchExplorerLight, Sidebar, ActivityBar, заметки n1–n4
- Часть 1 (popup веток, статус-бар): `2026-09-19-git-pro-branches-design.md`

## 1. Общие решения

- **UI — webview** (Git Log и просмотр ветки — вкладки редактора, панель — webview view): нативные элементы VS Code не дают таблицу с графом, дерево с поиском и карточки из макета. Разметка на Preact (TSX), бандл esbuild, отдельный бандл на экран.
- **Цвета — токены темы VS Code** (заметка n3): `--vscode-editor-background`, `sideBar-*`, `list-activeSelection*`, `list-hoverBackground`, `input-*`, `button-*`, `gitDecoration-*`, линии графа — `charts-blue/purple/green/orange/red/yellow`. Светлая и тёмная темы — автоматически. Строки 22–26 px, иконки 13–15 px, иконки — inline SVG из макета.
- **Данные** — свой git (только чтение и локальные операции) через `GitRunner`; сетевые операции (fetch/pull/push) и commit — через Git API.
- **Диффы** открываются в плавающем окне Git Pro (один файл — `diff`, много файлов — `changes`). Вкладки Git Log и просмотра ветки открываются в основном окне, даже если фокус в плавающем.
- **Безопасность webview**: CSP с nonce, `localResourceRoots` = `dist/webview`, никаких внешних ресурсов.
- **Горячие клавиши** не добавляются (решение пользователя: позже).

## 2. Git Log (часть 3)

Команда `Git Pro: Git Log` (`gitPro.log`), ссылка `Git Log` справа в статус-баре, кнопка в заголовке панели Git Pro. Одна вкладка «Git Log»; повторный вызов её показывает.

**Панель фильтров:** чип `Branch: <имя|All branches>` (выпадающий список: All branches, локальные, удалённые), `User` (авторы загруженных коммитов), `Date` (Any time, Last 24 hours, Last 7 days, Last 30 days), `Paths` (поле ввода пути или папки), поиск «Search by message, hash, author…», счётчик `N of M commits`, кнопка обновления.

**Таблица:** граф, сообщение с метками ссылок (`HEAD → main` — заливка акцентом, локальные ветки — контур, удалённые — серый контур, теги — жёлтый контур), автор, дата. Клик выделяет коммит. Загружаются последние 1000 коммитов (`--date-order`), внизу «Load more» (+1000).

- Branch/User/Date/Paths — параметры `git log` (`<branch>` или `--all`, `--author`, `--since`, `-- <path>`); поиск — фильтр по загруженным (сообщение, хеш, автор).
- Граф строится по загруженным коммитам: дорожки (lanes) по родителям, цвет дорожки — по номеру. Коммиты, чьи родители не загружены, обрывают линию внизу.
- Пусто — «No commits match the current filters» + «Clear the search box or pick "All branches".»

**Детали коммита (справа):** тема, тело (или «No extended description.»), хеш + копирование, метки ссылок, инициалы автора + «<автор> committed on <дата>», «Changed files (N)» списком или деревом (переключатель), строки `статус · имя · папка · +добавлено · −удалено`. Клик по файлу — дифф файла (первый родитель ↔ коммит) в плавающем окне. Кнопки: `Open diff` (все файлы коммита, `changes`), `Cherry-pick`, `Revert`, `⋯` (Copy hash, Checkout this commit, New branch from here…).

**Связь с панелью:** клик по ветке в панели Git Pro открывает лог с фильтром по этой ветке (заметка n2).

## 3. Просмотр ветки без checkout (часть 2)

Открытие: действие «Browse files at this branch» в popup веток, кнопка-глаз у ветки в панели Git Pro, команда `Git Pro: Browse Branch…` (`gitPro.browseBranch`, выбор ветки). Вкладка «<ветка> — browse», по одной на ветку. Рабочее дерево не меняется.

**Шапка:** имя ветки, метка `read-only`, строка «N commits ahead · M behind <текущая> · tip <хеш> · <автор>, <дата> · you stay on <текущая>, nothing is checked out». Кнопки `Compare with <текущая>` (дифф по многим файлам), `Cherry-pick…` (Quick Pick коммитов ветки, которых нет в текущей), `Checkout` (как в popup).

**Слева — дерево файлов на tip ветки** (`git ls-tree -r`): фильтр «Filter files in this branch…», заголовок «Files at <хеш>» + счётчик, папки сворачиваются; справа от файла — статус относительно merge-base с текущей (A/M/D).

**Центр — вкладки Search in branch / Files / Commits** (порядок и названия — по макету; при открытии активна Files):

- Files: «Read-only preview of <файл> at <ветка> — your working tree is untouched.», кнопки `Diff with my copy` (версия ветки ↔ рабочий файл) и `Copy to working tree` (с подтверждением, если файл есть и отличается); содержимое с номерами строк (`git show <ветка>:<путь>`), бинарные и больше 1 МБ — сообщение вместо содержимого.
- Commits: история ветки (последние 300 коммитов), коммиты, которых нет в текущей ветке, помечены «not in <текущая>» и фиолетовым (как в макете); клик — дифф коммита (`changes`). `Cherry-pick…` предлагает только помеченные.
- Search: «Search text in <ветка>…», переключатели `Aa` (регистр), `ab` (целое слово), `.*` (регулярное выражение); `git grep -n -I` по tip ветки, результаты по файлам с номерами строк и подсветкой; клик — Files с этим файлом и прокруткой к строке. Пусто — «No matches in this branch».

**Справа — «Diff vs <текущая>»:** «N files changed», `+X −Y` с полосой, список файлов (`merge-base..<ветка>`, `--numstat`); клик — дифф файла; `Open full diff in editor` — `changes` в плавающем окне; `Pick another branch` — выбор ветки.

## 4. Панель Git Pro в Activity Bar (часть 4)

- Свой view container `gitPro` в Activity Bar, иконка `media/git-pro.svg` (обводка 1.7 px, `currentColor`, 24×24 — из макета), одно webview view «Git Pro». Встроенный Source Control не трогаем (заметка n4).
- Бейдж на иконке — входящие коммиты текущей ветки (behind) после fetch; 0 — без бейджа. Цвет бейджа расширение не задаёт (API не позволяет) — конфликты бейджем не показываются. Бейдж есть у открытого хотя бы раз вида: VS Code создаёт webview-вид лениво, до этого бейдж поставить некуда.
- Заголовок вида (нативные кнопки): Fetch, Git Log, Branches.

**Содержимое:**

1. Поле коммита «Message (⌘⏎ to commit on <ветка>)», кнопка `Commit & Push` и меню рядом (`Commit`, `Commit & Push`). Commit — Git API `commit(message, { all: true })`, если ничего не застейджено, иначе только застейдженное; Push — `push()`. ⌘⏎/Ctrl⏎ в поле — Commit.
2. Фильтр «Filter branches and tags…».
3. Карточка текущей ветки: имя, `↓N ↑M`, «tracks <upstream> · N uncommitted changes», кнопки `Fetch`, `Pull ↓N`, `Push ↑M`.
4. Группы Recent (без текущей ветки — у неё своя карточка), Local, Remotes / <remote>, Tags (сворачиваются, счётчики). Строка: иконка, имя, синхронизация; при наведении — `👁` (просмотр ветки) и `⋯` (страница действий popup для этой ветки). Клик по ветке — Git Log с фильтром по ней.
5. Changes: незакоммиченные файлы (статус, имя, папка); клик — дифф в плавающем окне, как клик в Source Control.

Обновление — по `repository.state.onDidChange`.

## 5. Вне частей 2–4

Горячие клавиши (⌘⇧B, ⌃⇧G, ⌘⏎/⌥⏎ в popup), подсветка синтаксиса в предпросмотре файла, виртуальная прокрутка таблицы больше загруженных 1000–N коммитов, операции с тегами, цвет бейджа при конфликтах, несколько репозиториев одновременно в одной панели (берётся репозиторий активного файла, иначе первый).

## 6. Архитектура

```
src/data/parse.ts        чистые разборщики: log, refs (%D), numstat, name-status, ls-tree, grep, ahead/behind
src/data/gitData.ts      чтение данных git (log, детали коммита, дерево, файл, grep, diff-stat, счётчики)
src/graph/lanes.ts      раскладка графа по дорожкам (чистая)
src/shared/protocol.ts  типы сообщений extension ↔ webview
src/webview/host.ts     создание webview: HTML, CSP, nonce, ready
src/log/logPanel.ts     вкладка Git Log
src/explorer/explorerPanel.ts   вкладка просмотра ветки
src/sidebar/sidebarView.ts      webview view панели
webview/*               UI на Preact: common (стили, иконки, компоненты), log, explorer, sidebar
media/git-pro.svg       иконка Activity Bar
```

## 7. Тесты

- Unit: все разборщики `parse.ts`; раскладка графа (линейная история, ветка + merge, два параллельных ответвления, родитель вне загруженных, octopus); дерево файлов и фильтр; фильтры лога.
- Интеграционные (настоящие временные репозитории): `GitData` (log с фильтрами, детали коммита, ls-tree, show, grep с флагами, diff-stat, ahead/behind); каждая вкладка и панель открываются, скрипт webview загружается (сообщение `ready`) и отрисовывает данные (сообщение `rendered` с числом строк); команды открытия.
- Визуально: страница-превью каждого экрана с тестовыми данными и переменными темы Dark Modern в браузере, скриншоты.
