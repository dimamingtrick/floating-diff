// Serves the repository for the preview page: http://localhost:5178/webview/preview/?screen=log
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..');
const port = Number(process.env.PORT) || 5178;
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.map': 'application/json' };

http
	.createServer((req, res) => {
		const url = new URL(req.url ?? '/', 'http://localhost');
		let file = path.join(root, decodeURIComponent(url.pathname));
		if (!file.startsWith(root + path.sep)) {
			res.writeHead(403).end();
			return;
		}
		if (url.pathname.endsWith('/')) {
			file = path.join(file, 'index.html');
		}
		fs.readFile(file, (error, body) => {
			if (error) {
				res.writeHead(404).end('Not found');
				return;
			}
			res.writeHead(200, { 'content-type': types[path.extname(file)] ?? 'application/octet-stream', 'cache-control': 'no-store' });
			res.end(body);
		});
	})
	.listen(port, '127.0.0.1', () => console.log(`http://localhost:${port}/webview/preview/?screen=log`));
