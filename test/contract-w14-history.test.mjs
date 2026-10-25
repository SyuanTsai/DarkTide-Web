import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  createW14HistoryManifest,
  createW14HistoryPlayerProjection,
  loadW14HistoryStaticFiles,
  projectW14HistoryPlayerRows,
  verifyW14HistoryPublicFiles,
  verifyW14HistoryPackage,
} from '../scripts/content/contract-w14-history.mjs';

const REPO_ROOT = fileURLToPath(new URL('../', import.meta.url));
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');

function fixtureSource(overrides = {}) {
  return Buffer.from(JSON.stringify({
    schema_version: 2,
    package_kind: 'published',
    game_version: '1.13.1',
    skills: [{ skill_id: 'skill:one', name_zh_tw: '技能範例', category: '技能', effect_zh_tw: '命中後回復耐力。', archetype: 'psyker', claims: [{ value: 'private technical detail' }] }],
    weapons: [{ weapon_id: 'weapon:one', name_zh_tw: '武器範例', category: 'ranged', model_zh_tw: null, mark_ids: ['mark:one'], claims: [{ value: 'technical stat' }] }],
    blessings: [{ blessing_id: 'blessing:one', name_zh_tw: '祝福範例', category: 'melee', effect_zh_tw: '格擋後提高傷害。', trigger_zh_tw: null, variant_ids: ['variant:one'] }],
    marks: [{ mark_id: 'mark:one', weapon_id: 'weapon:one', name_zh_tw: '武器型號範例', category: null, claims: [{ value: 'technical stat' }] }],
    variants: [{ variant_id: 'variant:one', blessing_id: 'blessing:one', weapon_id: null, effect_zh_tw: '效果範例。', defined_tiers: [1, 2, 3, 4], available_tiers: null, tier_claims: [{ value: 'technical stat' }] }],
    assets: [{ asset_id: 'asset:one', sha256: 'f'.repeat(64) }],
    bindings: [{ variant_id: 'variant:one', mark_id: 'mark:one' }],
    sources: [{ source_id: 'source:one', url: 'https://example.test/source' }],
    routes: [{ target_route: '/skills/skill:one/' }],
    talent_trees: [{ nodes: [{ x: 1, y: 2 }] }],
    ...overrides,
  }), 'utf8');
}

// Scenario: one fixed historical published package contains player summaries and technical graphs/claims.
// Purpose: emit only the explicit Traditional Chinese player field allowlist while preserving stable IDs and exact localized relations.
// Given a valid 1.13.1 package with joined marks and variants, When projecting it, Then technical fields and English identifiers are absent from displayed rows.
test('UnitT10_projection-keeps-only-allowlisted-player-fields-and-exact-localized-relations', () => {
  const result = projectW14HistoryPlayerRows(JSON.parse(fixtureSource().toString('utf8')));

  assert.deepEqual(result.projection.counts, { skills: 1, weapons: 1, blessings: 1, marks: 1, variants: 1 });
  const skill = result.projection.entries.find(row => row.kind === 'skill');
  const weapon = result.projection.entries.find(row => row.kind === 'weapon');
  const blessing = result.projection.entries.find(row => row.kind === 'blessing');
  const mark = result.projection.entries.find(row => row.kind === 'mark');
  const variant = result.projection.entries.find(row => row.kind === 'variant');
  assert.deepEqual(skill, { kind: 'skill', id: 'psyker/skill:one', name: '技能範例', category: '技能', summary: '命中後回復耐力。' });
  assert.deepEqual(weapon, { kind: 'weapon', id: 'weapon:one', name: '武器範例', category: '遠程', relatedNames: ['武器型號範例'] });
  assert.deepEqual(blessing, { kind: 'blessing', id: 'blessing:one', name: '祝福範例', category: '近戰', summary: '格擋後提高傷害。', trigger: null, relatedCount: 1 });
  assert.deepEqual(mark, { kind: 'mark', id: 'mark:one', name: '武器型號範例', parentName: '武器範例' });
  assert.deepEqual(variant, { kind: 'variant', id: 'variant:one', name: '祝福範例（祝福變體）', category: '近戰', summary: '效果範例。', definedTiers: [1, 2, 3, 4] });
  const visibleFields = result.projection.entries.flatMap(row => [row.name, row.category, row.summary, row.trigger, row.parentName, ...(row.relatedNames ?? [])].filter(Boolean)).join('\n');
  for (const forbidden of ['private technical detail', 'technical stat', 'psyker', 'asset:one']) {
    assert.equal(visibleFields.includes(forbidden), false, `player-facing fields must not include ${forbidden}`);
  }
  assert.ok(result.projection.entries.some(row => row.id === 'variant:one'), 'stable IDs remain available for internal lookup');
  assert.equal(result.report.excluded.variants, 0);
});

// Scenario: historical entries have no Traditional Chinese name or no unique localized parent.
// Purpose: keep true gaps visible in the projection report instead of falling back to raw English identifiers.
// Given an unnamed variant and malformed duplicate identity, When projected, Then the unnamed entry is omitted and duplicate IDs fail closed.
test('UnitT20_projection-omits-unnameable-player-rows-and-rejects-duplicate-identities', () => {
  const noName = fixtureSource({
    variants: [{ variant_id: 'variant:orphan', blessing_id: null, weapon_id: null, effect_zh_tw: '效果。', defined_tiers: null }],
  });
  const result = projectW14HistoryPlayerRows(JSON.parse(noName.toString('utf8')));
  assert.equal(result.projection.entries.some(row => row.id === 'variant:orphan'), false);
  assert.equal(result.report.excluded.variants, 1);
  assert.equal(result.report.excludedReasons.variants.missingLocalizedParent, 1);
  const duplicate = fixtureSource({ blessings: [
    { blessing_id: 'blessing:one', name_zh_tw: '甲', category: 'melee', effect_zh_tw: '甲。', trigger_zh_tw: null, variant_ids: [] },
    { blessing_id: 'blessing:one', name_zh_tw: '乙', category: 'melee', effect_zh_tw: '乙。', trigger_zh_tw: null, variant_ids: [] },
  ] });
  assert.throws(() => projectW14HistoryPlayerRows(JSON.parse(duplicate.toString('utf8'))), /duplicate.*blessing|duplicate blessing identity/u);
});

// Scenario: a fixed historic source package is edited to name another game version or gains non-allowlisted public output.
// Purpose: bind the page to the exact 1.13.1 source bytes and projection digest without adding it to current dataRevision.
// Given pinned history source, projection, and manifest, When validating the package, Then exact source/projection hashes pass and any changed input is rejected.
test('UnitT30_history-manifest-binds-pinned-source-and-actual-projection-bytes', async () => {
  const directory = path.join(REPO_ROOT, 'content', 'history', '1.13.1');
  const sourceBytes = await readFile(path.join(directory, 'source-content.json'));
  const projectionBytes = await readFile(path.join(directory, 'player-index.json'));
  const manifestBytes = await readFile(path.join(directory, 'manifest.json'));
  const manifest = JSON.parse(manifestBytes.toString('utf8'));

  assert.deepEqual(verifyW14HistoryPackage({ sourceBytes, projectionBytes, manifestBytes }).manifest, manifest);
  assert.equal(manifest.source.sha256, '3f3c24874004d67aa7e03b045ca5f9a7409a0bea3e9136247852c26ec2c34bcc');
  assert.equal(manifest.projection.sha256, sha256(projectionBytes));
  assert.equal(manifest.projection.byteLength, projectionBytes.length);
  assert.deepEqual(verifyW14HistoryPublicFiles({ manifestBytes, projectionBytes }).projection, JSON.parse(projectionBytes.toString('utf8')));
  const changedProjection = Buffer.from(projectionBytes);
  changedProjection[changedProjection.length - 2] ^= 1;
  assert.throws(() => verifyW14HistoryPublicFiles({ manifestBytes, projectionBytes: changedProjection }), /fixed 1\.13\.1 bytes/u);
  assert.deepEqual(Object.keys(JSON.parse(projectionBytes.toString('utf8'))).sort(), ['counts', 'entries', 'gameVersion', 'schemaVersion']);
  assert.throws(() => verifyW14HistoryPackage({
    sourceBytes: Buffer.concat([sourceBytes, Buffer.from(' ', 'utf8')]), projectionBytes, manifestBytes,
  }), /pinned published bytes/u);

  const source = JSON.parse(sourceBytes.toString('utf8'));
  const projection = createW14HistoryPlayerProjection(sourceBytes);
  assert.equal(manifest.source.gameVersion, source.game_version);
  assert.deepEqual(projection.projection, JSON.parse(projectionBytes.toString('utf8')));
  assert.deepEqual(manifest, createW14HistoryManifest(sourceBytes, projectionBytes, projection.report));
});

// Scenario: The fixed history input directory has the verified source plus the two generated player files.
// Purpose: Ensure static build integration receives only the manifest and player projection, and rejects extra or linked inputs.
test('UnitT40_static-history-loader-returns-only-verified-player-files-and-rejects-extras', async () => {
  const sourceDirectory = path.join(REPO_ROOT, 'content', 'history', '1.13.1');
  const files = await loadW14HistoryStaticFiles(REPO_ROOT);
  assert.deepEqual([...files.keys()].sort(), ['history/1.13.1/manifest.json', 'history/1.13.1/player-index.json']);
  assert.equal(files.get('history/1.13.1/manifest.json').length, (await readFile(path.join(sourceDirectory, 'manifest.json'))).length);

  const tempRoot = await mkdtemp(path.join(tmpdir(), 'w14-history-loader-'));
  try {
    const fixtureDirectory = path.join(tempRoot, 'content', 'history', '1.13.1');
    await mkdir(fixtureDirectory, { recursive: true });
    for (const name of ['source-content.json', 'player-index.json', 'manifest.json']) {
      await copyFile(path.join(sourceDirectory, name), path.join(fixtureDirectory, name));
    }
    await writeFile(path.join(fixtureDirectory, 'unexpected.json'), '{}\n', 'utf8');
    await assert.rejects(loadW14HistoryStaticFiles(tempRoot), /unapproved file/u);
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});
