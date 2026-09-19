import * as assert from 'assert';
import * as vscode from 'vscode';

describe('extension', () => {
	it('activates and registers its commands', async () => {
		const extension = vscode.extensions.getExtension('DimaShraho.git-convenient');
		assert.ok(extension, 'extension is installed in the test host');
		await extension.activate();

		const commands = await vscode.commands.getCommands(true);
		for (const id of ['gitConvenient.openScmResource', 'gitConvenient.pickChange', 'gitConvenient.close', 'gitConvenient.branches', 'gitConvenient.log', 'gitConvenient.browseBranch', 'gitConvenient.fetch', 'gitConvenient.toggleBranches', 'gitConvenient.viewAsTree', 'gitConvenient.viewAsList', 'gitConvenient.logInEditor', 'gitConvenient.fileHistory']) {
			assert.ok(commands.includes(id), `${id} is registered`);
		}
	});
});
