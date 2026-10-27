import assert from 'node:assert/strict';
import test from 'node:test';
import { buildW15AnnouncementCandidate } from '../scripts/content/w15-announcement-import.mjs';
import { computeReviewDigests, loadWebAuthoringInputs, validateWebAuthoring } from '../scripts/content/contract-authoring.mjs';

// Scenario: A fixed official game document is represented with typed inline, table and image blocks.
// Purpose: Accept an official-document announcement without inventing a gameReleaseId or weakening the existing site/gameplay scopes.
test('UnitT10_accepts_pending_official_document_with_closed_typed_blocks', async () => {
  const inputs = await loadWebAuthoringInputs();
  const imported = await buildW15AnnouncementCandidate();
  const contract = structuredClone(inputs.authoring);
  const announcement = contract.announcements.find(row => row.scope === 'site');
  const source = imported.announcements[2];

  Object.assign(announcement, {
    scope: source.scope,
    title: source.title,
    publishedOn: source.publishedOn,
    source: source.source,
    blocks: source.blocks,
    assets: source.assets,
  });
  assert.equal(Object.hasOwn(announcement, 'gameReleaseId'), false);
  const result = validateWebAuthoring(contract, inputs);

  assert.equal(result.valid, true, JSON.stringify(result.issues));
  assert.equal(result.publicationEligible, false);
  assert.equal(announcement.scope, 'official-document');
  assert.equal(announcement.blocks.some(block => block.kind === 'table'), true);
  assert.equal(announcement.blocks.some(block => block.inline?.some(run => run.kind === 'strong')), true);
});

// Scenario: An official-document announcement is assigned a gameplay release or a site-owner identity.
// Purpose: Keep official game documents distinct from gameplay-scoped content and Web-owned notices.
test('UnitT20_rejects_official_document_with_game_release_or_site_owner', async () => {
  const inputs = await loadWebAuthoringInputs();
  const imported = await buildW15AnnouncementCandidate();
  const withRelease = structuredClone(inputs.authoring);
  const announcement = withRelease.announcements.find(row => row.scope === 'site');
  Object.assign(announcement, imported.announcements[0], { announcementId: announcement.announcementId, gameReleaseId: 'fixture-r2' });
  let result = validateWebAuthoring(withRelease, inputs);
  assert.equal(result.valid, false);

  const wrongOwner = structuredClone(inputs.authoring);
  const wrongAnnouncement = wrongOwner.announcements.find(row => row.scope === 'site');
  Object.assign(wrongAnnouncement, imported.announcements[0], {
    announcementId: wrongAnnouncement.announcementId,
    source: { ...imported.announcements[0].source, kind: 'site-owner' },
  });
  result = validateWebAuthoring(wrongOwner, inputs);
  assert.equal(result.valid, false);
});

// Scenario: An official-document source is replaced with an internal site route.
// Purpose: Keep external official source identity distinct from safe in-article navigation links.
test('UnitT30_rejects_internal_route_as_official_document_source', async () => {
  const inputs = await loadWebAuthoringInputs();
  const imported = await buildW15AnnouncementCandidate();
  const contract = structuredClone(inputs.authoring);
  const announcement = contract.announcements.find(row => row.scope === 'site');
  const source = imported.announcements[2];
  Object.assign(announcement, {
    scope: source.scope, title: source.title, publishedOn: source.publishedOn, revision: source.revision,
    source: source.source, blocks: source.blocks, assets: source.assets,
  });
  announcement.source.locator = '/terms/';

  const result = validateWebAuthoring(contract, inputs);
  assert.equal(result.valid, false);
  assert.ok(result.issues.some(item => item.path.endsWith('/source/locator') && item.code === 'announcement-url'));
});

// Scenario: Only an official-document publication date changes while its source and blocks stay fixed.
// Purpose: Bind the original publication context into that announcement's review digest without staling unrelated targets.
test('UnitT40_official_document_date_change_stales_only_its_blocks_review', async () => {
  const inputs = await loadWebAuthoringInputs();
  const imported = await buildW15AnnouncementCandidate();
  const contract = structuredClone(inputs.authoring);
  const announcement = contract.announcements.find(row => row.scope === 'site');
  const source = imported.announcements[2];
  Object.assign(announcement, {
    scope: source.scope, title: source.title, publishedOn: source.publishedOn, revision: source.revision,
    source: source.source, blocks: source.blocks, assets: source.assets,
  });
  const blocksTarget = contract.reviewTargets.find(target => target.ownerKind === 'announcement'
    && target.ownerId === announcement.announcementId && target.fieldPath === '/blocks');
  const unrelatedTermTarget = contract.reviewTargets.find(target => target.ownerKind === 'term-localization');
  assert.ok(blocksTarget);
  assert.ok(unrelatedTermTarget);

  const beforeBlocks = computeReviewDigests(contract, blocksTarget, inputs);
  const beforeTerm = computeReviewDigests(contract, unrelatedTermTarget, inputs);
  announcement.publishedOn = '2026-09-30';
  const afterBlocks = computeReviewDigests(contract, blocksTarget, inputs);
  const afterTerm = computeReviewDigests(contract, unrelatedTermTarget, inputs);

  assert.equal(afterBlocks.targetDigest, beforeBlocks.targetDigest);
  assert.notEqual(afterBlocks.dependenciesDigest, beforeBlocks.dependenciesDigest);
  assert.deepEqual(afterTerm, beforeTerm);
});
