import { mkdir, writeFile } from 'node:fs/promises';
import { assertSamePublication, monitorOrigin } from '../src/operations/monitor.mjs';
import { SITE_ORIGIN, PREVIEW_ORIGIN } from '../src/deploy/cloudflare.mjs';
const report = { checked_at: new Date().toISOString(), drill: process.env.MONITOR_DRILL === 'true', status: 'healthy', origins: [] };
const backups = new Map();
for (const origin of [SITE_ORIGIN, PREVIEW_ORIGIN, 'https://darktide-zh-tw.syuan-tsai.workers.dev']) {
  try {
    report.origins.push(await monitorOrigin(origin));
  } catch (error) {
    report.status = 'failed';
    report.origins.push({ origin, status: 'failed', ...(error.publication ? { publication: error.publication } : {}), error: error.message.slice(0, 500) });
  }
}
if (report.status === 'healthy') {
  try { assertSamePublication(report.origins); }
  catch (error) { report.status = 'failed'; report.error = error.message; }
}
if (report.drill) { report.status = 'failed'; report.exercise = 'Controlled alert exercise; no production mutation or actual outage is implied.'; }
await mkdir('.operations', { recursive: true });
await writeFile('.operations/monitor-report.json', JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report, null, 2));
if (report.status !== 'healthy') process.exitCode = 1;
