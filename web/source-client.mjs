// Direct Source-Data consumer. Retained W02 clients remain available separately.
const hash = async bytes => [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(x=>x.toString(16).padStart(2,'0')).join('');
const jsonBytes = value => new TextEncoder().encode(JSON.stringify(value, null, 2) + '\n');
export const isSourceDomainPath = path => typeof path === 'string' && /^domains\/[A-Za-z0-9_./-]+\.json$/.test(path) && !path.split('/').some(segment => !segment || segment === '.' || segment === '..');
export function createSourceClient({ build, fetchImpl = globalThis.fetch.bind(globalThis) }) {
  const cache = new Map();
  const read = async (path, expected, limit) => {
    if (!path.startsWith('/data/') || path.split('/').includes('..') || path.includes('\\')) throw new Error('Invalid source data path');
    const response = await fetchImpl(path, { redirect: 'error', signal: AbortSignal.timeout(30000) });
    if (!response.ok || !/^application\/json(?:;|$)/i.test(response.headers.get('content-type') ?? '')) throw new Error(`Source data unavailable: ${path}`);
    const reader = response.body.getReader(); const chunks = []; let size = 0;
    try { while (true) { const {value,done} = await reader.read(); if (done) break; size += value.length; if (size > limit) throw new Error('Source data exceeds byte limit'); chunks.push(value); } }
    catch (error) { await reader.cancel(); throw error; } finally { reader.releaseLock(); }
    const bytes = new Uint8Array(size); let offset=0; for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
    if (await hash(bytes) !== expected) throw new Error('Source data hash mismatch');
    return { bytes, value: JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) };
  };
  return { async load({ pathname = '/', search = '', force = false } = {}) {
    const requested = new URLSearchParams(search).get('version') ?? build.game_version;
    const pointer = build.game_releases.find(p=>p.game_version === requested);
    if (!pointer) throw new Error('Unknown source data version');
    if (force) cache.delete(requested);
    if (!cache.has(requested)) cache.set(requested, (async () => {
      const { value: manifest } = await read(pointer.manifest_path, pointer.manifest_sha256, 256 * 1024);
      const { dataRevision, ...material } = manifest;
      if (manifest.schemaVersion !== '3.0.0' || dataRevision !== pointer.data_revision || manifest.gameVersion !== requested || await hash(jsonBytes(material)) !== dataRevision) throw new Error('Invalid source manifest');
      const paths = new Set();
      for (const file of manifest.files) {
        if (!isSourceDomainPath(file.path) || paths.has(file.path) || !Number.isSafeInteger(file.sizeBytes) || file.sizeBytes < 1 || file.sizeBytes > 16 * 1024 * 1024) throw new Error('Invalid source domain descriptor');
        paths.add(file.path);
      }
      return { manifest, loaded: new Map() };
    })().catch(error=>{cache.delete(requested);throw error;}));
    const { manifest, loaded } = await cache.get(requested);
    const selected = new Map();
    const load = async file => {
      if (!file) return null;
      if (selected.has(file.path)) return selected.get(file.path).document;
      if (!loaded.has(file.path)) loaded.set(file.path, (async()=>{
        const result = await read(`/data/${manifest.dataRevision}/${file.path}`,file.sha256,file.sizeBytes);
        if(result.bytes.length!==file.sizeBytes)throw new Error('Source domain size mismatch');
        return result.value;
      })().catch(error=>{loaded.delete(file.path);throw error;}));
      const document=await loaded.get(file.path);selected.set(file.path,{kind:file.kind,document});
      for(const dependency of file.dependencies ?? []) {
        const row=manifest.files.find(f=>f.path===dependency);if(!row)throw new Error('Missing source dependency');await load(row);
      }
      return document;
    };
    const kind = pathname.split('/')[1];
    const kinds = {skills:['skills','terms','term-rules'],terms:['terms','term-rules'],weapons:['weapons-index','blessings-index'],blessings:['blessings-index'],'game-changes':['game-changes'],announcements:['announcements']}[kind] ?? [];
    for(const name of kinds)await load(manifest.files.find(f=>f.kind===name));
    const query=new URLSearchParams(search);
    if(kind==='weapons'||kind==='blessings') {
      const index=selected.get(`domains/${kind}-index.json`)?.document;
      const items=(index?.items ?? []).filter(item=>kind==='weapons' ? query.has('family')&&item.family===query.get('family') : query.has('id')&&item.id===query.get('id'));
      for(const item of items) { const row=manifest.files.find(f=>f.path===item.path);if(!row||row.kind!==(kind==='weapons'?'weapon-family':'blessing'))throw new Error('Invalid index shard');await load(row); }
    }
    return { status:'ready',sourceData:true,pointer,manifest,domains:[...selected.values()],versions:build.game_releases,fixtureOnly:build.package_kind==='fixture' };
  } };
}
