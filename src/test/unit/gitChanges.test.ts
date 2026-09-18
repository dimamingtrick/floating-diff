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
