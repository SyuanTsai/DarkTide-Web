import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile } from 'node:fs/promises';
import { INCIDENT_TITLE, incidentAction } from '../src/operations/monitor.mjs';
import { REPOSITORY } from '../src/operations/backup.mjs';
const exec = promisify(execFile);
if (process.env.GITHUB_REPOSITORY !== REPOSITORY || process.env.GITHUB_REF !== 'refs/heads/main') throw new Error('Incident writes require repository main');
const report = await readFile('.operations/monitor-report.json', 'utf8').then(JSON.parse, () => ({ status: 'failed', error: 'Monitor did not produce a report.' }));
const api = async (route, method = 'GET', body) => {
  const args = ['api', route, '--method', method];
  if (body) args.push('--input', '-');
  const child = execFile('gh', args, { maxBuffer: 4 * 1024 * 1024 });
  const result = new Promise((resolve, reject) => { let stdout = ''; child.stdout.on('data', part => stdout += part); child.stderr.on('data', () => {}); child.on('error', reject); child.on('close', code => code === 0 ? resolve(stdout ? JSON.parse(stdout) : null) : reject(new Error('GitHub incident API failed: ' + code))); });
  child.stdin.end(body ? JSON.stringify(body) : undefined);
  return result;
};
const issues = JSON.parse((await exec('gh', ['api', '--paginate', '--slurp', 'repos/' + REPOSITORY + '/issues?state=open&per_page=100'])).stdout);
const flatIssues = issues.flat();
const action = incidentAction(report.status === 'healthy', flatIssues);
const run = 'https://github.com/' + REPOSITORY + '/actions/runs/' + process.env.GITHUB_RUN_ID;
const body = (report.drill ? '**Controlled exercise: no real outage is claimed.**\n\n' : '') + 'Run: ' + run + '\n\n' + 'See the monitor report artifact and job summary for HTTPS, version, JSON integrity, asset and 404 checks.\n\n' + JSON.stringify({ error: report.error, failed_origins: report.origins?.filter(row => row.status !== 'healthy').map(row => ({ origin: row.origin, error: row.error })) }, null, 2);
if (action.action === 'open') await api('repos/' + REPOSITORY + '/issues', 'POST', { title: INCIDENT_TITLE, body });
if (action.action === 'close') {
  await api('repos/' + REPOSITORY + '/issues/' + action.number + '/comments', 'POST', { body: 'All monitored origins recovered. Verified run: ' + run });
  await api('repos/' + REPOSITORY + '/issues/' + action.number, 'PATCH', { state: 'closed', state_reason: 'completed' });
}
console.log(JSON.stringify(action));
