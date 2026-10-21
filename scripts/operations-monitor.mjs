import { mkdir, writeFile } from 'node:fs/promises';
import { loadBackupManifest, monitorOrigin } from '../src/operations/monitor.mjs';
import { SITE_ORIGIN, PREVIEW_ORIGIN } from '../src/deploy/cloudflare.mjs';
const report = { checked_at: new Date().toISOString(), drill: process.env.MONITOR_DRILL === 'true', status: 'healthy', origins: [] };
const backups = new Map();
for (const origin of [SITE_ORIGIN, PREVIEW_ORIGIN, 'https://darktide-zh-tw.syuan-tsai.workers.dev']) {
  try {
    const response = await fetch(origin + '/version.json', { redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(15000) });
    if (response.status !== 200 || !response.headers.get('content-type')?.includes('application/json')) throw new Error('version HTTP/MIME failure: ' + response.status);
    const version = await response.json();
    if (!backups.has(version.build_id)) backups.set(version.build_id, await loadBackupManifest(version));
    const backup = backups.get(version.build_id);
    const result = await monitorOrigin(origin, backup.manifest);
    report.origins.push({ ...result, backup_url: backup.backup_url, commit: backup.commit });
  } catch (error) {
    report.status = 'failed';
    report.origins.push({ origin, status: 'failed', error: error.message.slice(0, 500) });
  }
}
if (report.drill) { report.status = 'failed'; report.exercise = 'Controlled alert exercise; no production mutation or actual outage is implied.'; }
await mkdir('.operations', { recursive: true });
await writeFile('.operations/monitor-report.json', JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report, null, 2));
if (report.status !== 'healthy') process.exitCode = 1;
