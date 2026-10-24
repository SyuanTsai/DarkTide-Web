import test from 'node:test';
import assert from 'node:assert/strict';
import { loadSharedRelease } from '../web/shared-client.mjs';
import { createSharedViewModel } from '../web/shared-view.mjs';
import { installTestLocation, makeSharedPackage, responseFetch } from './w11-shared-client.fixture.mjs';
import { makeCompiledAnnouncementFixture } from './w13-announcement-fixture.mjs';

// Scenario: The actual W08 compiler emits a schema-valid announcement domain in a marked fixture package.
// Purpose: Load exactly the optional manifest-pinned announcement bytes without changing the four core-domain requirement.
// Given a non-publishable compiler fixture, When the shared client loads its release, Then it retrieves the announcement domain once and exposes it to the typed view.
test('UnitT10_loads_exact_compiled_optional_announcement_domain', async t => {
  installTestLocation(t);
  const fixture = await makeCompiledAnnouncementFixture();
  const calls = [];

  const result = await loadSharedRelease({
    build: fixture.build,
    fetchImpl: responseFetch(fixture.responses, { calls }),
  });

  assert.equal(result.status, 'ready');
  assert.equal(result.domains.some(domain => domain.kind === 'announcements'), true);
  const route = '/data/' + fixture.compiled.manifest.dataRevision + '/domains/announcements.json';
  assert.equal(result.rawFiles.has(route), true);
  assert.equal(calls.filter(call => call.url.endsWith('/domains/announcements.json')).length, 1);
  assert.equal(result.fixtureOnly, true);
  assert.equal(result.view.getAnnouncements().items.length, 1);
  assert.equal(result.view.getAnnouncement('fixture:announcement:w13-site').publishedOn, '2026-10-24');
});

// Scenario: A shared release predates the optional announcements domain and has only the four required core domains.
// Purpose: Keep the announcements page's empty state valid without adding requests or weakening the core release pins.
// Given no manifest announcement row, When the shared client loads the package, Then it exposes an empty typed list.
test('UnitT20_keeps_missing_optional_announcements_domain_as_an_empty_list', async t => {
  installTestLocation(t);
  const pack = makeSharedPackage();
  const calls = [];

  const result = await loadSharedRelease({ build: pack.build, fetchImpl: responseFetch(pack.responses, { calls }) });

  assert.equal(result.status, 'ready');
  assert.equal(result.view.getAnnouncements().items.length, 0);
  assert.equal(result.domains.length, 4);
  assert.equal(calls.length, 5);
  assert.ok(calls.every(call => !call.url.endsWith('/announcements.json')));
});

// Scenario: A compiler fixture points the optional announcements domain to a nonexistent manifest dependency.
// Purpose: Fail closed on an incomplete domain dependency closure before a package can be served.
// Given a resealed manifest with a dangling dependency, When static fixture validation runs, Then it rejects the release.
test('UnitT30_rejects_missing_announcement_dependency', async () => {
  await assert.rejects(makeCompiledAnnouncementFixture({ announcementDependencies: ['domains/missing.json'] }),
    /dependency points to missing path/u);
});

// Scenario: The manifest declares an announcement domain but the static build omits its exact byte pin.
// Purpose: Require the site build to pin the optional domain path, byte length and hash before fetching it.
// Given a valid W08 announcement release with one omitted build pin, When the client loads it, Then it rejects the release.
test('UnitT40_rejects_unpinned_optional_announcement_domain', async t => {
  installTestLocation(t);
  const fixture = await makeCompiledAnnouncementFixture();
  const build = structuredClone(fixture.build);
  build.shared_files = build.shared_files.filter(row => !row.path.endsWith('/domains/announcements.json'));

  await assert.rejects(loadSharedRelease({ build, fetchImpl: responseFetch(fixture.responses) }),
    /does not pin the optional announcements domain/u);
});

// Scenario: The announcement response differs from the SHA and byte length pinned in the compiler manifest.
// Purpose: Bind the optional announcement projection to the selected immutable release bytes.
// Given a tampered announcement response, When the shared client loads it, Then it rejects the complete release.
test('UnitT50_rejects_changed_announcement_domain_bytes', async t => {
  installTestLocation(t);
  const fixture = await makeCompiledAnnouncementFixture();
  const fetchImpl = responseFetch(fixture.responses, { alter: (pathname, bytes) => {
    if (!pathname.endsWith('/domains/announcements.json')) return null;
    return Buffer.from(bytes.toString('utf8').replace('2026-10-24', '2026-10-25'));
  } });

  await assert.rejects(loadSharedRelease({ build: fixture.build, fetchImpl }), /domain bytes do not match manifest/u);
});

// Scenario: A schema-valid compiler fixture contains a real date error inside the optional Web announcement projection.
// Purpose: Reject impossible calendar dates before the typed announcement view can render them.
// Given a date rolled beyond the end of February, When the view model validates the package, Then it fails closed.
test('UnitT60_rejects_impossible_announcement_date', async () => {
  const fixture = await makeCompiledAnnouncementFixture();
  const domain = structuredClone(fixture.announcementDomain);
  domain.web.announcements[0].publishedOn = '2026-02-30';

  assert.throws(() => createSharedViewModel({ domains: [domain], gameReleaseId: 'fixture-r2', fixtureOnly: true }),
    /announcement date is invalid/u);
});

// Scenario: An announcement contains a block kind outside the W08 typed block union.
// Purpose: Reject HTML or otherwise unknown block payloads without interpreting them as markup.
// Given an unsupported block kind, When the view model validates the release, Then it rejects the announcement.
test('UnitT70_rejects_unknown_announcement_block_kind', async () => {
  const fixture = await makeCompiledAnnouncementFixture();
  const domain = structuredClone(fixture.announcementDomain);
  domain.web.announcements[0].blocks.push({ blockId: 'fixture:block:unknown', kind: 'html', html: '<script>bad()</script>' });

  assert.throws(() => createSharedViewModel({ domains: [domain], gameReleaseId: 'fixture-r2', fixtureOnly: true }),
    /unsupported kind/u);
});

// Scenario: An announcement link uses an executable scheme rather than a public HTTPS URL.
// Purpose: Reject unsafe navigation before the renderer can attach the href to a link element.
// Given a javascript URL in a nested link block, When the typed view is built, Then the release is rejected.
test('UnitT80_rejects_unsafe_announcement_link_url', async () => {
  const fixture = await makeCompiledAnnouncementFixture();
  const domain = structuredClone(fixture.announcementDomain);
  domain.web.announcements[0].blocks.at(-1).blocks.at(-1).href = 'javascript:alert(1)';

  assert.throws(() => createSharedViewModel({ domains: [domain], gameReleaseId: 'fixture-r2', fixtureOnly: true }),
    /unsafe URL/u);
});

// Scenario: An image occurrence refers to an asset not declared by its announcement.
// Purpose: Fail closed on dangling image references instead of rendering an empty or unrelated asset.
// Given a missing image asset id, When the typed view is built, Then it rejects the announcement.
test('UnitT90_rejects_missing_announcement_asset_reference', async () => {
  const fixture = await makeCompiledAnnouncementFixture();
  const domain = structuredClone(fixture.announcementDomain);
  domain.web.announcements[0].blocks.find(block => block.kind === 'image').assetRef.assetId = 'fixture:asset:missing';

  assert.throws(() => createSharedViewModel({ domains: [domain], gameReleaseId: 'fixture-r2', fixtureOnly: true }),
    /undeclared asset/u);
});

// Scenario: A formal package carries a correctly shaped announcement without a matching human approval receipt.
// Purpose: Keep fixture markers as the only approval bypass and reject unreviewed formal content.
// Given the pending W08 fixture's formal view, When the typed view is built without fixture metadata, Then it rejects the row.
test('UnitT11_rejects_unreviewed_formal_announcement', async () => {
  const fixture = await makeCompiledAnnouncementFixture();

  assert.throws(() => createSharedViewModel({ domains: [fixture.announcementDomain], gameReleaseId: 'fixture-r2' }),
    /formal announcement is not approved/u);
});

// Scenario: The announcement has a matching human receipt for /revision, while its required /blocks review remains pending.
// Purpose: Bind formal publication approval to the exact announcement block target instead of any owner-level receipt.
// Given a valid receipt for a different field, When the formal view is built, Then the unreviewed blocks are rejected.
test('UnitT12_requires_human_review_receipt_for_announcement_blocks', async () => {
  const fixture = await makeCompiledAnnouncementFixture();
  const domain = structuredClone(fixture.announcementDomain);
  const target = domain.web.reviewTargets.find(row => row.target.ownerKind === 'announcement');
  target.target.fieldPath = '/revision';
  target.state = 'approved';
  target.targetDigest = 'a'.repeat(64);
  target.dependenciesDigest = 'b'.repeat(64);
  domain.web.reviewReceipts.push({
    mode: target.mode,
    receipt: {
      targetId: target.target.targetId,
      decision: 'approved',
      targetDigest: target.targetDigest,
      dependenciesDigest: target.dependenciesDigest,
      reviewer: { kind: 'human', id: 'w13-fixture-reviewer' },
    },
  });

  assert.throws(() => createSharedViewModel({ domains: [domain], gameReleaseId: 'fixture-r2' }),
    /formal announcement is not approved/u);
});

// Scenario: The announcement has an approved target and matching human receipt for the required /blocks path.
// Purpose: Permit formal display only when the exact content reviewed by a human is approved.
// Given a matching /blocks receipt, When the formal view is built, Then the announcement is available.
test('UnitT13_accepts_human_review_receipt_for_announcement_blocks', async () => {
  const fixture = await makeCompiledAnnouncementFixture();
  const domain = structuredClone(fixture.announcementDomain);
  const target = domain.web.reviewTargets.find(row => row.target.ownerKind === 'announcement');
  target.state = 'approved';
  target.targetDigest = 'a'.repeat(64);
  target.dependenciesDigest = 'b'.repeat(64);
  domain.web.reviewReceipts.push({
    mode: target.mode,
    receipt: {
      targetId: target.target.targetId,
      decision: 'approved',
      targetDigest: target.targetDigest,
      dependenciesDigest: target.dependenciesDigest,
      reviewer: { kind: 'human', id: 'w13-fixture-reviewer' },
    },
  });

  const view = createSharedViewModel({ domains: [domain], gameReleaseId: 'fixture-r2' });
  assert.equal(view.getAnnouncements().items.length, 1);
});

// Scenario: An announcement text value contains an HTML script element.
// Purpose: Keep announcement copy as validated plain text and prevent markup payloads from entering the UI projection.
// Given script markup in a heading block, When the view model validates it, Then the release is rejected.
test('UnitT14_rejects_html_markup_in_announcement_text', async () => {
  const fixture = await makeCompiledAnnouncementFixture();
  const domain = structuredClone(fixture.announcementDomain);
  domain.web.announcements[0].blocks[0].text = '<script>window.injected=true</script>';

  assert.throws(() => createSharedViewModel({ domains: [domain], gameReleaseId: 'fixture-r2', fixtureOnly: true }),
    /safe plain text/u);
});

// Scenario: Two ordered announcement blocks reuse the same stable block id.
// Purpose: Prevent ambiguous occurrence identities from colliding in the detail DOM or review evidence.
// Given duplicate block identities, When the view model validates the announcement, Then it rejects the release.
test('UnitT15_rejects_conflicting_announcement_block_ids', async () => {
  const fixture = await makeCompiledAnnouncementFixture();
  const domain = structuredClone(fixture.announcementDomain);
  domain.web.announcements[0].blocks[1].blockId = domain.web.announcements[0].blocks[0].blockId;

  assert.throws(() => createSharedViewModel({ domains: [domain], gameReleaseId: 'fixture-r2', fixtureOnly: true }),
    /invalid or duplicated/u);
});

// Scenario: A fixture package pointer omits the static build's explicit non-publishable marker.
// Purpose: Keep announcement fixture access controlled by validated build metadata rather than Web content.
// Given an incomplete fixture marker, When the client loads the package, Then it rejects before any network request.
test('UnitT16_requires_build_fixture_marker_before_loading_fixture_announcements', async t => {
  installTestLocation(t);
  const fixture = await makeCompiledAnnouncementFixture();
  fixture.build.shared_fixture_only = false;
  const calls = [];

  await assert.rejects(loadSharedRelease({ build: fixture.build, fetchImpl: responseFetch(fixture.responses, { calls }) }),
    /missing its non-publishable marker/u);
  assert.equal(calls.length, 0);
});
