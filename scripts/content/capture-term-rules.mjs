import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';

const revision = '3688cf214c4498d88dd8b1be42c423cb363f9602e7031b9d7a556abacddb2ea7';
const base = `https://darktide.tw-syuan.com/data/${revision}/`;
const response = await fetch(`${base}manifest.json`);
if (!response.ok) throw new Error(`manifest HTTP ${response.status}`);
const manifest = await response.json();
const captured = {};
for (const kind of ['terms', 'announcements', 'game-changes']) {
  const row = manifest.files.find(row => row.kind === kind);
  const bytes = Buffer.from(await (await fetch(new URL(row.path, base))).arrayBuffer());
  if (createHash('sha256').update(bytes).digest('hex') !== row.sha256) throw new Error(`${kind} hash mismatch`);
  captured[kind] = { row, doc: JSON.parse(bytes) };
}
const terms = captured.terms.doc.web.termRules;
const provenance = { revision, path: captured.terms.row.path, sha256: captured.terms.row.sha256, capturedAt: new Date().toISOString().slice(0, 10), source: 'Mods Referneces/Translation.md', references: terms.rules.map(({ ruleId, sourceLine, sourceRef }) => ({ ruleId, sourceLine, sourceRef })) };
await mkdir('content/reference/term-rules', { recursive: true });
await writeFile('content/reference/term-rules/v1.json', JSON.stringify({ schemaVersion: '1.0.0', rules: terms, provenance }, null, 2) + '\n');
const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const baseline = { revision, domains: Object.fromEntries(Object.entries(captured).map(([kind, {row}]) => [kind, { path: row.path, sha256: row.sha256 }])), announcements: captured.announcements.doc.web.announcements.map(item => ({ id: item.announcementId, sha256: digest(item) })), gameChanges: captured['game-changes'].doc.web.gameChanges.map(item => ({ id: item.changeId, sha256: digest(item) })), termRules: terms.rules.map(item => ({ id: item.ruleId, sha256: digest(item) })) };
await mkdir('test/fixtures/wp8b', { recursive: true });
await writeFile('test/fixtures/wp8b/online-coverage.json', JSON.stringify(baseline, null, 2) + '\n');
console.log(`Captured ${baseline.announcements.length} announcements, ${baseline.gameChanges.length} changes, ${baseline.termRules.length} rules`);
