import { renderCacheHeaders } from '../static/header-policy.mjs';
export function sourceDataHeaders() {
  return renderCacheHeaders({ redirects: [] }, { hasSitemap: true, includeAnnouncements: true, includeHistory: true })
    + '/terms/*\n  Cache-Control: no-cache, must-revalidate\n'
    + '/source-data/*\n  Content-Type: application/json; charset=utf-8\n  Access-Control-Allow-Origin: *\n  Access-Control-Allow-Methods: GET, HEAD\n  Cache-Control: public, max-age=31536000, immutable\n'
    + '/source-data/*.bin\n  ! Content-Type\n  Content-Type: application/octet-stream\n'
    + '/source-data/current.json\n  ! Cache-Control\n  Cache-Control: no-cache, must-revalidate\n';
}
