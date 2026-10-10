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
    if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(releaseId ?? '') || !env?.CONTENT_BUCKET?.get) {
      return response(503, 'Release unavailable');
    }
    const name = fileName(new URL(request.url).pathname);
    if (!name) return response(404, 'Not found');
    const prefix = `releases/${releaseId}/`;
    try {
      const manifestObject = await env.CONTENT_BUCKET.get(`${prefix}build-manifest.json`);
      if (!manifestObject) return response(503, 'Release unavailable');
      const manifest = JSON.parse(await manifestObject.text());
      validateReleaseManifest(manifest, releaseId);
      const entry = Object.hasOwn(manifest.files, name) ? manifest.files[name] : null;
      if (!entry) return response(404, 'Not found');
      if (!/^[a-f0-9]{64}$/.test(entry.sha256) || !Number.isSafeInteger(entry.bytes) || entry.bytes < 0) {
        return response(503, 'Release unavailable');
      }
      const etag = `"${entry.sha256}"`;
      const headers = new Headers({
        'content-type': name.endsWith('.html') ? 'text/html; charset=utf-8' : name.endsWith('.css') ? 'text/css; charset=utf-8' : name.endsWith('.js') ? 'text/javascript; charset=utf-8' : name.endsWith('.svg') ? 'image/svg+xml' : name.endsWith('.png') ? 'image/png' : 'image/webp',
        'cache-control': 'public, max-age=60',
        etag
      });
      if (request.headers.get('if-none-match') === etag) return new Response(null, { status: 304, headers });
      if (request.method === 'HEAD') return new Response(null, { status: 200, headers });
      const object = await env.CONTENT_BUCKET.get(`${prefix}${name}`);
      if (!object) return response(503, 'Release incomplete');
      return new Response(object.body, { status: 200, headers });
    } catch {
      return response(503, 'Release unavailable');
    }
  }
};
