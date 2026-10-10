import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { validateRecordPublication } from '../src/content/publication.mjs';

const route = '/skills/veteran/practice-guard/';
const raw = new TextEncoder().encode('fictional source bytes');
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const approval = (fieldPath, allowedRoute = route) => ({
  status: 'approved', evidence_ref: 'sample-evidence-index', rights_holder: 'Fictional Author',
  scope: 'fictional sample', allowed_field_paths: [fieldPath], allowed_routes: [allowedRoute],
  reviewer: 'fixture-reviewer', reviewed_on: '2026-10-10', reason_code: null
});
const pending = () => ({
  status: 'pending', evidence_ref: null, rights_holder: null, scope: null,
  allowed_field_paths: [], allowed_routes: [], reviewer: null, reviewed_on: null, reason_code: 'needs-review'
});

function candidate() {
  return {
    route,
    record: {
      name_zh_tw: '虛構防護', effect_zh_tw: '虛構效果。',
      evidence: [
        { field_path: '/name_zh_tw', source_id: 'fictional-source', source_selector: 'name', rights_id: 'right-name' },
        { field_path: '/effect_zh_tw', source_id: 'fictional-source', source_selector: 'effect', rights_id: 'right-effect' }
      ],
      asset_ids: []
    },
    requiredFieldPaths: ['/name_zh_tw', '/effect_zh_tw'],
    sourceLocks: [{
      schema_version: 1, source_id: 'fictional-source', kind: 'git_file',
      repository_url: 'https://example.test/fictional.git', commit_sha: 'a'.repeat(40),
      release: null, steam_build_id: null, build_association: 'unknown', build_evidence_id: null,
      tool_commit_sha: null, path: 'docs/sample.md', source_url: null,
      sha256: sha(raw), selectors: ['name', 'effect'], batch_id: 'fixture-batch'
    }],
    rightsLedger: [
      { schema_version: 1, rights_id: 'right-name', subject: { kind: 'source_field', source_id: 'fictional-source', selector: 'name', asset_id: null }, local: approval('/name_zh_tw'), git: pending(), publish: approval('/name_zh_tw') },
      { schema_version: 1, rights_id: 'right-effect', subject: { kind: 'source_field', source_id: 'fictional-source', selector: 'effect', asset_id: null }, local: approval('/effect_zh_tw'), git: pending(), publish: approval('/effect_zh_tw') }
    ],
    sourceBytes: new Map([['fictional-source', raw]]),
    assets: [],
    requireGitApproval: false
  };
}

function withLicensedIcon(input) {
  const bytes = new Uint8Array([1, 2, 3]);
  const sourceUrl = 'https://darktide.gameslantern.com/storage/sites/darktide/exporter/talents/fictional.webp';
  input.record.asset_ids = ['sample-icon'];
  input.assets = [{
    schema_version: 1, asset_id: 'sample-icon', source_id: 'icon-source',
    source_url: sourceUrl, source_sha256: sha(bytes), rights_id: 'right-icon',
    rehost_allowed: true, routes: [route], delivery_path: 'assets/sample.webp',
    attribution: { text: 'Icons obtained with permission from darktide.gameslantern.com', href: 'https://darktide.gameslantern.com/', follow_required: true }
  }];
  input.sourceLocks.push({
    schema_version: 1, source_id: 'icon-source', kind: 'external_asset',
    repository_url: null, commit_sha: null, release: null, steam_build_id: null,
    build_association: 'unknown', build_evidence_id: null, tool_commit_sha: null,
    path: null, source_url: sourceUrl, sha256: sha(bytes), selectors: ['asset'], batch_id: 'fixture-batch'
  });
  input.sourceBytes.set('icon-source', bytes);
  input.rightsLedger.push({
    schema_version: 1, rights_id: 'right-icon',
    subject: { kind: 'asset', source_id: 'icon-source', selector: null, asset_id: 'sample-icon' },
    local: approval('/asset_ids'), git: pending(), publish: approval('/asset_ids')
  });
  return input;
}

// Scenario: Every displayed field has a matching fixed source and local/publish approval.
// Purpose: Admit an independently reviewed record without requiring Git approval for external builds.
test('UnitT10_accepts_fully_matched_field_provenance', async () => {
  await assert.doesNotReject(() => validateRecordPublication(candidate()));
});

// Scenario: A fixed source path contains the space used by the real Game Info tree.
// Purpose: Allow a safe Git path without weakening source byte or rights checks.
test('UnitT15_accepts_git_source_path_with_internal_spaces', async () => {
  const input = candidate();
  input.sourceLocks[0].path = 'Game Info/docs/sample.md';
  await assert.doesNotReject(() => validateRecordPublication(input));
});

// Scenario: A displayed effect is missing its own evidence row.
// Purpose: Prevent another field's approval from covering unreviewed text.
test('UnitT20_rejects_missing_field_evidence', async () => {
  const input = candidate();
  input.record.evidence.pop();
  await assert.rejects(() => validateRecordPublication(input), /evidence.*effect_zh_tw/i);
});

// Scenario: Source bytes changed after the source lock was recorded.
// Purpose: Stop publication when an otherwise approved source drifts.
test('UnitT30_rejects_source_hash_drift', async () => {
  const input = candidate();
  input.sourceBytes.set('fictional-source', new TextEncoder().encode('changed'));
  await assert.rejects(() => validateRecordPublication(input), /source.*hash/i);
});

// Scenario: A right is approved for a different route only.
// Purpose: Keep approval scoped to its exact using page.
test('UnitT40_rejects_rights_for_another_route', async () => {
  const input = candidate();
  input.rightsLedger[1].publish = approval('/effect_zh_tw', '/skills/other/');
  await assert.rejects(() => validateRecordPublication(input), /route/i);
});

// Scenario: The right targets the name selector while evidence cites the effect selector.
// Purpose: Reject an approval attached to the wrong source field.
test('UnitT50_rejects_subject_selector_mismatch', async () => {
  const input = candidate();
  input.rightsLedger[1].subject.selector = 'name';
  await assert.rejects(() => validateRecordPublication(input), /selector/i);
});

// Scenario: A controlled build would copy real content into Git but its Git decision is pending.
// Purpose: Keep local, Git, and publish decisions independent.
test('UnitT60_requires_git_approval_only_for_git_output', async () => {
  const input = candidate();
  input.requireGitApproval = true;
  await assert.rejects(() => validateRecordPublication(input), /git.*approval/i);
});

// Scenario: A Games Lantern icon is used on a page without a matching asset approval.
// Purpose: Enforce the granted scope and visible follow attribution on each using route.
test('UnitT70_rejects_unapproved_icon_use', async () => {
  const input = withLicensedIcon(candidate());
  input.rightsLedger.pop();
  await assert.rejects(() => validateRecordPublication(input), /asset.*right/i);
});

// Scenario: A covered icon has its exact asset approval and visible follow credit.
// Purpose: Allow the already granted Games Lantern icon use when all page conditions hold.
test('UnitT80_accepts_approved_games_lantern_icon', async () => {
  await assert.doesNotReject(() => validateRecordPublication(withLicensedIcon(candidate())));
});

// Scenario: A covered icon's credit loses its follow requirement.
// Purpose: Stop an asset page that would violate the per-page backlink condition.
test('UnitT90_rejects_icon_without_follow_credit', async () => {
  const input = withLicensedIcon(candidate());
  input.assets[0].attribution.follow_required = false;
  await assert.rejects(() => validateRecordPublication(input), /attribution/i);
});

// Scenario: The asset delivery path escapes the release asset directory.
// Purpose: Keep copied image bytes within the release's static asset namespace.
test('UnitT100_rejects_unsafe_asset_delivery_path', async () => {
  const input = withLicensedIcon(candidate());
  input.assets[0].delivery_path = '../secret.webp';
  await assert.rejects(() => validateRecordPublication(input), /asset.*path/i);
});

function jsonCandidate() {
  const input = candidate();
  const rawJson = new TextEncoder().encode(JSON.stringify({ blessings: [
    { name_zh_tw: input.record.name_zh_tw, effect: input.record.effect_zh_tw }
  ] }));
  input.sourceLocks[0].path = 'Game Info/data/blessings.json';
  input.sourceLocks[0].sha256 = sha(rawJson);
  input.sourceLocks[0].selectors = ['json:/blessings/0/name_zh_tw', 'json:/blessings/0/effect'];
  input.sourceBytes.set('fictional-source', rawJson);
  input.record.evidence[0].source_selector = input.sourceLocks[0].selectors[0];
  input.record.evidence[1].source_selector = input.sourceLocks[0].selectors[1];
  input.rightsLedger[0].subject.selector = input.sourceLocks[0].selectors[0];
  input.rightsLedger[1].subject.selector = input.sourceLocks[0].selectors[1];
  return input;
}

// Scenario: A field cites an exact JSON Pointer inside a fixed source blob.
// Purpose: Prove the rendered text value equals the selected source value.
test('UnitT110_accepts_field_values_matching_json_selectors', async () => {
  await assert.doesNotReject(() => validateRecordPublication(jsonCandidate()));
});

// Scenario: A record changes its effect while the JSON source and approvals remain fixed.
// Purpose: Reject semantically unsupported text even when the source byte hash still matches.
test('UnitT120_rejects_record_value_different_from_json_source', async () => {
  const input = jsonCandidate();
  input.record.effect_zh_tw = '來源沒有的效果';
  await assert.rejects(() => validateRecordPublication(input), /source value.*effect_zh_tw/i);
});

// Scenario: A JSON source uses a selector that does not resolve to an exact field.
// Purpose: Block ambiguous or missing JSON claims from receiving source credit.
test('UnitT130_rejects_missing_or_untyped_json_selector', async () => {
  const missing = jsonCandidate();
  missing.sourceLocks[0].selectors[1] = 'json:/blessings/1/effect';
  missing.record.evidence[1].source_selector = missing.sourceLocks[0].selectors[1];
  missing.rightsLedger[1].subject.selector = missing.sourceLocks[0].selectors[1];
  await assert.rejects(() => validateRecordPublication(missing), /json selector/i);
  const untyped = jsonCandidate();
  untyped.sourceLocks[0].selectors[1] = 'effect';
  untyped.record.evidence[1].source_selector = 'effect';
  untyped.rightsLedger[1].subject.selector = 'effect';
  await assert.rejects(() => validateRecordPublication(untyped), /json selector/i);
});
