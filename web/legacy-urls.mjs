const routes = { skills: 'skill', weapons: 'weapon', blessings: 'blessing', terms: 'term' };

export function resolveLegacyUrl(input, map) {
  const url = new URL(input);
  const domain = url.pathname.split('/')[1];
  if (!Object.hasOwn(routes, domain)) return { status: 'unchanged', url };
  const pathname = url.pathname.endsWith('/') ? url.pathname : url.pathname + '/';
  const oldId = url.searchParams.get('id');
  const detailPath = pathname !== `/${domain}/`;
  const lookup = (table, key) => Object.hasOwn(table, key) ? table[key] : null;
  const target = detailPath ? lookup(map.paths, pathname) : lookup(map.ids, oldId);
  const family = detailPath ? lookup(map.familyPaths, pathname) : null;
  if (detailPath && !target && !family) return { status: 'not-found', url };
  if (!target && !family) return { status: 'unchanged', url };
  if (!detailPath && target === oldId) return { status: 'unchanged', url };
  if (target && !target.startsWith(`darktide:${routes[domain]}:`)) return { status: 'not-found', url };
  if (domain === 'blessings' && url.searchParams.has('variant')) {
    const variant = url.searchParams.get('variant');
    const expected = oldId?.replace(/^darktide:blessing:/, 'darktide:blessing-variant:');
    if (variant !== expected && variant !== target?.slice('darktide:blessing:'.length)) return { status: 'not-found', url };
    // Source-Data represents this legacy variant as the blessing itself.
    url.searchParams.delete('variant');
  }
  url.pathname = `/${domain}/`;
  if (target) url.searchParams.set('id', target);
  else { url.searchParams.delete('id'); url.searchParams.set('family', family); }
  url.searchParams.set('version', map.targetVersion);
  return { status: 'migrated', url };
}

export function applyLegacyUrl(input, map, history) {
  const result = resolveLegacyUrl(input, map);
  if (result.status === 'migrated') history.replaceState(null, '', result.url.pathname + result.url.search + result.url.hash);
  return result;
}
