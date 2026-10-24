import test from 'node:test';
import assert from 'node:assert/strict';
import { copyFile, mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildStaticSite } from '../src/static/build.mjs';
import { verifyStaticPackage } from '../src/static/verify.mjs';
import { loadSharedReleaseFixture } from '../src/static/shared-release.mjs';
import { renderStaticRewrites } from '../src/static/routing-policy.mjs';
import { renderCacheHeaders, validateCacheHeaders } from '../src/static/header-policy.mjs';
import { fixturePublicContent } from '../src/static/fixture.mjs';
import { createBuildRoot, disposeBuildRoot } from './static-test-helpers.mjs';

const REPOSITORY_ROOT = fileURLToPath(new URL('../', import.meta.url));
const SITE_ORIGIN = 'https://w13-runtime-fixture.test';

async function createPublishedInputRoot() {
  const root = await createBuildRoot();
  await mkdir(path.join(root, 'content', 'published'), { recursive: true });
  await copyFile(path.join(REPOSITORY_ROOT, 'content', 'published', 'content.json'),
    path.join(root, 'content', 'published', 'content.json'));
  return root;
}

// Scenario: A repo-contained minimal module graph has no announcement route capability marker.
// Purpose: Preserve exact legacy route/header requirements for shared fixture artifacts and runtime snapshots.
// Given the W08 shared fixture and existing static test helper, When the current verifier and runtimeSnapshot loader read the old-capability artifacts, Then they accept only the matching old policy and reject the new policy's headers.
test('InterT20_minimal_shared_artifact_preserves_legacy_routing_and_snapshot_policy', { timeout: 120000 }, async () => {
  const bundle = await loadSharedReleaseFixture({ repoRoot: REPOSITORY_ROOT });
  assert.equal(bundle.packageKind, 'fixture', 'the shared W08 package remains explicitly non-publishable');

  const sharedRoot = await createBuildRoot();
  const publishedRoot = await createPublishedInputRoot();
  const snapshotRoot = await createBuildRoot();
  try {
    await buildStaticSite({ root: sharedRoot, mode: 'fixture', data: fixturePublicContent(), sharedRelease: bundle });
    const sharedDist = path.join(sharedRoot, 'dist');
    const verifiedShared = await verifyStaticPackage(sharedDist);
    assert.equal(verifiedShared.package_kind, 'fixture');
    const sharedHeaders = await readFile(path.join(sharedDist, '_headers'), 'utf8');
    const sharedRedirects = await readFile(path.join(sharedDist, '_redirects'), 'utf8');
    assert.equal(sharedHeaders.includes('/announcements/*'), false);
    assert.equal(sharedRedirects.includes('/announcements/*'), false);

    const catalog = JSON.parse(await readFile(path.join(sharedDist, 'data', verifiedShared.runtime_data_revision, 'catalog.json'), 'utf8'));
    const expectedLegacyHeaders = renderCacheHeaders(catalog, { includeAnnouncements: false });
    const expectedNewHeaders = renderCacheHeaders(catalog, { includeAnnouncements: true });
    assert.equal(sharedHeaders, expectedLegacyHeaders);
    assert.throws(() => validateCacheHeaders(Buffer.from(expectedNewHeaders), catalog, { includeAnnouncements: false }),
      /cache rules do not match/u);
    assert.throws(() => validateCacheHeaders(Buffer.from(expectedLegacyHeaders), catalog, { includeAnnouncements: true }),
      /cache rules do not match/u);
    assert.equal(sharedRedirects, renderStaticRewrites(catalog, { includeAnnouncements: false }));
    assert.notEqual(renderStaticRewrites(catalog, { includeAnnouncements: true }), sharedRedirects);

    await buildStaticSite({ root: publishedRoot, mode: 'published', siteOrigin: SITE_ORIGIN });
    const verifiedPublished = await verifyStaticPackage(path.join(publishedRoot, 'dist'));
    assert.equal(verifiedPublished.package_kind, 'published');
    await buildStaticSite({ root: snapshotRoot, mode: 'published', runtimeSnapshot: path.join(publishedRoot, 'dist'), siteOrigin: SITE_ORIGIN });
    const verifiedSnapshot = await verifyStaticPackage(path.join(snapshotRoot, 'dist'));
    assert.equal(verifiedSnapshot.package_kind, 'published');
    assert.equal(verifiedSnapshot.data_revision, verifiedPublished.data_revision);
    assert.equal((await readFile(path.join(snapshotRoot, 'dist', '_headers'), 'utf8')).includes('/announcements/*'), false);
    assert.equal((await readFile(path.join(snapshotRoot, 'dist', '_redirects'), 'utf8')).includes('/announcements/*'), false);
  } finally {
    await disposeBuildRoot(snapshotRoot);
    await disposeBuildRoot(publishedRoot);
    await disposeBuildRoot(sharedRoot);
  }
});