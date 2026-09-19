export interface GraphPoint {
	readonly lane: number;
	/** Row edges and the node's middle. */
	readonly y: 'top' | 'mid' | 'bottom';
}

export interface GraphLine {
	readonly from: GraphPoint;
	readonly to: GraphPoint;
	/** Color index of the lane the line belongs to. */
	readonly color: number;
}

export interface GraphRow {
	/** Lane of the commit's node. */
	readonly lane: number;
	readonly color: number;
	/** Lanes the row needs horizontally. */
	readonly width: number;
	readonly lines: readonly GraphLine[];
}

/**
 * Lays out a commit graph row by row. `commits` are newest first with every
 * child before its parents (`git log --date-order`). Each lane waits for one
 * commit hash; a lane's color is fixed from when it opens until it closes.
 */
export function layoutGraph(commits: readonly { readonly hash: string; readonly parents: readonly string[] }[]): GraphRow[] {
	const lanes: (string | null)[] = [];
	const colors: number[] = [];
	let nextColor = 0;
	const open = (lane: number) => {
		colors[lane] = nextColor++;
	};
	const freeLane = () => {
		const free = lanes.indexOf(null);
		if (free >= 0) {
			return free;
		}
		lanes.push(null);
		return lanes.length - 1;
	};

	return commits.map(commit => {
		const lines: GraphLine[] = [];
		const waiting = lanes.flatMap((hash, i) => (hash === commit.hash ? [i] : []));
		let lane = waiting[0];
		if (lane === undefined) {
			lane = freeLane();
			open(lane);
		}
		const color = colors[lane];

		// Top half: lanes waiting for this commit join its node, the others pass by.
		lanes.forEach((hash, i) => {
			if (hash === commit.hash) {
				lines.push({ from: { lane: i, y: 'top' }, to: { lane, y: 'mid' }, color: colors[i] });
			} else if (hash !== null) {
				lines.push({ from: { lane: i, y: 'top' }, to: { lane: i, y: 'bottom' }, color: colors[i] });
			}
		});
		for (const i of waiting) {
			lanes[i] = null;
		}

		// Bottom half: the first parent continues the node's lane, others go to their own.
		const [first, ...others] = commit.parents;
		if (first !== undefined) {
			lanes[lane] = first;
			lines.push({ from: { lane, y: 'mid' }, to: { lane, y: 'bottom' }, color });
		}
		for (const parent of others) {
			let target = lanes.indexOf(parent);
			if (target < 0) {
				target = freeLane();
				lanes[target] = parent;
				open(target);
			}
			lines.push({ from: { lane, y: 'mid' }, to: { lane: target, y: 'bottom' }, color: colors[target] });
		}

		while (lanes.length > 0 && lanes[lanes.length - 1] === null) {
			lanes.pop();
		}
		const width = Math.max(lane + 1, lanes.length, ...lines.map(l => Math.max(l.from.lane, l.to.lane) + 1));
		return { lane, color, width, lines };
	});
}
