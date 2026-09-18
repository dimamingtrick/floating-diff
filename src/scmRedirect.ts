import type { Command } from 'vscode';
import { Status } from './git';
import { fromScmCommand } from './openRequest';

/**
 * The parts of the built-in Git extension's internals the redirect relies on
 * (`vscode.extensions.getExtension('vscode.git').exports.model`). Not public
 * API: if they change, the redirect does not install and clicks behave as before.
 */
export interface GitResourceGroup {
	resourceStates: readonly object[];
}

export interface GitRepository {
	readonly mergeGroup?: GitResourceGroup;
	readonly indexGroup?: GitResourceGroup;
	readonly workingTreeGroup?: GitResourceGroup;
	readonly untrackedGroup?: GitResourceGroup;
	status?(): Promise<void>;
}

export interface GitInternals {
	readonly repositories: readonly GitRepository[];
}

function resourcesOf(model: GitInternals): object[] {
	return model.repositories.flatMap(repository =>
		[repository.mergeGroup, repository.indexGroup, repository.workingTreeGroup, repository.untrackedGroup]
			.flatMap(group => [...(group?.resourceStates ?? [])]));
}

function isConflict(resource: object): boolean {
	const type = (resource as { type?: unknown }).type;
	return typeof type === 'number' && type >= Status.ADDED_BY_US;
}

/**
 * Makes clicks in the Source Control view run our command instead of Git's
 * own (`vscode.diff` / `vscode.open`), by wrapping the `command` getter of
 * Git's Resource class. VS Code copies the command when Git updates the view
 * and only resends commands that changed, hence the legacy/redirected sets
 * and the refresh after every switch.
 */
export class ScmOpenRedirect {
	private prototype: object | undefined;
	private original: ((this: object) => Command | undefined) | undefined;
	private enabled = false;
	/** Resources VS Code saw before the redirect was switched on: they keep Git's command. */
	private legacy = new WeakSet<object>();
	/** Resources that got our command: after switching off they keep it, so the refresh replaces them. */
	private readonly redirected = new WeakSet<object>();

	constructor(private readonly model: GitInternals, private readonly options: { commandId: string; log?: (message: string) => void }) { }

	/** Git's own click command for a resource state. */
	originalCommand(resource: object): Command | undefined {
		return this.original ? this.original.call(resource) : (resource as { command?: Command }).command;
	}

	/** Resolves to whether the redirect is installed; it cannot be before Git lists a resource. */
	async setEnabled(enabled: boolean): Promise<boolean> {
		if (!this.original && (!enabled || !this.install())) {
			return false;
		}
		if (enabled === this.enabled) {
			return true;
		}
		this.legacy = new WeakSet(resourcesOf(this.model));
		this.enabled = enabled;
		this.options.log?.(`Source Control clicks ${enabled ? 'open the floating window' : 'open tabs again'}`);
		await Promise.all(this.model.repositories.map(repository => repository.status?.()));
		return true;
	}

	private install(): boolean {
		const sample = resourcesOf(this.model)[0];
		const prototype = sample && Object.getPrototypeOf(sample);
		const getter = prototype && Object.getOwnPropertyDescriptor(prototype, 'command')?.get;
		if (!prototype || !getter) {
			return false;
		}
		const redirect = this;
		Object.defineProperty(prototype, 'command', {
			configurable: true,
			get(this: object) {
				return redirect.commandFor(this, getter.call(this));
			},
		});
		this.prototype = prototype;
		this.original = getter;
		this.options.log?.('Source Control redirect installed');
		return true;
	}

	private commandFor(resource: object, gitCommand: Command | undefined): Command | undefined {
		const redirect = this.enabled
			? !this.legacy.has(resource) && !isConflict(resource) && fromScmCommand(gitCommand) !== undefined
			: this.redirected.has(resource);
		if (!redirect) {
			return gitCommand;
		}
		this.redirected.add(resource);
		return { command: this.options.commandId, title: gitCommand?.title ?? 'Open', arguments: [resource] };
	}
}
