// A stand-in for VS Code's webview API: answers the screens' messages with mock-data.js.
(function () {
	const params = new URLSearchParams(location.search);
	const screen = params.get('screen') || 'log';
	document.documentElement.dataset.theme = params.get('theme') || 'dark';
	document.documentElement.dataset.screen = screen;
	const M = window.MOCK;
	const reply = message => setTimeout(() => window.postMessage(message, '*'), 20);

	function search(query, options) {
		const hits = [];
		const flags = options.matchCase ? 'g' : 'gi';
		let pattern;
		try {
			const source = options.regex ? query : query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
			pattern = new RegExp(options.wholeWord ? `\\b(?:${source})\\b` : source, flags);
		} catch (error) {
			return { hits, error: String(error.message) };
		}
		for (const [path, file] of Object.entries(M.previews)) {
			(file.text || '').split('\n').forEach((text, i) => {
				pattern.lastIndex = 0;
				if (pattern.test(text)) {
					hits.push({ path, line: i + 1, text });
				}
			});
		}
		return { hits };
	}

	const handlers = {
		log(m) {
			if (m.type === 'ready') {
				reply({ type: 'log', data: M.log });
				reply({ type: 'details', details: M.details[M.log.selected] });
			} else if (m.type === 'select') {
				reply({ type: 'details', details: M.details[m.hash] });
			}
		},
		explorer(m) {
			if (m.type === 'ready') {
				reply({ type: 'init', data: M.explorer });
				const file = params.get('file');
				if (file) {
					reply({ type: 'file', file: M.previews[file] || { path: file, missing: true } });
				}
			} else if (m.type === 'openFile') {
				reply({ type: 'file', file: M.previews[m.path] ? { ...M.previews[m.path], line: m.line } : { path: m.path, missing: true } });
			} else if (m.type === 'search') {
				reply({ type: 'search', query: m.query, ...search(m.query, m.options) });
			}
		},
		sidebar(m) {
			if (m.type === 'ready') {
				reply({ type: 'state', state: { ...M.sidebar, viewMode: params.get('mode') === 'tree' ? 'tree' : 'list' } });
			}
		},
		git(m) {
			if (m.type === 'ready') {
				reply({ type: 'branches', branches: M.gitPanel.branches });
				reply({ type: 'iconFonts', fonts: M.sidebar.iconFonts });
				reply({ type: 'log', data: { ...M.log, total: 207, canLoadMore: true } });
				reply({ type: 'details', details: M.gitPanel.details[M.log.selected] });
			} else if (m.type === 'loadMore') {
				// A second page: the same commits again under other hashes.
				const more = M.log.rows.map(row => ({ ...row, hash: `${row.hash.slice(0, 30)}0000000000`, refs: [] }));
				reply({ type: 'log', data: { ...M.log, rows: [...M.log.rows, ...more], total: 207, canLoadMore: true } });
			} else if (m.type === 'filters') {
				reply({ type: 'log', data: { ...M.log, filters: m.filters } });
			} else if (m.type === 'select') {
				reply({ type: 'details', details: M.gitPanel.details[m.hash] });
			}
		},
	};

	window.acquireVsCodeApi = () => ({
		postMessage(message) {
			if (message.type !== 'rendered') {
				console.log(`[${screen}] →`, JSON.stringify(message));
			}
			handlers[screen](message);
		},
		getState: () => undefined,
		setState: () => { },
	});
})();
