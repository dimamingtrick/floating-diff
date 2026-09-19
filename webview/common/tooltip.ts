import { placePopup } from '../../src/shared/popup';

/** Like VS Code's hovers: after a moment, or at once while moving from one button to the next. */
const DELAY = 500;
const STICKY = 400;
const TARGETS = '[data-tip], button[title], [role="button"][title]';

/**
 * Tooltips for buttons. A `title` shows none in a webview on macOS, so the
 * title of a hovered button (or any `data-tip`) shows in a hover of our own,
 * under the button, or above it at the bottom of the window.
 */
export function installTooltips(): void {
	const tip = document.createElement('div');
	tip.className = 'tip';
	tip.setAttribute('role', 'tooltip');
	document.body.appendChild(tip);
	let target: HTMLElement | undefined;
	let timer: ReturnType<typeof setTimeout> | undefined;
	let hiddenAt = 0;

	const hide = () => {
		clearTimeout(timer);
		if (tip.classList.contains('on')) {
			hiddenAt = Date.now();
			tip.classList.remove('on');
		}
		target = undefined;
	};
	const show = (element: HTMLElement) => {
		const text = element.dataset.tip;
		if (!text || !element.isConnected) {
			return;
		}
		tip.textContent = text;
		Object.assign(tip.style, { left: '0px', top: '0px' });
		tip.classList.add('on');
		const size = tip.getBoundingClientRect();
		const spot = placePopup(element.getBoundingClientRect(), { width: Math.ceil(size.width), height: Math.ceil(size.height) }, { width: window.innerWidth, height: window.innerHeight }, 'center');
		Object.assign(tip.style, { left: `${spot.left}px`, top: `${spot.top}px` });
	};

	document.addEventListener('mouseover', event => {
		const element = event.target instanceof Element ? event.target.closest<HTMLElement>(TARGETS) : null;
		if (element === target) {
			return;
		}
		const sticky = tip.classList.contains('on') || Date.now() - hiddenAt < STICKY;
		hide();
		if (!element) {
			return;
		}
		if (element.title) {
			// The title moves to the hover, and stays the name of an icon button.
			element.dataset.tip = element.title;
			if (!element.getAttribute('aria-label')) {
				element.setAttribute('aria-label', element.title);
			}
			element.removeAttribute('title');
		}
		target = element;
		timer = setTimeout(() => show(element), sticky ? 0 : DELAY);
	});
	document.documentElement.addEventListener('mouseleave', hide);
	document.addEventListener('mousedown', hide, true);
	document.addEventListener('keydown', hide, true);
	document.addEventListener('scroll', hide, true);
	window.addEventListener('blur', hide);
}
