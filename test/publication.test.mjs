import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { validateRecordPublication } from '../src/content/publication.mjs';

const route = '/skills/veteran/practice-guard/';
const raw = new TextEncoder().encode(JSON.stringify({ name_zh_tw: '虛構防護', effect_zh_tw: '虛構效果。' }));
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
        { field_path: '/name_zh_tw', source_id: 'fictional-source', source_selector: 'json:/name_zh_tw', rights_id: 'right-name' },
        { field_path: '/effect_zh_tw', source_id: 'fictional-source', source_selector: 'json:/effect_zh_tw', rights_id: 'right-effect' }
      ],
      asset_ids: []
    },
    requiredFieldPaths: ['/name_zh_tw', '/effect_zh_tw'],
    sourceLocks: [{
      schema_version: 1, source_id: 'fictional-source', kind: 'git_file',
      repository_url: 'https://example.test/fictional.git', commit_sha: 'a'.repeat(40),
      release: null, steam_build_id: null, build_association: 'unknown', build_evidence_id: null,
      tool_commit_sha: null, path: 'docs/sample.json', source_url: null,
      sha256: sha(raw), selectors: ['json:/name_zh_tw', 'json:/effect_zh_tw'], batch_id: 'fixture-batch'
    }],
    rightsLedger: [
      { schema_version: 1, rights_id: 'right-name', subject: { kind: 'source_field', source_id: 'fictional-source', selector: 'json:/name_zh_tw', asset_id: null }, local: approval('/name_zh_tw'), git: pending(), publish: approval('/name_zh_tw') },
      { schema_version: 1, rights_id: 'right-effect', subject: { kind: 'source_field', source_id: 'fictional-source', selector: 'json:/effect_zh_tw', asset_id: null }, local: approval('/effect_zh_tw'), git: pending(), publish: approval('/effect_zh_tw') }
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
  input.sourceLocks[0].path = 'Game Info/docs/sample.json';
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
  input.rightsLedger[1].subject.selector = 'json:/name_zh_tw';
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

function markdownCandidate() {
  const input = candidate();
  input.record.name_zh_tw = '演示防護';
  input.record.effect_zh_tw = '效果：這是一段虛構技能效果，僅用於版面測試。';
  const markdown = [
    '# 虛構職業', '', '<a id="practice-guard"></a>', '',
    '### 演示防護(Practice Guard)', '',
    '<img src="https://example.test/fictional.webp" alt="虛構圖示">', '',
    '- **效果**：這是一段虛構技能效果，僅用於版面測試。', '',
    '[詳細資料](practice-guard.md) · [返回目錄](#talent-index)', '', '---', ''
  ].join('\n');
  const rawMarkdown = new TextEncoder().encode(markdown);
  input.sourceLocks[0].path = 'Game Info/skills/README.md';
  input.sourceLocks[0].sha256 = sha(rawMarkdown);
  input.sourceLocks[0].selectors = [
    'md:anchor:practice-guard:title-zh', 'md:anchor:practice-guard:body-text'
  ];
  input.sourceBytes.set('fictional-source', rawMarkdown);
  for (let index = 0; index < 2; index++) {
    input.record.evidence[index].source_selector = input.sourceLocks[0].selectors[index];
    input.rightsLedger[index].subject.selector = input.sourceLocks[0].selectors[index];
  }
  return input;
}

// Scenario: A synthetic Markdown page has an exact skill anchor, title, and bullet effect.
// Purpose: Match candidate skill text to a deterministic section of the hashed source.
test('UnitT140_accepts_values_selected_from_markdown_skill_section', async () => {
  await assert.doesNotReject(() => validateRecordPublication(markdownCandidate()));
});

// Scenario: A skill effect differs while its Markdown source and rights remain fixed.
// Purpose: Reject a field whose cited Markdown section does not support its value.
test('UnitT150_rejects_effect_different_from_markdown_section', async () => {
  const input = markdownCandidate();
  input.record.effect_zh_tw = '來源沒有的效果';
  await assert.rejects(() => validateRecordPublication(input), /source value.*effect_zh_tw/i);
});

// Scenario: The fixed Markdown source repeats the same skill anchor.
// Purpose: Fail on ambiguous section identity instead of choosing the first match.
test('UnitT160_rejects_ambiguous_markdown_anchor', async () => {
  const input = markdownCandidate();
  const rawMarkdown = input.sourceBytes.get('fictional-source');
  const duplicate = new TextEncoder().encode(`${new TextDecoder().decode(rawMarkdown)}\n<a id="practice-guard"></a>`);
  input.sourceBytes.set('fictional-source', duplicate);
  input.sourceLocks[0].sha256 = sha(duplicate);
  await assert.rejects(() => validateRecordPublication(input), /markdown anchor.*ambiguous/i);
});

// Scenario: A skill section adds a clearly labeled translation erratum after its effect bullets.
// Purpose: Keep the published effect scoped to the primary bullets without silently mixing in editorial notes.
test('UnitT170_excludes_labeled_erratum_from_markdown_effect', async () => {
  const input = markdownCandidate();
  const text = new TextDecoder().decode(input.sourceBytes.get('fictional-source'));
  const changed = text.replace('[詳細資料](practice-guard.md)',
    '#### 繁中原文勘誤\n\n- 此行是勘誤註記。\n\n[詳細資料](practice-guard.md)');
  const bytes = new TextEncoder().encode(changed);
  input.sourceBytes.set('fictional-source', bytes);
  input.sourceLocks[0].sha256 = sha(bytes);
  await assert.doesNotReject(() => validateRecordPublication(input));
});

// Scenario: A skill's worked example follows the primary effect under a level-four heading.
// Purpose: Keep the effect selector focused on the preceding bullets across section variants.
test('UnitT180_stops_markdown_effect_before_secondary_subsection', async () => {
  const input = markdownCandidate();
  const text = new TextDecoder().decode(input.sourceBytes.get('fictional-source'));
  const changed = text.replace('[詳細資料](practice-guard.md)',
    '#### 算例條件\n\n- 此行是範例，不是主要效果。\n\n[詳細資料](practice-guard.md)');
  const bytes = new TextEncoder().encode(changed);
  input.sourceBytes.set('fictional-source', bytes);
  input.sourceLocks[0].sha256 = sha(bytes);
  await assert.doesNotReject(() => validateRecordPublication(input));
});

function baseEffectCandidate() {
  const input = markdownCandidate();
  input.record.name_zh_tw = '演示防護：基礎效果';
  const markdown = [
    '# 虛構基礎效果', '', '## 演示防護(Practice Guard)：基礎效果', '',
    '- **效果**：這是一段虛構技能效果，僅用於版面測試。', '',
    '[原始碼依據與算例條件](practice-guard.md)', '', '---', ''
  ].join('\n');
  const bytes = new TextEncoder().encode(markdown);
  input.sourceLocks[0].path = 'Game Info/skills/BASE_EFFECTS.md';
  input.sourceLocks[0].sha256 = sha(bytes);
  input.sourceLocks[0].selectors = [
    'md:detail:practice-guard:title-zh', 'md:detail:practice-guard:body-text'
  ];
  input.sourceBytes.set('fictional-source', bytes);
  for (let index = 0; index < 2; index++) {
    input.record.evidence[index].source_selector = input.sourceLocks[0].selectors[index];
    input.rightsLedger[index].subject.selector = input.sourceLocks[0].selectors[index];
  }
  return input;
}

// Scenario: A base-effect section has no HTML anchor but links to one fixed detail file.
// Purpose: Select its heading and primary bullets using a unique, source-local detail link.
test('UnitT190_accepts_base_effect_section_selected_by_detail_link', async () => {
  await assert.doesNotReject(() => validateRecordPublication(baseEffectCandidate()));
});

// Scenario: Two base-effect sections cite the same detail file.
// Purpose: Reject ambiguous detail selectors instead of attributing the wrong source section.
test('UnitT200_rejects_ambiguous_base_effect_detail_link', async () => {
  const input = baseEffectCandidate();
  const text = new TextDecoder().decode(input.sourceBytes.get('fictional-source'));
  const bytes = new TextEncoder().encode(`${text}\n## 第二個效果\n\n[原始碼依據與算例條件](practice-guard.md)\n`);
  input.sourceBytes.set('fictional-source', bytes);
  input.sourceLocks[0].sha256 = sha(bytes);
  await assert.rejects(() => validateRecordPublication(input), /Markdown detail.*ambiguous/i);
});

// Scenario: A base effect bullet links to a nearby recipe section.
// Purpose: Preserve the visible link label in plain effect text without copying the link target into the field.
test('UnitT210_resolves_safe_local_link_label_in_markdown_bullet', async () => {
  const input = baseEffectCandidate();
  const text = new TextDecoder().decode(input.sourceBytes.get('fictional-source'));
  const changed = text.replace('這是一段虛構技能效果，僅用於版面測試。',
    '可查看[虛構配方](README.md#practice-recipe)。');
  const bytes = new TextEncoder().encode(changed);
  input.sourceBytes.set('fictional-source', bytes);
  input.sourceLocks[0].sha256 = sha(bytes);
  input.record.effect_zh_tw = '效果：可查看虛構配方。';
  await assert.doesNotReject(() => validateRecordPublication(input));
});

// Scenario: A locked Markdown source lists an arbitrary selector with approved rights.
// Purpose: Require a supported selector that proves the public field equals source text.
test('UnitT220_rejects_unverified_markdown_selector_even_with_approval', async () => {
  const input = markdownCandidate();
  input.sourceLocks[0].selectors[1] = 'untyped-effect';
  input.record.evidence[1].source_selector = 'untyped-effect';
  input.rightsLedger[1].subject.selector = 'untyped-effect';
  await assert.rejects(() => validateRecordPublication(input), /unsupported.*selector/i);
});

// Scenario: A text field cites a byte-exact external asset as its supposed source.
// Purpose: Keep image rights and byte hashes from substituting for text field provenance.
test('UnitT230_rejects_external_asset_as_field_source', async () => {
  const input = candidate();
  Object.assign(input.sourceLocks[0], { kind: 'external_asset', path: null,
    repository_url: null, commit_sha: null, source_url: 'https://example.test/fictional.webp' });
  await assert.rejects(() => validateRecordPublication(input), /unsupported.*field source/i);
});
