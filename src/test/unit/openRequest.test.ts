import * as assert from 'assert';
import type { Command, Uri } from 'vscode';
import { Change, Status } from '../../git';
import { ChangeDeps, fromChange, fromScmCommand, OpenRequest, showsDocument } from '../../openRequest';

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
	switch (req.kind) {
		case 'diff':
			return { kind: 'diff', left: req.left.toString(), right: req.right.toString(), title: req.title };
		case 'file':
			return { kind: 'file', uri: req.uri.toString(), title: req.title };
		case 'changes':
			return { kind: 'changes', title: req.title, resources: req.resources.map(r => [r.label, r.original, r.modified].map(u => u?.toString())) };
	}
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

describe('showsDocument', () => {
	const left = toGitUri(A, '~');
	const diff: OpenRequest = { kind: 'diff', left, right: A, title: 'a.ts (Working Tree)' };
	const file: OpenRequest = { kind: 'file', uri: A, title: 'a.ts (Untracked)' };

	it('matches the modified side of a diff', () => {
		assert.strictEqual(showsDocument(diff, fileUri('/repo/src/a.ts')), true);
	});

	it('matches the original side of a diff', () => {
		assert.strictEqual(showsDocument(diff, toGitUri(A, '~')), true);
	});

	it('matches the file of a single-file request', () => {
		assert.strictEqual(showsDocument(file, fileUri('/repo/src/a.ts')), true);
	});

	it('matches any side of a multi-file request', () => {
		const other = fileUri('/repo/src/b.ts');
		const changes: OpenRequest = { kind: 'changes', title: 'main ↔ x', resources: [{ label: A, original: left, modified: A }, { label: other, modified: other }] };
		assert.strictEqual(showsDocument(changes, toGitUri(A, '~')), true);
		assert.strictEqual(showsDocument(changes, fileUri('/repo/src/b.ts')), true);
		assert.strictEqual(showsDocument(changes, OLD), false);
	});

	it('rejects other documents and no document', () => {
		assert.strictEqual(showsDocument(diff, OLD), false);
		assert.strictEqual(showsDocument(file, undefined), false);
		assert.strictEqual(showsDocument(undefined, A), false);
	});
});
