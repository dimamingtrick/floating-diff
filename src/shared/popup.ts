export interface Rect {
	readonly left: number;
	readonly top: number;
	readonly right: number;
	readonly bottom: number;
}

export interface Size {
	readonly width: number;
	readonly height: number;
}

export interface Placement {
	readonly left: number;
	readonly top: number;
	readonly maxHeight: number;
	readonly maxWidth: number;
}

/** Between the anchor and its popup, and between the popup and the window's edges. */
const GAP = 4;

/**
 * Where a popup of `size` goes next to `anchor` in a `view`-sized window: under
 * it, or above when only there it fits (or there is more room); by the anchor's
 * left or right edge, or centered; shrunk and moved so it stays inside the window.
 */
export function placePopup(anchor: Rect, size: Size, view: Size, align: 'left' | 'right' | 'center' = 'left'): Placement {
	const below = view.height - anchor.bottom - 2 * GAP;
	const above = anchor.top - 2 * GAP;
	const down = size.height <= below || below >= above;
	const maxHeight = Math.max(0, Math.min(size.height, down ? below : above));
	const maxWidth = Math.max(0, Math.min(size.width, view.width - 2 * GAP));
	const start = align === 'right' ? anchor.right - maxWidth : align === 'center' ? (anchor.left + anchor.right - maxWidth) / 2 : anchor.left;
	return {
		left: Math.max(GAP, Math.min(start, view.width - GAP - maxWidth)),
		top: down ? anchor.bottom + GAP : anchor.top - GAP - maxHeight,
		maxHeight,
		maxWidth,
	};
}
