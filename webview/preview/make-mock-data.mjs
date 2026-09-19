// Builds a throwaway repository with branches, merges and tags, reads it with
// GitStorm's own data code (out/, from `tsc -p .`) and writes mock-data.js for
// the preview page. Run: npm run preview
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';

const require = createRequire(import.meta.url);
const out = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../../out');
const { GitData } = require(`${out}/data/gitData.js`);
const { createGitRunner } = require(`${out}/branches/gitRunner.js`);
const { BranchService } = require(`${out}/branches/branchService.js`);
const { layoutGraph } = require(`${out}/graph/lanes.js`);
const { sidebarGroups } = require(`${out}/sidebar/sidebarModel.js`);

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gitstorm-preview-'));
let clock = Date.parse('2026-09-08T09:00:00Z') / 1000;
const people = { anna: ['Anna Kovalenko', 'anna@example.com'], mark: ['Mark Rivera', 'mark@example.com'], li: ['Li Wei', 'li@example.com'] };
const git = (...args) => execFileSync('git', args, { cwd: dir, stdio: 'pipe' }).toString();
const write = (file, text) => {
	fs.mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
	fs.writeFileSync(path.join(dir, file), text);
};
function commit(who, message, files = {}) {
	for (const [file, text] of Object.entries(files)) {
		if (text === null) {
			git('rm', '-q', file);
		} else {
			write(file, text);
			git('add', file);
		}
	}
	clock += 3 * 3600 + 1234;
	const [name, email] = people[who];
	execFileSync('git', ['-c', `user.name=${name}`, '-c', `user.email=${email}`, 'commit', '-q', '--allow-empty', '-m', message], {
		cwd: dir,
		env: { ...process.env, GIT_AUTHOR_DATE: `${clock} +0000`, GIT_COMMITTER_DATE: `${clock} +0000` },
	});
}
const merge = (who, branch, message) => {
	clock += 3600;
	const [name, email] = people[who];
	execFileSync('git', ['-c', `user.name=${name}`, '-c', `user.email=${email}`, 'merge', '-q', '--no-ff', '-m', message, branch], {
		cwd: dir,
		env: { ...process.env, GIT_AUTHOR_DATE: `${clock} +0000`, GIT_COMMITTER_DATE: `${clock} +0000` },
	});
};
const lines = (...rows) => rows.join('\n') + '\n';

git('init', '-q', '-b', 'main');
commit('anna', 'Initial commit', {
	'README.md': lines('# Shop', '', 'Storefront with cart and checkout.'),
	'package.json': lines('{', '  "name": "shop",', '  "version": "2.3.0"', '}'),
	'src/app.ts': lines("import { cart } from './cart/cart';", '', 'export function start() {', '  cart.load();', '}'),
});
commit('mark', 'cart: add totals and discounts', {
	'src/cart/cart.ts': lines('export const cart = {', '  items: [] as { price: number; qty: number }[],', '  load() {},', '};'),
	'src/cart/totals.ts': lines(
		"import { cart } from './cart';",
		'',
		'/** Sum of all items, before discounts. */',
		'export function subtotal(): number {',
		'  return cart.items.reduce((sum, item) => sum + item.price * item.qty, 0);',
		'}',
		'',
		'export function total(discount = 0): number {',
		'  return Math.round((subtotal() - discount) * 100) / 100;',
		'}',
	),
});
git('checkout', '-q', '-b', 'develop');
commit('li', 'checkout: routes for the new flow', {
	'src/checkout/Routes.tsx': lines("import { PaymentStep } from './PaymentStep';", '', 'export const routes = [', "  { path: '/checkout', step: 'address' },", '];'),
});
git('checkout', '-q', '-b', 'feature/checkout-v2');
commit('anna', 'checkout: payment step skeleton', {
	'src/checkout/PaymentStep.tsx': lines('export function PaymentStep() {', "  return 'payment';", '}'),
});
git('checkout', '-q', 'develop');
commit('mark', 'cart: fix rounding of totals', {
	'src/cart/totals.ts': lines(
		"import { cart } from './cart';",
		'',
		'/** Sum of all items, before discounts. */',
		'export function subtotal(): number {',
		'  return cart.items.reduce((sum, item) => sum + item.price * item.qty, 0);',
		'}',
		'',
		'export function total(discount = 0): number {',
		'  const cents = Math.round(subtotal() * 100) - Math.round(discount * 100);',
		'  return Math.max(cents, 0) / 100;',
		'}',
	),
});
git('checkout', '-q', 'feature/checkout-v2');
commit('anna', 'checkout: validate promo codes before submit', {
	'src/checkout/promo.ts': lines('const CODE = /^[A-Z0-9]{4,12}$/;', '', 'export function validPromo(code: string): boolean {', '  return CODE.test(code.trim().toUpperCase());', '}'),
	'src/checkout/promo.test.ts': lines("import { validPromo } from './promo';", '', "test('accepts SPRING24', () => expect(validPromo('spring24')).toBe(true));"),
});
git('checkout', '-q', 'main');
commit('li', 'docs: describe the checkout flow', { 'README.md': lines('# Shop', '', 'Storefront with cart and checkout.', '', '## Checkout', '', 'Address → payment → review.') });
merge('mark', 'develop', "Merge branch 'develop'");
git('tag', 'v2.3.6');
git('checkout', '-q', 'feature/checkout-v2');
merge('anna', 'develop', "Merge branch 'develop' into feature/checkout-v2");
commit('anna', 'checkout: wire the payment step into routes', {
	'src/checkout/Routes.tsx': lines("import { PaymentStep } from './PaymentStep';", '', 'export const routes = [', "  { path: '/checkout', step: 'address' },", "  { path: '/checkout/payment', step: 'payment', view: PaymentStep },", '];'),
});
git('checkout', '-q', '-b', 'hotfix/pdf-export', 'main');
commit('li', 'fix: PDF export crashes on an empty cart', { 'src/export/pdf.ts': lines('export function exportPdf(items: unknown[]) {', "  if (items.length === 0) return 'Your cart is empty';", "  return 'PDF';", '}') });
git('checkout', '-q', 'main');
merge('mark', 'hotfix/pdf-export', "Merge branch 'hotfix/pdf-export'");
git('tag', 'v2.4.0');
git('checkout', '-q', 'develop');
commit('li', 'search: facets prototype', { 'src/search/facets.ts': lines('export const facets = ["brand", "price", "size"];'), 'src/ui/legacy.tsx': lines('// old UI') });
commit('mark', 'search: drop legacy UI', { 'src/ui/legacy.tsx': null });
git('checkout', '-q', 'feature/checkout-v2');
// Never contacted: it only maps branches to their upstreams.
git('remote', 'add', 'origin', 'https://example.com/shop.git');
for (const [ref, rev] of [['main', 'main~1'], ['develop', 'develop~1'], ['feature/checkout-v2', 'feature/checkout-v2~1']]) {
	git('update-ref', `refs/remotes/origin/${ref}`, git('rev-parse', rev).trim());
}
git('config', 'branch.feature/checkout-v2.remote', 'origin');
git('config', 'branch.feature/checkout-v2.merge', 'refs/heads/feature/checkout-v2');
git('config', 'branch.main.remote', 'origin');
git('config', 'branch.main.merge', 'refs/heads/main');
// Checkout moves for the Recent group.
for (const branch of ['hotfix/pdf-export', 'develop', 'feature/checkout-v2']) {
	git('checkout', '-q', branch);
}

const run = createGitRunner('git', dir);
const data = new GitData(run);
const commits = await data.log({ limit: 1000 });
const graph = layoutGraph(commits);
const head = git('rev-parse', 'HEAD').trim();
const details = {};
for (const c of commits) {
	const d = await data.commit(c.hash, c.parents[0]);
	details[c.hash] = { hash: c.hash, body: d.body, files: d.files };
}
const log = {
	rows: commits.map((c, i) => ({ hash: c.hash, parents: c.parents, subject: c.subject, author: c.author, date: c.date, refs: c.refs, graph: graph[i] })),
	graphWidth: graph.reduce((max, row) => Math.max(max, row.width), 1),
	filters: {},
	branches: await data.branchNames(),
	authors: [...new Set(commits.map(c => c.author))].sort(),
	canLoadMore: false,
	selected: head,
};

const browsed = 'develop';
const [tip] = await data.log({ ref: browsed, limit: 1 });
const base = await data.mergeBase('HEAD', browsed);
const counts = await data.aheadBehind('HEAD', browsed);
const files = await data.tree(browsed);
const explorer = {
	info: { branch: browsed, current: 'feature/checkout-v2', remote: false, tip: { hash: tip.hash, subject: tip.subject, author: tip.author, date: tip.date }, ...counts },
	files,
	diff: await data.diffStat(base, browsed),
	commits: await (async () => {
		const ahead = new Set((await data.commitsBetween('HEAD', browsed)).map(c => c.hash));
		return (await data.log({ ref: browsed, limit: 300 })).map(({ hash, parents, subject, author, date }) => ({ hash, parents, subject, author, date, ahead: ahead.has(hash) }));
	})(),
};
const previews = {};
for (const file of files) {
	previews[file] = { path: file, ...(await data.file(browsed, file)) };
}

const list = await new BranchService({}, run, () => undefined).list();
// File icons: the Seti theme of the downloaded test VS Code, resolved by GitStorm's own code.
const { iconIdFor, fontCharacter, languageResolver } = require(`${out}/sidebar/fileIcons.js`);
const seti = fs.readdirSync(path.join(out, '../.vscode-test')).map(dir => path.join(out, '../.vscode-test', dir, 'Visual Studio Code.app/Contents/Resources/app/extensions/theme-seti/icons')).find(dir => fs.existsSync(dir));
const theme = seti && JSON.parse(fs.readFileSync(path.join(seti, 'vs-seti-icon-theme.json'), 'utf8'));
const language = languageResolver([
	{ id: 'typescript', extensions: ['.ts'] },
	{ id: 'typescriptreact', extensions: ['.tsx'] },
	{ id: 'markdown', extensions: ['.md'] },
	{ id: 'json', extensions: ['.json'] },
], {});
const icon = name => {
	const definition = theme && theme.iconDefinitions[iconIdFor(theme, name, language(name), 'dark')];
	return definition && { kind: 'glyph', font: 'seti', char: fontCharacter(definition.fontCharacter), color: definition.fontColor, size: '150%' };
};
const file = (filePath, letter, decoration, text) => {
	const slash = filePath.lastIndexOf('/');
	const name = filePath.slice(slash + 1);
	return { path: filePath, name, dir: slash < 0 ? '' : filePath.slice(0, slash), letter, decoration, tooltip: `${filePath} • ${text}`, icon: icon(name) };
};
const sidebar = {
	repos: [
		{
			root: '/work/shop',
			name: 'shop',
			current: { name: list.current.name, upstream: list.current.upstream, ahead: list.current.ahead, behind: list.current.behind },
			groups: [
				{ group: 'index', label: 'Staged Changes', files: [file('src/checkout/promo.test.ts', 'A', 'added', 'Index Added')] },
				{
					group: 'workingTree',
					label: 'Changes',
					files: [
						file('native-app/src/shared/components/ScreenWrapper/ScreenWrapper.tsx', 'M', 'modified', 'Modified'),
						file('src/cart/totals.ts', 'M', 'modified', 'Modified'),
						file('src/ui/legacy.tsx', 'D', 'deleted', 'Deleted'),
						file('docs/notes.md', 'U', 'untracked', 'Untracked'),
					],
				},
			],
			changeCount: 5,
		},
		{
			root: '/work/shop/vendor/design-tokens',
			name: 'design-tokens',
			current: { name: 'fb99218', ahead: 0, behind: 0 },
			groups: [{ group: 'workingTree', label: 'Changes', files: [] }],
			changeCount: 0,
		},
	],
	viewMode: 'list',
	compactFolders: true,
	folderIcons: {},
	iconFonts: seti ? [{ id: 'seti', src: `/${path.relative(path.join(out, '..'), path.join(seti, 'seti.woff'))}`, format: 'woff' }] : [],
};

const { syncLabel } = require(`${out}/branches/branchModel.js`);
const gitPanel = {
	branches: {
		repos: sidebar.repos.map(({ root, name }) => ({ root, name })),
		root: '/work/shop',
		local: list.branches.filter(b => !b.remote).map(b => ({ name: b.name, current: b.current, favorite: ['main', 'master'].includes(b.name), sync: syncLabel(b) })),
		remote: list.branches.filter(b => b.remote).map(b => ({ name: b.name, current: false, favorite: ['main', 'master'].includes(b.name.slice(b.remote.length + 1)), sync: '' })),
		tags: await data.tags(),
		remotes: ['origin'],
	},
	details: Object.fromEntries(
		await Promise.all(
			Object.values(details).map(async d => [
				d.hash,
				{ ...d, branches: await data.branchesContaining(d.hash), icons: Object.fromEntries(d.files.map(f => [f.path, icon(f.path.slice(f.path.lastIndexOf('/') + 1))])) },
			]),
		),
	),
};
log.rows = log.rows.map(row => ({ ...row, email: `${row.author.split(' ')[0].toLowerCase()}@example.com` }));
log.total = log.rows.length;
// A long message, to see the commit buttons stay at the bottom.
gitPanel.details[log.selected].body = 'Two-step checkout: the payment step now lives on its own route, so it can be\nlinked from the e-mail reminders.\n\nThe step keeps its own form state: a refresh no longer drops\nthe card data that was entered. Routes are declared in one\nplace and the old step list is gone.\n\nReviewed-by: Li Wei';

const target = path.join(path.dirname(new URL(import.meta.url).pathname), 'mock-data.js');
fs.writeFileSync(target, `window.MOCK = ${JSON.stringify({ log, details, explorer, previews, sidebar, gitPanel }, null, 1)};\n`);
fs.rmSync(dir, { recursive: true, force: true });
console.log(`${path.relative(process.cwd(), target)}: ${commits.length} commits, ${files.length} files`);
