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
