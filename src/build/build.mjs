import { readFile, readdir, mkdir, mkdtemp, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { loadSourceData } from './source-data.mjs';
import { buildSiteData, validateTermRules } from './site-data.mjs';
import { loadAnnouncements } from './announcements.mjs';
import { sourceDataHeaders } from './headers.mjs';
import { jsonBytes, sha256, hashNamedFiles, safeRelativePath } from '../static/common.mjs';
import { buildHashedAssets } from '../static/module-graph.mjs';
import { replaceDirectory } from '../static/build.mjs';
import { loadW14HistoryStaticFiles } from '../../scripts/content/contract-w14-history.mjs';
import { verifyStaticPackage } from '../static/verify.mjs';
import { renderStaticRewrites } from '../static/routing-policy.mjs';

export async function buildSourceSite({ root, sourceData, sourceDataCommit, siteOrigin, fixture = false, maxOutputFileBytes }) {
  root = path.resolve(root);
  if (siteOrigin) { const u=new URL(siteOrigin);if(u.protocol!=='https:' || u.origin!==siteOrigin || u.username || u.password)throw new Error('site origin must be an HTTPS origin'); }
  // Validate all inputs before creating a staging directory or replacing dist.
  const source = await loadSourceData({ directory: sourceData, commit: sourceDataCommit, fixture });
  const frozen = {};
  for(const version of source.current.versions) {
    const bytes = await readFile(path.join(root,'content/history',version,'game-changes.json')).catch(error=>error.code==='ENOENT'?null:Promise.reject(error));
    if(bytes)frozen[version]=JSON.parse(bytes);
  }
  const termRules = validateTermRules(JSON.parse(await readFile(path.join(root, 'content/reference/term-rules/v1.json'))));
  const bundle=buildSiteData({source,announcements:await loadAnnouncements(root),frozen,termRules});
  const files=new Map(bundle.files);
  for(const [name,bytes] of await loadW14HistoryStaticFiles(root))files.set(name,bytes);
  const web=new Map();
  for(const entry of await readdir(path.join(root,'web'),{withFileTypes:true})) {
    if(entry.isSymbolicLink())throw new Error('web source cannot be symbolic link');
    if(entry.isFile() && /\.(mjs|css|html)$/.test(entry.name))web.set(entry.name,await readFile(path.join(root,'web',entry.name)));
  }
  const assets=await buildHashedAssets(web);for(const [name,bytes] of assets.assets)files.set(name,bytes);
  const packageKind=fixture?'fixture':'published';
  const buildId=hashNamedFiles(files);
  const version={schema_version:3,source_data:true,package_kind:packageKind,game_version:source.current.gameVersion,data_revision:bundle.current.data_revision,build_id:buildId,game_releases:bundle.pointers};
  const scriptJson=JSON.stringify(version).replaceAll('<','\\u003c').replaceAll('>','\\u003e').replaceAll('&','\\u0026');
  const html=assets.index.replace('__BUILD_CONTEXT__',scriptJson).replace('./app.mjs',assets.moduleEntry).replace('./style.css',assets.styleEntry)
    .replace('__GAMES_LANTERN_CREDIT__','<p class="asset-credit">本網站部分圖片素材經 <a href="https://darktide.gameslantern.com/">Games Lantern</a> 許可使用。</p>');
  files.set('index.html',Buffer.from(html));files.set('version.json',jsonBytes(version));files.set('_headers',Buffer.from(sourceDataHeaders()));
  const routes=['/','/skills/','/weapons/','/blessings/','/terms/','/game-changes/','/announcements/','/history/1.13.1/'];
  files.set('_redirects',Buffer.from(renderStaticRewrites({redirects:[]},{includeAnnouncements:true,includeHistory:true})+'/terms/* / 200\n'));
  files.set('robots.txt',Buffer.from('User-agent: *\nAllow: /\n'+(siteOrigin?`Sitemap: ${siteOrigin}/sitemap.xml\n`:'')));
  if(siteOrigin)files.set('sitemap.xml',Buffer.from('<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">'+routes.map(route=>`<url><loc>${siteOrigin}${route}</loc></url>`).join('')+'</urlset>\n'));
  const manifest={schema_version:1,package_kind:packageKind,build_id:buildId,data_revision:version.data_revision,files:[...files].sort(([a],[b])=>a<b?-1:a>b?1:0).map(([name,bytes])=>({path:name,size_bytes:bytes.length,sha256:sha256(bytes)}))};
  files.set('artifact-manifest.json',jsonBytes(manifest));
  const stage=await mkdtemp(path.join(root,'.static-build-staging-'));let installed=false;
  try {
    for(const [name,bytes] of files){safeRelativePath(name);const target=path.join(stage,name);await mkdir(path.dirname(target),{recursive:true});await writeFile(target,bytes);}
    await verifyStaticPackage(stage, { maxOutputFileBytes });await replaceDirectory(stage,path.join(root,'dist'));installed=true;
  } finally {if(!installed)await rm(stage,{recursive:true,force:true});}
  return {...version,file_count:files.size,outputDirectory:path.join(root,'dist')};
}
