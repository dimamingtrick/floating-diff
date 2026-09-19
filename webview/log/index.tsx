import { render } from 'preact';
import { useState } from 'preact/hooks';
import type { LogToWebview } from '../../src/shared/protocol';
import { useMessages } from '../common/vscode';
import { installTooltips } from '../common/tooltip';
import { CommitTable, Details, Toolbar, useLogState } from './parts';

/** The Git Log in an editor tab: filters, commit graph, details of the selected commit. */
function App() {
	const log = useLogState();
	const [asTree, setAsTree] = useState(false);
	useMessages<LogToWebview>(log.onMessage);

	if (!log.data) {
		return <div class="log">{log.busy && <div class="busy-bar" />}</div>;
	}
	return (
		<div class="log">
			{log.busy && <div class="busy-bar" />}
			<Toolbar data={log.data} paths={log.paths} />
			<div class="log-body">
				<CommitTable data={log.data} rows={log.rows} selected={log.selected} onSelect={log.select} searching={log.searching} />
				<Details row={log.row} details={log.details} asTree={asTree} setAsTree={setAsTree} />
			</div>
		</div>
	);
}

installTooltips();
render(<App />, document.getElementById('app')!);
