import { createReadStream } from 'node:fs';
import { access, realpath } from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isPathInside } from '../src/static/common.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'dist-w01');
const host = '127.0.0.1';
const port = Number(process.env.W01_PREVIEW_PORT ?? '4174');
const contentTypes = new Map([
  ['.css', 'text/css; charset=utf-8'],
  ['.html', 'text/html; charset=utf-8'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.txt', 'text/plain; charset=utf-8']
]);

if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('W01_PREVIEW_PORT must be between 1024 and 65535');
const rootRealPath = await realpath(root);
const server = http.createServer(async (request, response) => {
  response.setHeader('X-Content-Type-Options', 'nosniff');
  response.setHeader('Referrer-Policy', 'no-referrer');
  response.setHeader('X-Robots-Tag', 'noindex, nofollow, noarchive');
  response.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; base-uri 'none'; frame-ancestors 'none'");
  response.setHeader('Cache-Control', 'no-store');
  if (!['GET', 'HEAD'].includes(request.method ?? '')) {
    response.writeHead(405, { Allow: 'GET, HEAD' }).end();
    return;
  }
  try {
    const url = new URL(request.url ?? '/', 'http://' + host + ':' + port);
    let requestedPath = decodeURIComponent(url.pathname);
    if (requestedPath === '/') requestedPath = '/index.html';
    const candidate = path.resolve(rootRealPath, '.' + requestedPath);
    if (!isPathInside(rootRealPath, candidate)) {
      response.writeHead(404).end();
      return;
    }
    const candidateRealPath = await realpath(candidate);
    if (!isPathInside(rootRealPath, candidateRealPath)) {
      response.writeHead(404).end();
      return;
    }
    await access(candidateRealPath);
    response.setHeader('Content-Type', contentTypes.get(path.extname(candidateRealPath)) ?? 'application/octet-stream');
    response.writeHead(200);
    if (request.method === 'HEAD') response.end();
    else createReadStream(candidateRealPath).pipe(response);
  } catch {
    response.writeHead(404).end();
  }
});

server.listen(port, host, () => process.stdout.write('Serving isolated W01 preview at http://' + host + ':' + port + '\n'));
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => server.close(() => process.exit(0)));
