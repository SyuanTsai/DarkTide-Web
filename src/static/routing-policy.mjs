import {compareUtf8} from './common.mjs';
export function renderStaticRewrites(catalog) {
 const rules=new Map(['/skills/*','/weapons/*','/blessings/*','/game-changes/*'].map(p=>[p,'/']));
 for(const row of catalog.redirects??[]){
  const p=row.source_route;
  if(typeof p!=='string'||!p.startsWith('/')||/[\s*?#]/.test(p)||p.startsWith('/data/')||p.startsWith('/assets/'))throw new Error('unsafe document alias for Cloudflare rewrite');
 if(!['/skills/','/weapons/','/blessings/','/game-changes/'].some(prefix=>p.startsWith(prefix)))rules.set(p,'/');
 }
 if(rules.size>2000)throw new Error('Cloudflare rewrite limit exceeded');
 return [...rules].sort(([a],[b])=>compareUtf8(a,b)).map(([p,target])=>p+' '+target+' 200').join('\n')+'\n';
}
