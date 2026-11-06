import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, cp, readFile, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { loadSourceData } from '../src/build/source-data.mjs';

const fixture = new URL('./fixtures/source-data/', import.meta.url);
// Scenario: A complete two-version checkout is pinned to its actual HEAD.
// Purpose: Reject mismatched revisions and preserve the exact source bytes.
test('InterT10_讀取指定commit與兩版資料並拒絕錯誤輸入', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'wp5-source-'));
  try {
    await cp(fixture, root, { recursive: true });
    const git = (...args) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8' }).trim();
    git('init'); git('add', '.');
    git('-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.test', 'commit', '-m', 'fixture');
    const commit = git('rev-parse', 'HEAD');
    const loaded = await loadSourceData({ directory: root, commit });
    assert.deepEqual(loaded.current.versions, ['9.9.1', '9.9.2']);
    assert.deepEqual(loaded.rawFiles.get('current.json'), await readFile(path.join(root, 'data/current.json')));
    await assert.rejects(loadSourceData({ directory: root, commit: '0'.repeat(40) }), /HEAD/);
    const file = path.join(root, 'data/9.9.2/skills.json');
    const original = await readFile(file);
    const data = JSON.parse(original); data.items[0].explanation = {};
    await writeFile(file, JSON.stringify(data));
    await assert.rejects(loadSourceData({ directory: root }), /explanation/);
    await writeFile(file, original);
    const weaponFile=path.join(root,'data/9.9.2/weapons.json');const weapons=JSON.parse(await readFile(weaponFile));
    weapons.items[0].values.bars[0].stats=null;await writeFile(weaponFile,JSON.stringify(weapons));
    await assert.rejects(loadSourceData({directory:root}),/weapon bars/);
    await cp(new URL('./fixtures/source-data/data/9.9.2/weapons.json',import.meta.url),weaponFile);
    await rm(path.join(root, 'data/current.json'));
    await assert.rejects(loadSourceData({ directory: root }), /current.json/);
  } finally { await rm(root, { recursive: true, force: true }); }
});
