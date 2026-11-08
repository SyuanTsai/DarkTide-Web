import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const startup = options => JSON.parse(execFileSync(process.execPath,
  ['--experimental-test-module-mocks', fileURLToPath(new URL('./fixtures/legacy-app-harness.mjs', import.meta.url)), JSON.stringify(options)],
  { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }));
const examples = [
  ['/skills/?id=darktide%3Askill%3Apsyker%3Abrain-burst-improved', 'darktide:skill:psyker:psyker_brain_burst_improved', '顱腦崩裂'],
  ['/blessings/?id=darktide%3Ablessing%3Aarc_rifle%3Ap1-ammo-from-reserve-on-crit&variant=darktide%3Ablessing-variant%3Aarc_rifle%3Ap1-ammo-from-reserve-on-crit&tier=4', 'darktide:blessing:weapon_trait_bespoke_arc_rifle_p1_ammo_from_reserve_on_crit', '名稱待確認'],
  ['/skills/arbites/adamant_ammo_belt/', 'darktide:skill:adamant:adamant_ammo_belt', '彈藥腰帶'],
  ['/skills/arbites/adamant_area_buff_drone_improved/', 'darktide:skill:adamant:adamant_area_buff_drone_improved', '天鷹使節']
];

// Scenario: Each specified production URL starts the real app with only local fetch fixtures.
// Purpose: Protect app wiring as well as replaceState, actual load identity/version, and unique rendering.
test('InterT10_實際app啟動四個舊網址會改寫請求並只顯示目標', () => {
  for (const [path, id, name] of examples) {
    const result = startup({ path });
    assert.equal(result.replacements.length, 1, path);
    const rewritten = new URL(result.replacements[0][2], 'https://example.test');
    assert.equal(rewritten.searchParams.get('id'), id);
    assert.equal(rewritten.searchParams.get('version'), '1.13.4');
    assert.equal(result.loadCalls.length, 1);
    assert.equal(result.loadCalls[0].pathname, rewritten.pathname);
    const query = new URLSearchParams(result.loadCalls[0].search);
    assert.equal(query.get('id'), id); assert.equal(query.get('version'), '1.13.4');
    assert.ok(result.requests.some(p => p.endsWith('/manifest.json')));
    assert.ok(result.requests.some(p => p.includes('/domains/')));
    assert.deepEqual(result.itemIds, [id]); assert.ok(result.text.includes(name));
    assert.match(result.meta, /遊戲版本 1\.13\.4/);
    if (path.includes('variant=')) { assert.equal(query.has('variant'), false); assert.equal(query.get('tier'), '4'); }
  }
});

// Scenario: Four canonical weapon paths retain a unique mark after a family reorganization.
// Purpose: Exercise resolution, shard loading, and exact display through the real startup flow.
test('InterT20_實際app將重組family的四個網址呈現為正確武器', () => {
  for (const suffix of ['2', '3']) for (const path of [
    `/weapons/ogryn_thumper_p${suffix}/`, `/weapons/ogryn_thumper_p${suffix}/marks/ogryn_thumper_p1_m${suffix}/`
  ]) {
    const result = startup({ path }); const id = `darktide:weapon:ogryn_thumper_p1_m${suffix}`;
    assert.equal(result.replacements.length, 1, path);
    const query = new URLSearchParams(result.loadCalls[0]?.search);
    assert.equal(query.get('id'), id); assert.equal(query.get('version'), '1.13.4'); assert.equal(query.has('family'), false);
    assert.ok(result.requests.some(p => p.includes('/domains/weapons/')));
    assert.deepEqual(result.itemIds, [id]);
    assert.ok(result.text.includes(suffix === '2' ? '震盪槍' : '惡棍槍'));
  }
});

// Scenario: An unmapped old id supplies a historical or unknown version absent from the build.
// Purpose: Show deterministic not-found before any version/data load or retryable error screen.
test('InterT30_實際app對未知舊id與歷史或未知版本一律顯示找不到', () => {
  for (const version of ['1.13.2', 'does-not-exist']) {
    const result = startup({ path: `/skills/?id=darktide:skill:psyker:no-such-old-id&version=${version}` });
    assert.match(result.text, /找不到/); assert.doesNotMatch(result.text, /驗證失敗|稍後再試/);
    assert.deepEqual(result.itemIds, []); assert.deepEqual(result.replacements, []);
    assert.deepEqual(result.loadCalls, []); assert.deepEqual(result.requests, []);
  }
});

// Scenario: A legitimate new id selects an available historical version or an unavailable version.
// Purpose: Preserve the client's original version selection and validation behavior for new URLs.
test('InterT40_實際app保留合法新id的版本選擇與未知版本錯誤', () => {
  const id = examples[0][1];
  const historical = startup({ path: `/skills/?id=${id}&version=1.13.2`, includeHistory: true });
  assert.deepEqual(historical.replacements, []); assert.deepEqual(historical.itemIds, [id]);
  assert.ok(historical.text.includes('歷史版本項目')); assert.match(historical.meta, /遊戲版本 1\.13\.2/);
  assert.equal(new URLSearchParams(historical.loadCalls[0].search).get('version'), '1.13.2');
  const unknown = startup({ path: `/skills/?id=${id}&version=does-not-exist` });
  assert.deepEqual(unknown.replacements, []); assert.deepEqual(unknown.itemIds, []);
  assert.equal(unknown.loadCalls.length, 1); assert.match(unknown.text, /稍後再試/); assert.doesNotMatch(unknown.text, /找不到/);
});
