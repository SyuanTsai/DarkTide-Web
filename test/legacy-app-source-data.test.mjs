import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { cp, mkdtemp, rm, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildSourceSite } from '../src/build/build.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
let fixtureRoot;
before(async () => {
  fixtureRoot = await mkdtemp(join(root, '.static-build-staging-legacy-app-'));
  for (const name of ['web', 'content/history', 'content/authoring/v2', 'content/reference']) {
    await cp(join(root, name), join(fixtureRoot, name), { recursive: true });
  }
  await buildSourceSite({ root: fixtureRoot, sourceData: join(root, 'test/fixtures/source-data'), fixture: true });
});
after(async () => { if (fixtureRoot) await rm(fixtureRoot, { recursive: true, force: true }); });

const startup = path => JSON.parse(execFileSync(process.execPath,
  ['--experimental-test-module-mocks', fileURLToPath(new URL('../test-support/legacy-app-harness.mjs', import.meta.url)),
    JSON.stringify({ path, dist: join(fixtureRoot, 'dist') })],
  { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }));

for (const [scenario, path, id, version, name] of [
  ['10', '/skills/?id=darktide:skill:fixture_a', 'darktide:skill:fixture_a', '9.9.2', '技能a'],
  ['20', '/skills/?id=darktide:skill:fixture_c&version=9.9.1', 'darktide:skill:fixture_c', '9.9.1', '技能c'],
  ['30', '/blessings/?id=darktide:blessing:fixture_a', 'darktide:blessing:fixture_a', '9.9.2', '祝福a'],
  ['40', '/blessings/?id=darktide:blessing:fixture_a&version=9.9.1', 'darktide:blessing:fixture_a', '9.9.1', '祝福a']
]) {
  // Scenario: A supported new URL starts the actual app using a complete existing Source-Data fixture build.
  // Purpose: Protect CI fixture details, historical selection, unchanged URLs and unique item rendering.
  test(`InterT${scenario}_fixture建置實際app載入唯一項目_${path}`, () => {
    const result = startup(path);
    assert.deepEqual(result.replacements, []);
    assert.equal(result.loadCalls.length, 1);
    assert.equal(result.loadCalls[0].pathname + result.loadCalls[0].search, path);
    assert.ok(result.requests.some(p => p.endsWith('/manifest.json')));
    assert.ok(result.requests.some(p => p.includes('/domains/')));
    assert.deepEqual(result.itemIds, [id]); assert.ok(result.text.includes(name));
    assert.ok(result.meta.includes(`遊戲版本 ${version}`));
    assert.doesNotMatch(result.text, /找不到|稍後再試/);
  });
}

// Scenario: fixture_c exists in 9.9.1 and is absent from current 9.9.2.
// Purpose: Prove historical-only identity support and let selected data determine not-found after loading.
test('InterT50_歷史專屬id可讀且目前資料確實缺少才顯示找不到', async () => {
  const id = 'darktide:skill:fixture_c';
  const items = async version => JSON.parse(await readFile(join(root, `test/fixtures/source-data/data/${version}/skills.json`))).items;
  assert.ok((await items('9.9.1')).some(item => item.id === id));
  assert.ok(!(await items('9.9.2')).some(item => item.id === id));
  const historical = startup(`/skills/?id=${id}&version=9.9.1`);
  assert.deepEqual(historical.itemIds, [id]); assert.match(historical.meta, /遊戲版本 9\.9\.1/);
  const current = startup(`/skills/?id=${id}`);
  assert.equal(current.loadCalls.length, 1); assert.ok(current.requests.some(p => p.includes('/domains/')));
  assert.deepEqual(current.replacements, []); assert.deepEqual(current.itemIds, []);
  assert.match(current.text, /找不到/); assert.doesNotMatch(current.text, /稍後再試/);
});

// Scenario: A fixture new id absent from the migration inventory selects an unsupported version.
// Purpose: Preserve client version validation instead of misclassifying the new identity as an old alias.
test('InterT60_未列於對應表的新id保留未知版本驗證錯誤', () => {
  const result = startup('/skills/?id=darktide:skill:fixture_a&version=does-not-exist');
  assert.deepEqual(result.replacements, []); assert.deepEqual(result.itemIds, []);
  assert.equal(result.loadCalls.length, 1);
  assert.match(result.text, /稍後再試/); assert.doesNotMatch(result.text, /找不到/);
});
