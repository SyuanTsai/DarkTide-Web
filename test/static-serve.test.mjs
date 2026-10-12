import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createStaticServer } from '../scripts/serve.mjs';
import { createBuildRoot, buildFixture, disposeBuildRoot } from './static-test-helpers.mjs';

test('InterT10_serves_deep_document_routes_and_cache_policy', async () => {
  // Scenario: A browser navigates directly to a canonical deep route and requests versioned data and hashed code.
  // Purpose: Keep route refreshes available while distinguishing revalidated HTML from immutable files.
  const root = await createBuildRoot();
  let server;
  try {
    const result = await buildFixture(root);
    const dist = join(root, 'dist');
    const manifest = JSON.parse(await readFile(join(dist, 'artifact-manifest.json'), 'utf8'));
    const dataFile = manifest.files.find(file => file.path.endsWith('/catalog.json'));
    const assetFile = manifest.files.find(file => /^assets\/[a-f0-9]{64}\.mjs$/.test(file.path));
    server = await createStaticServer({ distPath: dist });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    const base = 'http://127.0.0.1:' + address.port;

    const deep = await fetch(base + '/weapons/practice-rifle/', { headers: { accept: 'text/html' } });
    assert.equal(deep.status, 200);
    assert.match(deep.headers.get('content-type'), /text\/html/);
    assert.match(deep.headers.get('cache-control'), /no-cache|must-revalidate/i);
    assert.match(await deep.text(), /window\.__BUILD__/);

    const version = await fetch(base + '/version.json');
    assert.equal(version.status, 200);
    assert.match(version.headers.get('cache-control'), /no-cache|must-revalidate/i);

    const data = await fetch(base + '/data/' + result.data_revision + '/' + dataFile.path.split('/').slice(2).join('/'));
    assert.equal(data.status, 200);
    assert.match(data.headers.get('content-type'), /application\/json/);
    assert.match(data.headers.get('cache-control'), /immutable/);

    const asset = await fetch(base + '/' + assetFile.path);
    assert.equal(asset.status, 200);
    assert.match(asset.headers.get('cache-control'), /immutable/);
  } finally {
    if (server?.listening) await new Promise(resolve => server.close(resolve));
    await disposeBuildRoot(root);
  }
});

test('InterT20_missing_data_json_and_assets_return_404_without_spa_fallback', async () => {
  // Scenario: A document request names a missing versioned JSON file or hashed asset.
  // Purpose: Keep missing data and code failures visible instead of returning the application shell.
  const root = await createBuildRoot();
  let server;
  try {
    const result = await buildFixture(root);
    server = await createStaticServer({ distPath: join(root, 'dist') });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const base = 'http://127.0.0.1:' + server.address().port;

    const missingData = await fetch(base + '/data/' + result.data_revision + '/missing.json', {
      headers: { accept: 'text/html' }
    });
    assert.equal(missingData.status, 404);
    assert.match(missingData.headers.get('content-type'), /application\/json/);
    assert.match(await missingData.text(), /not_found/);

    const missingAsset = await fetch(base + '/assets/' + 'a'.repeat(64) + '.mjs', {
      headers: { accept: 'text/html' }
    });
    assert.equal(missingAsset.status, 404);
    assert.doesNotMatch(await missingAsset.text(), /window\.__BUILD__/);

    const missingImage = await fetch(base + '/data/' + result.data_revision + '/icons/missing.png', {
      headers: { accept: 'text/html' }
    });
    assert.equal(missingImage.status, 404);
    assert.doesNotMatch(await missingImage.text(), /window\.__BUILD__/);
  } finally {
    if (server?.listening) await new Promise(resolve => server.close(resolve));
    await disposeBuildRoot(root);
  }
});

