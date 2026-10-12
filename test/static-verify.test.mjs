import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { buildStaticSite } from '../src/static/build.mjs';
import { verifyStaticPackage } from '../src/static/verify.mjs';
import { createBuildRoot, buildFixture, disposeBuildRoot, publishedRemotePackage, resealStaticDataFile } from './static-test-helpers.mjs';

test('UnitT10_detects_artifact_byte_tampering', async () => {
  // Scenario: One emitted JSON byte changes without updating the artifact manifest.
  // Purpose: Reject a static package whose recorded SHA-256 no longer matches its bytes.
  const root = await createBuildRoot();
  try {
    await buildFixture(root);
    const dist = join(root, 'dist');
    const manifest = JSON.parse(await readFile(join(dist, 'artifact-manifest.json'), 'utf8'));
    const catalog = manifest.files.find(file => file.path.endsWith('/catalog.json'));
    await writeFile(join(dist, ...catalog.path.split('/')), '{}', 'utf8');
    await assert.rejects(verifyStaticPackage(dist), /hash|size|tamper|integrity/i);
  } finally {
    await disposeBuildRoot(root);
  }
});

test('UnitT20_detects_missing_and_unlisted_files', async () => {
  // Scenario: A package is first missing a listed file, then receives an unlisted extra file.
  // Purpose: Require exact agreement between the directory contents and the package manifest.
  const root = await createBuildRoot();
  try {
    await buildFixture(root);
    const dist = join(root, 'dist');
    const manifest = JSON.parse(await readFile(join(dist, 'artifact-manifest.json'), 'utf8'));
    const target = manifest.files.find(file => file.path.endsWith('/catalog.json'));
    const targetPath = join(dist, ...target.path.split('/'));
    await rm(targetPath);
    await assert.rejects(verifyStaticPackage(dist), /missing|file set|artifact/i);

    await buildFixture(root);
    await writeFile(join(dist, 'unlisted.bin'), 'extra', 'utf8');
    await assert.rejects(verifyStaticPackage(dist), /extra|manifest|unlisted|file set/i);
  } finally {
    await disposeBuildRoot(root);
  }
});

test('UnitT30_rejects_malformed_public_json_even_when_manifest_is_resealed', async () => {
  // Scenario: A public catalog is replaced by malformed JSON and its manifest entry is updated.
  // Purpose: Validate the meaning of public JSON instead of relying only on self-consistent hashes.
  const root = await createBuildRoot();
  try {
    await buildFixture(root);
    const dist = join(root, 'dist');
    const manifest = JSON.parse(await readFile(join(dist, 'artifact-manifest.json'), 'utf8'));
    const catalog = manifest.files.find(file => file.path.endsWith('/catalog.json'));
    await resealStaticDataFile(dist, catalog.path.split('/').slice(2).join('/'), '{');
    await assert.rejects(verifyStaticPackage(dist), /JSON|json|catalog/i);
  } finally {
    await disposeBuildRoot(root);
  }
});

test('UnitT40_rejects_private_fields_even_when_manifest_is_resealed', async () => {
  // Scenario: A rehashed catalog JSON contains a private evidence field.
  // Purpose: Preserve the public-data boundary independently of package hashes.
  const root = await createBuildRoot();
  try {
    await buildFixture(root);
    const dist = join(root, 'dist');
    const manifest = JSON.parse(await readFile(join(dist, 'artifact-manifest.json'), 'utf8'));
    const catalog = manifest.files.find(file => file.path.endsWith('/catalog.json'));
    const target = join(dist, ...catalog.path.split('/'));
    const value = JSON.parse(await readFile(target, 'utf8'));
    value.evidence = [{ private_path: 'F:/private/source.tsv' }];
    await resealStaticDataFile(dist, catalog.path.split('/').slice(2).join('/'), JSON.stringify(value, null, 2) + '\n');
    await assert.rejects(verifyStaticPackage(dist), /private|evidence|source path/i);
  } finally {
    await disposeBuildRoot(root);
  }
});

test('UnitT50_rejects_cross_record_reference_after_manifest_revision_and_build_are_resealed', async () => {
  // Scenario: A variant detail is changed to reference a nonexistent weapon, then all package hashes and version links are rebuilt.
  // Purpose: Prove semantic relationships are validated after the package is fully resealed, not only protected by checksums.
  const root = await createBuildRoot();
  try {
    await buildFixture(root);
    const dist = join(root, 'dist');
    const manifest = JSON.parse(await readFile(join(dist, 'artifact-manifest.json'), 'utf8'));
    const variantPath = manifest.files.find(file => file.path.endsWith('/details/variants/steady-example-rifle.json')).path;
    const relative = variantPath.split('/').slice(2).join('/');
    const target = join(dist, ...variantPath.split('/'));
    const detail = JSON.parse(await readFile(target, 'utf8'));
    detail.record.weapon_id = 'missing-rifle';
    await resealStaticDataFile(dist, relative, JSON.stringify(detail, null, 2) + '\n');
    await assert.rejects(verifyStaticPackage(dist), /missing|weapon|relation|reference/i);
  } finally {
    await disposeBuildRoot(root);
  }
});

test('UnitT60_rejects_catalog_count_mismatch_after_full_reseal', async () => {
  // Scenario: A catalog count is incremented and every revision, build, manifest, and HTML version reference is updated.
  // Purpose: Ensure catalog entry totals stay semantically linked to the detail package.
  const root = await createBuildRoot();
  try {
    await buildFixture(root);
    const dist = join(root, 'dist');
    const manifest = JSON.parse(await readFile(join(dist, 'artifact-manifest.json'), 'utf8'));
    const catalogPath = manifest.files.find(file => file.path.endsWith('/catalog.json')).path;
    const relative = catalogPath.split('/').slice(2).join('/');
    const target = join(dist, ...catalogPath.split('/'));
    const catalog = JSON.parse(await readFile(target, 'utf8'));
    catalog.counts.weapons++;
    await resealStaticDataFile(dist, relative, JSON.stringify(catalog, null, 2) + '\n');
    await assert.rejects(verifyStaticPackage(dist), /count|entry|catalog/i);
  } finally {
    await disposeBuildRoot(root);
  }
});

test('UnitT65_rejects_removed_initial_games_lantern_credit_after_full_reseal', async () => {
  // Scenario: A published package using a Games Lantern attachment has its initial HTML credit removed and all package hashes are resealed.
  // Purpose: Enforce attribution from validated public data instead of trusting only self-consistent artifact hashes.
  const root = await createBuildRoot({ productionWeb: true });
  try {
    const published = join(root, 'content', 'published');
    await mkdir(published, { recursive: true });
    await writeFile(join(published, 'content.json'), JSON.stringify(publishedRemotePackage()), 'utf8');
    await buildStaticSite({ root });
    const dist = join(root, 'dist');
    const indexPath = join(dist, 'index.html');
    const index = await readFile(indexPath, 'utf8');
    const credit = '<p class="asset-credit">本網站部分圖片素材經 <a href="https://darktide.gameslantern.com/">Games Lantern</a> 許可使用。</p>';
    assert.ok(index.includes(credit), 'precondition: built index contains the initial credit');
    await writeFile(indexPath, index.replace(credit, ''), 'utf8');
    const manifest = JSON.parse(await readFile(join(dist, 'artifact-manifest.json'), 'utf8'));
    const catalog = manifest.files.find(file => file.path.endsWith('/catalog.json'));
    await resealStaticDataFile(dist, catalog.path.split('/').slice(2).join('/'),
      await readFile(join(dist, ...catalog.path.split('/'))));
    await assert.rejects(verifyStaticPackage(dist), /initial HTML.*Games Lantern|Games Lantern.*initial HTML/i);
  } finally {
    await disposeBuildRoot(root);
  }
});

test('UnitT70_rejects_local_image_bytes_in_published_data_even_when_manifest_lists_them', async () => {
  // Scenario: A valid JSON-only published package is modified to include an image under its versioned data root and that file is listed in the artifact manifest.
  // Purpose: Ensure the verifier enforces remote-only published assets rather than accepting downloaded image bytes as static package content.
  const root = await createBuildRoot();
  try {
    const published = join(root, 'content', 'published');
    await mkdir(published, { recursive: true });
    await writeFile(join(published, 'content.json'), JSON.stringify(publishedRemotePackage()), 'utf8');
    await buildStaticSite({ root });
    const dist = join(root, 'dist');
    const manifest = JSON.parse(await readFile(join(dist, 'artifact-manifest.json'), 'utf8'));
    const imagePath = `data/${manifest.data_revision}/icons/unapproved.png`;
    const imageBytes = Buffer.from('not-an-image-but-listed-as-download');
    const absoluteImage = join(dist, ...imagePath.split('/'));
    await mkdir(join(dist, ...imagePath.split('/').slice(0, -1)), { recursive: true });
    await writeFile(absoluteImage, imageBytes);
    manifest.files.push({
      path: imagePath,
      size_bytes: imageBytes.byteLength,
      sha256: createHash('sha256').update(imageBytes).digest('hex')
    });
    manifest.files.sort((left, right) => left.path.localeCompare(right.path));
    await writeFile(join(dist, 'artifact-manifest.json'), JSON.stringify(manifest, null, 2) + '\n', 'utf8');

    await assert.rejects(verifyStaticPackage(dist), /published static data must contain JSON only/i);
  } finally {
    await disposeBuildRoot(root);
  }
});

