# Git Pro, часть 1 — popup веток

- Дата: 2026-09-19
- Статус: дизайн согласован в чате
- Источник: дизайн-холст «VS Code Git — WebStorm-style», артборды Branches, BranchesLight (popup), Main (статус-бар)
- Суть: Floating Diff становится расширением Git Pro. Первая часть — ветка в статус-баре и popup веток с поиском и действиями.

## 1. Декомпозиция Git Pro

| Часть | Что | Статус |
|---|---|---|
| 1 | Ветка в статус-баре + popup веток | эта спека |
| 2 | Просмотр ветки без checkout: дерево, файл, поиск, коммиты, diff vs main | позже |
| 3 | Git Log с графом, фильтрами и деталями коммита | позже |
| 4 | Панель Git Pro в Activity Bar: ветки, изменения, коммит, бейдж | позже |

## 2. Переименование в Git Pro

- `package.json`: `name: git-pro`, `displayName: Git Pro`, id расширения `local.git-pro`.
- Команды `floatingDiff.*` → `gitPro.*`: `gitPro.openScmResource`, `gitPro.pickChange`, `gitPro.close`, новая `gitPro.branches`.
- Context key `floatingDiff.focused` → `gitPro.diffFocused`; настройка `floatingDiff.openFromSourceControl` → `gitPro.openFromSourceControl`.
- Хоткеи те же: `ctrl+alt+d` → `gitPro.pickChange`; `escape` → `gitPro.close` с тем же условием.
- Всё, что умеет Floating Diff, остаётся без изменений.
- Установка нового расширения удаляет `local.floating-diff`: иначе работают оба (два редиректа Source Control). Запомненный размер окна хранится по id расширения, поэтому после переименования его нужно задать заново один раз.

## 3. Ветка в статус-баре

- Слева, текст `$(git-branch) main* ↓2 ↑1`: имя текущей ветки, `*` при незакоммиченных изменениях, синхронизация с upstream (пусто, если нет расхождений).
- Клик и команда `Git Pro: Branches` открывают popup.
- Репозиторий — тот, где лежит файл активного редактора, иначе первый открытый. Текст обновляется по `repository.state.onDidChange` и смене активного редактора.
- Встроенный индикатор ветки git остаётся; скрывается правым кликом по статус-бару.

## 4. Popup веток

Нативный Quick Pick (сверху по центру). Расширения не рисуют свои всплывающие окна поверх редактора, поэтому позиция и боковое меню действий из макета недоступны; действия — второй шаг popup.

**Список**

- Заголовок `Git Branches`, кнопка `$(add)` «New branch» в заголовке.
- Placeholder: `Search branches and remotes… (Enter: checkout)`.
- Группы (разделители со счётчиком): `Recent · N`, `Local · N`, `Remote · N`.
  - Recent: до 5 недавно открытых локальных веток из reflog (`checkout: moving from A to B` → B), только при пустом поиске (иначе дубли с Local).
  - Local: текущая первой, затем по алфавиту. Remote: по алфавиту, без `origin/HEAD`.
- Строка: иконка `$(git-branch)` (текущая — цвет `charts.blue`, remote — `$(cloud)`), имя, в описании метка `current` или `merged` и синхронизация `↓2 ↑1`; кнопка `$(ellipsis)` «More actions».
- Поиск — встроенный фильтр Quick Pick по имени. Если введённое имя допустимо для ветки и точно не совпадает ни с одной веткой, в списке всегда есть пункт `$(add) Create branch "<имя>"` (создать от текущей и перейти).
- Enter на ветке — checkout:
  - локальная: `checkout <name>`;
  - удалённая: если есть локальная с тем же именем — checkout её, иначе создать локальную tracking-ветку (`createBranch(local, checkout, origin/x)` + upstream).

**Действия (второй шаг, кнопка `…`)**

Заголовок — имя выбранной ветки, кнопка «Назад» возвращает к списку. `<cur>` — текущая ветка. Неприменимые пункты не показываются.

| Действие | Когда | Реализация |
|---|---|---|
| Checkout | не текущая | как Enter |
| Compare with `<cur>` | не текущая | дифф `<cur>`…`<ветка>` по многим файлам в плавающем окне |
| Show diff with working tree | всегда | дифф `<ветка>` ↔ рабочие файлы по многим файлам в плавающем окне |
| New branch from `<ветка>`… | всегда | InputBox имени → `createBranch(name, true, ветка)` |
| Merge `<ветка>` into `<cur>` | не текущая | Git API `merge` |
| Rebase `<cur>` onto `<ветка>` | не текущая | `git rebase <ветка>` |
| Pull into `<cur>` using rebase | удалённая | Git API `fetch(remote, branch)` + `git rebase <remote>/<branch>` |
| Rename… | локальная | InputBox → `git branch -m <old> <new>` |
| Delete | локальная, не текущая | модальное подтверждение → Git API `deleteBranch`; не слита — второе подтверждение с force |

**Ошибки.** Любая ошибка git — сообщение `Git Pro: <текст ошибки>` с кнопкой «Show Git Output» (`git.showOutput`). Конфликты merge/rebase остаются в репозитории как есть; их видно в Source Control.

## 5. Дифф по многим файлам в плавающем окне

- `OpenRequest` получает третий вид: `{ kind: 'changes', title, resources: {original, modified}[] }`.
- Открытие: сначала обычный дифф первого файла через плавающее окно (так окно создаётся с запомненным размером или переиспользуется и получает фокус), затем `vscode.changes(title, resources)` открывает вкладку в активной группе — нашем окне, затем вкладка первого файла закрывается.
- Вкладка распознаётся по `tab.input.textDiffs` (класс `TabInputTextMultiDiff` есть в runtime, но не в типах 1.105): совпадают пары original/modified. Фокус для Esc — `activeTextEditor` внутри вкладки: его документ один из файлов запроса.
- Esc закрывает окно так же, как для одного диффа.
- Пустое сравнение — сообщение `Git Pro: no differences between <a> and <b>.`

## 6. Архитектура

```
src/branches/branchModel.ts    чистые функции: разбор вывода git, группы, метки, проверка имени, список действий
src/branches/gitRunner.ts      запуск git в корне репозитория
src/branches/branchService.ts  операции над ветками (Git API + git)
src/branches/branchesPopup.ts  Quick Pick: список и шаг действий
src/branches/statusBar.ts      ветка в статус-баре
src/openRequest.ts             + kind 'changes', showsDocument для него
src/diffWindow.ts              + показ 'changes'
```

- Git API: `checkout`, `createBranch`, `deleteBranch`, `merge`, `fetch`, `diffBetween`, `diffWith`, `status`, `state.HEAD`, `getRepository`. Сетевые операции только через API (прогресс и авторизация git-расширения).
- Свой git (путь — `api.git.path`, cwd — корень репозитория), только локальные операции: `for-each-ref`, `branch --merged`, `reflog`, `branch -m`, `branch --set-upstream-to`, `rebase`. После них — `repository.status()`.
- `rebase` в Git API 1.105 (Cursor) отсутствует, поэтому он через свой git.

## 7. Вне части 1

Browse files и Search in branch (часть 2), подсказки ⌘⏎/⌥⏎ и подвал popup (у Quick Pick нет подвала), теги, удаление удалённых веток, горячая клавиша popup (позже по решению пользователя), настройки popup.

## 8. Тесты

- Unit (`branchModel`): разбор `for-each-ref` (локальные, удалённые, `origin/HEAD`, ahead/behind/gone), `branch --merged`, reflog → Recent (порядок, уникальность, лимит, пропуск хешей), `syncLabel`, группы (Recent только без поиска, сортировка, текущая первой), проверка имени ветки, список действий для текущей/локальной/удалённой.
- Unit (`openRequest`): `showsDocument` для `changes`.
- Интеграционные (настоящий временный репозиторий + bare-репозиторий как `origin`): загрузка веток (current, ahead/behind, merged, recent), checkout локальной и удалённой (появляется tracking-ветка), создание, переименование, удаление, merge, `compare` и `diffWithWorkingTree` дают правильные пары файлов, `changes` открывается в плавающем окне одной вкладкой и закрывается `close()`.
- Ручная проверка: статус-бар, popup, шаг действий, Esc на вкладке сравнения.
