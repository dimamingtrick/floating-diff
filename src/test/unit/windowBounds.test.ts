import * as assert from 'assert';
import { EventEmitter } from 'events';
import { PassThrough } from 'stream';
import { Bounds, BoundsStore, HelperProcess, MacWindowBoundsReader, parseBounds, WindowBoundsReader, WindowSizeMemory } from '../../windowBounds';

describe('parseBounds', () => {
	it('parses "x,y,width,height"', () => {
		assert.deepStrictEqual(parseBounds('10,20,1200,800\n'), { x: 10, y: 20, width: 1200, height: 800 });
	});

	it('accepts negative positions (display left of the main one)', () => {
		assert.deepStrictEqual(parseBounds('-1440, 25, 1440, 875'), { x: -1440, y: 25, width: 1440, height: 875 });
	});

	it('rejects an empty answer (no window found)', () => {
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

/** A stand-in for the osascript helper: records requests, answers on demand. */
class FakeHelper extends EventEmitter implements HelperProcess {
	readonly stdin = new PassThrough();
	readonly stdout = new PassThrough();
	readonly requests: string[] = [];
	killed = false;

	constructor() {
		super();
		this.stdin.on('data', chunk => this.requests.push(...String(chunk).split('\n').filter(Boolean)));
	}

	answer(line: string): void {
		this.stdout.write(`${line}\n`);
	}

	kill(): boolean {
		this.killed = true;
		this.emit('exit', null);
		return true;
	}
}

async function until(condition: () => boolean): Promise<void> {
	while (!condition()) {
		await new Promise(resolve => setImmediate(resolve));
	}
}

describe('MacWindowBoundsReader', () => {
	it('asks the helper for the frontmost window of the pid and parses the answer', async () => {
		const helper = new FakeHelper();
		const reader = new MacWindowBoundsReader(4242, { spawn: () => helper });

		const result = reader.read();
		await until(() => helper.requests.length === 1);
		helper.answer('10,25,1440,875');

		assert.deepStrictEqual(await result, { x: 10, y: 25, width: 1440, height: 875 });
		assert.deepStrictEqual(helper.requests, ['4242']);
	});

	it('resolves undefined when no window was found', async () => {
		const helper = new FakeHelper();
		const reader = new MacWindowBoundsReader(1, { spawn: () => helper });

		const result = reader.read();
		await until(() => helper.requests.length === 1);
		helper.answer('');

		assert.strictEqual(await result, undefined);
	});

	it('resolves undefined when the helper does not answer in time', async () => {
		const helper = new FakeHelper();
		const reader = new MacWindowBoundsReader(1, { spawn: () => helper, timeoutMs: 5 });

		assert.strictEqual(await reader.read(), undefined);
	});

	it('does not hand a late answer to the next read', async () => {
		const helper = new FakeHelper();
		const reader = new MacWindowBoundsReader(1, { spawn: () => helper, timeoutMs: 5 });
		await reader.read(); // times out
		helper.answer('1,1,999,999'); // late answer to the first read

		const second = reader.read();
		await until(() => helper.requests.length === 2);
		helper.answer('2,2,800,600');

		assert.deepStrictEqual(await second, { x: 2, y: 2, width: 800, height: 600 });
	});

	it('starts a new helper after the previous one exited', async () => {
		const helpers = [new FakeHelper(), new FakeHelper()];
		let spawned = 0;
		const reader = new MacWindowBoundsReader(1, { spawn: () => helpers[spawned++] });

		reader.warmUp();
		helpers[0].emit('exit', 1);
		const result = reader.read();
		await until(() => helpers[1].requests.length === 1);
		helpers[1].answer('0,0,800,600');

		assert.deepStrictEqual(await result, { x: 0, y: 0, width: 800, height: 600 });
		assert.strictEqual(spawned, 2);
	});

	it('kills the helper on dispose', () => {
		const helper = new FakeHelper();
		const reader = new MacWindowBoundsReader(1, { spawn: () => helper });
		reader.warmUp();

		reader.dispose();

		assert.strictEqual(helper.killed, true);
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

	function reader(read: () => Promise<Bounds | undefined>): WindowBoundsReader {
		return { read, warmUp: () => { }, dispose: () => { } };
	}

	it('remembers the bounds of the frontmost window', async () => {
		const store = memoryStore();
		await new WindowSizeMemory(reader(async () => bounds), store, noErrors).remember();
		assert.deepStrictEqual(store.value, bounds);
	});

	it('keeps the previous bounds when the window cannot be read', async () => {
		const store = memoryStore(bounds);
		await new WindowSizeMemory(reader(async () => undefined), store, noErrors).remember();
		assert.deepStrictEqual(store.value, bounds);
	});

	it('exposes the remembered bounds for the next window', () => {
		assert.deepStrictEqual(new WindowSizeMemory(reader(async () => undefined), memoryStore(bounds), noErrors).savedBounds(), bounds);
	});

	it('reports reader errors instead of throwing', async () => {
		const errors: unknown[] = [];
		const memory = new WindowSizeMemory(reader(async () => { throw new Error('boom'); }), memoryStore(), e => errors.push(e));

		await memory.remember();

		assert.strictEqual(errors.length, 1);
	});
});
