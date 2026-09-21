/** Two lines of a commit message, so the section never collapses to nothing. */
const MIN_INFO = 60;
/** Enough of the file list to stay useful while the details are dragged open. */
const MIN_FILES = 120;

/**
 * The height of the commit details after their top edge moves by `dy`
 * (dragging up is negative, and makes them taller).
 */
export function resizeInfo(height: number, dy: number, paneHeight: number): number {
	return Math.max(MIN_INFO, Math.min(paneHeight - MIN_FILES, height - dy));
}
