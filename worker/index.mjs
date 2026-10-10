import { validateReleaseManifest } from '../src/release/manifest.mjs';

const response = (status, message) => new Response(message, {
  status,
  headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' }
});

function fileName(pathname) {
  if (pathname === '/') return 'index.html';
  if (!/^\/[a-zA-Z0-9/_-]+(?:\.[a-z0-9]+)?$/.test(pathname) || pathname.includes('//')) return null;
  if (pathname.endsWith('/')) return `${pathname.slice(1)}index.html`;
  if (pathname.startsWith('/assets/') && /\.(?:css|js|svg|png|webp)$/.test(pathname)) return pathname.slice(1);
  return null;
}

export default {
  async fetch(request, env) {
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return new Response('Method Not Allowed', { status: 405, headers: { allow: 'GET, HEAD', 'cache-control': 'no-store' } });
    }
    const releaseId = env?.ACTIVE_RELEASE;
    if (!/^sha256:[a-f0-9]{64}$/.test(releaseId ?? '') || !env?.CONTENT_BUCKET?.get) {
      return response(503, 'Release unavailable');
    }
    const name = fileName(new URL(request.url).pathname);
    if (!name) return response(404, 'Not found');
    const prefix = `releases/${releaseId}/`;
    try {
      const manifestObject = await env.CONTENT_BUCKET.get(`${prefix}build-manifest.json`);
      if (!manifestObject) return response(503, 'Release unavailable');
      const manifest = JSON.parse(await manifestObject.text());
      await validateReleaseManifest(manifest, releaseId);
      const requestedEntry = manifest.files.find(file => file.path === name);
      const notFound = !requestedEntry;
      const entry = requestedEntry ?? (name.startsWith('assets/') ? null :
        manifest.files.find(file => file.path === '404.html'));
      if (!entry) return response(404, 'Not found');
      const etag = `"${entry.sha256}"`;
      const headers = new Headers({
        'content-type': entry.content_type,
        'cache-control': notFound ? 'no-store' : 'public, max-age=60',
        etag
      });
      if (!notFound && request.headers.get('if-none-match') === etag) return new Response(null, { status: 304, headers });
      if (request.method === 'HEAD') return new Response(null, { status: notFound ? 404 : 200, headers });
      const object = await env.CONTENT_BUCKET.get(`${prefix}${entry.path}`);
      if (!object) return response(503, 'Release incomplete');
      const bytes = await object.arrayBuffer();
      if (bytes.byteLength !== entry.raw_bytes) return response(503, 'Release object mismatch');
      const digest = await crypto.subtle.digest('SHA-256', bytes);
      const actualSha = [...new Uint8Array(digest)].map(value => value.toString(16).padStart(2, '0')).join('');
      if (actualSha !== entry.sha256) return response(503, 'Release object mismatch');
      return new Response(bytes, { status: notFound ? 404 : 200, headers });
    } catch {
      return response(503, 'Release unavailable');
    }
  }
};
