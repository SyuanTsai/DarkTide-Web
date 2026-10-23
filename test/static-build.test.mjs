import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildStaticSite, replaceDirectory } from '../src/static/build.mjs';
import { createBuildRoot, buildFixture, disposeBuildRoot, publishedRemotePackage } from './static-test-helpers.mjs';
import { fixturePublicContent } from '../src/static/fixture.mjs';
import { verifyStaticPackage } from '../src/static/verify.mjs';

const BUILD_CLI = fileURLToPath(new URL('../scripts/build.mjs', import.meta.url));
const VERIFY_CLI = fileURLToPath(new URL('../scripts/verify-static.mjs', import.meta.url));

test('UnitT10_repeats_data_revision_and_changes_build_id_for_code_only_change', async () => {
  // Scenario: The same published fixture and web source are built twice, then one web module changes.
  // Purpose: Prove data_revision ignores machine state while build_id locks the website source.
  const root = await createBuildRoot();
  try {
    const first = await buildFixture(root);
    const repeated = await buildFixture(root);
    assert.equal(repeated.data_revision, first.data_revision);
    assert.equal(repeated.build_id, first.build_id);

    await writeFile(join(root, 'web', 'client.mjs'), "export const label = 'fixture changed';\n", 'utf8');
    const codeChanged = await buildFixture(root);
    assert.equal(codeChanged.data_revision, first.data_revision);
    assert.notEqual(codeChanged.build_id, first.build_id);
  } finally {
    await disposeBuildRoot(root);
  }
});

test('UnitT15_fixture_without_games_lantern_assets_omits_initial_credit', async () => {
  // Scenario: A fixture package with no assets is emitted from the production HTML template.
  // Purpose: Avoid making a Games Lantern permission claim when the public package uses no covered material.
  const root = await createBuildRoot({ productionWeb: true });
  try {
    await buildFixture(root);
    const html = await readFile(join(root, 'dist', 'index.html'), 'utf8');
    assert.doesNotMatch(html, /Games Lantern|darktide\.gameslantern\.com|__GAMES_LANTERN_CREDIT__/i);
  } finally {
    await disposeBuildRoot(root);
  }
});

test('UnitT20_formal_build_rejects_missing_or_fixture_content_and_keeps_previous_output', async () => {
  // Scenario: A prior dist exists while published content is absent or explicitly marked fixture.
  // Purpose: Prevent a production build from silently substituting fictional data or losing the last complete package.
  const root = await createBuildRoot();
  const dist = join(root, 'dist');
  try {
    await mkdir(dist);
    await writeFile(join(dist, 'previous.txt'), 'previous-complete-package', 'utf8');
    await assert.rejects(buildStaticSite({ root }), /content\/published\/content\.json/);
    assert.equal(await readFile(join(dist, 'previous.txt'), 'utf8'), 'previous-complete-package');

    const published = join(root, 'content', 'published');
    await mkdir(published, { recursive: true });
    await writeFile(join(published, 'content.json'), JSON.stringify(fixturePublicContent()), 'utf8');
    await assert.rejects(buildStaticSite({ root }), /package_kind.*published|published.*package_kind/i);
    assert.equal(await readFile(join(dist, 'previous.txt'), 'utf8'), 'previous-complete-package');
  } finally {
    await disposeBuildRoot(root);
  }
});

test('UnitT25_formal_build_rejects_private_fields_without_projection_and_preserves_previous_output', async () => {
  // Scenario: Published content has a valid published discriminator but carries an unapproved evidence field.
  // Purpose: Ensure the public repository is strictly validated and private candidate data never gets silently projected away.
  const root = await createBuildRoot();
  const dist = join(root, 'dist');
  try {
    await mkdir(dist);
    await writeFile(join(dist, 'previous.txt'), 'previous-complete-package', 'utf8');
    const published = join(root, 'content', 'published');
    await mkdir(published, { recursive: true });
    const candidate = fixturePublicContent();
    candidate.package_kind = 'published';
    candidate.evidence = [{ private_path: 'C:/private/source.tsv' }];
    await writeFile(join(published, 'content.json'), JSON.stringify(candidate), 'utf8');

    await assert.rejects(buildStaticSite({ root }), /unsupported|private|evidence|field/i);
    assert.equal(await readFile(join(dist, 'previous.txt'), 'utf8'), 'previous-complete-package');
  } finally {
    await disposeBuildRoot(root);
  }
});

test('UnitT35_formal_build_rejects_local_icon_files_and_preserves_previous_output', async () => {
  // Scenario: A valid remote-only published package is accompanied by an unlisted local image under content/published/icons.
  // Purpose: Keep the checked-in formal input strictly JSON-only and prevent stale or private image bytes from being silently ignored.
  const root = await createBuildRoot();
  const dist = join(root, 'dist');
  try {
    await mkdir(dist);
    await writeFile(join(dist, 'previous.txt'), 'previous-complete-package', 'utf8');
    const published = join(root, 'content', 'published');
    await mkdir(join(published, 'icons'), { recursive: true });
    await writeFile(join(published, 'content.json'), JSON.stringify(publishedRemotePackage()), 'utf8');
    await writeFile(join(published, 'icons', 'stale.png'), 'image bytes must not be read', 'utf8');

    await assert.rejects(buildStaticSite({ root }), /only content\.json|JSON.only|local image/i);
    assert.equal(await readFile(join(dist, 'previous.txt'), 'utf8'), 'previous-complete-package');
  } finally {
    await disposeBuildRoot(root);
  }
});

test('InterT30_formal_remote_assets_build_from_json_without_local_icon_bytes', async () => {
  // Scenario: A complete published v2 package references a GitHub Issue attachment and contains no local icons directory.
  // Purpose: Keep formal builds JSON-only and show the used asset's direct credit in the initial index.
  const root = await createBuildRoot({ productionWeb: true });
  try {
    const published = join(root, 'content', 'published');
    await mkdir(published, { recursive: true });
    await writeFile(join(published, 'content.json'), JSON.stringify(publishedRemotePackage()), 'utf8');

    const built = await buildStaticSite({ root });
    const report = await verifyStaticPackage(join(root, 'dist'));
    const html = await readFile(join(root, 'dist', 'index.html'), 'utf8');
    assert.match(html, /本網站部分圖片素材經 <a href="https:\/\/darktide\.gameslantern\.com\/">Games Lantern<\/a> 許可使用。/);
    const initialCreditLink = /<a href="https:\/\/darktide\.gameslantern\.com\/">Games Lantern<\/a>/.exec(html)?.[0];
    assert.ok(initialCreditLink, 'initial HTML must include the direct Games Lantern link');
    assert.doesNotMatch(initialCreditLink, /rel\s*=|nofollow|ugc|sponsored/i);
    const footerStart = html.indexOf('<footer');
    const footerEnd = footerStart < 0 ? -1 : html.indexOf('</footer>', footerStart);
    const footer = footerEnd < 0 ? '' : html.slice(footerStart, footerEnd + '</footer>'.length);
    assert.ok(footer.includes('<p class="asset-credit">本網站部分圖片素材經 ' + initialCreditLink + ' 許可使用。</p>'), 'credit must be visible in the initial footer markup');
    assert.ok(html.indexOf(initialCreditLink) < html.indexOf('<script type="module"'), 'credit must be present before the app module runs');
    const manifest = JSON.parse(await readFile(join(root, 'dist', 'artifact-manifest.json'), 'utf8'));
    const dataRows = manifest.files.filter(file => file.path.startsWith('data/'));
    const skillsPath = dataRows.find(file => file.path.endsWith('/details/skills/veteran/practice-guard.json'))?.path;
    const skill = JSON.parse(await readFile(join(root, 'dist', ...skillsPath.split('/')), 'utf8'));

    assert.equal(built.package_kind, 'published');
    assert.equal(report.package_kind, 'published');
    assert.equal(skill.assets.length, 1);
    assert.equal(skill.assets[0].path, null);
    assert.match(skill.assets[0].source_url, /^https:\/\/github\.com\/user-attachments\/assets\/[a-f0-9-]+$/);
    assert.ok(dataRows.every(file => file.path.endsWith('.json')));
    assert.ok(manifest.files.every(file => !file.path.includes('/icons/')));
  } finally {
    await disposeBuildRoot(root);
  }
});

test('UnitT30_writes_only_one_html_and_a_complete_hashed_module_graph', async () => {
  // Scenario: A fixture build has an app module importing one local client module.
  // Purpose: Ensure the entry and every reachable ESM module use deterministic hashed URLs.
  const root = await createBuildRoot();
  try {
    const result = await buildFixture(root);
    const dist = join(root, 'dist');
    const manifest = JSON.parse(await readFile(join(dist, 'artifact-manifest.json'), 'utf8'));
    const htmlFiles = manifest.files.filter(file => file.path.endsWith('.html'));
    const scripts = manifest.files.filter(file => /^assets\/[a-f0-9]{64}\.mjs$/.test(file.path));
    assert.deepEqual(htmlFiles.map(file => file.path), ['index.html']);
    assert.equal(scripts.length, 2);
    const html = await readFile(join(dist, 'index.html'), 'utf8');
    assert.match(html, /window\.__BUILD__=/);
    assert.doesNotMatch(html, /__BUILD_CONTEXT__/);
    assert.match(html, new RegExp('/assets/[a-f0-9]{64}\\.mjs'));
    const moduleBodies = await Promise.all(scripts.map(file => readFile(join(dist, ...file.path.split('/')), 'utf8')));
    for (const body of moduleBodies) {
      for (const match of body.matchAll(/from\s+['"]([^'"]+)['"]/g)) {
        assert.ok(scripts.some(file => '/' + file.path === match[1]), 'unresolved import ' + match[1]);
      }
    }
    assert.equal(result.package_kind, 'fixture');
  } finally {
    await disposeBuildRoot(root);
  }
});

test('UnitT40_restores_previous_output_when_staging_rename_fails', async () => {
  // Scenario: Replacing dist fails after the existing directory was moved aside.
  // Purpose: Keep the previous complete package available when the new staging directory cannot be installed.
  const root = await createBuildRoot();
  const dist = join(root, 'dist');
  const staging = join(root, '.staging-test');
  try {
    await mkdir(dist);
    await writeFile(join(dist, 'previous.txt'), 'old', 'utf8');
    await mkdir(staging);
    await writeFile(join(staging, 'new.txt'), 'new', 'utf8');
    let failed = false;
    const renameWithFailure = async (source, destination) => {
      if (source === staging && destination === dist && !failed) {
        failed = true;
        throw new Error('injected staging rename failure');
      }
      return rename(source, destination);
    };
    await assert.rejects(replaceDirectory(staging, dist, { renameDirectory: renameWithFailure }), /injected staging rename failure/);
    assert.equal(await readFile(join(dist, 'previous.txt'), 'utf8'), 'old');
  } finally {
    await disposeBuildRoot(root);
  }
});

test('UnitT50_origin_is_optional_absolute_and_part_of_build_identity_only', async () => {
  // Scenario: The same fixture is built without a platform origin and then with two explicit HTTPS origins.
  // Purpose: Avoid inventing a production hostname while keeping absolute sitemap URLs and origin-sensitive build identity.
  const root = await createBuildRoot();
  try {
    const noOrigin = await buildFixture(root);
    const noOriginManifest = JSON.parse(await readFile(join(root, 'dist', 'artifact-manifest.json'), 'utf8'));
    assert.ok(!noOriginManifest.files.some(file => file.path === 'sitemap.xml'));
    assert.doesNotMatch(await readFile(join(root, 'dist', 'robots.txt'), 'utf8'), /^Sitemap:/m);

    const firstOrigin = await buildStaticSite({ root, mode: 'fixture', data: fixturePublicContent(), siteOrigin: 'https://example.test' });
    const firstManifest = JSON.parse(await readFile(join(root, 'dist', 'artifact-manifest.json'), 'utf8'));
    assert.ok(firstManifest.files.some(file => file.path === 'sitemap.xml'));
    const sitemap = await readFile(join(root, 'dist', 'sitemap.xml'), 'utf8');
    assert.match(sitemap, /<loc>https:\/\/example\.test\/skills\//);
    assert.match(await readFile(join(root, 'dist', 'robots.txt'), 'utf8'), /Sitemap: https:\/\/example\.test\/sitemap\.xml/);
    const secondOrigin = await buildStaticSite({ root, mode: 'fixture', data: fixturePublicContent(), siteOrigin: 'https://other.test' });
    assert.equal(firstOrigin.data_revision, noOrigin.data_revision);
    assert.equal(secondOrigin.data_revision, noOrigin.data_revision);
    assert.notEqual(firstOrigin.build_id, noOrigin.build_id);
    assert.notEqual(secondOrigin.build_id, firstOrigin.build_id);

    await assert.rejects(buildStaticSite({ root, mode: 'fixture', data: fixturePublicContent(), siteOrigin: 'http://example.test' }), /HTTPS origin/i);
    assert.equal((await buildStaticSite({ root, mode: 'fixture', data: fixturePublicContent(), siteOrigin: 'https://other.test' })).build_id, secondOrigin.build_id);
  } finally {
    await disposeBuildRoot(root);
  }
});

test('InterT10_build_and_verify_CLIs_work_with_a_temporary_root_containing_spaces', async () => {
  // Scenario: The real command-line entry points run against an isolated temporary root whose path contains spaces.
  // Purpose: Catch Windows file URL pathname and argument parsing errors in formal and explicit fixture commands.
  const root = await createBuildRoot({ withSpaces: true });
  try {
    const formal = spawnSync(process.execPath, [BUILD_CLI, '--root', root], { encoding: 'utf8', timeout: 120_000 });
    assert.notEqual(formal.status, 0);
    assert.match(formal.stderr, /content\/published\/content\.json/);
    assert.equal(await readFile(join(root, 'dist', 'index.html'), 'utf8').then(() => true, () => false), false);

    const fixture = spawnSync(process.execPath, [BUILD_CLI, '--fixture', '--site-origin', 'https://example.test', '--root', root], {
      encoding: 'utf8', timeout: 120_000
    });
    assert.equal(fixture.status, 0, fixture.stderr);
    assert.match(fixture.stdout, /Built \d+ static files \(fixture\)/);
    const verified = spawnSync(process.execPath, [VERIFY_CLI, join(root, 'dist')], { encoding: 'utf8', timeout: 120_000 });
    assert.equal(verified.status, 0, verified.stderr);
    assert.match(verified.stdout, /Verified \d+ static files \(fixture\)/);
    assert.equal((await verifyStaticPackage(join(root, 'dist'))).site_origin, 'https://example.test');
  } finally {
    await disposeBuildRoot(root);
  }
});

test('InterT20_thousand_public_records_keep_cloudflare_headers_within_fixed_limits', async () => {
  // Scenario: A valid fixture package grows to 1,000 distinct weapons and over 1,000 canonical routes.
  // Purpose: Keep cache rules bounded and nonoverlapping as public record counts grow.
  const root = await createBuildRoot();
  try {
    const data = fixturePublicContent();
    for (let index = 2; index <= 1000; index += 1) {
      const weaponId = `practice-rifle-${String(index).padStart(4, '0')}`;
      data.weapons.push({
        weapon_id: weaponId,
        kind: 'ranged',
        category: '遠程武器',
        name_zh_tw: `測試武器 ${index}`,
        model_zh_tw: null,
        mark_ids: [],
        claims: [],
        asset_ids: [],
        source_ids: []
      });
      data.routes.push({
        route_kind: 'canonical',
        content_kind: 'weapon',
        content_key: weaponId,
        source_route: null,
        target_route: `/weapons/${weaponId}/`,
        decision: 'keep'
      });
    }
    data.routes.push(
      {
        route_kind: 'redirect',
        content_kind: 'weapon',
        content_key: 'practice-rifle',
        source_route: '/old-practice-rifle/',
        target_route: '/weapons/practice-rifle/',
        decision: 'redirect'
      },
      {
        route_kind: 'redirect',
        content_kind: 'weapon',
        content_key: 'practice-rifle',
        source_route: '/weapons/old-practice-rifle/',
        target_route: '/weapons/practice-rifle/',
        decision: 'redirect'
      }
    );
    await buildStaticSite({ root, mode: 'fixture', data });
    const headers = await readFile(join(root, 'dist', '_headers'), 'utf8');
    const ruleLines = headers.trimEnd().split(/\r?\n/).filter(line => line.startsWith('/'));
    assert.equal(data.weapons.length, 1000);
    assert.equal(ruleLines.length, 11);
    assert.ok(ruleLines.length <= 100);
    assert.ok(headers.split(/\r?\n/).every(line => line.length <= 2000));
    assert.deepEqual([...ruleLines].sort(), [
      '/', '/assets/*', '/blessings/*', '/data/*', '/game-changes/*', '/index.html', '/old-practice-rifle/', '/robots.txt', '/skills/*', '/version.json', '/weapons/*'
    ]);
    assert.ok(!ruleLines.includes('/weapons/old-practice-rifle/'), 'in-prefix aliases should be covered by /weapons/*');
  } finally {
    await disposeBuildRoot(root);
  }
});

test('UnitT60_rejects_cloudflare_header_rule_overflow_without_replacing_dist', async () => {
  // Scenario: More than Cloudflare's 100-rule budget is required by out-of-prefix redirect aliases.
  // Purpose: Fail closed before replacing the last complete static package.
  const root = await createBuildRoot();
  const dist = join(root, 'dist');
  try {
    await mkdir(dist);
    await writeFile(join(dist, 'previous.txt'), 'previous-complete-package', 'utf8');
    const data = fixturePublicContent();
    for (let index = 0; index < 92; index += 1) {
      data.routes.push({
        route_kind: 'redirect',
        content_kind: 'weapon',
        content_key: 'practice-rifle',
        source_route: `/old-weapon-${String(index).padStart(3, '0')}/`,
        target_route: '/weapons/practice-rifle/',
        decision: 'redirect'
      });
    }
    await assert.rejects(buildStaticSite({ root, mode: 'fixture', data }), /100-rule limit/);
    assert.equal(await readFile(join(dist, 'previous.txt'), 'utf8'), 'previous-complete-package');
  } finally {
    await disposeBuildRoot(root);
  }
});

test('UnitT70_rejects_cloudflare_header_line_overflow_without_replacing_dist', async () => {
  // Scenario: One valid-looking public alias would exceed Cloudflare's 2,000-character line budget.
  // Purpose: Prevent an artifact that Cloudflare would reject while preserving the prior output.
  const root = await createBuildRoot();
  const dist = join(root, 'dist');
  try {
    await mkdir(dist);
    await writeFile(join(dist, 'previous.txt'), 'previous-complete-package', 'utf8');
    const data = fixturePublicContent();
    data.routes.push({
      route_kind: 'redirect',
      content_kind: 'weapon',
      content_key: 'practice-rifle',
      source_route: '/' + 'a'.repeat(2001) + '/',
      target_route: '/weapons/practice-rifle/',
      decision: 'redirect'
    });
    await assert.rejects(buildStaticSite({ root, mode: 'fixture', data }), /exceeds 2000 characters/);
    assert.equal(await readFile(join(dist, 'previous.txt'), 'utf8'), 'previous-complete-package');
  } finally {
    await disposeBuildRoot(root);
  }
});

test('UnitT80_rejects_external_alias_overlapping_immutable_data_prefix', async () => {
  // Scenario: A legacy alias source path would match both document revalidation and immutable data caching.
  // Purpose: Avoid Cloudflare merging conflicting Cache-Control values for one request path.
  const root = await createBuildRoot();
  const dist = join(root, 'dist');
  try {
    await mkdir(dist);
    await writeFile(join(dist, 'previous.txt'), 'previous-complete-package', 'utf8');
    const data = fixturePublicContent();
    data.routes.push({
      route_kind: 'redirect',
      content_kind: 'weapon',
      content_key: 'practice-rifle',
      source_route: '/data/old-package/',
      target_route: '/weapons/practice-rifle/',
      decision: 'redirect'
    });
    await assert.rejects(buildStaticSite({ root, mode: 'fixture', data }), /overlaps an immutable/);
    assert.equal(await readFile(join(dist, 'previous.txt'), 'utf8'), 'previous-complete-package');
  } finally {
    await disposeBuildRoot(root);
  }
});

