import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { pathToFileURL } from 'node:url';

const DEFAULT_UPSTREAM = 'http://127.0.0.1:8087';
const DEFAULT_PORT = 8088;
const MODES = new Set(['bad-json-once', 'old-data-404', 'missing-image', 'missing-remote-image']);
const HASH = /^[a-f0-9]{64}$/;
const MISSING_REMOTE_ATTACHMENT = 'https://github.com/user-attachments/assets/00000000-0000-0000-0000-000000000000';
const GITHUB_ATTACHMENT = /^https:\/\/github\.com\/user-attachments\/assets\/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;

function usage() {
  return [
    'Usage: node scripts/browser-fault-server.mjs --mode <mode> --path <path> [--port <port>] [--upstream <loopback-url>]',
    'Modes: bad-json-once | old-data-404 | missing-image | missing-remote-image',
    `Defaults: --upstream ${DEFAULT_UPSTREAM} --port ${DEFAULT_PORT}`
  ].join('\n');
}

function validTargetPath(mode, path) {
  if (typeof path !== 'string' || !path.startsWith('/') || path.startsWith('//') ||
      path.includes('\\') || path.includes('?') || path.includes('#') || /%(?:2f|5c|2e)/i.test(path) ||
      path.split('/').some((part, index) => index > 0 && (!part || part === '.' || part === '..'))) return false;
  if (mode === 'missing-image') return /^\/data\/[a-f0-9]{64}\/icons\/[A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)*\.(?:png|webp|jpe?g|gif)$/i.test(path);
  return /^\/data\/[a-f0-9]{64}\/details\/[A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)*\.json$/.test(path);
}

function isGithubAttachmentUrl(value) {
  return typeof value === 'string' && GITHUB_ATTACHMENT.test(value);
}

function rewriteMissingRemoteImage(body) {
  let detail;
  try { detail = JSON.parse(body.toString('utf8')); }
  catch { return null; }
  if (!detail || typeof detail !== 'object' || Array.isArray(detail) || !Array.isArray(detail.assets)) return null;
  const remoteAsset = detail.assets.find(asset => asset && typeof asset === 'object' && isGithubAttachmentUrl(asset.source_url));
  if (!remoteAsset) return null;
  remoteAsset.source_url = MISSING_REMOTE_ATTACHMENT;
  return Buffer.from(JSON.stringify(detail));
}

function validUpstream(value) {
  let url;
  try { url = new URL(value); } catch { throw new Error('--upstream must be a loopback HTTP URL'); }
  if (url.protocol !== 'http:' || url.username || url.password || url.search || url.hash || url.pathname !== '/' ||
      !['127.0.0.1', '::1', 'localhost'].includes(url.hostname)) {
    throw new Error('--upstream must be a plain loopback HTTP origin');
  }
  return url;
}

export function parseFaultArgs(argv) {
  const values = new Map();
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (flag === '--help' || flag === '-h') return { help: true };
    if (!['--mode', '--path', '--port', '--upstream'].includes(flag) || values.has(flag) || !argv[index + 1]) {
      throw new Error(`Invalid or duplicate argument: ${flag}\n${usage()}`);
    }
    values.set(flag, argv[++index]);
  }

  const mode = values.get('--mode');
  const targetPath = values.get('--path');
  if (!MODES.has(mode)) throw new Error(`--mode must be one of: ${[...MODES].join(', ')}`);
  if (!validTargetPath(mode, targetPath)) throw new Error(`--path is not a safe ${mode} target`);
  const portText = values.get('--port') ?? String(DEFAULT_PORT);
  if (!/^\d+$/.test(portText) || Number(portText) > 65535) throw new Error('--port must be an integer from 0 to 65535');
  const upstream = validUpstream(values.get('--upstream') ?? DEFAULT_UPSTREAM);
  return { mode, targetPath, port: Number(portText), upstream };
}

function readRequestHeaders(headers) {
  const output = {};
  for (const name of ['accept', 'accept-language', 'if-none-match', 'if-modified-since', 'range']) {
    const value = headers[name];
    if (typeof value === 'string') output[name] = value;
  }
  return output;
}

function sendJson(response, status, value, marker) {
  const body = Buffer.from(JSON.stringify(value));
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'content-length': body.length,
    'x-browser-fault': marker
  });
  response.end(body);
}

function changedHash(label, previous) {
  let next = createHash('sha256').update(`darktide-browser-fault:${label}:${previous}`).digest('hex');
  if (next === previous) next = createHash('sha256').update(`${next}:changed`).digest('hex');
  return next;
}

export function createBrowserFaultServer({ mode, targetPath, upstream = new URL(DEFAULT_UPSTREAM) }) {
  if (!MODES.has(mode) || !validTargetPath(mode, targetPath)) throw new TypeError('Invalid browser fault mode or target path');
  const upstreamUrl = upstream instanceof URL ? upstream : validUpstream(String(upstream));
  if (upstreamUrl.protocol !== 'http:' || !['127.0.0.1', '::1', 'localhost'].includes(upstreamUrl.hostname)) {
    throw new TypeError('Browser fault proxy upstream must use loopback HTTP');
  }
  let badJsonInjected = false;

  return createServer(async (request, response) => {
    if (!['GET', 'HEAD'].includes(request.method)) {
      sendJson(response, 405, { error: 'method_not_allowed' }, 'method-not-allowed');
      return;
    }

    let requestedUrl;
    try { requestedUrl = new URL(request.url ?? '/', 'http://fault-proxy.invalid'); }
    catch {
      sendJson(response, 400, { error: 'bad_request' }, 'bad-request');
      return;
    }

    const isTarget = requestedUrl.pathname === targetPath;
    if (mode === 'bad-json-once' && isTarget && request.method === 'GET' && !badJsonInjected) {
      badJsonInjected = true;
      const body = Buffer.from('{"fault":"deliberately invalid JSON"');
      console.log(`Injected one invalid JSON response for ${targetPath}; later requests pass through.`);
      response.writeHead(200, {
        'content-type': 'application/json; charset=utf-8',
        'cache-control': 'no-store',
        'content-length': body.length,
        'x-browser-fault': 'bad-json-once'
      });
      response.end(body);
      return;
    }

    if (mode === 'old-data-404' && isTarget) {
      console.log(`Injected a stale-data 404 for ${targetPath}.`);
      sendJson(response, 404, { error: 'not_found', test_fault: true }, 'old-data-404');
      return;
    }

    if (mode === 'missing-image' && isTarget) {
      console.log(`Injected a missing-image 404 for ${targetPath}.`);
      sendJson(response, 404, { error: 'not_found', test_fault: true }, 'missing-image');
      return;
    }

    const upstreamRequest = new URL(requestedUrl.pathname + requestedUrl.search, upstreamUrl);
    try {
      const upstreamResponse = await fetch(upstreamRequest, {
        method: request.method,
        headers: readRequestHeaders(request.headers),
        redirect: 'manual'
      });
      const body = request.method === 'HEAD' || upstreamResponse.status === 304
        ? Buffer.alloc(0)
        : Buffer.from(await upstreamResponse.arrayBuffer());
      if (mode === 'missing-remote-image' && isTarget && request.method === 'GET' && upstreamResponse.ok) {
        const rewritten = rewriteMissingRemoteImage(body);
        if (!rewritten) {
          sendJson(response, 502, { error: 'remote_image_not_available_for_fault_test' }, 'missing-remote-image-unavailable');
          return;
        }
        console.log(`Injected a missing GitHub attachment URL in ${targetPath}; all other assets and requests pass through.`);
        response.writeHead(upstreamResponse.status, {
          'content-type': upstreamResponse.headers.get('content-type') ?? 'application/json; charset=utf-8',
          'cache-control': 'no-store',
          'content-length': rewritten.length,
          'x-browser-fault': 'missing-remote-image'
        });
        response.end(rewritten);
        return;
      }
      const outputHeaders = {
        'content-length': body.length,
        'x-browser-fault': 'proxy'
      };
      for (const name of ['content-type', 'cache-control', 'etag', 'last-modified', 'location']) {
        const value = upstreamResponse.headers.get(name);
        if (value !== null) outputHeaders[name] = value;
      }
      response.writeHead(upstreamResponse.status, outputHeaders);
      response.end(body);
    } catch {
      sendJson(response, 502, { error: 'upstream_unavailable' }, 'upstream-unavailable');
    }
  });
}

async function maybeRewriteVersion(response, upstream, requestMethod) {
  const originalBody = Buffer.from(await response.arrayBuffer());
  let version;
  try { version = JSON.parse(originalBody.toString('utf8')); }
  catch { return { status: response.status, body: originalBody, headers: response.headers }; }
  if (version?.schema_version !== 2 || !HASH.test(version.data_revision ?? '') || !HASH.test(version.build_id ?? '')) {
    return { status: response.status, body: originalBody, headers: response.headers };
  }
  const changed = {
    ...version,
    data_revision: changedHash('data-revision', version.data_revision),
    build_id: changedHash('build-id', version.build_id)
  };
  const body = Buffer.from(JSON.stringify(changed));
  return {
    status: response.status,
    body: requestMethod === 'HEAD' ? Buffer.alloc(0) : body,
    headers: new Headers([
      ['content-type', response.headers.get('content-type') ?? 'application/json; charset=utf-8'],
      ['cache-control', 'no-store'],
      ['x-browser-fault', 'old-data-404-version']
    ])
  };
}

export function createOldData404Server({ targetPath, upstream = new URL(DEFAULT_UPSTREAM) }) {
  if (!validTargetPath('old-data-404', targetPath)) throw new TypeError('Invalid old-data-404 target path');
  const upstreamUrl = upstream instanceof URL ? upstream : validUpstream(String(upstream));
  let versionLogged = false;
  return createServer(async (request, response) => {
    if (!['GET', 'HEAD'].includes(request.method)) {
      sendJson(response, 405, { error: 'method_not_allowed' }, 'method-not-allowed');
      return;
    }
    let requestedUrl;
    try { requestedUrl = new URL(request.url ?? '/', 'http://fault-proxy.invalid'); }
    catch { sendJson(response, 400, { error: 'bad_request' }, 'bad-request'); return; }
    if (requestedUrl.pathname === targetPath) {
      console.log(`Injected a stale-data 404 for ${targetPath}.`);
      sendJson(response, 404, { error: 'not_found', test_fault: true }, 'old-data-404');
      return;
    }

    const upstreamRequest = new URL(requestedUrl.pathname + requestedUrl.search, upstreamUrl);
    try {
      const upstreamResponse = await fetch(upstreamRequest, {
        method: request.method,
        headers: readRequestHeaders(request.headers),
        redirect: 'manual'
      });
      const rewritten = requestedUrl.pathname === '/version.json'
        ? await maybeRewriteVersion(upstreamResponse, upstreamUrl, request.method)
        : { status: upstreamResponse.status, body: request.method === 'HEAD' ? Buffer.alloc(0) : Buffer.from(await upstreamResponse.arrayBuffer()), headers: upstreamResponse.headers };
      const outputHeaders = { 'content-length': rewritten.body.length };
      for (const name of ['content-type', 'cache-control', 'etag', 'last-modified', 'location', 'x-browser-fault']) {
        const value = rewritten.headers.get(name);
        if (value !== null) outputHeaders[name] = value;
      }
      if (requestedUrl.pathname === '/version.json') {
        outputHeaders['cache-control'] = 'no-store';
        outputHeaders['x-browser-fault'] = 'old-data-404-version';
        if (!versionLogged && rewritten.body.length > 0) {
          versionLogged = true;
          console.log('Changed /version.json build_id and data_revision to synthetic 64-character hashes.');
        }
      }
      response.writeHead(rewritten.status, outputHeaders);
      response.end(rewritten.body);
    } catch {
      sendJson(response, 502, { error: 'upstream_unavailable' }, 'upstream-unavailable');
    }
  });
}

export async function runFaultProxy(options) {
  const server = options.mode === 'old-data-404'
    ? createOldData404Server(options)
    : createBrowserFaultServer(options);
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(options.port, '127.0.0.1', resolve);
  });
  const address = server.address();
  console.log(`Browser fault proxy (${options.mode}): http://127.0.0.1:${address.port}/ -> ${options.upstream.origin}/`);
  console.log(`Target: ${options.targetPath}. Stop with Ctrl+C.`);
  return server;
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  try {
    const options = parseFaultArgs(process.argv.slice(2));
    if (options.help) console.log(usage());
    else await runFaultProxy(options);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
