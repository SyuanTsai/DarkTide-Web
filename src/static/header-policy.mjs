import { compareUtf8 } from './common.mjs';

export const CLOUDFLARE_HEADER_RULE_LIMIT = 100;
export const CLOUDFLARE_HEADER_LINE_LIMIT = 2000;

const DOCUMENT_PREFIXES = ['/skills/*', '/weapons/*', '/blessings/*', '/game-changes/*'];
const IMMUTABLE_PREFIXES = ['/assets/*', '/data/*'];
const DOCUMENT_POLICY = 'no-cache, must-revalidate';
const IMMUTABLE_POLICY = 'public, max-age=31536000, immutable';
const RESERVED_DOCUMENT_PATHS = new Set(['/', '/index.html', '/version.json', '/robots.txt', '/sitemap.xml']);

function prefixBase(pattern) { return pattern.slice(0, -1).replace(/\/$/, ''); }

function isWithinPattern(path, pattern) {
  const base = prefixBase(pattern);
  return path === base || path.startsWith(base + '/');
}

function isHandledAsDocument(path) {
  return DOCUMENT_PREFIXES.some(pattern => isWithinPattern(path, pattern));
}

function isImmutablePath(path) {
  return IMMUTABLE_PREFIXES.some(pattern => isWithinPattern(path, pattern));
}

export function expectedCacheRules(catalog, { hasSitemap = false } = {}) {
  if (!catalog || !Array.isArray(catalog.redirects)) throw new Error('catalog redirects are required for the cache policy');
  const rules = new Map([
    ['/', DOCUMENT_POLICY],
    ['/index.html', DOCUMENT_POLICY],
    ['/version.json', DOCUMENT_POLICY],
    ['/robots.txt', DOCUMENT_POLICY],
    ...DOCUMENT_PREFIXES.map(pattern => [pattern, DOCUMENT_POLICY]),
    ...IMMUTABLE_PREFIXES.map(pattern => [pattern, IMMUTABLE_POLICY])
  ]);
  if (hasSitemap) rules.set('/sitemap.xml', DOCUMENT_POLICY);

  for (const redirect of catalog.redirects) {
    const route = redirect.source_route;
    if (typeof route !== 'string' || !route.startsWith('/')) throw new Error('catalog redirect source route is invalid for cache policy');
    if (isImmutablePath(route)) throw new Error('catalog redirect overlaps an immutable asset/data cache prefix');
    if (isHandledAsDocument(route)) continue;
    if (RESERVED_DOCUMENT_PATHS.has(route)) throw new Error('catalog redirect collides with a generated document path');
    rules.set(route, DOCUMENT_POLICY);
  }

  if (rules.size > CLOUDFLARE_HEADER_RULE_LIMIT) {
    throw new Error(`Cloudflare _headers exceeds the ${CLOUDFLARE_HEADER_RULE_LIMIT}-rule limit`);
  }
  return rules;
}

export function assertCloudflareHeaderLimits(text) {
  if (typeof text !== 'string') throw new Error('_headers must be text');
  const lines = text.split(/\r?\n/);
  const longLine = lines.findIndex(line => line.length > CLOUDFLARE_HEADER_LINE_LIMIT);
  if (longLine >= 0) throw new Error(`Cloudflare _headers line ${longLine + 1} exceeds ${CLOUDFLARE_HEADER_LINE_LIMIT} characters`);
  const ruleCount = lines.filter(line => line.startsWith('/')).length;
  if (ruleCount > CLOUDFLARE_HEADER_RULE_LIMIT) {
    throw new Error(`Cloudflare _headers exceeds the ${CLOUDFLARE_HEADER_RULE_LIMIT}-rule limit`);
  }
  return ruleCount;
}

export function renderCacheHeaders(catalog, options) {
  const rules = expectedCacheRules(catalog, options);
  const text = [...rules.entries()].sort(([left], [right]) => compareUtf8(left, right))
    .flatMap(([route, policy]) => [route, '  Cache-Control: ' + policy])
    .join('\n') + '\n';
  assertCloudflareHeaderLimits(text);
  return text;
}

export function validateCacheHeaders(bytes, catalog, options) {
  const text = Buffer.from(bytes ?? []).toString('utf8');
  assertCloudflareHeaderLimits(text);
  const lines = text.trimEnd().split(/\r?\n/);
  if (!lines[0] || lines.length % 2 !== 0) throw new Error('_headers contains an incomplete rule');

  const actual = new Map();
  for (let index = 0; index < lines.length; index += 2) {
    const rule = lines[index];
    const match = /^\s+Cache-Control:\s*(.+)$/i.exec(lines[index + 1]);
    if (!rule.startsWith('/') || !match || actual.has(rule)) throw new Error('_headers contains an invalid or duplicate cache rule');
    actual.set(rule, match[1]);
  }

  const expected = expectedCacheRules(catalog, options);
  if (actual.size !== expected.size || [...expected].some(([rule, policy]) => actual.get(rule) !== policy)) {
    throw new Error('_headers cache rules do not match the nonoverlapping static asset policy');
  }
  return actual;
}
