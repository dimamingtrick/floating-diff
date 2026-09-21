/** One line of `git blame --line-porcelain`. */
export interface BlameLine {
	readonly hash: string;
	readonly author: string;
	readonly email: string;
	/** Author date in ms. */
	readonly date: number;
	/** The author's offset from UTC in minutes, so the date reads as they wrote it. */
	readonly tz: number;
	readonly summary: string;
	/** The file as this commit named it; a rename gives the old name in `previous`. */
	readonly path: string;
	/** The file before this commit; missing when the commit added it. */
	readonly previous?: { readonly hash: string; readonly path: string };
	/** A line the working tree has and no commit does: git gives it a hash of zeros. */
	readonly uncommitted: boolean;
}

export interface BlameAction {
	readonly label: string;
	readonly href: string;
}

const HEADER = /^([0-9a-f]{40}) \d+ \d+/;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** `+0300` as minutes; an unreadable offset counts as UTC. */
function tzMinutes(offset: string | undefined): number {
	const match = /^([+-])(\d{2})(\d{2})$/.exec(offset ?? '');
	return match ? (match[1] === '-' ? -1 : 1) * (Number(match[2]) * 60 + Number(match[3])) : 0;
}

/** The blame of one line; `undefined` when git said anything else (no such path, no commits). */
export function parseBlamePorcelain(output: string): BlameLine | undefined {
	const lines = output.split('\n');
	const header = HEADER.exec(lines[0] ?? '');
	if (!header) {
		return undefined;
	}
	const fields = new Map<string, string>();
	for (const line of lines.slice(1)) {
		// The line's own content comes last, with a tab: nothing after it is a field.
		if (line.startsWith('\t')) {
			break;
		}
		const space = line.indexOf(' ');
		fields.set(space < 0 ? line : line.slice(0, space), space < 0 ? '' : line.slice(space + 1));
	}
	const previous = (fields.get('previous') ?? '').split(' ');
	const hash = header[1];
	return {
		hash,
		author: fields.get('author') ?? '',
		email: (fields.get('author-mail') ?? '').replace(/^<|>$/g, ''),
		date: Number(fields.get('author-time') ?? 0) * 1000,
		tz: tzMinutes(fields.get('author-tz')),
		summary: fields.get('summary') ?? '',
		path: fields.get('filename') ?? '',
		...(HEADER.test(`${previous[0]} 1 1`) ? { previous: { hash: previous[0], path: previous.slice(1).join(' ') } } : {}),
		uncommitted: /^0+$/.test(hash),
	};
}

const count = (value: number, unit: string) => `${value} ${unit}${value === 1 ? '' : 's'} ago`;

/** "14 months ago", the way GitLens and WebStorm date a line. */
export function relativeTime(date: number, now: number): string {
	// A commit dated ahead of this clock (another machine's) is as good as new.
	const seconds = Math.max(0, Math.round((now - date) / 1000));
	const minutes = Math.floor(seconds / 60);
	const hours = Math.floor(minutes / 60);
	const days = Math.floor(hours / 24);
	if (minutes < 1) {
		return 'seconds ago';
	}
	if (hours < 1) {
		return count(minutes, 'minute');
	}
	if (days < 1) {
		return count(hours, 'hour');
	}
	if (days < 30) {
		return count(days, 'day');
	}
	const months = Math.floor(days / 30.44);
	return months < 18 ? count(months, 'month') : count(Math.floor(days / 365), 'year');
}

/** "15 Aug 2022 16:41" in the author's own timezone. */
export function formatDateTime(date: number, tz: number): string {
	const shifted = new Date(date + tz * 60000);
	const pad = (value: number) => String(value).padStart(2, '0');
	return `${shifted.getUTCDate()} ${MONTHS[shifted.getUTCMonth()]} ${shifted.getUTCFullYear()} ${pad(shifted.getUTCHours())}:${pad(shifted.getUTCMinutes())}`;
}

const who = (line: BlameLine, me?: string) => (me && line.email.toLowerCase() === me.toLowerCase() ? 'You' : line.author);

/** The grey note at the end of the line: "You, 14 months ago • feat: the callout". */
export function annotation(line: BlameLine, options: { readonly now: number; readonly me?: string }): string {
	return line.uncommitted ? 'You • Uncommitted changes' : `${who(line, options.me)}, ${relativeTime(line.date, options.now)} • ${line.summary}`;
}

/** The tooltip of that note: who, when, the message and what you can do with the commit. */
export function hoverMarkdown(line: BlameLine, options: { readonly now: number; readonly me?: string; readonly actions: readonly BlameAction[] }): string {
	if (line.uncommitted) {
		return '**You**, uncommitted changes';
	}
	const head = `**${who(line, options.me)}** <${line.email}>, ${relativeTime(line.date, options.now)} (${formatDateTime(line.date, line.tz)})`;
	const links = options.actions.map(action => `[${action.label}](${action.href})`).join(' · ');
	return [head, '', line.summary, ...(links ? ['', links] : [])].join('\n');
}
