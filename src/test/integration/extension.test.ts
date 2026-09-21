import * as assert from 'assert';
import * as vscode from 'vscode';

describe('extension', () => {
	it('activates and registers its commands', async () => {
		const extension = vscode.extensions.getExtension('DimaShraho.git-convenient');
		assert.ok(extension, 'extension is installed in the test host');
		await extension.activate();

		const commands = await vscode.commands.getCommands(true);
		for (const id of ['gitConvenient.openScmResource', 'gitConvenient.pickChange', 'gitConvenient.close', 'gitConvenient.branches', 'gitConvenient.log', 'gitConvenient.browseBranch', 'gitConvenient.fetch', 'gitConvenient.pull', 'gitConvenient.push', 'gitConvenient.toggleBranches', 'gitConvenient.viewAsTree', 'gitConvenient.viewAsList', 'gitConvenient.logInEditor', 'gitConvenient.fileHistory', 'gitConvenient.diffWithPrevious', 'gitConvenient.blame.openDiff', 'gitConvenient.blame.copyHash']) {
			assert.ok(commands.includes(id), `${id} is registered`);
		}
	});

	it('binds ⌘⇧G to the Git Convenient view and ⌘⇧B to Branches, with keys that run something', async () => {
		const extension = vscode.extensions.getExtension('DimaShraho.git-convenient')!;
		await extension.activate();
		const keybindings = extension.packageJSON.contributes.keybindings as { command: string; key: string; mac?: string }[];
		const commands = await vscode.commands.getCommands(true);

		assert.strictEqual(keybindings.find(binding => binding.command === 'gitConvenient.sidebar.focus')?.mac, 'cmd+shift+g');
		assert.strictEqual(keybindings.find(binding => binding.command === 'gitConvenient.toggleBranches')?.mac, 'cmd+shift+b');
		for (const binding of keybindings) {
			assert.ok(commands.includes(binding.command), `${binding.command} (${binding.mac ?? binding.key}) exists`);
		}
	});
});
