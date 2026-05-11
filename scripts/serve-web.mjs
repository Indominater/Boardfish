import http from 'node:http';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const args = new Set(process.argv.slice(2));
const devMode = args.has('--dev');
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const root = path.join(repoRoot, devMode ? 'src' : 'dist-web');
const port = Number(process.env.PORT || (devMode ? 5173 : 4173));
const webEnvRelativePath = path.join('js', 'web_env.js');

const types = new Map([
  ['.css', 'text/css; charset=utf-8'],
  ['.html', 'text/html; charset=utf-8'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.mjs', 'text/javascript; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.png', 'image/png'],
  ['.woff2', 'font/woff2'],
]);

function safePath(urlPath) {
  const decoded = decodeURIComponent(urlPath.split('?')[0] || '/');
  const relative = decoded === '/' ? 'index.html' : decoded.replace(/^\/+/, '');
  const resolved = path.resolve(root, relative);
  if (!resolved.startsWith(root + path.sep) && resolved !== root) return null;
  return resolved;
}

function webEnvSource() {
  return `'use strict';

(function initBoardfishWebEnv(root) {
  Object.defineProperty(root, '__BOARDFISH_WEB_DEV_MODE__', {
    value: ${devMode ? 'true' : 'false'},
    writable: false,
    configurable: false,
  });
}(globalThis));
`;
}

const server = http.createServer(async (req, res) => {
  const filePath = safePath(req.url || '/');
  if (!filePath) {
    res.writeHead(403).end('Forbidden');
    return;
  }
  if (devMode && path.relative(root, filePath) === webEnvRelativePath) {
    res.writeHead(200, {
      'Content-Type': types.get('.js'),
      'Cache-Control': 'no-store',
    });
    res.end(webEnvSource());
    return;
  }
  try {
    const info = await stat(filePath);
    const finalPath = info.isDirectory() ? path.join(filePath, 'index.html') : filePath;
    const ext = path.extname(finalPath).toLowerCase();
    res.writeHead(200, {
      'Content-Type': types.get(ext) || 'application/octet-stream',
    });
    createReadStream(finalPath).pipe(res);
  } catch (_) {
    res.writeHead(404).end('Not Found');
  }
});

server.listen(port, '127.0.0.1', () => {
  const mode = devMode ? 'dev' : 'release preview';
  console.log(`Boardfish Web (${mode}): http://127.0.0.1:${port}`);
});
