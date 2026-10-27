import assert from 'node:assert/strict';
import test from 'node:test';
import { buildW15AnnouncementCandidate } from '../scripts/content/w15-announcement-import.mjs';
import { createSharedViewModel } from '../web/shared-view.mjs';
import { installTestLocation, responseFetch } from './w11-shared-client.fixture.mjs';
import { makeCompiledAnnouncementFixture } from './w13-announcement-fixture.mjs';
import { loadSharedRelease } from '../web/shared-client.mjs';

function authoringRow(candidateRow) {
  return {
    announcementId: 'fixture:announcement:w13-site',
    scope: candidateRow.scope,
    title: candidateRow.title,
    publishedOn: candidateRow.publishedOn,
    revision: candidateRow.revision,
    source: candidateRow.source,
    blocks: candidateRow.blocks,
    assets: candidateRow.assets,
  };
}

// Scenario: The five pending official documents pass through the real W08 compiler and optional announcements client domain.
// Purpose: Preserve rich source meaning and title without claiming a gameplay release or adding announcements to W10 required features.
test('UnitT10_compiles_and_validates_official_document_as_optional_typed_announcement', async t => {
  installTestLocation(t);
  const candidate = await buildW15AnnouncementCandidate();
  const source = candidate.announcements[2];
  const fixture = await makeCompiledAnnouncementFixture({ announcement: authoringRow(source) });
  const loaded = await loadSharedRelease({ build: fixture.build, fetchImpl: responseFetch(fixture.responses) });
  assert.equal(loaded.status, 'ready');
  assert.equal(loaded.view.getAnnouncements().items.length, 1);
  assert.equal(loaded.view.getAnnouncements().items[0].scope, 'official-document');
  const item = loaded.view.getAnnouncement('fixture:announcement:w13-site');
  assert.equal(item.title, source.title);
  assert.equal(Object.hasOwn(item, 'gameReleaseId'), false);
  assert.ok(item.blocks.some(block => block.kind === 'table' && block.rows[0].header === true));
  assert.ok(item.blocks.some(block => block.inline?.some(run => run.kind === 'strong')));
  assert.ok(item.assets.length > 0);
  assert.equal(fixture.compiled.manifest.compatibility.requiredFeatures.some(feature => feature.includes('announcement')), false);
  assert.equal(fixture.compiled.manifest.files.some(file => file.kind === 'announcements'), true);
});

// Scenario: An inline announcement link contains an executable URL but otherwise matches its declared plain-text value.
// Purpose: Reject unsafe link destinations in rich runs before the DOM renderer can create an anchor.
test('UnitT20_rejects_unsafe_inline_announcement_link', async () => {
  const candidate = await buildW15AnnouncementCandidate();
  const fixture = await makeCompiledAnnouncementFixture({ announcement: authoringRow(candidate.announcements[2]) });
  const domain = structuredClone(fixture.announcementDomain);
  const paragraph = domain.web.announcements[0].blocks.find(block => block.kind === 'paragraph' && block.inline?.some(run => run.kind === 'link'));
  const linkRun = paragraph.inline.find(run => run.kind === 'link');
  linkRun.href = 'javascript:alert(1)';

  assert.throws(() => createSharedViewModel({ domains: [domain], gameReleaseId: 'fixture-r2', fixtureOnly: true }), /unsafe URL/u);
});

// Scenario: A compiled official-document row uses an internal route as its source locator.
// Purpose: Keep the typed consumer aligned with the authoring rule for public official sources.
test('UnitT25_rejects_internal_route_as_official_document_source_locator', async () => {
  const candidate = await buildW15AnnouncementCandidate();
  const fixture = await makeCompiledAnnouncementFixture({ announcement: authoringRow(candidate.announcements[2]) });
  const domain = structuredClone(fixture.announcementDomain);
  domain.web.announcements[0].source.locator = '/terms/';

  assert.throws(() => createSharedViewModel({ domains: [domain], gameReleaseId: 'fixture-r2', fixtureOnly: true }), /source locator/u);
});

// Scenario: An official document contains a nested list and a blockquote represented as typed data.
// Purpose: Keep nested order and quote structure when the W08 optional-domain view is built.
test('UnitT30_preserves_quote_and_nested_list_in_optional_announcement_view', async () => {
  const candidate = await buildW15AnnouncementCandidate();
  const quoteFixture = await makeCompiledAnnouncementFixture({ announcement: authoringRow(candidate.announcements[1]) });
  const quoteView = createSharedViewModel({ domains: [quoteFixture.announcementDomain], gameReleaseId: 'fixture-r2', fixtureOnly: true });
  assert.ok(quoteView.getAnnouncement('fixture:announcement:w13-site').blocks.some(block => block.kind === 'quote'));

  const listFixture = await makeCompiledAnnouncementFixture({ announcement: authoringRow(candidate.announcements[0]) });
  const listView = createSharedViewModel({ domains: [listFixture.announcementDomain], gameReleaseId: 'fixture-r2', fixtureOnly: true });
  const item = listView.getAnnouncement('fixture:announcement:w13-site');
  const nestedList = item.blocks.find(block => block.kind === 'list' && block.items.some(row => row.children?.some(child => child.kind === 'list')));
  assert.ok(nestedList);
  assert.ok(nestedList.items.some(row => row.children?.some(child => child.kind === 'list')));
});

// Scenario: A legacy gameplay announcement keeps an opaque official reference identifier rather than an HTTP URL.
// Purpose: Limit the new public-HTTPS locator rule to additive official-document rows while preserving older gameplay packages.
test('UnitT40_preserves_legacy_gameplay_opaque_source_locator', async () => {
  const candidate = await buildW15AnnouncementCandidate();
  const gameplay = authoringRow(candidate.announcements[2]);
  gameplay.scope = 'gameplay';
  gameplay.gameReleaseId = 'fixture-r2';
  gameplay.source.locator = 'official-doc:legacy-reference';
  const fixture = await makeCompiledAnnouncementFixture({ announcement: gameplay });

  const view = createSharedViewModel({ domains: [fixture.announcementDomain], gameReleaseId: 'fixture-r2', fixtureOnly: true });
  assert.equal(view.getAnnouncement('fixture:announcement:w13-site').source.locator, 'official-doc:legacy-reference');

  const officialDocument = structuredClone(fixture.announcementDomain);
  officialDocument.web.announcements[0].scope = 'official-document';
  delete officialDocument.web.announcements[0].gameReleaseId;
  assert.throws(() => createSharedViewModel({ domains: [officialDocument], gameReleaseId: 'fixture-r2', fixtureOnly: true }), /source locator/u);
});
