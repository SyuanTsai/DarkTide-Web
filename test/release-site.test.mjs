import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fixture } from '../fixtures/site.mjs';
import { canonicalize } from '../src/release/manifest.mjs';
import { createGitVerifiedReleaseDraft, createValidatedReleaseDraft } from '../src/release/build.mjs';
import { renderReleaseSite, renderSite } from '../src/site/render.mjs';

const sha = value => createHash('sha256').update(value).digest('hex');
const required = {
  skill: ['/archetype', '/skill_id', '/kind', '/category', '/name_zh_tw', '/effect_zh_tw'],
  weapon: ['/weapon_id', '/kind', '/name_zh_tw', '/mark_ids'],
  mark: ['/mark_id', '/weapon_id', '/name_zh_tw'],
  blessing: ['/blessing_id', '/name_zh_tw', '/effect_zh_tw', '/variant_ids'],
  variant: ['/variant_id', '/blessing_id', '/weapon_id', '/defined_tiers'],
  binding: ['/blessing_id', '/weapon_id', '/mark_id', '/variant_id']
};

function approved(field, routes) {
  return { status: 'approved', evidence_ref: 'synthetic-review-index', rights_holder: 'Fictional Author',
    scope: 'fictional release test', allowed_field_paths: [field], allowed_routes: routes,
    reviewer: 'fixture-reviewer', reviewed_on: '2026-10-10', reason_code: null };
}
function pending() {
  return { status: 'pending', evidence_ref: null, rights_holder: null, scope: null,
    allowed_field_paths: [], allowed_routes: [], reviewer: null, reviewed_on: null, reason_code: 'not-in-git' };
}

function candidate() {
  const data = structuredClone(fixture);
  data.package_kind = 'release';
  data.taxonomy_version = 'test-v1';
  data.field_requirement_version = 'test-v1';
  const taxonomy = { version: 'test-v1', skill_kinds: ['current-talent'], skill_categories: ['示範分類'], weapon_kinds: ['ranged'] };
  const fieldRequirements = { version: 'test-v1', fields: required,
    source_kinds: Object.fromEntries(Object.entries(required).map(([kind, fields]) =>
      [kind, Object.fromEntries(fields.map(field => [field, ['git_json']]))])) };
  data.taxonomy_sha256 = sha(canonicalize(taxonomy));
  data.field_requirement_sha256 = sha(canonicalize(fieldRequirements));

  const routes = ['/', '/skills/', '/weapons/', '/blessings/', ...data.routes.map(row => row.target_route)];
  const rightsLedger = [];
  const selectors = [];
  let number = 0;
  for (const [kind, collection, rows] of [
    ['skill', 'skills', data.skills], ['weapon', 'weapons', data.weapons], ['mark', 'marks', data.marks],
    ['blessing', 'blessings', data.blessings], ['variant', 'variants', data.variants], ['binding', 'bindings', data.bindings]
  ]) {
    for (const [rowIndex, row] of rows.entries()) {
      row.schema_version ??= 1;
      row.evidence = [];
      row.asset_ids ??= [];
      for (const field of required[kind]) {
        const selector = `json:/${collection}/${rowIndex}${field}`;
        const rightId = `right-${number++}`;
        selectors.push(selector);
        row.evidence.push({ field_path: field, source_id: 'fictional-source', source_selector: selector, rights_id: rightId });
        rightsLedger.push({ schema_version: 1, rights_id: rightId,
          subject: { kind: 'source_field', source_id: 'fictional-source', selector, asset_id: null },
          local: approved(field, routes), git: pending(), publish: approved(field, routes) });
      }
    }
  }
  const raw = new TextEncoder().encode(JSON.stringify(Object.fromEntries(
    ['skills', 'weapons', 'marks', 'blessings', 'variants', 'bindings'].map(name => [name, data[name]]))));
  const sourceLocks = [{ schema_version: 1, source_id: 'fictional-source', kind: 'git_file',
    repository_url: 'https://example.test/fictional.git', commit_sha: 'a'.repeat(40),
    release: null, steam_build_id: null, build_association: 'unknown', build_evidence_id: null,
    tool_commit_sha: null, path: 'docs/fictional.json', source_url: null, sha256: sha(raw),
    selectors, batch_id: 'fixture-batch' }];
  return { data, context: { taxonomy, fieldRequirements, sourceLocks, rightsLedger,
    sourceBytes: new Map([['fictional-source', raw]]), requireGitApproval: false } };
}

// Scenario: A synthetic release has complete structural, source, and page-rights evidence.
// Purpose: Prove the release entrypoint renders the three categories only after validation.
test('UnitT10_renders_approved_release_without_fixture_labels', async () => {
  const { data, context } = candidate();
  const files = await renderReleaseSite(data, context);
  assert.ok(files.has('skills/veteran/practice-guard/index.html'));
  assert.ok(files.has('weapons/practice-rifle/index.html'));
  assert.ok(files.has('blessings/steady-example/index.html'));
  assert.doesNotMatch(files.get('index.html'), /虛構示範|真實遊戲資料尚未發布|name="robots" content="noindex"/);
  assert.match(files.get('weapons/practice-rifle/index.html'), /href="\/blessings\/steady-example\/"/);
});

// Scenario: A blessing effect lacks the required source evidence.
// Purpose: Block page generation before any unreviewed public text is rendered.
test('UnitT20_rejects_missing_field_evidence_before_render', async () => {
  const { data, context } = candidate();
  data.blessings[0].evidence = data.blessings[0].evidence.filter(row => row.field_path !== '/effect_zh_tw');
  await assert.rejects(() => renderReleaseSite(data, context), /evidence.*effect_zh_tw/i);
});

// Scenario: The versioned rule requires Markdown for one displayed effect, but only JSON supports it.
// Purpose: Reject an approved field whose source kind cannot satisfy its declared requirement.
test('UnitT25_rejects_field_with_wrong_required_source_kind', async () => {
  const { data, context } = candidate();
  context.fieldRequirements.source_kinds.blessing['/effect_zh_tw'] = ['git_markdown'];
  data.field_requirement_sha256 = sha(canonicalize(context.fieldRequirements));
  await assert.rejects(() => renderReleaseSite(data, context), /source kind.*effect_zh_tw/i);
});

// Scenario: A versioned rule lists the effect field but omits its required source-kind set.
// Purpose: Keep an incomplete field policy from weakening release validation.
test('UnitT27_rejects_missing_source_kind_rule_for_required_field', async () => {
  const { data, context } = candidate();
  delete context.fieldRequirements.source_kinds.blessing['/effect_zh_tw'];
  data.field_requirement_sha256 = sha(canonicalize(context.fieldRequirements));
  await assert.rejects(() => renderReleaseSite(data, context), /source kind.*requirement/i);
});

// Scenario: A skill name requires matching JSON and TSV evidence, with rights for both sources.
// Purpose: Admit a field only when every declared source kind independently supports its value.
test('UnitT28_accepts_matching_json_and_tsv_evidence_for_one_field', async () => {
  const { data, context } = candidate();
  const tsv = new TextEncoder().encode('id\tzh\npractice-guard\t演示防護\n');
  const source = { ...context.sourceLocks[0], source_id: 'skill-tsv',
    path: 'docs/darktide-skills/veteran.tsv', sha256: sha(tsv),
    selectors: ['tsv:row:practice-guard:zh'] };
  context.sourceLocks.push(source);
  context.sourceBytes.set('skill-tsv', tsv);
  const originalEvidence = data.skills[0].evidence.find(row => row.field_path === '/name_zh_tw');
  const originalRight = context.rightsLedger.find(row => row.rights_id === originalEvidence.rights_id);
  context.rightsLedger.push({ ...structuredClone(originalRight), rights_id: 'right-skill-name-tsv',
    subject: { kind: 'source_field', source_id: 'skill-tsv',
      selector: 'tsv:row:practice-guard:zh', asset_id: null } });
  data.skills[0].evidence.push({ field_path: '/name_zh_tw', source_id: 'skill-tsv',
    source_selector: 'tsv:row:practice-guard:zh', rights_id: 'right-skill-name-tsv' });
  context.fieldRequirements.source_kinds.skill['/name_zh_tw'] = ['git_json', 'git_tsv'];
  data.field_requirement_sha256 = sha(canonicalize(context.fieldRequirements));
  await assert.doesNotReject(() => renderReleaseSite(data, context));
});

// Scenario: The release package names a taxonomy hash different from the supplied version.
// Purpose: Stop a changed classification or requirement file from silently changing output.
test('UnitT30_rejects_taxonomy_hash_drift', async () => {
  const { data, context } = candidate();
  data.taxonomy_sha256 = '0'.repeat(64);
  await assert.rejects(() => renderReleaseSite(data, context), /taxonomy.*hash/i);
});

// Scenario: A structurally valid numeric claim is added to an otherwise approved synthetic release.
// Purpose: Keep claim publication closed until per-claim source and page rights are wired into the release gate.
test('UnitT35_rejects_numeric_claims_without_release_evidence_flow', async () => {
  const { data, context } = candidate();
  data.weapons[0].claims = [{ claim_id: 'capacity', state: 'known', value: '30',
    unit: 'count', unit_note: null, source_ref: 'fictional-source' }];
  await assert.rejects(() => renderReleaseSite(data, context), /numeric claims are unsupported/i);
});

// Scenario: A binding is used to join weapon and blessing pages but its right is pending.
// Purpose: Keep relationship-derived links under the same publication gate as content text.
test('UnitT40_rejects_unapproved_binding_before_render', async () => {
  const { data, context } = candidate();
  const rightId = data.bindings[0].evidence[0].rights_id;
  const right = context.rightsLedger.find(row => row.rights_id === rightId);
  right.publish = pending();
  await assert.rejects(() => renderReleaseSite(data, context), /publish.*approval/i);
});

// Scenario: A caller bypasses the release entrypoint and calls the preview renderer.
// Purpose: Preserve the fixture-only boundary of the public preview API.
test('UnitT50_rejects_direct_release_render_without_context', () => {
  const { data } = candidate();
  assert.throws(() => renderSite(data), /release.*unsupported/i);
});

function candidateWithIcon() {
  const { data, context } = candidate();
  const bytes = new Uint8Array([1, 2, 3]);
  const sourceUrl = 'https://darktide.gameslantern.com/storage/sites/darktide/exporter/talents/fictional.webp';
  const skillRoute = '/skills/veteran/practice-guard/';
  data.skills[0].asset_ids = ['sample-icon'];
  data.assets = [{ schema_version: 1, asset_id: 'sample-icon', source_id: 'icon-source',
    source_url: sourceUrl, source_sha256: sha(bytes), rights_id: 'right-icon',
    delivery_path: 'assets/sample.webp', rehost_allowed: true, routes: [skillRoute],
    attribution: { text: 'Icons obtained with permission from darktide.gameslantern.com', href: 'https://darktide.gameslantern.com/', follow_required: true } }];
  context.sourceLocks.push({ schema_version: 1, source_id: 'icon-source', kind: 'external_asset',
    repository_url: null, commit_sha: null, release: null, steam_build_id: null,
    build_association: 'unknown', build_evidence_id: null, tool_commit_sha: null,
    path: null, source_url: sourceUrl, sha256: sha(bytes), selectors: ['asset'], batch_id: 'fixture-batch' });
  context.sourceBytes.set('icon-source', bytes);
  context.rightsLedger.push({ schema_version: 1, rights_id: 'right-icon',
    subject: { kind: 'asset', source_id: 'icon-source', selector: null, asset_id: 'sample-icon' },
    local: approved('/asset_ids', [skillRoute]), git: pending(), publish: approved('/asset_ids', [skillRoute]) });
  return { data, context, bytes };
}

// Scenario: A covered talent icon is approved for its detail page and supplied as raw bytes.
// Purpose: Put both the image and its visible direct credit into the same release output.
test('UnitT60_renders_approved_icon_and_copies_its_exact_bytes', async () => {
  const { data, context, bytes } = candidateWithIcon();
  const files = await renderReleaseSite(data, context);
  assert.deepEqual(files.get('assets/sample.webp'), bytes);
  const page = files.get('skills/veteran/practice-guard/index.html');
  assert.match(page, /src="\/assets\/sample.webp"/);
  assert.match(page, /href="https:\/\/darktide\.gameslantern\.com\/"/);
  assert.doesNotMatch(page, /nofollow|sponsored|ugc/);
});

// Scenario: Skill name approval omits the homepage where that name is listed.
// Purpose: Enforce each actual use page, including navigation and index pages.
test('UnitT70_rejects_name_not_approved_for_homepage', async () => {
  const { data, context } = candidate();
  const nameEvidence = data.skills[0].evidence.find(row => row.field_path === '/name_zh_tw');
  const right = context.rightsLedger.find(row => row.rights_id === nameEvidence.rights_id);
  right.publish.allowed_routes = right.publish.allowed_routes.filter(item => item !== '/');
  await assert.rejects(() => renderReleaseSite(data, context), /route/i);
});

// Scenario: The caller edits the content object while asynchronous source checks run.
// Purpose: Render the exact validated snapshot instead of later unreviewed mutations.
test('UnitT80_renders_the_snapshot_validated_before_async_work', async () => {
  const { data, context } = candidate();
  const rendering = renderReleaseSite(data, context);
  data.skills[0].effect_zh_tw = '驗證後才加入的文字';
  const files = await rendering;
  const page = files.get('skills/veteran/practice-guard/index.html');
  assert.match(page, /這是一段虛構技能效果/);
  assert.doesNotMatch(page, /驗證後才加入的文字/);
});

// Scenario: Two used icons claim the same output path.
// Purpose: Reject a release that would silently overwrite one approved asset.
test('UnitT90_rejects_duplicate_asset_delivery_paths', async () => {
  const { data, context } = candidateWithIcon();
  const second = { ...data.assets[0], asset_id: 'another-icon', rights_id: 'right-another' };
  data.assets.push(second);
  data.skills[0].asset_ids.push(second.asset_id);
  context.rightsLedger.push({ schema_version: 1, rights_id: second.rights_id,
    subject: { kind: 'asset', source_id: 'icon-source', selector: null, asset_id: second.asset_id },
    local: approved('/asset_ids', second.routes), git: pending(), publish: approved('/asset_ids', second.routes) });
  await assert.rejects(() => renderReleaseSite(data, context), /duplicate.*asset.*path/i);
});

// Scenario: An approved synthetic candidate is rendered with its icon into an output draft.
// Purpose: Bind the manifest to validated page bytes and only the evidence those pages use.
test('UnitT100_builds_draft_from_validated_release_pages', async () => {
  const { data, context, bytes } = candidateWithIcon();
  context.sourceLocks.push({ ...context.sourceLocks[0], source_id: 'unused-source' });
  const { files, manifest } = await createValidatedReleaseDraft(data, context, {
    workerBytes: new TextEncoder().encode('export default {};'), toolCommitSha: 'd'.repeat(40)
  });
  assert.deepEqual(files.get('assets/sample.webp'), bytes);
  assert.deepEqual(manifest.source_lock_ids, ['fictional-source', 'icon-source']);
  assert.equal(manifest.files.find(file => file.path === 'assets/sample.webp').sha256, sha(bytes));
  assert.equal(manifest.validation.complete, false);
});

// Scenario: An unapproved blessing field reaches the output draft entrypoint.
// Purpose: Refuse to generate even a draft from content that failed page publication checks.
test('UnitT110_rejects_unapproved_content_before_draft_creation', async () => {
  const { data, context } = candidate();
  const rightId = data.blessings[0].evidence.find(row => row.field_path === '/effect_zh_tw').rights_id;
  context.rightsLedger.find(row => row.rights_id === rightId).publish = pending();
  await assert.rejects(() => createValidatedReleaseDraft(data, context, {
    workerBytes: new TextEncoder().encode('export default {};'), toolCommitSha: 'd'.repeat(40)
  }), /publish.*approval/i);
});

// Scenario: A candidate supplies stale in-memory source bytes alongside a fixed local Git source.
// Purpose: Build pages from the locked Git blob instead of trusting the caller's byte map.
test('InterT120_builds_candidate_using_verified_git_blob_bytes', async () => {
  const checkout = dirname(dirname(fileURLToPath(import.meta.url)));
  const git = (...args) => execFileSync('git', ['-C', checkout, ...args], { encoding: 'utf8' }).trim();
  const origin = git('config', '--get', 'remote.origin.url');
  const remote = origin.startsWith('git@github.com:')
    ? `https://github.com/${origin.slice('git@github.com:'.length)}` : origin;
  const commit = git('rev-parse', 'HEAD');
  const path = 'test/fixtures/release-source.json';
  const blob = execFileSync('git', ['-C', checkout, 'cat-file', 'blob', `${commit}:${path}`]);
  const { data, context } = candidate();
  Object.assign(context.sourceLocks[0], { repository_url: remote, commit_sha: commit,
    path, sha256: sha(blob) });
  context.sourceBytes.set('fictional-source', new Uint8Array([9, 9, 9]));
  const { manifest } = await createGitVerifiedReleaseDraft(data, context, {
    gitCheckouts: new Map([[remote, checkout]]),
    workerBytes: new TextEncoder().encode('export default {};'), toolCommitSha: 'd'.repeat(40)
  });
  assert.deepEqual(manifest.source_lock_ids, ['fictional-source']);
  assert.equal(manifest.validation.complete, false);
});
