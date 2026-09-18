import * as assert from 'assert';
import type { Command, Uri } from 'vscode';
import { Status } from '../../git';
import { GitInternals, ScmOpenRedirect } from '../../scmRedirect';

const REDIRECT = 'test.openInWindow';

function fileUri(path: string): Uri {
	return { scheme: 'file', path, toString: () => `file://${path}` } as unknown as Uri;
}

function diffCommand(path: string): Command {
	return { command: 'vscode.diff', title: 'Open', arguments: [fileUri(`${path}.orig`), fileUri(path), `${path} (Working Tree)`] };
}

/** Commands hold URIs with function members, so compare them by their text form. */
function text(command: Command | undefined): unknown {
	return command && { ...command, arguments: command.arguments?.map(arg => (typeof arg === 'object' ? String(arg) : arg)) };
}

/** Git's Resource keeps its click command in a prototype getter; each test gets its own class. */
function resourceClass() {
	return class Resource {
		constructor(readonly type: Status, private readonly click: Command) { }
		get command(): Command {
			return this.click;
		}
	};
}

function git(resources: object[]): GitInternals & { refreshes: number } {
	const model = {
		refreshes: 0,
		repositories: [{
			indexGroup: { resourceStates: [] },
			workingTreeGroup: { resourceStates: resources },
			status: async () => { model.refreshes++; },
		}],
	};
	return model;
}

describe('ScmOpenRedirect', () => {
	it('points new Git resources at the floating window command', async () => {
		const Resource = resourceClass();
		const model = git([new Resource(Status.MODIFIED, diffCommand('/r/a.ts'))]);
		const redirect = new ScmOpenRedirect(model, { commandId: REDIRECT });

		assert.strictEqual(await redirect.setEnabled(true), true);
		const fresh = new Resource(Status.MODIFIED, diffCommand('/r/b.ts')); // what Git creates on refresh

		assert.strictEqual(fresh.command.command, REDIRECT);
		assert.deepStrictEqual(fresh.command.arguments, [fresh]);
		assert.deepStrictEqual(text(redirect.originalCommand(fresh)), text(diffCommand('/r/b.ts')));
	});

	it('keeps the old command on existing resources and asks Git to refresh', async () => {
		const Resource = resourceClass();
		const existing = new Resource(Status.MODIFIED, diffCommand('/r/a.ts'));
		const model = git([existing]);

		await new ScmOpenRedirect(model, { commandId: REDIRECT }).setEnabled(true);

		// VS Code only resends commands that changed, so the refresh must create resources whose command differs.
		assert.deepStrictEqual(text(existing.command), text(diffCommand('/r/a.ts')));
		assert.strictEqual(model.refreshes, 1);
	});

	it('leaves merge conflicts and non-diff commands alone', async () => {
		const Resource = resourceClass();
		const model = git([new Resource(Status.MODIFIED, diffCommand('/r/a.ts'))]);
		await new ScmOpenRedirect(model, { commandId: REDIRECT }).setEnabled(true);

		const conflict = new Resource(Status.BOTH_MODIFIED, { command: 'vscode.open', title: 'Open', arguments: [fileUri('/r/c.ts')] });
		const mergeEditor = new Resource(Status.BOTH_MODIFIED, { command: 'git.openMergeEditor', title: 'Open Merge', arguments: [fileUri('/r/c.ts')] });

		assert.strictEqual(conflict.command.command, 'vscode.open');
		assert.strictEqual(mergeEditor.command.command, 'git.openMergeEditor');
	});

	it('restores Git commands when disabled, refreshing so the view picks them up', async () => {
		const Resource = resourceClass();
		const model = git([new Resource(Status.MODIFIED, diffCommand('/r/a.ts'))]);
		const redirect = new ScmOpenRedirect(model, { commandId: REDIRECT });
		await redirect.setEnabled(true);
		const redirected = new Resource(Status.MODIFIED, diffCommand('/r/b.ts'));
		assert.strictEqual(redirected.command.command, REDIRECT);

		await redirect.setEnabled(false);
		const fresh = new Resource(Status.MODIFIED, diffCommand('/r/b.ts'));

		assert.strictEqual(fresh.command.command, 'vscode.diff');
		// Still differs from the refreshed resource, so VS Code replaces the command it holds.
		assert.strictEqual(redirected.command.command, REDIRECT);
		assert.strictEqual(model.refreshes, 2);
	});

	it('cannot install before Git lists any resource', async () => {
		const Resource = resourceClass();
		const model = git([]);
		const redirect = new ScmOpenRedirect(model, { commandId: REDIRECT });

		assert.strictEqual(await redirect.setEnabled(true), false);

		model.repositories[0].workingTreeGroup!.resourceStates = [new Resource(Status.MODIFIED, diffCommand('/r/a.ts'))];
		assert.strictEqual(await redirect.setEnabled(true), true);
	});

	it('falls back to the resource command when not installed', () => {
		const Resource = resourceClass();
		const redirect = new ScmOpenRedirect(git([]), { commandId: REDIRECT });

		assert.deepStrictEqual(text(redirect.originalCommand(new Resource(Status.MODIFIED, diffCommand('/r/a.ts')))), text(diffCommand('/r/a.ts')));
	});
});
