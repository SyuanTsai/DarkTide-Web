import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { loadSourceData } from '../src/build/source-data.mjs';
import { buildSiteData, validateTermRules } from '../src/build/site-data.mjs';
import { loadAnnouncements } from '../src/build/announcements.mjs';

// Scenario: A first game release has frozen changes and the captured community reference.
// Purpose: Verify offline coverage against the online baseline and preserve every frozen record.
test('InterT10_離線基準保留公告變更與譯名規則', async () => {
  const root = fileURLToPath(new URL('../', import.meta.url));
  const json = async p => JSON.parse(await readFile(new URL(p, import.meta.url)));
  const baseline = await json('./fixtures/wp8b/online-coverage.json');
  const sidecar = await json('../content/reference/term-rules/v1.json');
  const frozen = await json('../content/history/1.13.4/game-changes.json');
  const source = await loadSourceData({ directory: fileURLToPath(new URL('./fixtures/source-data/', import.meta.url)), fixture: true });
  source.dataByVersion['1.13.4'] = source.dataByVersion['9.9.1']; source.current.versions = ['1.13.4']; source.current.gameVersion = '1.13.4';
  for (const category of ['skills', 'weapons', 'blessings', 'terms']) source.rawFiles.set(`1.13.4/${category}.json`, source.rawFiles.get(`9.9.1/${category}.json`));
  const bundle = buildSiteData({ source, announcements: await loadAnnouncements(root), frozen: { '1.13.4': frozen }, termRules: sidecar });
  const readDomain = name => JSON.parse(bundle.files.get(`data/${bundle.current.data_revision}/domains/${name}.json`));
  const ids = new Set(readDomain('announcements').items.map(x => x.announcementId));
  assert.equal(baseline.announcements.length, 8); for (const row of baseline.announcements) assert.ok(ids.has(row.id));
  assert.deepEqual(readDomain('game-changes').web.gameChanges, frozen.web.gameChanges); assert.equal(frozen.web.gameChanges.length, 18);
  const rules = readDomain('term-rules').rules.rules; assert.deepEqual(rules, sidecar.rules.rules);
  assert.deepEqual(new Set(rules.map(r => r.ruleId)), new Set(['peril-general','staggering','stagger','rev-it-up','peril-psyker','brain-burst','brain-rupture']));
  const hash = x => createHash('sha256').update(JSON.stringify(x)).digest('hex');
  assert.deepEqual(frozen.web.gameChanges.map(item => ({ id: item.changeId, sha256: hash(item) })), baseline.gameChanges);
  assert.deepEqual(rules.map(r => ({ id: r.ruleId, sha256: hash(r) })), baseline.termRules);
});

// Scenario: A sidecar has duplicate or missing rule fields.
// Purpose: Reject corrupted reference data before building output.
test('UnitT20_損壞的譯名規則sidecar遭拒', async () => {
  const sidecar = JSON.parse(await readFile(new URL('../content/reference/term-rules/v1.json', import.meta.url)));
  const duplicate = structuredClone(sidecar); duplicate.rules.rules[1].ruleId = duplicate.rules.rules[0].ruleId;
  assert.throws(() => validateTermRules(duplicate), /Invalid term-rules/);
  delete sidecar.rules.rules[0].targetText; assert.throws(() => validateTermRules(sidecar), /Invalid term-rules/);
});
