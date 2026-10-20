import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

const repoRoot = path.resolve(import.meta.dirname, '..');
const fixtureRoot = path.join(repoRoot, 'test', 'fixtures', 'w01');

// Scenario: R2 changes only the Web-owned synthetic presentation and release version.
// Purpose: the generated package advances to 0.0.2 while Source claim and official source text stay fixed.
test('UnitT40_r2-version-and-web-owned-name-preserve-source-claim-and-official-text', async () => {
  const release = JSON.parse(await readFile(path.join(fixtureRoot, 'content', 'w01', 'release.json'), 'utf8'));
  const web = JSON.parse(await readFile(path.join(fixtureRoot, 'content', 'w01', 'web-authoring.json'), 'utf8'));
  const technical = JSON.parse(await readFile(path.join(fixtureRoot, 'content', 'w01', 'source', 'technical.json'), 'utf8'));
  const skillPresentation = web.records.find(record => record.recordId === 'web:presentation:fixture-skill-smite');
  const claim = technical.records.find(record => record.recordId === 'fixture:claim:smite-damage');

  assert.equal(release.contentVersion, '0.0.2');
  assert.equal(skillPresentation.payload.name, '合成技能示例（修訂2）');
  assert.equal(skillPresentation.payload.official.sourceText, 'Cooldown: 40 seconds.');
  assert.equal(skillPresentation.payload.official.sourceTextSha256, 'a474c376d1febdc86664256edba7e7136740f9b03f1bbda55fec2bb7d6bfe8fa');
  assert.equal(claim.payload.value.decimal, '35');
  assert.equal(claim.payload.value.unit, 's');
});
