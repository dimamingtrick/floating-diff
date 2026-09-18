import type { Uri } from "vscode";
import { API, Change, Repository, Status } from "./git";

export type ChangeGroup = "index" | "workingTree" | "untracked";

export interface ChangeItem {
  readonly repository: Repository;
  readonly group: ChangeGroup;
  readonly change: Change;
}

/** All changes the floating window can show; merge conflicts are skipped. */
export function listChanges(api: API): ChangeItem[] {
  const items: ChangeItem[] = [];

  for (const repository of api.repositories) {
    const {
      indexChanges,
      workingTreeChanges,
      untrackedChanges = [],
    } = repository.state;
    for (const change of indexChanges) {
      items.push({ repository, group: "index", change });
    }
    for (const change of workingTreeChanges) {
      items.push({ repository, group: "workingTree", change });
    }
    for (const change of untrackedChanges) {
      items.push({ repository, group: "untracked", change });
    }
  }
  return items;
}

export function indexRenameOf(
  repository: Repository,
  uri: Uri,
): Uri | undefined {
  const key = uri.toString();
  return repository.state.indexChanges.find(
    (c) => c.uri.toString() === key && c.renameUri,
  )?.renameUri;
}

const LETTERS: Partial<Record<Status, string>> = {
  [Status.INDEX_MODIFIED]: "M",
  [Status.MODIFIED]: "M",
  [Status.INDEX_ADDED]: "A",
  [Status.INDEX_DELETED]: "D",
  [Status.DELETED]: "D",
  [Status.INDEX_RENAMED]: "R",
  [Status.INTENT_TO_RENAME]: "R",
  [Status.INDEX_COPIED]: "C",
  [Status.UNTRACKED]: "U",
  [Status.TYPE_CHANGED]: "T",
  [Status.INTENT_TO_ADD]: "I",
};

export function statusLetter(status: Status): string {
  return LETTERS[status] ?? "";
}
