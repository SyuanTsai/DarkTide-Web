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
  skill: ['/archetype', '/skill_id', '/kind', '/category', '/name_zh_tw', '/effect_zh_tw', '/mechanics_zh_tw'],
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

  const routes = ['/', '/skills/', '/skills/veteran/', '/skills/veteran/practice-guard/mechanics/',
    '/weapons/', '/blessings/', ...data.routes.map(row => row.target_route)];
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

function candidateWithNumericClaim(kind = 'weapon', state = 'known') {
  const { data, context } = candidate();
  const collection = { weapon: 'weapons', mark: 'marks', variant: 'variants' }[kind];
  const claimId = kind === 'variant' ? 'stability' : 'capacity';
  const claim = { claim_id: claimId, state, value: state === 'known' ? '30' : null,
    unit: state === 'known' ? 'count' : null, unit_note: null,
    source_ref: state === 'known' ? 'fictional-source' : null };
  const row = data[collection][0];
  if (kind === 'variant') row.tier_claims = [{ tier: 1, claims: [claim] }];
  else row.claims = [claim];
  const prefix = kind === 'variant' ? '/tier_claims/0/claims/0' : '/claims/0';
  const fields = state === 'known' ? ['claim_id', 'state', 'value', 'unit'] : ['claim_id', 'state'];
  const routes = ['/', '/skills/', '/weapons/', '/blessings/', ...data.routes.map(item => item.target_route)];
  for (const field of fields) {
    const path = `${prefix}/${field}`;
    const selector = `json:/${collection}/0${path}`;
    const rightId = `right-numeric-${field}`;
    row.evidence.push({ field_path: path, source_id: 'fictional-source', source_selector: selector, rights_id: rightId });
    context.sourceLocks[0].selectors.push(selector);
    context.rightsLedger.push({ schema_version: 1, rights_id: rightId,
      subject: { kind: 'source_field', source_id: 'fictional-source', selector, asset_id: null },
      local: approved(path, routes), git: pending(), publish: approved(path, routes) });
  }
  if (kind === 'variant') {
    const path = '/tier_claims/0/tier';
    const selector = `json:/variants/0${path}`;
    row.evidence.push({ field_path: path, source_id: 'fictional-source', source_selector: selector, rights_id: 'right-numeric-tier' });
    context.sourceLocks[0].selectors.push(selector);
    context.rightsLedger.push({ schema_version: 1, rights_id: 'right-numeric-tier',
      subject: { kind: 'source_field', source_id: 'fictional-source', selector, asset_id: null },
      local: approved(path, routes), git: pending(), publish: approved(path, routes) });
  }
  context.taxonomy.numeric_claims = { [kind]: { [claimId]: {
    scope: kind, variability: 'fixed', unit: 'count', min: '0', max: '100'
  } } };
  context.fieldRequirements.numeric_claims = Object.fromEntries(
    [...fields, 'unit_note', 'tier'].map(field => [field, ['git_json']]));
  data.taxonomy_sha256 = sha(canonicalize(context.taxonomy));
  data.field_requirement_sha256 = sha(canonicalize(context.fieldRequirements));
  const raw = new TextEncoder().encode(JSON.stringify(Object.fromEntries(
    ['skills', 'weapons', 'marks', 'blessings', 'variants', 'bindings'].map(name => [name, data[name]]))));
  context.sourceBytes.set('fictional-source', raw);
  context.sourceLocks[0].sha256 = sha(raw);
  return { data, context, claim, row };
}

// Scenario: A synthetic release has complete structural, source, and page-rights evidence.
// Purpose: Prove the release entrypoint renders the three categories only after validation.
test('UnitT10_renders_approved_release_without_fixture_labels', async () => {
  const { data, context } = candidate();
  const files = await renderReleaseSite(data, context);
  assert.ok(files.has('skills/veteran/practice-guard/index.html'));
  assert.ok(files.has('skills/veteran/practice-guard/mechanics/index.html'));
  assert.ok(files.has('skills/veteran/index.html'));
  assert.ok(files.has('weapons/practice-rifle/index.html'));
  assert.ok(files.has('weapons/practice-rifle/marks/practice-rifle-m1/index.html'));
  assert.ok(files.has('blessings/steady-example/index.html'));
  assert.doesNotMatch(files.get('index.html'), /虛構示範|真實遊戲資料尚未發布|name="robots" content="noindex"/);
  assert.match(files.get('weapons/practice-rifle/index.html'), /href="\/blessings\/steady-example\/"/);
});

// Scenario: A synthetic approved release produces its generic missing-page response.
// Purpose: Keep the public 404 page navigable and excluded from search indexing.
test('UnitT15_renders_approved_release_not_found_page_with_noindex', async () => {
  const { data, context } = candidate();
  const files = await renderReleaseSite(data, context);
  const page = files.get('404.html');
  assert.match(page, /找不到頁面/);
  assert.match(page, /<meta name="robots" content="noindex">/);
  assert.match(page, /href="\/skills\/"/);
  assert.doesNotMatch(files.get('index.html'), /name="robots" content="noindex"/);
});

// Scenario: A blessing effect lacks the required source evidence.
// Purpose: Block page generation before any unreviewed public text is rendered.
test('UnitT20_rejects_missing_field_evidence_before_render', async () => {
  const { data, context } = candidate();
  data.blessings[0].evidence = data.blessings[0].evidence.filter(row => row.field_path !== '/effect_zh_tw');
  await assert.rejects(() => renderReleaseSite(data, context), /evidence.*effect_zh_tw/i);
});

// Scenario: The separate mechanics field has no source evidence.
// Purpose: Keep the new mechanics route from publishing unaudited prose.
test('UnitT22_rejects_mechanics_without_source_evidence', async () => {
  const { data, context } = candidate();
  data.skills[0].evidence = data.skills[0].evidence.filter(row => row.field_path !== '/mechanics_zh_tw');
  await assert.rejects(() => renderReleaseSite(data, context), /evidence.*mechanics_zh_tw/i);
});

// Scenario: The mechanics text is approved on the player page but not its own route.
// Purpose: Require route-specific approval for the separate mechanics page.
test('UnitT23_rejects_mechanics_without_route_approval', async () => {
  const { data, context } = candidate();
  const evidence = data.skills[0].evidence.find(row => row.field_path === '/mechanics_zh_tw');
  const right = context.rightsLedger.find(row => row.rights_id === evidence.rights_id);
  right.publish.allowed_routes = right.publish.allowed_routes.filter(route =>
    route !== '/skills/veteran/practice-guard/mechanics/');
  await assert.rejects(() => renderReleaseSite(data, context), /route/i);
});

// Scenario: The requested mechanics explanation differs from the fixed source value.
// Purpose: Reject edited prose even when an evidence selector and route right are present.
test('UnitT24_rejects_mechanics_text_not_matching_source', async () => {
  const { data, context } = candidate();
  data.skills[0].mechanics_zh_tw = '來源並沒有這段機制說明';
  await assert.rejects(() => renderReleaseSite(data, context), /source value differs.*mechanics_zh_tw/i);
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

// Scenario: A structurally valid numeric claim is added without its versioned policy and source evidence.
// Purpose: Keep unreviewed numeric values out of release pages.
test('UnitT35_rejects_numeric_claims_without_release_evidence_flow', async () => {
  const { data, context } = candidate();
  data.weapons[0].claims = [{ claim_id: 'capacity', state: 'known', value: '30',
    unit: 'count', unit_note: null, source_ref: 'fictional-source' }];
  await assert.rejects(() => renderReleaseSite(data, context), /numeric claims are unsupported/i);
});

// Scenario: A fixed weapon claim has a domain rule and exact source, field, and route approvals.
// Purpose: Publish a numeric value only after the same gate used by public text succeeds.
test('UnitT36_renders_source_matched_numeric_claim', async () => {
  const { data, context } = candidateWithNumericClaim();
  const page = (await renderReleaseSite(data, context)).get('weapons/practice-rifle/index.html');
  assert.match(page, /capacity[\s\S]*30個/);
});

// Scenario: The numeric value has no field evidence despite an otherwise approved claim.
// Purpose: Prevent a visible number from inheriting approval from unrelated fields.
test('UnitT37_rejects_numeric_value_without_its_own_evidence', async () => {
  const { data, context, row } = candidateWithNumericClaim();
  row.evidence = row.evidence.filter(item => item.field_path !== '/claims/0/value');
  await assert.rejects(() => renderReleaseSite(data, context), /numeric.*source_ref|evidence.*claims\/0\/value/i);
});

// Scenario: The value field is evidenced by one source but source_ref names another.
// Purpose: Bind a known claim's declared source to the exact evidenced value.
test('UnitT38_rejects_numeric_claim_with_wrong_source_ref', async () => {
  const { data, context, claim } = candidateWithNumericClaim();
  claim.source_ref = 'other-source';
  await assert.rejects(() => renderReleaseSite(data, context), /numeric.*source_ref/i);
});

// Scenario: A static weapon claim is labeled as an item roll or exceeds its approved domain.
// Purpose: Keep changing item values and out-of-range numbers out of a fixed weapon page.
test('UnitT39_rejects_item_roll_or_out_of_range_numeric_claim', async () => {
  const itemRoll = candidateWithNumericClaim();
  itemRoll.context.taxonomy.numeric_claims.weapon.capacity.variability = 'item_roll';
  itemRoll.data.taxonomy_sha256 = sha(canonicalize(itemRoll.context.taxonomy));
  await assert.rejects(() => renderReleaseSite(itemRoll.data, itemRoll.context), /numeric.*fixed|variability/i);

  const tooHigh = candidateWithNumericClaim();
  tooHigh.claim.value = '101';
  tooHigh.data.taxonomy_sha256 = sha(canonicalize(tooHigh.context.taxonomy));
  await assert.rejects(() => renderReleaseSite(tooHigh.data, tooHigh.context), /numeric.*range/i);
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

// Scenario: A mark name is approved on the weapon page but excluded from the mark page.
// Purpose: Require a route-specific publish decision before showing the mark's own detail page.
test('UnitT42_rejects_mark_name_without_mark_page_approval', async () => {
  const { data, context } = candidate();
  const rightId = data.marks[0].evidence.find(row => row.field_path === '/name_zh_tw').rights_id;
  const decision = context.rightsLedger.find(row => row.rights_id === rightId).publish;
  decision.allowed_routes = decision.allowed_routes.filter(route =>
    route !== '/weapons/practice-rifle/marks/practice-rifle-m1/');
  await assert.rejects(() => renderReleaseSite(data, context), /approval excludes route/i);
});

// Scenario: A mark has its own fixed claim and the taxonomy declares that mark scope.
// Purpose: Keep a mark number under its mark rather than silently promoting it to weapon scope.
test('UnitT44_renders_mark_claim_only_with_mark_scope', async () => {
  const valid = candidateWithNumericClaim('mark');
  const files = await renderReleaseSite(valid.data, valid.context);
  const page = files.get('weapons/practice-rifle/index.html');
  assert.match(page, /演示型[\s\S]*capacity[\s\S]*30個/);
  assert.match(files.get('weapons/practice-rifle/marks/practice-rifle-m1/index.html'),
    /演示型[\s\S]*capacity[\s\S]*30個/);

  const wrongScope = candidateWithNumericClaim('mark');
  wrongScope.context.taxonomy.numeric_claims.mark.capacity.scope = 'weapon';
  wrongScope.data.taxonomy_sha256 = sha(canonicalize(wrongScope.context.taxonomy));
  await assert.rejects(() => renderReleaseSite(wrongScope.data, wrongScope.context), /numeric.*fixed.*domain/i);
});

// Scenario: A variant's tier and value have separate exact source and route approvals.
// Purpose: Render tier values without inferring availability from defined tiers.
test('UnitT45_renders_approved_tier_claim_without_availability', async () => {
  const { data, context } = candidateWithNumericClaim('variant');
  const page = (await renderReleaseSite(data, context)).get('blessings/steady-example/variants/steady-example-rifle/index.html');
  assert.match(page, /可用階級：尚未確認/);
  assert.match(page, /第 1 階[\s\S]*stability[\s\S]*30個/);
});

// Scenario: A claim is explicitly unknown and only its ID and state have approved evidence.
// Purpose: Publish an honest unknown marker without requiring an invented number or unit.
test('UnitT46_renders_approved_unknown_numeric_claim', async () => {
  const { data, context } = candidateWithNumericClaim('weapon', 'unknown');
  const page = (await renderReleaseSite(data, context)).get('weapons/practice-rifle/index.html');
  assert.match(page, /capacity[\s\S]*尚未確認/);
});

// Scenario: An approved value differs from its locked JSON source byte content.
// Purpose: Ensure rights approval alone never validates a changed number.
test('UnitT47_rejects_numeric_value_different_from_source', async () => {
  const { data, context, claim } = candidateWithNumericClaim();
  claim.value = '31';
  await assert.rejects(() => renderReleaseSite(data, context), /source value differs.*claims\/0\/value/i);
});

// Scenario: An exact numeric source is present but publishing its value is still pending.
// Purpose: Require value-specific publication approval on the actual weapon page.
test('UnitT48_rejects_numeric_value_without_publish_right', async () => {
  const { data, context, row } = candidateWithNumericClaim();
  const rightId = row.evidence.find(item => item.field_path === '/claims/0/value').rights_id;
  context.rightsLedger.find(item => item.rights_id === rightId).publish = pending();
  await assert.rejects(() => renderReleaseSite(data, context), /publish.*approval/i);
});

// Scenario: A known claim requires Markdown evidence while its value only has JSON evidence.
// Purpose: Apply versioned source-kind policy to numeric fields as well as prose fields.
test('UnitT49_rejects_numeric_value_with_wrong_source_kind', async () => {
  const { data, context } = candidateWithNumericClaim();
  context.fieldRequirements.numeric_claims.value = ['git_markdown'];
  data.field_requirement_sha256 = sha(canonicalize(context.fieldRequirements));
  await assert.rejects(() => renderReleaseSite(data, context), /source kind.*claims\/0\/value/i);
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

// Scenario: Detail and catalog routes are approved, but the homepage is excluded for record names.
// Purpose: Require rights only for pages where those names are rendered.
test('UnitT65_allows_homepage_without_record_name_approval', async () => {
  const { data, context } = candidate();
  for (const [records, fields] of [
    [data.skills, ['/name_zh_tw', '/category']],
    [data.weapons, ['/name_zh_tw']],
    [data.blessings, ['/name_zh_tw']]
  ]) {
    for (const record of records) {
      for (const field of fields) {
        const evidence = record.evidence.find(row => row.field_path === field);
        const right = context.rightsLedger.find(row => row.rights_id === evidence.rights_id);
        right.publish.allowed_routes = right.publish.allowed_routes.filter(route => route !== '/');
      }
    }
  }
  await assert.doesNotReject(() => renderReleaseSite(data, context));
});

// Scenario: The archetype ID is displayed as a skill catalog link without route approval.
// Purpose: Check rights for classification text where it appears in the root catalog.
test('UnitT67_rejects_archetype_not_approved_for_skill_catalog', async () => {
  const { data, context } = candidate();
  const archetypeEvidence = data.skills[0].evidence.find(row => row.field_path === '/archetype');
  const right = context.rightsLedger.find(row => row.rights_id === archetypeEvidence.rights_id);
  right.publish.allowed_routes = right.publish.allowed_routes.filter(route => route !== '/skills/');
  await assert.rejects(() => renderReleaseSite(data, context), /route/i);
});

// Scenario: Skill name approval omits the class page where the name is listed.
// Purpose: Enforce rights for the actual class index use page.
test('UnitT70_rejects_name_not_approved_for_archetype_page', async () => {
  const { data, context } = candidate();
  const nameEvidence = data.skills[0].evidence.find(row => row.field_path === '/name_zh_tw');
  const right = context.rightsLedger.find(row => row.rights_id === nameEvidence.rights_id);
  right.publish.allowed_routes = right.publish.allowed_routes.filter(item => item !== '/skills/veteran/');
  await assert.rejects(() => renderReleaseSite(data, context), /route/i);
});

// Scenario: A skill name is approved on its class page and detail, but not on the root catalog.
// Purpose: Match rights checks to pages that actually display the skill name.
test('UnitT72_allows_skill_name_without_root_catalog_approval', async () => {
  const { data, context } = candidate();
  const nameEvidence = data.skills[0].evidence.find(row => row.field_path === '/name_zh_tw');
  const right = context.rightsLedger.find(row => row.rights_id === nameEvidence.rights_id);
  right.publish.allowed_routes = right.publish.allowed_routes.filter(item => item !== '/skills/');
  await assert.doesNotReject(() => renderReleaseSite(data, context));
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
