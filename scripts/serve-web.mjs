import http from 'node:http';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const args = new Set(process.argv.slice(2));
const devMode = args.has('--dev');
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const root = path.join(repoRoot, devMode ? 'src' : 'dist-web');
const defaultPort = devMode ? 5173 : 4173;
const explicitPort = process.env.PORT !== undefined;
const port = Number(process.env.PORT || defaultPort);
const host = '127.0.0.1';
const fallbackPortAttempts = 10;
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
  Object.defineProperty(root, '__BOARDFISH_DEBUG_TOOLS_ENABLED__', {
    value: ${devMode ? 'true' : 'false'},
    writable: false,
    configurable: false,
  });
}(globalThis));
`;
}

async function handleRequest(req, res) {
  let filePath = null;
  try {
    filePath = safePath(req.url || '/');
  } catch (err) {
    if (err instanceof URIError) {
      res.writeHead(400).end('Bad Request');
      return;
    }
    throw err;
  }
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
}

function startServer(nextPort, attemptsRemaining = explicitPort ? 1 : fallbackPortAttempts) {
  const server = http.createServer(handleRequest);
  server.once('error', (error) => {
    if (error.code === 'EADDRINUSE' && !explicitPort && attemptsRemaining > 1) {
      const fallbackPort = nextPort + 1;
      console.warn(`Port ${nextPort} is busy; trying ${fallbackPort}.`);
      startServer(fallbackPort, attemptsRemaining - 1);
      return;
    }

    if (error.code === 'EADDRINUSE') {
      const hint = explicitPort ? ' Choose a different PORT value.' : ' Set PORT to choose another port.';
      console.error(`Port ${nextPort} is already in use.${hint}`);
      process.exitCode = 1;
      return;
    }

    throw error;
  });
  server.listen(nextPort, host, () => {
    const mode = devMode ? 'dev' : 'release preview';
    console.log(`Boardfish Web (${mode}): http://${host}:${nextPort}`);
  });
}

startServer(port);
