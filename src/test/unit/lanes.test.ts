import * as assert from 'assert';
import { GraphRow, layoutGraph } from '../../graph/lanes';

const c = (hash: string, ...parents: string[]) => ({ hash, parents });

/** Lines as "fromLane.fromY>toLane.toY" strings, e.g. "1.top>0.mid". */
function lines(row: GraphRow): string[] {
	return row.lines.map(l => `${l.from.lane}.${l.from.y}>${l.to.lane}.${l.to.y}`).sort();
}

describe('layoutGraph', () => {
	it('keeps a linear history on one lane', () => {
		const rows = layoutGraph([c('c', 'b'), c('b', 'a'), c('a')]);

		assert.deepStrictEqual(rows.map(r => r.lane), [0, 0, 0]);
		assert.deepStrictEqual(rows.map(lines), [
			['0.mid>0.bottom'],
			['0.mid>0.bottom', '0.top>0.mid'],
			['0.top>0.mid'],
		]);
		assert.deepStrictEqual(rows.map(r => r.width), [1, 1, 1]);
	});

	it('opens a lane for a merged branch and joins it at the fork point', () => {
		const rows = layoutGraph([c('m', 'b', 'f'), c('f', 'a'), c('b', 'a'), c('a')]);

		assert.deepStrictEqual(rows.map(r => r.lane), [0, 1, 0, 0]);
		assert.deepStrictEqual(lines(rows[0]), ['0.mid>0.bottom', '0.mid>1.bottom']);
		assert.deepStrictEqual(lines(rows[1]), ['0.top>0.bottom', '1.mid>1.bottom', '1.top>1.mid']);
		assert.deepStrictEqual(lines(rows[2]), ['0.mid>0.bottom', '0.top>0.mid', '1.top>1.bottom']);
		assert.deepStrictEqual(lines(rows[3]), ['0.top>0.mid', '1.top>0.mid']);
		assert.deepStrictEqual(rows.map(r => r.width), [2, 2, 2, 2]);
	});

	it('gives every lane its own color that lasts until the lane closes', () => {
		const rows = layoutGraph([c('m', 'b', 'f'), c('f', 'a'), c('b', 'a'), c('a')]);

		assert.strictEqual(rows[0].color, rows[2].color, 'main line keeps its color');
		assert.notStrictEqual(rows[1].color, rows[0].color, 'the branch gets another color');
		const merge = rows[0].lines.find(l => l.to.lane === 1);
		assert.strictEqual(merge?.color, rows[1].color, 'the merge line has the branch color');
	});

	it('keeps two parallel branches on separate lanes', () => {
		const rows = layoutGraph([c('x2', 'x1'), c('y1', 'base'), c('x1', 'base'), c('base')]);

		assert.deepStrictEqual(rows.map(r => r.lane), [0, 1, 0, 0]);
		assert.deepStrictEqual(lines(rows[3]), ['0.top>0.mid', '1.top>0.mid']);
	});

	it('lets a line run off the bottom when the parent is not loaded', () => {
		const rows = layoutGraph([c('x', 'not-loaded')]);

		assert.deepStrictEqual(lines(rows[0]), ['0.mid>0.bottom']);
	});

	it('opens a lane per extra parent of an octopus merge', () => {
		const rows = layoutGraph([c('o', 'a', 'b', 'c'), c('a'), c('b'), c('c')]);

		assert.deepStrictEqual(lines(rows[0]), ['0.mid>0.bottom', '0.mid>1.bottom', '0.mid>2.bottom']);
		assert.deepStrictEqual(rows.map(r => r.lane), [0, 0, 1, 2]);
		assert.strictEqual(rows[0].width, 3);
	});

	it('reuses a lane after it closes', () => {
		const rows = layoutGraph([c('m', 'b', 'f'), c('f', 'a'), c('b', 'a'), c('a', 'root'), c('tip', 'root'), c('root')]);

		// "tip" starts a new branch after "f"'s lane closed at "a": it takes lane 1 again.
		assert.strictEqual(rows[4].lane, 1);
	});
});
