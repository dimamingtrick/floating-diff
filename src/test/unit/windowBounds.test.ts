import * as assert from 'assert';
import {
	applyScript, Bounds, BoundsStore, isPermissionError, MacWindowBounds, parseBounds, readScript, WindowBoundsDriver, WindowSizeMemory,
} from '../../windowBounds';

describe('parseBounds', () => {
	it('parses "x,y,width,height"', () => {
		assert.deepStrictEqual(parseBounds('10,20,1200,800\n'), { x: 10, y: 20, width: 1200, height: 800 });
	});

	it('accepts negative positions (display left of the main one)', () => {
		assert.deepStrictEqual(parseBounds('-1440, 25, 1440, 875'), { x: -1440, y: 25, width: 1440, height: 875 });
	});

	it('rejects empty output (window title did not match)', () => {
		assert.strictEqual(parseBounds(''), undefined);
	});

	it('rejects malformed output', () => {
		assert.strictEqual(parseBounds('a,b,c,d'), undefined);
		assert.strictEqual(parseBounds('1,2,3'), undefined);
	});

	it('rejects implausibly small windows', () => {
		assert.strictEqual(parseBounds('0,0,100,100'), undefined);
	});
});

describe('scripts', () => {
	it('reads the frontmost window only when its title matches', () => {
		const script = readScript('say "hi" \\ bye');
		assert.ok(script.includes('first process whose frontmost is true'));
		assert.ok(script.includes('does not contain "say \\"hi\\" \\\\ bye"'), script);
	});

	it('applies rounded bounds to the frontmost window only when its title matches', () => {
		const script = applyScript({ x: 10.4, y: -20.6, width: 1200.2, height: 799.5 }, 'a.ts (Working Tree)');
		assert.ok(script.includes('does not contain "a.ts (Working Tree)"'));
		assert.ok(script.includes('set position of w to {10, -21}'), script);
		assert.ok(script.includes('set size of w to {1200, 800}'), script);
	});
});

describe('isPermissionError', () => {
	it('detects missing Accessibility or Automation permissions', () => {
		assert.ok(isPermissionError(new Error('System Events got an error: osascript is not allowed assistive access. (-1719)')));
		assert.ok(isPermissionError(new Error('Not authorized to send Apple events to System Events. (-1743)')));
		assert.ok(isPermissionError(new Error('execution error: (-25211)')));
	});

	it('ignores other errors', () => {
		assert.ok(!isPermissionError(new Error('Command failed: osascript timed out')));
		assert.ok(!isPermissionError('oops'));
	});
});

describe('MacWindowBounds', () => {
	it('reads bounds through osascript', async () => {
		const scripts: string[] = [];
		const driver = new MacWindowBounds(async script => { scripts.push(script); return '10,20,1200,800\n'; });

		assert.deepStrictEqual(await driver.read('a.ts'), { x: 10, y: 20, width: 1200, height: 800 });
		assert.deepStrictEqual(scripts, [readScript('a.ts')]);
	});

	it('retries applying until the window title matches', async () => {
		const replies = ['miss\n', 'miss\n', 'ok\n'];
		let calls = 0;
		const driver = new MacWindowBounds(async () => replies[calls++], { attempts: 5, delayMs: 1 });

		assert.strictEqual(await driver.apply({ x: 0, y: 0, width: 800, height: 600 }, 'a.ts'), true);
		assert.strictEqual(calls, 3);
	});

	it('gives up applying after the configured attempts', async () => {
		let calls = 0;
		const driver = new MacWindowBounds(async () => { calls++; return 'miss\n'; }, { attempts: 3, delayMs: 1 });

		assert.strictEqual(await driver.apply({ x: 0, y: 0, width: 800, height: 600 }, 'a.ts'), false);
		assert.strictEqual(calls, 3);
	});
});

describe('WindowSizeMemory', () => {
	const bounds: Bounds = { x: 0, y: 25, width: 1440, height: 875 };
	const noErrors = (error: unknown) => assert.fail(String(error));

	function memoryStore(initial?: Bounds): BoundsStore & { value?: Bounds } {
		const store = {
			value: initial,
			get: () => store.value,
			set: async (b: Bounds) => { store.value = b; },
		};
		return store;
	}

	function fakeDriver(read: Bounds | undefined, applied: Array<[Bounds, string]> = []): WindowBoundsDriver {
		return {
			read: async () => read,
			apply: async (b, title) => { applied.push([b, title]); return true; },
		};
	}

	it('remembers the bounds of the window', async () => {
		const store = memoryStore();
		await new WindowSizeMemory(fakeDriver(bounds), store, noErrors).remember('a.ts');
		assert.deepStrictEqual(store.value, bounds);
	});

	it('keeps the previous bounds when the window cannot be read', async () => {
		const store = memoryStore(bounds);
		await new WindowSizeMemory(fakeDriver(undefined), store, noErrors).remember('a.ts');
		assert.deepStrictEqual(store.value, bounds);
	});

	it('restores the remembered bounds', async () => {
		const applied: Array<[Bounds, string]> = [];
		await new WindowSizeMemory(fakeDriver(undefined, applied), memoryStore(bounds), noErrors).restore('a.ts');
		assert.deepStrictEqual(applied, [[bounds, 'a.ts']]);
	});

	it('does nothing on restore when no bounds were remembered', async () => {
		const applied: Array<[Bounds, string]> = [];
		await new WindowSizeMemory(fakeDriver(undefined, applied), memoryStore(), noErrors).restore('a.ts');
		assert.deepStrictEqual(applied, []);
	});

	it('reports driver errors instead of throwing', async () => {
		const errors: unknown[] = [];
		const failing: WindowBoundsDriver = {
			read: async () => { throw new Error('boom'); },
			apply: async () => { throw new Error('boom'); },
		};
		const memory = new WindowSizeMemory(failing, memoryStore(bounds), e => errors.push(e));

		await memory.remember('a.ts');
		await memory.restore('a.ts');

		assert.strictEqual(errors.length, 2);
	});
});
