import { createServer } from 'node:http';
import { lstat, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { verifyStaticPackage } from '../src/static/verify.mjs';
import { parseJson, safeRelativePath } from '../src/static/common.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const IMMUTABLE = 'public, max-age=31536000, immutable';
const REVALIDATE = 'no-cache, must-revalidate';

function contentType(relativePath) {
  const extension = path.posix.extname(relativePath).toLowerCase();
  return ({
    '.html': 'text/html; charset=utf-8',
    '.mjs': 'application/javascript; charset=utf-8',
    '.js': 'application/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.xml': 'application/xml; charset=utf-8',
    '.txt': 'text/plain; charset=utf-8',
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
    '.webp': 'image/webp',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif'
  })[extension] ?? 'application/octet-stream';
}

function isHashedAsset(relativePath) {
  return /^assets\/[a-f0-9]{64}\.(?:mjs|js|css)$/.test(relativePath);
}
function cacheControl(relativePath, isDocument = false) {
  if (isDocument || relativePath === 'index.html' || relativePath === 'version.json') return REVALIDATE;
  if (relativePath.startsWith('data/') || isHashedAsset(relativePath)) return IMMUTABLE;
  return REVALIDATE;
}
function send(response, status, body, type, cache = 'no-store', method = 'GET') {
  const bytes = Buffer.isBuffer(body) ? body : Buffer.from(body, 'utf8');
  response.writeHead(status, {
    'Content-Type': type,
    'Content-Length': bytes.byteLength,
    'Cache-Control': cache,
    'X-Content-Type-Options': 'nosniff'
  });
  response.end(method === 'HEAD' ? undefined : bytes);
}
function acceptsHtml(request) {
  return (request.headers.accept ?? '').split(',').some(item => item.trim().split(';')[0].trim().toLowerCase() === 'text/html');
}
function safeUrlPath(pathname) {
  let decoded;
  try { decoded = decodeURIComponent(pathname); }
  catch { return null; }
  if (decoded.includes('\0') || decoded.includes('\\') || decoded.startsWith('//')) return null;
  const segments = decoded.split('/');
  if (segments.some(segment => segment === '.' || segment === '..')) return null;
  return decoded;
}
async function readRegularFile(distPath, relativePath) {
  let safe;
  try { safe = safeRelativePath(relativePath, 'request path'); }
  catch { return null; }
  const target = path.join(distPath, ...safe.split('/'));
  const relative = path.relative(distPath, target);
  if (!relative || relative === '..' || relative.startsWith('..' + path.sep) || path.isAbsolute(relative)) return null;
  let current = distPath;
  const segments = safe.split('/');
  for (let index = 0; index < segments.length; index++) {
    current = path.join(current, segments[index]);
    const info = await lstat(current).catch(error => error.code === 'ENOENT' ? null : Promise.reject(error));
    if (!info || info.isSymbolicLink()) return null;
    if (index < segments.length - 1 && !info.isDirectory()) return null;
    if (index === segments.length - 1 && !info.isFile()) return null;
  }
  return readFile(target);
}

export async function createStaticServer({ distPath = path.join(ROOT, 'dist') } = {}) {
  const resolvedDist = path.resolve(distPath);
  const verified = await verifyStaticPackage(resolvedDist);
  const manifestBytes = await readFile(path.join(resolvedDist, 'artifact-manifest.json'));
  const manifest = parseJson(manifestBytes, 'artifact-manifest.json');
  const available = new Set(manifest.files.map(file => file.path));
  available.add('artifact-manifest.json');

  return createServer(async (request, response) => {
    const method = request.method ?? 'GET';
    if (method !== 'GET' && method !== 'HEAD') {
      response.setHeader('Allow', 'GET, HEAD');
      return send(response, 405, 'Method Not Allowed\n', 'text/plain; charset=utf-8', 'no-store', method);
    }
    let url;
    try { url = new URL(request.url ?? '/', 'http://127.0.0.1'); }
    catch { return send(response, 400, 'Bad Request\n', 'text/plain; charset=utf-8', 'no-store', method); }
    const pathname = safeUrlPath(url.pathname);
    if (pathname === null) return send(response, 400, 'Bad Request\n', 'text/plain; charset=utf-8', 'no-store', method);
    const historyBase = '/history/1.13.1';
    const isHistoryDocumentPath = pathname === historyBase || pathname === historyBase + '/';
    const isDataPath = pathname.startsWith('/data/');
    const relativePath = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
    if (available.has(relativePath)) {
      const bytes = await readRegularFile(resolvedDist, relativePath);
      if (bytes) {
        return send(response, 200, bytes, contentType(relativePath), cacheControl(relativePath), method);
      }
    }
    if (isDataPath && pathname.toLowerCase().endsWith('.json')) {
      return send(response, 404, '{"error":"not_found"}\n', 'application/json; charset=utf-8', 'no-store', method);
    }
    if (isHistoryDocumentPath && acceptsHtml(request)) {
      const bytes = await readRegularFile(resolvedDist, 'index.html');
      if (bytes) return send(response, 200, bytes, contentType('index.html'), cacheControl('index.html', true), method);
    }
    if (pathname.startsWith(historyBase + '/')) {
      return send(response, 404, 'Not Found\n', 'text/plain; charset=utf-8', 'no-store', method);
    }
    if (relativePath.startsWith('assets/') || relativePath.startsWith('data/') ||
        path.posix.extname(relativePath) !== '') {
      return send(response, 404, 'Not Found\n', 'text/plain; charset=utf-8', 'no-store', method);
    }
    if (acceptsHtml(request)) {
      const bytes = await readRegularFile(resolvedDist, 'index.html');
      if (bytes) return send(response, 200, bytes, contentType('index.html'), cacheControl('index.html', true), method);
    }
    return send(response, 404, 'Not Found\n', 'text/plain; charset=utf-8', 'no-store', method);
  });
}

function parsePort(args) {
  if (args.length > 1) throw new Error('Usage: node scripts/serve.mjs [port]');
  const value = args[0] ?? process.env.PORT ?? '8000';
  if (!/^\d+$/.test(String(value))) throw new Error('port must be an integer from 0 to 65535');
  const port = Number(value);
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('port must be an integer from 0 to 65535');
  return port;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const port = parsePort(process.argv.slice(2));
    const server = await createStaticServer();
    server.listen(port, '127.0.0.1', () => {
      const address = server.address();
      process.stdout.write('Static preview at http://127.0.0.1:' + address.port + '/\n');
    });
  } catch (error) {
    process.stderr.write('Static server failed: ' + (error?.message ?? String(error)) + '\n');
    process.exitCode = 1;
  }
}

