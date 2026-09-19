import type { GraphLine, GraphRow } from '../../src/shared/protocol';

// Geometry of the design: lanes 15 px apart, rows 26 px, turns rounded like its 9 px corners.
const LANE = 15;
const FIRST = 14;
const ROW_HEIGHT = 26;
const CORNER = 9;
const Y = { top: 0, mid: ROW_HEIGHT / 2, bottom: ROW_HEIGHT } as const;

export const laneColor = (color: number) => `var(--lane${color % 6})`;
const laneX = (lane: number) => FIRST + lane * LANE;

export function graphWidth(lanes: number): number {
	return laneX(Math.max(lanes, 1) - 1) + 12;
}

/** Straight down a lane; sideways turns go through the commit's middle with a rounded corner. */
function linePath(line: GraphLine): string {
	const x1 = laneX(line.from.lane);
	const x2 = laneX(line.to.lane);
	const y1 = Y[line.from.y];
	const y2 = Y[line.to.y];
	if (x1 === x2) {
		return `M${x1} ${y1}V${y2}`;
	}
	const dir = Math.sign(x2 - x1);
	const r = Math.min(CORNER, Math.abs(x2 - x1), Math.abs(y2 - y1));
	if (line.from.y === 'mid') {
		// Out of the commit sideways, then down the other lane.
		return `M${x1} ${y1}H${x2 - dir * r}Q${x2} ${y1} ${x2} ${y1 + r}V${y2}`;
	}
	if (line.to.y === 'mid') {
		// Down the other lane, then sideways into the commit.
		return `M${x1} ${y1}V${y2 - r}Q${x1} ${y2} ${x1 + dir * r} ${y2}H${x2}`;
	}
	return `M${x1} ${y1}C${x1} ${Y.mid} ${x2} ${Y.mid} ${x2} ${y2}`;
}

/** One row of the commit graph: lane lines and the commit's node (a ring for merges and HEAD). */
export function GraphCell({ row, lanes, ring }: { row: GraphRow; lanes: number; ring: boolean }) {
	const width = graphWidth(lanes);
	const x = laneX(row.lane);
	const color = laneColor(row.color);
	return (
		<svg class="graph" width={width} height={ROW_HEIGHT} viewBox={`0 0 ${width} ${ROW_HEIGHT}`} aria-hidden="true">
			{row.lines.map((line, i) => (
				<path key={i} d={linePath(line)} stroke={laneColor(line.color)} stroke-width="2" fill="none" />
			))}
			{ring ? (
				<>
					<circle cx={x} cy={Y.mid} r="8" fill="var(--editor)" />
					<circle cx={x} cy={Y.mid} r="4" fill="var(--editor)" stroke={color} stroke-width="2" />
				</>
			) : (
				<>
					<circle cx={x} cy={Y.mid} r="7" fill="var(--editor)" />
					<circle cx={x} cy={Y.mid} r="4" fill={color} />
				</>
			)}
		</svg>
	);
}

/** While searching, rows are not neighbors in history: dots only, no lines. */
export function DotCell({ color }: { color: number }) {
	const width = graphWidth(1);
	return (
		<svg class="graph" width={width} height={ROW_HEIGHT} aria-hidden="true">
			<circle cx={laneX(0)} cy={Y.mid} r="4" fill={laneColor(color)} />
		</svg>
	);
}
