import * as assert from 'assert';
import * as vscode from 'vscode';

describe('extension', () => {
	it('activates and registers its commands', async () => {
		const extension = vscode.extensions.getExtension('local.gitstorm');
		assert.ok(extension, 'extension is installed in the test host');
		await extension.activate();

		const commands = await vscode.commands.getCommands(true);
		for (const id of ['gitStorm.openScmResource', 'gitStorm.pickChange', 'gitStorm.close', 'gitStorm.branches', 'gitStorm.log', 'gitStorm.browseBranch', 'gitStorm.fetch', 'gitStorm.toggleBranches', 'gitStorm.viewAsTree', 'gitStorm.viewAsList', 'gitStorm.logInEditor', 'gitStorm.fileHistory']) {
			assert.ok(commands.includes(id), `${id} is registered`);
		}
	});
});
