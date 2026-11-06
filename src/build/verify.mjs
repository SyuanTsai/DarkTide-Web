import { jsonBytes, sha256, hashNamedFiles, safeRelativePath } from '../static/common.mjs';
import { verifyHashedModuleGraph } from '../static/module-graph.mjs';
import { verifyW14HistoryPublicFiles } from '../../scripts/content/contract-w14-history.mjs';
import { sourceDataHeaders } from './headers.mjs';
import { renderStaticRewrites } from '../static/routing-policy.mjs';
export function verifySourceStaticFiles(files, version) {
  const fail=message=>{throw new Error(`Source static artifact: ${message}`);};
  const artifact=JSON.parse(files.get('artifact-manifest.json'));
  if(version.schema_version!==3 || !['fixture','published'].includes(version.package_kind) || artifact.build_id!==version.build_id || artifact.data_revision!==version.data_revision || artifact.package_kind!==version.package_kind)fail('version identity mismatch');
  if(!Array.isArray(version.game_releases)||!version.game_releases.length)fail('missing version pointers');
  const current=version.game_releases.find(p=>p.game_version===version.game_version);if(!current || current.data_revision!==version.data_revision)fail('current pointer mismatch');
  if(new Set(version.game_releases.map(p=>p.game_version)).size!==version.game_releases.length)fail('duplicate version pointer');
  const used=new Set(['index.html','version.json','artifact-manifest.json','_headers','_redirects','robots.txt',...(files.has('sitemap.xml')?['sitemap.xml']:[])]);
  const identity=new Map();
  for(const pointer of version.game_releases) {
    if(!/^[a-f0-9]{64}$/.test(pointer.data_revision) || pointer.manifest_path!==`/data/${pointer.data_revision}/manifest.json`)fail('unsafe pointer');
    const name=pointer.manifest_path.slice(1),bytes=files.get(name);if(!bytes||sha256(bytes)!==pointer.manifest_sha256)fail('manifest hash mismatch');
    used.add(name);identity.set(name,bytes);
    const manifest=JSON.parse(bytes);const {dataRevision,...material}=manifest;
    if(dataRevision!==pointer.data_revision || sha256(jsonBytes(material))!==dataRevision || manifest.schemaVersion!=='3.0.0' || manifest.gameVersion!==pointer.game_version)fail('manifest identity mismatch');
    if(manifest.source?.repository!=='SyuanTsai/DarkTide-Source-Data'||!/^[a-f0-9]{40}$/.test(manifest.source.commit))fail('invalid source identity');
    const paths=new Set();
    for(const row of manifest.files) {
      safeRelativePath(row.path);if(!row.path.startsWith('domains/')||paths.has(row.path))fail('invalid domain path');paths.add(row.path);
      const file=`data/${dataRevision}/${row.path}`,value=files.get(file);
      if(!value||value.length!==row.sizeBytes||value.length>16*1024*1024||sha256(value)!==row.sha256)fail('domain bytes mismatch');
      used.add(file);identity.set(file,value);
    }
    for(const row of manifest.files)if(!Array.isArray(row.dependencies)||row.dependencies.some(p=>!paths.has(p)))fail('missing domain dependency');
  }
  const sourceCurrent=JSON.parse(files.get('source-data/current.json'));
  if(sourceCurrent.gameVersion!==version.game_version || JSON.stringify(sourceCurrent.versions)!==JSON.stringify(version.game_releases.map(p=>p.game_version)))fail('source current versions mismatch');
  for(const name of ['source-data/current.json',...sourceCurrent.versions.flatMap(v=>['skills','weapons','blessings','terms'].map(c=>`source-data/${v}/${c}.json`))]){if(!files.has(name))fail('missing source copy');used.add(name);identity.set(name,files.get(name));}
  const assets=new Map([...files].filter(([name])=>name.startsWith('assets/')));
  const html=files.get('index.html').toString();verifyHashedModuleGraph(html,assets);
  const context=/<script>window\.__BUILD__=(.*?)<\/script>/s.exec(html);if(!context || JSON.stringify(JSON.parse(context[1]))!==JSON.stringify(version))fail('build context mismatch');
  for(const [name,bytes]of assets){used.add(name);identity.set(name,bytes);}
  const history=new Map([...files].filter(([name])=>name.startsWith('history/')));verifyW14HistoryPublicFiles({manifestBytes:history.get('history/1.13.1/manifest.json'),projectionBytes:history.get('history/1.13.1/player-index.json')});
  for(const [name,bytes]of history){used.add(name);identity.set(name,bytes);}
  if(files.get('_headers')?.toString()!==sourceDataHeaders())fail('header policy mismatch');
  if(files.get('_redirects')?.toString()!==renderStaticRewrites({redirects:[]},{includeAnnouncements:true,includeHistory:true})+'/terms/* / 200\n')fail('document rewrite policy mismatch');
  if(hashNamedFiles(identity)!==version.build_id)fail('build identity mismatch');
  if(files.size!==used.size||[...files.keys()].some(name=>!used.has(name)))fail('unexpected output file');
  const robots=files.get('robots.txt')?.toString()??'';const siteOrigin=/Sitemap: (https:\/\/[^/]+)\/sitemap.xml/.exec(robots)?.[1]??null;
  return {...version,site_origin:siteOrigin,file_count:files.size,source_commit:JSON.parse(files.get(current.manifest_path.slice(1))).source.commit,
    source_files:[...files].filter(([name])=>name.startsWith('data/')||name.startsWith('source-data/')).map(([name,bytes])=>({path:'/'+name,size_bytes:bytes.length,sha256:sha256(bytes)})),
    history_files:[...history].map(([name,bytes])=>({path:'/'+name,size_bytes:bytes.length,sha256:sha256(bytes)}))};
}
