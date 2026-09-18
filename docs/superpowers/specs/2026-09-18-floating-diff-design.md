# Floating Diff — дизайн

- Дата: 2026-09-18
- Статус: дизайн согласован в чате, спека на ревью
- Суть: расширение для VS Code и Cursor, которое показывает дифф изменённого файла в отдельном плавающем окне, как WebStorm. Esc закрывает окно.

## 1. Проблема

Клик по изменённому файлу в панели Source Control открывает дифф табом в активной группе редактора:

- ломается split view: дифф занимает одну из половин;
- на каждый файл появляется новый таб, их приходится закрывать пачками.

В WebStorm дифф открывается в отдельном окне: посмотрел, нажал Esc, открыл следующий файл.

## 2. Сценарии MVP

1. **Иконка в Source Control.** При наведении на файл в группах Changes, Staged Changes и Untracked Changes появляется иконка `$(multiple-windows)` с подсказкой «Open Diff in Floating Window». Клик открывает дифф в плавающем окне.
2. **Список изменений.** Хоткей `ctrl+alt+d` (на macOS ⌃⌥D) открывает Quick Pick со всеми изменениями: группы Staged Changes, Changes, Untracked Changes, поиск по имени и пути. Enter открывает дифф в плавающем окне.
3. **Переиспользование окна.** Если наше окно уже открыто, новый файл открывается в нём. Таб предыдущего файла, открытый расширением, закрывается. В окне остаётся один таб.
4. **Esc.** Когда фокус в нашем окне, Esc закрывает таб, и VS Code закрывает опустевшее окно. Если открыт поиск, подсказки, переименование, peek, Quick Pick, hover или есть выделение/мультикурсор, Esc сначала выполняет своё обычное действие.
5. **Размер окна.** Окно появляется по центру активного окна, 1024×768 (так решает VS Code). Задать размер и позицию из расширения нельзя.

## 3. Вне MVP

- Конфликты слияния (группа Merge Changes): иконки нет, в списке их нет.
- Переход к следующему/предыдущему файлу внутри окна.
- Публикация в Marketplace и Open VSX.
- Настройки расширения.
- Запоминание размера и позиции окна.

## 4. Проверенные факты платформы

Источник: исходники `microsoft/vscode`, ветка `main` на 2026-09-18.

| Факт | Где в исходниках |
|---|---|
| `workbench.action.newEmptyEditorWindow` создаёт плавающее окно (auxiliary editor part) и фокусирует его активную группу | `src/vs/workbench/browser/parts/editor/editorActions.ts`, `NewEmptyEditorWindowAction` |
| `ViewColumn` N адресует N-ю группу в общем списке групп: сначала основное окно, затем плавающие в порядке создания. Группу плавающего окна можно адресовать её `TabGroup.viewColumn` | `editorGroupColumn.ts#columnToEditorGroup`, `editorParts.ts#getGroups`, `browser/part.ts#parts` |
| Плавающее окно закрывается, когда удаляется его последняя группа | `auxiliaryEditorPart.ts#removeGroup` |
| Новое плавающее окно: 1024×768 по центру активного окна | `auxiliaryWindowService.ts`, `DEFAULT_AUX_WINDOW_SIZE` |
| Context key `isAuxiliaryWindowFocusedContext` означает, что фокус в плавающем окне | `src/vs/workbench/common/contextkeys.ts` |
| Панель SCM передаёт ресурсы в команду только из меню (inline-иконка, контекстное меню), но не из хоткеев | `scmViewPane.ts`, `RepositoryPaneActionRunner` |
| `SourceControlResourceState.command` у git-ресурса: `vscode.diff [left, right, title]`, `vscode.open [uri, options, title]` или `git.openMergeEditor [uri]` | `extensions/git/src/repository.ts#resolveChangeCommand` |
| Маппинг «статус → левая/правая версия + заголовок» | `repository.ts#getLeftResource`, `#getRightResource`, `#getTitle` |
| Модальный редактор (`workbench.editor.useModal`, с 1.110) недоступен из публичного API: `ViewColumn` не маппится в `MODAL_GROUP` | `extHostTypeConverters.ts#ViewColumn.from`, `editorGroupFinder.ts` |
| Объекты `TabGroup` сохраняют идентичность между обновлениями только в свежем VS Code. В Cursor (база 1.105) они могут пересоздаваться | `extHostEditorTabs.ts#$acceptEditorTabModel` |

Вывод: не опираемся ни на идентичность объектов `TabGroup`, ни на запомненный `viewColumn`. Наше окно ищем по содержимому (раздел 5.3).

## 5. Архитектура

### 5.1 Файлы

```
floating-diff/
  package.json             манифест и contributions
  src/extension.ts         activate(): регистрирует команды, создаёт DiffWindow
  src/openRequest.ts       чистые функции «что открыть» (vscode импортируется только как тип)
  src/gitChanges.ts        Git API: получение API, список изменений, поиск rename в индексе
  src/diffWindow.ts        управление плавающим окном
  src/pickChange.ts        Quick Pick со списком изменений
  src/types/git.d.ts       копия extensions/git/src/api/git.d.ts из microsoft/vscode (MIT)
  src/test/unit/           unit-тесты (mocha)
  src/test/integration/    интеграционные тесты (@vscode/test-electron)
```

### 5.2 `openRequest.ts`

```ts
export type OpenRequest =
  | { kind: 'diff'; left: Uri; right: Uri; title: string }
  | { kind: 'file'; uri: Uri; title: string };

// Иконка в SCM: берём команду клика из git-ресурса
export function fromScmCommand(cmd: Command | undefined): OpenRequest | undefined;

// Quick Pick: повторяем маппинг git-расширения
export function fromChange(change: Change, deps: {
  toGitUri(uri: Uri, ref: string): Uri;
  indexRenameOf(uri: Uri): Uri | undefined;
}): OpenRequest | undefined;
```

`fromScmCommand`:

- `vscode.diff` → `{ kind: 'diff', left: args[0], right: args[1], title: args[2] }`;
- `vscode.open` → `{ kind: 'file', uri: args[0], title: args[2] ?? basename(args[0]) }`;
- любая другая команда (например, `git.openMergeEditor`) или `undefined` → `undefined`.

`fromChange` повторяет git-расширение. Ref для `toGitUri`: `'HEAD'` — версия из HEAD, `'~'` и `''` — версия из индекса. `name` — basename от `change.uri`. `R` = `indexRenameOf(uri) ?? uri`.

| Статус | left | right | Заголовок |
|---|---|---|---|
| INDEX_MODIFIED, INDEX_RENAMED | `toGitUri(originalUri, 'HEAD')` | `toGitUri(uri, '')` | `name (Index)` |
| INDEX_ADDED | — | `toGitUri(uri, '')` | `name (Index)` |
| INDEX_COPIED | — | `toGitUri(uri, '')` | `name` |
| INDEX_DELETED, DELETED | — | `toGitUri(uri, 'HEAD')` | `name (Deleted)` |
| MODIFIED | `toGitUri(uri, '~')` | `R` | `name (Working Tree)` |
| TYPE_CHANGED | `toGitUri(originalUri, 'HEAD')` | `R` | `name (Type changed)` |
| INTENT_TO_RENAME | `toGitUri(originalUri, 'HEAD')` | `R` | `name (Intent to add)` |
| UNTRACKED | — | `R` | `name (Untracked)` |
| INTENT_TO_ADD | — | `R` | `name (Intent to add)` |
| IGNORED и все статусы конфликтов | — | — | возвращаем `undefined` |

Если left есть, результат `kind: 'diff'`, иначе `kind: 'file'`.

### 5.3 `diffWindow.ts`

```ts
export class DiffWindow implements vscode.Disposable {
  show(req: OpenRequest): Promise<void>;
  close(): Promise<void>;
}
```

Состояние: `current?: OpenRequest` — что сейчас показано в нашем окне.

**Поиск нашей группы (`findGroup`).** Среди `window.tabGroups.all` берём группы, в которых есть таб с input, совпадающим с `current`: для `TabInputTextDiff` совпадают `original` и `modified` с `left` и `right`, для `TabInputText` совпадает `uri`. Если таких групп несколько, берём группу с максимальным `viewColumn`: плавающие окна идут после основного. Если групп нет, окно закрыто, и `current` сбрасывается.

**`show(req)`:**

1. `group = findGroup()`.
2. Если группы нет: подписываемся на `tabGroups.onDidChangeTabGroups`, выполняем `workbench.action.newEmptyEditorWindow` и берём первую группу из `event.opened`, ждём не дольше 1000 мс. Если команда упала или группа не пришла, работает fallback из раздела 5.6.
3. Открываем в `group.viewColumn` с опциями `{ preview: true, preserveFocus: false }`: `vscode.diff(left, right, title, opts)` либо `vscode.open(uri, opts, title)`.
4. Если был предыдущий `current`, он отличается от `req`, его таб всё ещё в нашей группе и не `isDirty`, закрываем его через `tabGroups.close(tab)`.
5. `current = req`, пересчитываем context key.

**`close()`:** находим таб `current` в нашей группе и закрываем его через `tabGroups.close(tab)`. Если группа осталась и пуста, закрываем её через `tabGroups.close(group)`: удаление последней группы закрывает окно.

**Context key `floatingDiff.focused`** равен `true`, когда `tabGroups.activeTabGroup` — это группа из `findGroup()`. Пересчитывается на `onDidChangeTabGroups` и `onDidChangeTabs`.

### 5.4 `gitChanges.ts` и `pickChange.ts`

`gitChanges.ts`:

- `getGitApi(): Promise<API | undefined>`: `extensions.getExtension<GitExtension>('vscode.git')`, активируем, если не активно. Если расширения нет или `exports.enabled === false`, возвращаем `undefined`. Иначе `getAPI(1)`.
- `listChanges(api): ChangeItem[]`, где `ChangeItem = { repository: Repository; group: 'index' | 'workingTree' | 'untracked'; change: Change }`. Обходим `api.repositories`: `indexChanges`, `workingTreeChanges`, `untrackedChanges ?? []` (в старых версиях поля нет). `mergeChanges` пропускаем.
- `indexRenameOf(repository, uri)`: ищем в `repository.state.indexChanges` изменение с тем же `uri` (сравнение `toString()`) и с `renameUri`, возвращаем `renameUri`.

`pickChange.ts`:

- Если изменений нет, показываем info-сообщение «Floating Diff: no changes.» и выходим.
- Элементы Quick Pick группируются разделителями «Staged Changes», «Changes», «Untracked Changes». При нескольких репозиториях к разделителю добавляется имя папки репозитория.
- Элемент: `label` — basename, `description` — папка относительно корня репозитория и буква статуса. `matchOnDescription: true`.
- Буквы статуса: INDEX_MODIFIED, MODIFIED → M; INDEX_ADDED → A; INDEX_DELETED, DELETED → D; INDEX_RENAMED, INTENT_TO_RENAME → R; INDEX_COPIED → C; UNTRACKED → U; TYPE_CHANGED → T; INTENT_TO_ADD → I.
- По Enter: `fromChange(...)` → `DiffWindow.show(...)`.

### 5.5 `package.json`

- `name: floating-diff`, `displayName: Floating Diff`, `publisher: local`, `version: 0.1.0`.
- `engines.vscode: ^1.90.0`, `@types/vscode` зафиксирован на `1.90.0`, чтобы не использовать API новее базы Cursor (1.105).
- `extensionDependencies: ["vscode.git"]`, `main: ./dist/extension.js`. Активация неявная, по объявленным командам.
- Команды:
  - `floatingDiff.openScmResource`: «Open Diff in Floating Window», иконка `$(multiple-windows)`, скрыта из Command Palette;
  - `floatingDiff.pickChange`: «Floating Diff: Open Change…»;
  - `floatingDiff.close`: «Floating Diff: Close Window», скрыта из Command Palette.
- Меню `scm/resourceState/context`: `floatingDiff.openScmResource`, `group: inline`, `when: scmProvider == git && scmResourceGroup =~ /^(index|workingTree|untracked)$/`.
- Хоткеи:
  - `ctrl+alt+d` → `floatingDiff.pickChange`. В стандартных хоткеях VS Code это сочетание свободно, проверено по исходникам.
  - `escape` → `floatingDiff.close`, условие:
    `floatingDiff.focused && isAuxiliaryWindowFocusedContext && !findWidgetVisible && !suggestWidgetVisible && !parameterHintsVisible && !renameInputVisible && !referenceSearchVisible && !inSnippetMode && !inlineSuggestionVisible && !editorHasSelection && !editorHasMultipleSelections && !editorHoverVisible && !notificationToastsVisible && !inQuickOpen && !accessibleViewIsShown`

Хоткеи расширений имеют приоритет над встроенными, поэтому условие обязано исключать все состояния, где у Esc есть своё действие.

### 5.6 Ошибки

| Ситуация | Поведение |
|---|---|
| Git-расширения нет или оно выключено | Ошибка «Floating Diff: the built-in Git extension is disabled.», больше ничего не делаем |
| Изменений нет (Quick Pick) | Info «Floating Diff: no changes.» |
| `fromScmCommand` вернул `undefined` | Выполняем исходную `command` ресурса как есть: обычное поведение клика |
| `newEmptyEditorWindow` упала или группа не пришла за 1000 мс | Открываем в текущей группе (`ViewColumn.Active`). Один раз за сессию предупреждение «Floating Diff: floating windows are unavailable, opened as a regular tab.» |
| У предыдущего таба несохранённые правки | Не закрываем его |

## 6. Тесты

**Unit** (mocha, без VS Code, `npm run test:unit`):

- `fromChange`: по кейсу на каждую строку таблицы из 5.2, плюс MODIFIED с rename в индексе.
- `fromScmCommand`: `vscode.diff`; `vscode.open` с заголовком и без; `git.openMergeEditor` → `undefined`; `undefined` → `undefined`.

**Интеграционные** (`@vscode/test-cli` и `@vscode/test-electron`, `npm run test:integration`; на время прогона открывается отдельное окно VS Code):

- Фикстура: временный git-репозиторий, в котором закоммичены `a.txt` и `b.txt`, `a.txt` изменён в рабочем дереве, изменение `b.txt` добавлено в индекс.
- T1: `show(дифф a.txt)` → групп стало на одну больше, активный таб новой группы — `TabInputTextDiff` с ожидаемыми URI.
- T2: `show(дифф b.txt)` → число групп не изменилось, в нашей группе ровно один таб, и это `b.txt`.
- T3: `close()` → число групп вернулось к исходному.

**Ручной чек-лист** (VS Code и Cursor):

1. Иконка видна при наведении в Changes, Staged Changes и Untracked Changes и не видна в Merge Changes.
2. Клик по иконке открывает окно, split view в основном окне не меняется.
3. Клик по другому файлу открывает его в том же окне, таб один.
4. Esc при открытом поиске закрывает поиск, второй Esc закрывает окно.
5. ⌃⌥D → список → Enter → окно.
6. Esc в основном окне ведёт себя как раньше.

## 7. Сборка и установка

- TypeScript, бандл esbuild → `dist/extension.js`.
- `npm run package` → `vsce package` → `floating-diff-0.1.0.vsix`.
- Установка: `code --install-extension floating-diff-0.1.0.vsix` и `cursor --install-extension floating-diff-0.1.0.vsix`.

## 8. Риски

| Риск | Что делаем |
|---|---|
| Внутреннюю команду `workbench.action.newEmptyEditorWindow` переименуют или удалят | Fallback из 5.6 с предупреждением; интеграционный тест T1 поймает это при обновлении VS Code |
| Cursor отстаёт от VS Code (база 1.105) | `engines ^1.90.0`, типы 1.90.0, ручной чек-лист в Cursor |
| Идентичность `TabGroup` отличается между версиями | Ищем группу по содержимому (5.3) |
| Esc конфликтует с другими действиями | Явное условие хоткея (5.5), пункт 4 ручного чек-листа |
