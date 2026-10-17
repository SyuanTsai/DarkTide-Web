import { execFileSync } from 'node:child_process';
import { lstat, mkdir, readFile, readdir, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  assertChildPath,
  assertExactKeys,
  assertPlainObject,
  compareUtf8,
  hashNamedFiles,
  jsonBytes,
  parseJson,
  safeRelativePath,
  sha256
} from '../src/static/common.mjs';
import { previewAssets } from './w01-preview-assets.mjs';

const SCRIPT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SOURCE_REPOSITORY = 'https://github.com/SyuanTsai/DarkTide-Source-Data';
const UPSTREAM_GAME_SOURCE_REPOSITORY = 'https://github.com/Aussiemon/Darktide-Source-Code';
const FIXED_LEGACY_ANALYSIS_REFERENCE = {
  sourceId: 'legacy:mods:psyker:brain-burst-improved:analysis-en',
  repository: 'https://github.com/SyuanTsai/Warhammer-40-000-DARKTIDE-Mods',
  commit: '241ad76ce62330472aa423055a5b85db59bb6c0d',
  path: 'Game Info/releases/1.13.X/skills/talents/Psyker/en/psyker_brain_burst_improved.md'
};
const SOURCE_ARTIFACTS = ['technical.json', 'game-changes.json'];
const DOMAIN_KINDS = ['skills', 'blessings', 'weapons', 'terms', 'game-changes'];
const DOMAIN_DEPENDENCIES = {
  skills: ['terms'],
  blessings: ['weapons', 'terms'],
  weapons: ['terms'],
  terms: [],
  'game-changes': ['skills']
};
const SOURCE_KIND_DOMAIN = {
  skill: 'skills',
  claim: 'skills',
  evidence: 'skills',
  blessing: 'blessings',
  'blessing-variant': 'blessings',
  weapon: 'weapons',
  'stat-definition': 'weapons',
  'stat-curve': 'weapons',
  term: 'terms'
};
const SOURCE_PAYLOAD_KEYS = {
  skill: ['termRef', 'claimRefs'],
  claim: ['targetRef', 'property', 'value', 'context', 'basis', 'evidenceRefs', 'displayValue', 'displayFormat'],
  evidence: ['sourceRef', 'safeSummary'],
  blessing: ['variantRefs'],
  'blessing-variant': ['blessingRef', 'weaponRefs', 'definedTiers', 'obtainableTiers', 'tierValues'],
  weapon: ['familyId', 'markId', 'templateKey', 'statRefs', 'attackProfileRefs', 'dataCoverage', 'armorRefs', 'theoreticalInputRange', 'claimRefs', 'displayedAttacks'],
  'stat-definition': ['quantity', 'inputUnit', 'outputUnit', 'theoreticalInputRange', 'obtainableInputRange', 'curveRef', 'claimRefs'],
  'stat-curve': ['inputUnit', 'outputUnit', 'knots', 'interpolation', 'edgePolicy'],
  term: ['termKey', 'contextKey', 'technicalDefinitionEn', 'claimRefs']
};
const SOURCE_REQUIRED_PAYLOAD_KEYS = {
  ...SOURCE_PAYLOAD_KEYS,
  claim: ['targetRef', 'property', 'value', 'context', 'basis', 'evidenceRefs'],
  weapon: ['familyId', 'markId', 'templateKey', 'statRefs', 'attackProfileRefs', 'dataCoverage'],
  'stat-definition': ['quantity', 'inputUnit', 'outputUnit', 'theoreticalInputRange', 'obtainableInputRange', 'curveRef']
};
const CHAINAXE_MARKS = {
  'darktide:weapon:chainaxe:p1-m1': {
    markId: 'chainaxe_p1_m1',
    templateKey: 'chainaxe_p1_m1',
    attackModes: [
      { key: 'primary', mode: 'light', displayedType: 'smiter', targetRole: 'single-target', profile: 'default_light_chainaxe', count: 4 },
      { key: 'secondary', mode: 'heavy', displayedType: 'linesman', targetRole: 'multi-target-cleave', profile: 'heavy_chainaxe', count: 2 }
    ],
    metrics: { damage: 2, armor: 5, defence: 3, sawing: 5, mobility: 4 }
  },
  'darktide:weapon:chainaxe:p1-m2': {
    markId: 'chainaxe_p1_m2',
    templateKey: 'chainaxe_p1_m2',
    attackModes: [
      { key: 'primary', mode: 'light', displayedType: 'tank', targetRole: 'multi-target-cleave', profile: 'light_chainaxe_tank', count: 2 },
      { key: 'secondary', mode: 'heavy', displayedType: 'smiter', targetRole: 'single-target', profile: 'heavy_chainaxe_smiter', count: 2 }
    ],
    metrics: { damage: 2, armor: 6, defence: 3, sawing: 4, mobility: 4 }
  }
};
const CHAINAXE_PRESENTATION_IDS = {
  'darktide:weapon:chainaxe:p1-m1': 'web:presentation:chainaxe-p1-m1',
  'darktide:weapon:chainaxe:p1-m2': 'web:presentation:chainaxe-p1-m2'
};
const CHAINAXE_STAT_SECTIONS = [
  { sourceStat: 'chainaxe_dps_stat', label: '傷害' },
  { sourceStat: 'chainaxe_armor_pierce_stat', label: '護甲穿透' },
  { sourceStat: 'chainaxe_defence_stat', label: '防禦' },
  { sourceStat: 'chainaxe_sawing_stat', label: '鏈鋸' },
  { sourceStat: 'chainaxe_mobility_stat', label: '移動性' }
];
const CHAINAXE_STAT_FAMILIES = {
  chainaxe_dps_stat: { id: 'damage', rawUnit: 'attack-power-point', displayUnit: 'attack-power-point', displayFormat: 'fixed-2' },
  chainaxe_armor_pierce_stat: { id: 'armorPenetration', rawUnit: 'ratio', displayUnit: 'percent', displayFormat: 'percentage-fixed-2' },
  chainaxe_defence_stat: { id: 'defence' },
  chainaxe_sawing_stat: { id: 'sawing', rawUnit: 'attack-power-point', displayUnit: 'attack-power-point', displayFormat: 'fixed-2' },
  chainaxe_mobility_stat: { id: 'mobility' }
};
const CHAINAXE_DEFENCE_METRICS = {
  'weapon_stamina_templates.linesman.stamina_modifier': { profile: 'linesman', rawUnit: 'stamina-point', displayUnit: 'stamina-point', displayFormat: 'fixed-2-signed', rowLabel: '耐力' },
  'weapon_stamina_templates.linesman.sprint_cost_per_second': { profile: 'linesman', rawUnit: 'stamina-point-per-second', displayUnit: 'stamina-point-per-second', displayFormat: 'fixed-2', rowLabel: '衝刺體力消耗' },
  'weapon_stamina_templates.linesman.push_cost': { profile: 'linesman', rawUnit: 'stamina-point', displayUnit: 'stamina-point', displayFormat: 'fixed-2', rowLabel: '推擊耐力消耗' }
};
const CHAINAXE_MOBILITY_METRICS = {
  'weapon_dodge_templates.smiter_plus.distance_scale': { profile: 'smiter_plus', rawUnit: 'ratio', displayUnit: 'percent', displayFormat: 'multiplier-percent-fixed-2-signed', rowLabel: '閃避距離修正' },
  'weapon_dodge_templates.smiter_plus.diminishing_return_start': { profile: 'smiter_plus', rawUnit: 'dodge-count', displayUnit: 'dodge-count', displayFormat: 'floor-fixed-2', rowLabel: '有效閃避次數' },
  'weapon_dodge_templates.smiter_plus.speed_modifier': { profile: 'smiter_plus', rawUnit: 'ratio', displayUnit: 'percent', displayFormat: 'multiplier-percent-fixed-2-signed', rowLabel: '閃避速度修正' },
  'weapon_sprint_templates.default.sprint_speed_mod': { profile: 'default', rawUnit: 'ratio', displayUnit: 'ratio', displayFormat: 'fixed-2-signed', rowLabel: '衝刺速度修正' }
};
const CHAINAXE_SAWING_LABELS = {
  light_chainaxe_active_sticky: '輕攻擊特殊動作首段鋸擊威力',
  light_chainaxe_active_sticky_last: '輕攻擊特殊動作末段鋸擊威力',
  light_chainaxe_sticky_last_quick: '一般輕攻擊末段鋸擊威力',
  heavy_chainaxe_active_sticky: '重攻擊特殊動作首段鋸擊威力',
  heavy_chainaxe_active_sticky_last: '重攻擊特殊動作末段鋸擊威力'
};
const CHAINAXE_ARMOR_LABELS = {
  armored: '防彈護甲',
  super_armor: '甲殼護甲',
  resistant: '不屈',
  disgustingly_resilient: '被感染'
};
const CHAINAXE_ARMOR_CLASSES = new Set(['armored', 'super_armor', 'resistant', 'disgustingly_resilient']);
const CHAINAXE_ATTACK_POWER_PROPERTY = /^damage_templates\.[a-z0-9_]+\.targets\[1\]\.power_distribution\.attack$/;
const CHAINAXE_ARMOR_PROPERTY = /^damage_templates\.[a-z0-9_]+\.targets\[1\]\.armor_damage_modifier\.attack\[armor_types\.([a-z_]+)\]$/;
const RECORD_STATES = new Set(['draft', 'pending', 'approved', 'rejected', 'stale']);
const DETAIL_SECTION_KEYS = ['effects', 'conditions', 'calculation', 'notes', 'extra'];
const BLESSING_TIER_PRESENTATIONS_FEATURE = 'blessing-tier-presentations-v1';
const NATIVE_NUMERIC_PARAMETER_CONTRACTS = {
  damage: { property: 'description.format_values.damage.display_percent', format: 'signed-percent', unit: 'percent', basis: 'code-derived', entityKind: 'skill' },
  movement_speed: { property: 'description.format_values.movement_speed.defined_tier_1_display_percent', format: 'signed-percent', unit: 'percent', basis: 'code-derived', entityKind: 'blessing' },
  time: { property: 'template.buff_override.active_duration', format: 'plain-number', unit: 's', basis: 'code-observed', entityKind: 'blessing' }
};
const CHAINAXE_COMPARISON_GROUPS = {
  attack: {
    statDefinition: 'darktide:stat-definition:chainaxe-p1-m1-default-light-attack-power-table',
    weaponStat: 'chainaxe_dps_stat',
    property: 'damage_templates.default_light_chainaxe.targets[1].power_distribution.attack',
    unit: 'point',
    section: 'effects',
    itemId: 'chainaxe-attack-power-comparison',
    inputLabel: '傷害素質 ',
    valueLabel: '：輕攻擊對第一個目標的威力 ',
    valueSuffix: '',
    claims: [
      { id: 'darktide:claim:chainaxe:p1-m1-default-light-attack-power-comparison-60' },
      { id: 'darktide:claim:chainaxe:p1-m1-default-light-attack-power-comparison-80' }
    ]
  },
  armored: {
    statDefinition: 'darktide:stat-definition:chainaxe-p1-m1-default-light-armored-parameter-table',
    weaponStat: 'chainaxe_armor_pierce_stat',
    property: 'damage_templates.default_light_chainaxe.targets[1].armor_damage_modifier.attack[armor_types.armored]',
    unit: 'ratio',
    section: 'effects',
    itemId: 'chainaxe-armored-modifier-comparison',
    inputLabel: '護甲穿透素質 ',
    valueLabel: '：輕攻擊對防彈護甲的傷害倍率約 ',
    valueSuffix: ' 倍',
    claims: [
      { id: 'darktide:claim:chainaxe:p1-m1-default-light-armored-modifier-comparison-60' },
      { id: 'darktide:claim:chainaxe:p1-m1-default-light-armored-modifier-comparison-80' }
    ]
  }
};
const CHAINAXE_COMPARISON_BY_CLAIM = new Map(Object.entries(CHAINAXE_COMPARISON_GROUPS)
  .flatMap(([groupId, group]) => group.claims.map(claim => [claim.id, { ...claim, groupId, ...group }])));
const W01_RUNTIME_OUTPUT_PATHS = new Set(['_headers', 'index.html', 'preview.css', 'preview.js', 'preview.json', 'robots.txt', 'version.json']);
const CONTENT_VERSION_PATTERN = /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/;

function fail(message) {
  throw new Error(message);
}

function requireString(value, label) {
  if (typeof value !== 'string' || value.length === 0) fail(label + ' must be a non-empty string');
  return value;
}

function validateContentVersion(value) {
  if (typeof value !== 'string' || !CONTENT_VERSION_PATTERN.test(value) ||
      value.split('.').some(part => !Number.isSafeInteger(Number(part)))) {
    fail('contentVersion must be a numeric major.minor.patch version');
  }
  return value;
}

function requireBoolean(value, label) {
  if (typeof value !== 'boolean') fail(label + ' must be a boolean');
  return value;
}

function requireArray(value, label) {
  if (!Array.isArray(value)) fail(label + ' must be an array');
  return value;
}

function requireRefList(value, label) {
  requireArray(value, label);
  for (const ref of value) requireString(ref, label + ' reference');
}

function validateDecimal(value, label) {
  if (typeof value !== 'string' || !/^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?$/.test(value)) {
    fail(label + ' must preserve a decimal string');
  }
}

function validateTypedValue(value, label) {
  assertPlainObject(value, label);
  if (value.status === 'known' && 'decimal' in value) {
    const allowed = ['status', 'decimal', 'unit', 'step', 'inclusive'].filter(key => key in value);
    assertExactKeys(value, allowed, label);
    validateDecimal(value.decimal, label + '.decimal');
    requireString(value.unit, label + '.unit');
    if ('step' in value) validateDecimal(value.step, label + '.step');
    if ('inclusive' in value && typeof value.inclusive !== 'boolean') fail(label + '.inclusive must be boolean');
    return;
  }
  if (value.status === 'known' && 'min' in value && 'max' in value) {
    const allowed = ['status', 'min', 'max', 'unit', 'step', 'inclusive'].filter(key => key in value);
    assertExactKeys(value, allowed, label);
    validateDecimal(value.min, label + '.min');
    validateDecimal(value.max, label + '.max');
    requireString(value.unit, label + '.unit');
    if ('step' in value) validateDecimal(value.step, label + '.step');
    if ('inclusive' in value && typeof value.inclusive !== 'boolean') fail(label + '.inclusive must be boolean');
    return;
  }
  if (value.status === 'unknown') {
    assertExactKeys(value, ['status', 'reasonCode'], label);
    requireString(value.reasonCode, label + '.reasonCode');
    return;
  }
  if (value.status === 'not-applicable') {
    assertExactKeys(value, ['status'], label);
    return;
  }
  fail(label + ' has an unsupported typed-value shape');
}

function validateDisplayValue(raw, display, format, label) {
  validateTypedValue(raw, label + '.value');
  validateTypedValue(display, label + '.displayValue');
  if (raw.status !== 'known' || display.status !== 'known') fail(label + ' display binding requires known raw and display values');
  const rawNumber = Number(raw.decimal);
  if (!Number.isFinite(rawNumber)) fail(label + '.value.decimal must be finite');
  let expectedDecimal;
  let expectedUnit;
  switch (format) {
    case 'fixed-2':
    case 'fixed-2-signed':
      expectedDecimal = rawNumber.toFixed(2);
      expectedUnit = raw.unit;
      break;
    case 'percentage-fixed-2':
      expectedDecimal = (rawNumber * 100).toFixed(2);
      expectedUnit = 'percent';
      break;
    case 'multiplier-percent-fixed-2-signed':
      expectedDecimal = ((rawNumber - 1) * 100).toFixed(2);
      expectedUnit = 'percent';
      break;
    case 'floor-fixed-2':
      expectedDecimal = Math.floor(rawNumber).toFixed(2);
      expectedUnit = raw.unit;
      break;
    default:
      fail(label + '.displayFormat is not a supported Source UI formatter');
  }
  if (display.decimal !== expectedDecimal || display.unit !== expectedUnit) {
    fail(label + '.displayValue does not match its raw value and Source UI formatter');
  }
}

function validatePolicy(value, label) {
  assertPlainObject(value, label);
  if (value.status === 'unknown') {
    assertExactKeys(value, ['status', 'reasonCode'], label);
    requireString(value.reasonCode, label + '.reasonCode');
  } else if (value.status === 'known') {
    assertExactKeys(value, ['status', 'value'], label);
    requireString(value.value, label + '.value');
  } else {
    fail(label + ' has an unsupported policy shape');
  }
}

function validateSourcePayload(kind, payload, label) {
  assertPlainObject(payload, label);
  const allowed = SOURCE_PAYLOAD_KEYS[kind];
  const required = SOURCE_REQUIRED_PAYLOAD_KEYS[kind];
  if (Object.keys(payload).some(key => !allowed.includes(key)) || required.some(key => !Object.hasOwn(payload, key))) {
    fail(label + ' has missing or unsupported fields');
  }
  switch (kind) {
    case 'skill':
      requireString(payload.termRef, label + '.termRef');
      requireRefList(payload.claimRefs, label + '.claimRefs');
      break;
    case 'claim': {
      requireString(payload.targetRef, label + '.targetRef');
      requireString(payload.property, label + '.property');
      validateTypedValue(payload.value, label + '.value');
      assertPlainObject(payload.context, label + '.context');
      const contextKeys = ['attackMode', 'charge', 'armorClass', 'targetId', 'hitZone', 'critical', 'weakspot', 'distance', 'weaponStat', 'comparisonStat', 'profile', 'weaponRef'];
      if (Object.keys(payload.context).some(key => !contextKeys.includes(key))) fail(label + '.context has unsupported fields');
      if ('charge' in payload.context) validateTypedValue(payload.context.charge, label + '.context.charge');
      if ('distance' in payload.context) validateTypedValue(payload.context.distance, label + '.context.distance');
      if ('weaponStat' in payload.context) requireString(payload.context.weaponStat, label + '.context.weaponStat');
      if ('comparisonStat' in payload.context) {
        validateTypedValue(payload.context.comparisonStat, label + '.context.comparisonStat');
        if (payload.context.comparisonStat.status !== 'known' || payload.context.comparisonStat.unit !== 'percent') {
          fail(label + '.context.comparisonStat must be a known percent input');
        }
      }
      if (('weaponStat' in payload.context) !== ('comparisonStat' in payload.context)) {
        fail(label + '.context must provide weaponStat and comparisonStat together');
      }
      if ('profile' in payload.context) requireString(payload.context.profile, label + '.context.profile');
      if ('weaponRef' in payload.context) requireString(payload.context.weaponRef, label + '.context.weaponRef');
      if (('displayValue' in payload) !== ('displayFormat' in payload)) fail(label + ' must provide displayValue and displayFormat together');
      if ('displayValue' in payload) validateDisplayValue(payload.value, payload.displayValue, payload.displayFormat, label);
      if (!['code-observed', 'code-derived', 'game-tested', 'unknown'].includes(payload.basis)) fail(label + '.basis is unsupported');
      requireRefList(payload.evidenceRefs, label + '.evidenceRefs');
      break;
    }
    case 'evidence':
      requireString(payload.sourceRef, label + '.sourceRef');
      requireString(payload.safeSummary, label + '.safeSummary');
      break;
    case 'blessing':
      requireRefList(payload.variantRefs, label + '.variantRefs');
      break;
    case 'blessing-variant':
      requireString(payload.blessingRef, label + '.blessingRef');
      requireRefList(payload.weaponRefs, label + '.weaponRefs');
      requireArray(payload.definedTiers, label + '.definedTiers');
      if (!payload.definedTiers.length || payload.definedTiers.some(tier => !Number.isInteger(tier) || tier < 1)) fail(label + '.definedTiers must contain positive tiers');
      validateTypedValue(payload.obtainableTiers, label + '.obtainableTiers');
      requireArray(payload.tierValues, label + '.tierValues');
      if (!payload.tierValues.length) fail(label + '.tierValues must not be empty');
      for (const [index, item] of payload.tierValues.entries()) {
        assertExactKeys(item, ['tier', 'value'], label + '.tierValues[' + index + ']');
        if (!Number.isInteger(item.tier) || item.tier < 1) fail(label + '.tierValues tier must be positive');
        validateTypedValue(item.value, label + '.tierValues[' + index + '].value');
      }
      break;
    case 'weapon':
      for (const key of ['familyId', 'markId', 'templateKey']) requireString(payload[key], label + '.' + key);
      for (const key of ['statRefs', 'attackProfileRefs']) requireRefList(payload[key], label + '.' + key);
      if ('claimRefs' in payload) requireRefList(payload.claimRefs, label + '.claimRefs');
      if ('armorRefs' in payload) requireRefList(payload.armorRefs, label + '.armorRefs');
      if ('theoreticalInputRange' in payload) validateTypedValue(payload.theoreticalInputRange, label + '.theoreticalInputRange');
      assertExactKeys(payload.dataCoverage, ['status', 'missing'], label + '.dataCoverage');
      if (!['complete', 'partial', 'unknown'].includes(payload.dataCoverage.status)) fail(label + '.dataCoverage.status is unsupported');
      requireArray(payload.dataCoverage.missing, label + '.dataCoverage.missing');
      for (const [index, missing] of payload.dataCoverage.missing.entries()) {
        const keys = ['field', 'reasonCode', ...(Object.hasOwn(missing, 'sourceRef') ? ['sourceRef'] : [])];
        assertExactKeys(missing, keys, label + '.dataCoverage.missing[' + index + ']');
        requireString(missing.field, label + '.dataCoverage.missing.field');
        requireString(missing.reasonCode, label + '.dataCoverage.missing.reasonCode');
        if ('sourceRef' in missing) requireString(missing.sourceRef, label + '.dataCoverage.missing.sourceRef');
      }
      break;
    case 'stat-definition':
      for (const key of ['quantity', 'inputUnit', 'outputUnit', 'curveRef']) requireString(payload[key], label + '.' + key);
      validateTypedValue(payload.theoreticalInputRange, label + '.theoreticalInputRange');
      validateTypedValue(payload.obtainableInputRange, label + '.obtainableInputRange');
      if ('claimRefs' in payload) requireRefList(payload.claimRefs, label + '.claimRefs');
      break;
    case 'stat-curve':
      for (const key of ['inputUnit', 'outputUnit']) requireString(payload[key], label + '.' + key);
      requireArray(payload.knots, label + '.knots');
      if (!payload.knots.length) fail(label + '.knots must not be empty');
      for (const [index, knot] of payload.knots.entries()) {
        assertExactKeys(knot, ['x', 'y'], label + '.knots[' + index + ']');
        validateDecimal(knot.x, label + '.knots[' + index + '].x');
        validateDecimal(knot.y, label + '.knots[' + index + '].y');
      }
      validatePolicy(payload.interpolation, label + '.interpolation');
      validatePolicy(payload.edgePolicy, label + '.edgePolicy');
      break;
    case 'term':
      for (const key of ['termKey', 'contextKey', 'technicalDefinitionEn']) requireString(payload[key], label + '.' + key);
      requireRefList(payload.claimRefs, label + '.claimRefs');
      break;
    default:
      fail(label + ' has an unsupported source kind');
  }
}

async function readRequired(directory, name) {
  const relative = safeRelativePath(name, 'input path');
  return readFile(assertChildPath(directory, path.join(directory, ...relative.split('/')), 'input file'));
}

function verifyFilePin(sourceManifest, name, bytes, label) {
  const file = sourceManifest.files.find(entry => entry.path === name);
  if (!file) fail(label + ' is not listed in the pinned Source manifest');
  assertExactKeys(file, ['path', 'sha256', 'sizeBytes'], label + ' manifest row');
  const canonicalBytes = jsonBytes(parseJson(bytes, name));
  if (sha256(canonicalBytes) !== file.sha256 || canonicalBytes.byteLength !== file.sizeBytes) {
    fail('source artifact ' + name + ' hash or size does not match the pinned manifest');
  }
}

function validateRecordEnvelope(record, label, owner) {
  assertExactKeys(record, ['recordId', 'owner', 'kind', 'gameReleaseId', 'payload', 'sourceRefs', 'reviewState'], label);
  requireString(record.recordId, label + '.recordId');
  if (record.owner !== owner) fail(label + '.owner violates the owner contract');
  requireString(record.kind, label + '.kind');
  requireString(record.gameReleaseId, label + '.gameReleaseId');
  assertPlainObject(record.payload, label + '.payload');
  requireRefList(record.sourceRefs, label + '.sourceRefs');
  if (!RECORD_STATES.has(record.reviewState)) fail(label + '.reviewState is unsupported');
}

function validateSourceInput(lock, sourceManifest, technical, gameChanges, webAuthoring) {
  assertExactKeys(lock, ['schemaVersion', 'repository', 'commit', 'sourceRevision', 'manifestSha256', 'gameReleaseId', 'gameVersion', 'artifacts'], 'source.lock.json');
  if (lock.schemaVersion !== '1.0.0' || lock.repository !== SOURCE_REPOSITORY) fail('source.lock.json does not pin the expected Source repository contract');
  if (!/^[a-f0-9]{40}$/.test(lock.commit) || !/^[a-f0-9]{64}$/.test(lock.sourceRevision) || !/^[a-f0-9]{64}$/.test(lock.manifestSha256)) {
    fail('source.lock.json has an invalid revision or digest');
  }
  if (JSON.stringify([...lock.artifacts].sort()) !== JSON.stringify([...SOURCE_ARTIFACTS].sort())) fail('source.lock.json has an unsupported artifact set');

  assertExactKeys(sourceManifest, ['files', 'fixtureOnly', 'gameReleaseId', 'gameVersion', 'publicationEligible', 'schemaVersion', 'sourceRevision'], 'source manifest');
  if (sourceManifest.schemaVersion !== '1.0.0' || sourceManifest.sourceRevision !== lock.sourceRevision ||
      sourceManifest.gameReleaseId !== lock.gameReleaseId || sourceManifest.gameVersion !== lock.gameVersion) {
    fail('pinned Source manifest metadata does not match source.lock.json');
  }
  requireBoolean(sourceManifest.fixtureOnly, 'Source manifest fixtureOnly');
  requireBoolean(sourceManifest.publicationEligible, 'Source manifest publicationEligible');
  requireArray(sourceManifest.files, 'Source manifest files');

  assertExactKeys(technical, ['fixtureOnly', 'gameChanges', 'gameReleaseId', 'gameVersion', 'publicationEligible', 'records', 'schemaVersion', 'sourceRefs', 'sourceRevision'], 'technical.json');
  if (technical.schemaVersion !== '2.0.0' || technical.sourceRevision !== lock.sourceRevision ||
      technical.gameReleaseId !== lock.gameReleaseId || technical.gameVersion !== lock.gameVersion) {
    fail('technical.json metadata does not match the pinned Source package');
  }
  if (technical.fixtureOnly !== sourceManifest.fixtureOnly || technical.publicationEligible !== sourceManifest.publicationEligible) {
    fail('technical.json publication flags do not match the pinned Source manifest');
  }

  assertExactKeys(gameChanges, ['changes', 'fixtureOnly', 'gameReleaseId', 'publicationEligible', 'sourceRevision'], 'game-changes.json');
  if (gameChanges.sourceRevision !== lock.sourceRevision || gameChanges.gameReleaseId !== lock.gameReleaseId ||
      gameChanges.fixtureOnly !== technical.fixtureOnly || gameChanges.publicationEligible !== technical.publicationEligible) {
    fail('game-changes.json metadata does not match the pinned Source package');
  }
  if (JSON.stringify(technical.gameChanges) !== JSON.stringify(gameChanges.changes)) fail('technical.json and game-changes.json contain different change records');
  if (webAuthoring.schemaVersion !== '1.0.0' || webAuthoring.gameReleaseId !== lock.gameReleaseId) {
    fail('Web authoring input metadata does not match source.lock.json');
  }
  requireBoolean(webAuthoring.fixtureOnly, 'Web authoring fixtureOnly');
}

function validateChainaxeComparisonSource(sourceRecordById, sourceReferences) {
  const presentIds = Object.keys(CHAINAXE_MARKS).filter(recordId => sourceRecordById.has(recordId));
  if (presentIds.length === 0) return;
  if (presentIds.length !== Object.keys(CHAINAXE_MARKS).length) fail('Chainaxe preview requires both pinned Mk IV and Mk XII Source weapon records');

  const sourceReferenceIds = new Set(sourceReferences.map(reference => reference.sourceId));
  const familyCounts = new Map();
  for (const [weaponId, expected] of Object.entries(CHAINAXE_MARKS)) {
    const weapon = sourceRecordById.get(weaponId);
    if (!weapon || weapon.kind !== 'weapon' || weapon.payload.familyId !== 'chainaxe_p1' ||
        weapon.payload.markId !== expected.markId || weapon.payload.templateKey !== expected.templateKey) {
      fail('Chainaxe preview Source weapon identity does not match its pinned mark: ' + weaponId);
    }
    requireRefList(weapon.payload.claimRefs, weaponId + '.payload.claimRefs');
    if (weapon.payload.claimRefs.length !== 38 || new Set(weapon.payload.claimRefs).size !== 38) {
      fail(weaponId + '.payload.claimRefs must contain the exact 38 typed stat claims');
    }
    const displayedAttacks = weapon.payload.displayedAttacks;
    if (!Array.isArray(displayedAttacks) || displayedAttacks.length !== expected.attackModes.length) {
      fail(weaponId + '.payload.displayedAttacks must contain its two displayed attack modes');
    }
    for (const [attackIndex, attackExpected] of expected.attackModes.entries()) {
      const attack = displayedAttacks[attackIndex];
      const attackLabel = weaponId + '.payload.displayedAttacks[' + attackIndex + ']';
      assertExactKeys(attack, ['displayedType', 'evidenceRefs', 'key', 'mode', 'scope', 'segments', 'sourceRefs'], attackLabel);
      if (attack.key !== attackExpected.key || attack.mode !== attackExpected.mode || attack.scope !== 'display-summary' ||
          attack.displayedType !== attackExpected.displayedType) fail(attackLabel + ' does not match its displayed attack summary');
      requireRefList(attack.sourceRefs, attackLabel + '.sourceRefs');
      requireRefList(attack.evidenceRefs, attackLabel + '.evidenceRefs');
      if (attack.sourceRefs.length === 0 || attack.sourceRefs.some(ref => !sourceReferenceIds.has(ref))) {
        fail(attackLabel + '.sourceRefs must resolve to the pinned Source registry');
      }
      if (attack.evidenceRefs.length === 0 || attack.evidenceRefs.some(ref => sourceRecordById.get(ref)?.kind !== 'evidence')) {
        fail(attackLabel + '.evidenceRefs must resolve to Source evidence records');
      }
      if (!Array.isArray(attack.segments) || attack.segments.length !== attackExpected.count) fail(attackLabel + '.segments has the wrong displayed segment count');
      for (const [segmentIndex, segment] of attack.segments.entries()) {
        const segmentLabel = attackLabel + '.segments[' + segmentIndex + ']';
        assertExactKeys(segment, ['attackType', 'index', 'roleProfileKey', 'targetRole'], segmentLabel);
        if (segment.index !== segmentIndex + 1 || segment.attackType !== attackExpected.displayedType ||
            segment.roleProfileKey !== attackExpected.profile || segment.targetRole !== attackExpected.targetRole) {
          fail(segmentLabel + ' does not match the pinned per-segment displayed role');
        }
      }
    }

    const groups = new Map();
    for (const claimRef of weapon.payload.claimRefs) {
      const claim = sourceRecordById.get(claimRef);
      if (!claim || claim.kind !== 'claim') fail(weaponId + '.payload.claimRefs has an unresolved stat claim ' + claimRef);
      const payload = claim.payload;
      const context = payload.context;
      const family = CHAINAXE_STAT_FAMILIES[context.weaponStat];
      if (!family || payload.basis !== 'code-derived' || context.weaponRef !== weaponId ||
          !context.profile || !['light', 'heavy', undefined].includes(context.attackMode) ||
          !context.comparisonStat || context.comparisonStat.status !== 'known' ||
          !['60', '80'].includes(context.comparisonStat.decimal) || context.comparisonStat.unit !== 'percent' ||
          payload.evidenceRefs.length === 0) {
        fail(weaponId + ' has a claim outside the typed 60/80 weapon-stat contract: ' + claimRef);
      }
      if (payload.targetRef !== weaponId) {
        const stat = sourceRecordById.get(payload.targetRef);
        if (!stat || stat.kind !== 'stat-definition' || !weapon.payload.statRefs.includes(stat.recordId) ||
            !stat.payload.claimRefs.includes(claimRef) || stat.payload.obtainableInputRange?.status !== 'unknown') {
          fail(weaponId + ' has a claim detached from its Source weapon or stat definition: ' + claimRef);
        }
      }
      let metric;
      switch (family.id) {
        case 'damage':
        case 'armorPenetration': {
          const attackMode = context.attackMode;
          const attack = expected.attackModes.find(item => item.mode === attackMode);
          if (!attack || context.profile !== attack.profile) fail(claimRef + ' profile is not linked to its displayed attack mode');
          if (family.id === 'damage') {
            if (!CHAINAXE_ATTACK_POWER_PROPERTY.test(payload.property) || payload.value.unit !== family.rawUnit ||
                payload.displayValue?.unit !== family.displayUnit || payload.displayFormat !== family.displayFormat) {
              fail(claimRef + ' has an invalid attack-power display contract');
            }
            metric = 'damage';
          } else {
            const armorMatch = payload.property.match(CHAINAXE_ARMOR_PROPERTY);
            const armorClass = context.armorClass;
            if (!armorMatch || armorMatch[1] !== armorClass || !CHAINAXE_ARMOR_CLASSES.has(armorClass) ||
                payload.value.unit !== family.rawUnit || payload.displayValue?.unit !== family.displayUnit ||
                payload.displayFormat !== family.displayFormat) {
              fail(claimRef + ' has an invalid armor-penetration display contract');
            }
            metric = 'armor';
          }
          break;
        }
        case 'defence':
          metric = CHAINAXE_DEFENCE_METRICS[payload.property] ? 'defence' : null;
          if (!metric || context.profile !== CHAINAXE_DEFENCE_METRICS[payload.property].profile ||
              payload.value.unit !== CHAINAXE_DEFENCE_METRICS[payload.property].rawUnit ||
              payload.displayValue?.unit !== CHAINAXE_DEFENCE_METRICS[payload.property].displayUnit ||
              payload.displayFormat !== CHAINAXE_DEFENCE_METRICS[payload.property].displayFormat) {
            fail(claimRef + ' has an invalid defence display contract');
          }
          break;
        case 'sawing':
          metric = CHAINAXE_SAWING_LABELS[context.profile] ? 'sawing' : null;
          if (!metric || !payload.property.startsWith('base_stats.chainaxe_sawing_stat.damage.') ||
              !payload.property.endsWith('.targets[1].power_distribution.attack') ||
              payload.value.unit !== family.rawUnit || payload.displayValue?.unit !== family.displayUnit ||
              payload.displayFormat !== family.displayFormat || !context.attackMode) {
            fail(claimRef + ' has an invalid sawing display contract');
          }
          break;
        case 'mobility':
          metric = CHAINAXE_MOBILITY_METRICS[payload.property] ? 'mobility' : null;
          if (!metric || context.profile !== CHAINAXE_MOBILITY_METRICS[payload.property].profile ||
              payload.value.unit !== CHAINAXE_MOBILITY_METRICS[payload.property].rawUnit ||
              payload.displayValue?.unit !== CHAINAXE_MOBILITY_METRICS[payload.property].displayUnit ||
              payload.displayFormat !== CHAINAXE_MOBILITY_METRICS[payload.property].displayFormat) {
            fail(claimRef + ' has an invalid mobility display contract');
          }
          break;
        default:
          fail(claimRef + ' uses an unsupported Chainaxe stat family');
      }
      const metricKey = [context.weaponStat, payload.property, context.attackMode ?? '', context.profile, context.armorClass ?? '', payload.targetRef].join('|');
      const group = groups.get(metricKey) ?? { familyId: family.id, claims: new Map() };
      if (group.claims.has(context.comparisonStat.decimal)) fail(weaponId + ' has a duplicate 60/80 claim for ' + metricKey);
      group.claims.set(context.comparisonStat.decimal, claim);
      groups.set(metricKey, group);
      familyCounts.set(weaponId + '|' + family.id, (familyCounts.get(weaponId + '|' + family.id) ?? 0) + 1);
    }
    if (groups.size !== 19) fail(weaponId + ' must provide 19 paired metrics across all five stat families');
    const expectedCounts = { damage: 2, armorPenetration: expected.metrics.armor, defence: 3, sawing: expected.metrics.sawing, mobility: 4 };
    for (const [metricKey, group] of groups) {
      if (group.claims.size !== 2 || !group.claims.has('60') || !group.claims.has('80')) fail('Chainaxe metric is missing its 60/80 pair: ' + metricKey);
    }
    for (const [familyId, count] of Object.entries(expectedCounts)) {
      if (familyCounts.get(weaponId + '|' + familyId) !== count * 2) fail(weaponId + ' has incomplete ' + familyId + ' metric coverage');
    }
  }
}

function compileChainaxeWeaponView(config, label, presentation, sourceRecordById) {
  assertExactKeys(config, ['markLabel', 'attackHeading', 'comparisonHeading', 'note', 'statSections'], label);
  for (const key of ['markLabel', 'attackHeading', 'comparisonHeading', 'note']) requireString(config[key], label + '.' + key);
  const expectedMark = CHAINAXE_MARKS[presentation.entityRef]?.markId === 'chainaxe_p1_m1' ? 'Mk IV' :
    CHAINAXE_MARKS[presentation.entityRef]?.markId === 'chainaxe_p1_m2' ? 'Mk XII' : null;
  const expectedConfig = {
    markLabel: expectedMark,
    attackHeading: '遊戲顯示的攻擊段定位',
    comparisonHeading: '素質比較點（60% → 80%）',
    note: '60% 與 80% 是比較點，不代表掉落上下限；攻擊威力和鋸擊威力不等於實際扣血。',
    statSections: CHAINAXE_STAT_SECTIONS
  };
  if (!expectedMark || JSON.stringify(config) !== JSON.stringify(expectedConfig)) {
    fail(label + ' does not match the fixed player-facing Chainaxe copy contract');
  }
  requireArray(config.statSections, label + '.statSections');
  for (const [index, section] of config.statSections.entries()) {
    assertExactKeys(section, ['sourceStat', 'label'], label + '.statSections[' + index + ']');
    requireString(section.sourceStat, label + '.statSections[' + index + '].sourceStat');
    requireString(section.label, label + '.statSections[' + index + '].label');
  }
  const expectedOrder = CHAINAXE_STAT_SECTIONS.map(section => section.sourceStat);
  if (JSON.stringify(config.statSections.map(section => section.sourceStat)) !== JSON.stringify(expectedOrder)) {
    fail(label + '.statSections must present all five weapon stat families in the fixed player order');
  }
  const weapon = sourceRecordById.get(presentation.entityRef);
  if (!weapon || weapon.kind !== 'weapon') fail(label + ' needs its matching Source weapon');
  const groups = new Map();
  for (const claimRef of weapon.payload.claimRefs) {
    const claim = sourceRecordById.get(claimRef);
    const family = CHAINAXE_STAT_FAMILIES[claim?.payload?.context?.weaponStat];
    const context = claim?.payload?.context;
    const metricKey = [claim.payload.context.weaponStat, claim.payload.property, context.attackMode ?? '', context.profile, context.armorClass ?? '', claim.payload.targetRef].join('|');
    const group = groups.get(metricKey) ?? { claims: [], familyId: family.id, first: claim };
    group.claims.push(claim);
    groups.set(metricKey, group);
  }
  const attackModes = weapon.payload.displayedAttacks.map(attack => ({
    mode: attack.mode,
    segments: attack.segments.map(segment => ({ index: segment.index, targetRole: segment.targetRole }))
  }));
  const statSections = config.statSections.map(section => {
    const familyId = CHAINAXE_STAT_FAMILIES[section.sourceStat].id;
    const rows = [];
    for (const group of groups.values()) {
      if (group.familyId !== familyId) continue;
      const sample = group.first;
      const context = sample.payload.context;
      let rowLabel = null;
      if (familyId === 'damage') rowLabel = (context.attackMode === 'light' ? '輕攻擊' : '重攻擊') + '第一個目標攻擊威力';
      if (familyId === 'armorPenetration') {
        const armorLabel = CHAINAXE_ARMOR_LABELS[context.armorClass];
        if (!armorLabel) fail(label + ' has no player-facing armor label for Source metric ' + sample.recordId);
        rowLabel = (context.attackMode === 'light' ? '輕攻擊' : '重攻擊') + '對' + armorLabel + '的敵人傷害倍率';
      }
      if (familyId === 'defence') rowLabel = CHAINAXE_DEFENCE_METRICS[sample.payload.property].rowLabel;
      if (familyId === 'sawing') rowLabel = CHAINAXE_SAWING_LABELS[context.profile];
      if (familyId === 'mobility') rowLabel = CHAINAXE_MOBILITY_METRICS[sample.payload.property].rowLabel;
      if (!rowLabel) fail(label + ' has no player-facing label for Source metric ' + sample.recordId);
      const claims = group.claims.sort((left, right) => Number(left.payload.context.comparisonStat.decimal) - Number(right.payload.context.comparisonStat.decimal));
      rows.push({
        label: rowLabel,
        claimRefs: claims.map(claim => claim.recordId),
        values: claims.map(claim => ({
          comparisonStat: structuredClone(claim.payload.context.comparisonStat),
          value: structuredClone(claim.payload.value),
          displayValue: structuredClone(claim.payload.displayValue),
          displayFormat: claim.payload.displayFormat,
          claimRef: claim.recordId
        }))
      });
    }
    return { sourceStat: section.sourceStat, label: section.label, rows };
  });
  return {
    markLabel: config.markLabel,
    attackHeading: config.attackHeading,
    comparisonHeading: config.comparisonHeading,
    note: config.note,
    attackModes,
    statSections
  };
}

function validateOfficialIdentity(value, label, expectedLocale, record, referenceIds) {
  requireString(value.sourceRef, label + '.sourceRef');
  if (!referenceIds.has(value.sourceRef) || !record.sourceRefs.includes(value.sourceRef)) {
    fail(label + '.sourceRef must be a Web-owned registry reference listed by the record');
  }
  if (value.sourceLocale !== expectedLocale) fail(label + '.sourceLocale does not match its official locale');
  requireString(value.resource, label + '.resource');
  if (typeof value.sourceHash !== 'string' || !/^[a-f0-9]{8}$/.test(value.sourceHash)) {
    fail(label + '.sourceHash must be the exact 8-character lowercase source hash');
  }
  if (value.key !== null) requireString(value.key, label + '.key');
  if (!Number.isInteger(value.occurrence) || value.occurrence < 1) fail(label + '.occurrence must be a positive locale-local ordinal');
  requireString(value.sourceText, label + '.sourceText');
  if (value.sourceTextSha256 !== sha256(Buffer.from(value.sourceText, 'utf8'))) fail(label + '.sourceText hash mismatch');
}

function ratioAsPercentDecimal(value, label) {
  validateDecimal(value, label);
  if (value.startsWith('-')) fail(label + ' must be a non-negative ratio');
  const [whole, fraction = ''] = value.split('.');
  const digits = whole + fraction;
  const shiftedPosition = whole.length + 2;
  let shifted;
  if (shiftedPosition >= digits.length) {
    shifted = digits + '0'.repeat(shiftedPosition - digits.length);
  } else {
    shifted = digits.slice(0, shiftedPosition) + '.' + digits.slice(shiftedPosition);
  }
  const [integerPart, fractionalPart] = shifted.split('.');
  const normalizedInteger = integerPart.replace(/^0+(?=\d)/, '');
  const normalizedFraction = fractionalPart?.replace(/0+$/, '');
  return normalizedFraction ? normalizedInteger + '.' + normalizedFraction : normalizedInteger;
}

function decimalAsFixed2(value, label) {
  validateDecimal(value, label);
  if (value.startsWith('-')) fail(label + ' must be a non-negative decimal');
  const [whole, fraction = ''] = value.split('.');
  const denominator = 10n ** BigInt(fraction.length);
  const numerator = BigInt(whole + fraction) * 100n;
  const roundedCents = (numerator + denominator / 2n) / denominator;
  return String(roundedCents / 100n) + '.' + String(roundedCents % 100n).padStart(2, '0');
}

function resolveOfficialParam(param, label, locale, record, referenceById, sourceRecordById, sourceKindById, tierContext = null) {
  assertExactKeys(param, ['name', 'placeholder', 'status', 'bindingRef', 'format'], label);
  if (typeof param.name !== 'string' || !/^[a-z][a-z0-9_]*$/.test(param.name)) fail(label + '.name is invalid');
  if (param.placeholder !== '{' + param.name + ':%s}') fail(label + '.placeholder does not match its parameter name');
  if (param.status !== 'bound') fail(label + ' is unbound; this official candidate cannot be compiled');
  requireString(param.bindingRef, label + '.bindingRef');
  if (!['official-name', 'plain-number', 'signed-percent'].includes(param.format)) fail(label + '.format is unsupported');

  let resolvedValue;
  if (param.format === 'official-name') {
    const reference = referenceById.get(param.bindingRef);
    if (!reference?.officialName) fail(label + '.bindingRef must identify a Web-owned officialName');
    if (!record.sourceRefs.includes(param.bindingRef)) fail(label + '.bindingRef must be listed by the Web record');
    if (reference.officialName.sourceLocale !== locale) fail(label + '.officialName locale does not match the template locale');
    resolvedValue = reference.officialName.text;
  } else {
    const tieredMovement = tierContext && param.name === 'movement_speed';
    const bindingContract = tieredMovement
      ? {
          property: 'description.format_values.movement_speed.defined_tier_' + tierContext.tier + '_display_percent',
          format: 'signed-percent', unit: 'percent', basis: 'code-derived', entityKind: 'blessing'
        }
      : NATIVE_NUMERIC_PARAMETER_CONTRACTS[param.name];
    if (!bindingContract) fail(label + ' does not match the fixed W01 numeric parameter contract');
    const claim = sourceRecordById.get(param.bindingRef);
    if (!claim || sourceKindById.get(param.bindingRef) !== 'claim') fail(label + '.bindingRef must identify a Source claim');
    if (claim.gameReleaseId !== record.gameReleaseId || claim.payload.value.status !== 'known' ||
        claim.payload.basis === 'unknown') fail(label + '.bindingRef is not a known claim for this game release');
    const value = claim.payload.value;
    if (typeof value.decimal !== 'string') fail(label + '.bindingRef claim must be a scalar decimal');
    if (param.format === 'signed-percent') {
      if (claim.payload.basis !== 'code-derived' ||
          !claim.payload.property.startsWith('description.format_values.' + param.name + '.') || value.unit !== 'percent') {
        fail(label + '.signed-percent requires a code-derived official format value with unit percent');
      }
    } else if (param.format === 'plain-number') {
      const fixedDuration = param.name === 'time' && claim.payload.property === 'template.buff_override.active_duration' &&
        claim.payload.basis === 'code-observed' && value.unit === 's';
      if (!fixedDuration) fail(label + '.plain-number is limited to the fixed code-observed duration parameter');
      if (value.unit === 'percent' || value.unit === 'ratio') fail(label + '.plain-number cannot format percent or ratio values');
    }
    if (param.format !== bindingContract.format) fail(label + ' does not match the fixed W01 numeric parameter contract');
    const entity = sourceRecordById.get(record.entityRef);
    if (entity?.kind !== bindingContract.entityKind || claim.payload.property !== bindingContract.property ||
        claim.payload.basis !== bindingContract.basis || claim.payload.value.unit !== bindingContract.unit) {
      fail(label + '.bindingRef claim does not match its fixed property, unit, basis, or entity kind');
    }
    if (tieredMovement) {
      const variant = sourceRecordById.get(tierContext.variantRef);
      const expectedClaimId = 'darktide:claim:' + tierContext.variantRef.replace(/^darktide:blessing-variant:/, '') + '-tier' + tierContext.tier + '-display-percent';
      const tierValue = variant?.payload?.tierValues?.find(entry => entry.tier === tierContext.tier)?.value;
      if (!variant || variant.kind !== 'blessing-variant' || variant.gameReleaseId !== record.gameReleaseId ||
          variant.recordId !== tierContext.variantRef || variant.payload.blessingRef !== record.entityRef ||
          !entity.payload.variantRefs.includes(tierContext.variantRef) || param.bindingRef !== expectedClaimId ||
          claim.payload.targetRef !== tierContext.variantRef || !claim.payload.context ||
          Object.keys(claim.payload.context).length !== 0 || !tierValue || tierValue.status !== 'known' || tierValue.unit !== 'ratio' ||
          ratioAsPercentDecimal(tierValue.decimal, label + '.variant ratio') !== value.decimal) {
        fail(label + '.bindingRef does not match the selected blessing tier and Source value');
      }
    }
    const relatedClaim = entity.kind === 'skill'
      ? claim.payload.targetRef === record.entityRef
      : tieredMovement
        ? claim.payload.targetRef === tierContext.variantRef
        : entity.payload.variantRefs.includes(claim.payload.targetRef);
    if (!relatedClaim) fail(label + '.bindingRef claim does not target this presentation');
    if (param.format === 'signed-percent') {
      const isZero = /^-?0(?:\.0+)?$/.test(value.decimal);
      resolvedValue = (value.decimal.startsWith('-') || isZero ? value.decimal : '+' + value.decimal) + '%';
    } else {
      resolvedValue = value.decimal;
    }
  }
  if (/[{}]/.test(resolvedValue)) fail(label + '.resolvedValue may not contain template braces');
  return { ...param, resolvedValue };
}

function resolveOfficialLocale(entry, label, locale, record, referenceIds, referenceById, sourceRecordById, sourceKindById, includeOrigin, tierContext = null) {
  const identityKeys = ['sourceRef', 'sourceLocale', 'resource', 'sourceHash', 'key', 'occurrence', 'sourceText', 'sourceTextSha256', 'segments', 'params'];
  assertExactKeys(entry, [...(includeOrigin ? ['origin'] : []), ...identityKeys], label);
  if (includeOrigin && entry.origin !== 'official') fail(label + '.origin must be official');
  validateOfficialIdentity(entry, label, locale, record, referenceIds);
  requireArray(entry.segments, label + '.segments');
  if (entry.segments.length === 0) fail(label + '.segments must not be empty');
  const segmentIds = new Set();
  for (const [index, segment] of entry.segments.entries()) {
    const segmentLabel = label + '.segments[' + index + ']';
    assertExactKeys(segment, ['segmentId', 'kind', 'text', 'sha256'], segmentLabel);
    requireString(segment.segmentId, segmentLabel + '.segmentId');
    if (!['literal', 'template-placeholder'].includes(segment.kind)) fail(segmentLabel + '.kind is unsupported');
    requireString(segment.text, segmentLabel + '.text');
    if (segment.sha256 !== sha256(Buffer.from(segment.text, 'utf8'))) fail(segmentLabel + ' hash mismatch');
    if (segmentIds.has(segment.segmentId)) fail(segmentLabel + ' has a duplicate segmentId');
    segmentIds.add(segment.segmentId);
  }
  if (entry.segments.map(segment => segment.text).join('') !== entry.sourceText) fail(label + '.segments do not preserve sourceText');
  requireArray(entry.params, label + '.params');
  const paramsByName = new Map();
  for (const [index, param] of entry.params.entries()) {
    const resolved = resolveOfficialParam(param, label + '.params[' + index + ']', locale, record, referenceById, sourceRecordById, sourceKindById, tierContext);
    if (paramsByName.has(resolved.name)) fail(label + '.params contains a duplicate parameter name');
    paramsByName.set(resolved.name, resolved);
  }
  const usedNames = new Set();
  for (const [index, segment] of entry.segments.entries()) {
    if (segment.kind === 'literal') {
      if (/\{[a-z][a-z0-9_]*:%s\}/.test(segment.text)) fail(label + '.literal segment contains an unresolved template placeholder');
      continue;
    }
    const match = /^\{([a-z][a-z0-9_]*):%s\}$/.exec(segment.text);
    if (!match) fail(label + '.segments[' + index + '] has an invalid template placeholder');
    const param = paramsByName.get(match[1]);
    if (!param || param.placeholder !== segment.text) fail(label + '.template placeholder has no matching bound parameter');
    usedNames.add(match[1]);
  }
  if (usedNames.size !== paramsByName.size) fail(label + '.params contains a binding not used by the source template');
  const resolvedText = entry.segments.map(segment => segment.kind === 'literal' ? segment.text : paramsByName.get(segment.text.slice(1, segment.text.indexOf(':'))).resolvedValue).join('');
  if (/\{[a-z][a-z0-9_]*:%s\}/.test(resolvedText)) fail(label + '.resolvedText contains an unresolved placeholder');
  const resolvedTextSha256 = sha256(Buffer.from(resolvedText, 'utf8'));
  return {
    ...(includeOrigin ? { origin: entry.origin } : {}),
    sourceRef: entry.sourceRef,
    sourceLocale: entry.sourceLocale,
    resource: entry.resource,
    sourceHash: entry.sourceHash,
    key: entry.key,
    occurrence: entry.occurrence,
    sourceText: entry.sourceText,
    sourceTextSha256: entry.sourceTextSha256,
    segments: entry.segments,
    params: [...paramsByName.values()],
    resolvedText,
    resolvedTextSha256,
    ...(includeOrigin ? { text: resolvedText, sha256: resolvedTextSha256 } : {})
  };
}

function compileNativeOfficial(official, label, record, referenceIds, referenceById, sourceRecordById, sourceKindById, tierContext = null) {
  assertExactKeys(official, ['sourceRef', 'sourceLocale', 'resource', 'sourceHash', 'key', 'occurrence', 'sourceText', 'sourceTextSha256', 'segments', 'params', 'localizations'], label);
  assertExactKeys(official.localizations, ['zh-TW'], label + '.localizations');
  const english = resolveOfficialLocale({
    sourceRef: official.sourceRef,
    sourceLocale: official.sourceLocale,
    resource: official.resource,
    sourceHash: official.sourceHash,
    key: official.key,
    occurrence: official.occurrence,
    sourceText: official.sourceText,
    sourceTextSha256: official.sourceTextSha256,
    segments: official.segments,
    params: official.params
  }, label, 'en', record, referenceIds, referenceById, sourceRecordById, sourceKindById, false, tierContext);
  const traditionalChinese = resolveOfficialLocale(official.localizations['zh-TW'], label + '.localizations.zh-TW', 'zh-TW', record, referenceIds, referenceById, sourceRecordById, sourceKindById, true, tierContext);
  return { ...english, localizations: { 'zh-TW': traditionalChinese } };
}

function compileWeaponComparisonItem(item, itemLabel, section, sourceRecordById, presentationRecord) {
  if (!sourceRecordById) fail(itemLabel + '.parts requires the pinned Source comparison records');
  if (presentationRecord?.recordId !== 'web:presentation:chainaxe-p1-m1' ||
      presentationRecord.entityRef !== 'darktide:weapon:chainaxe:p1-m1') {
    fail(itemLabel + '.parts is only supported for the representative Chainaxe weapon presentation');
  }
  assertExactKeys(item, ['itemId', 'parts', 'claimRefs'], itemLabel);
  requireString(item.itemId, itemLabel + '.itemId');
  requireArray(item.parts, itemLabel + '.parts');
  requireRefList(item.claimRefs, itemLabel + '.claimRefs');
  if (item.claimRefs.length !== 2) fail(itemLabel + '.claimRefs must contain one complete comparison pair');
  const comparison = CHAINAXE_COMPARISON_BY_CLAIM.get(item.claimRefs[0]);
  if (!comparison || comparison.groupId !== CHAINAXE_COMPARISON_BY_CLAIM.get(item.claimRefs[1])?.groupId) {
    fail(itemLabel + '.claimRefs must identify one Source comparison pair');
  }
  const group = CHAINAXE_COMPARISON_GROUPS[comparison.groupId];
  const expectedClaims = group.claims.map(claim => claim.id);
  if (section !== group.section || item.itemId !== group.itemId ||
      JSON.stringify(item.claimRefs) !== JSON.stringify(expectedClaims)) {
    fail(itemLabel + '.itemId, section, or claimRefs do not match the Source comparison pair');
  }
  const expectedParts = [
    { kind: 'literal', text: group.inputLabel },
    { kind: 'source-comparison', bindingRef: expectedClaims[0], format: 'comparison-stat' },
    { kind: 'literal', text: ' → ' },
    { kind: 'source-comparison', bindingRef: expectedClaims[1], format: 'comparison-stat' },
    { kind: 'literal', text: group.valueLabel },
    { kind: 'source-comparison', bindingRef: expectedClaims[0], format: 'comparison-value' },
    { kind: 'literal', text: ' → ' },
    { kind: 'source-comparison', bindingRef: expectedClaims[1], format: 'comparison-value' },
    { kind: 'literal', text: group.valueSuffix + '。' }
  ];
  if (JSON.stringify(item.parts) !== JSON.stringify(expectedParts)) {
    fail(itemLabel + '.parts must bind both Source comparison inputs and values in the fixed Chainaxe copy format');
  }

  const text = [];
  for (const [index, part] of expectedParts.entries()) {
    const partLabel = itemLabel + '.parts[' + index + ']';
    if (part.kind === 'literal') {
      text.push(part.text);
      continue;
    }
    const claim = sourceRecordById.get(part.bindingRef);
    if (!claim || claim.kind !== 'claim' || claim.payload.targetRef !== group.statDefinition ||
        claim.payload.property !== group.property || claim.payload.context.weaponStat !== group.weaponStat ||
        claim.payload.value.status !== 'known' || claim.payload.value.unit !== group.unit) {
      fail(partLabel + '.bindingRef does not match this presentation weapon stat and comparison input');
    }
    if (part.format === 'comparison-stat') {
      text.push(claim.payload.context.comparisonStat.decimal + '%');
    } else {
      text.push(group.unit === 'ratio'
        ? decimalAsFixed2(claim.payload.value.decimal, partLabel + '.ratio')
        : claim.payload.value.decimal);
    }
  }
  return { itemId: item.itemId, text: text.join(''), claimRefs: expectedClaims };
}

function compileDetailSections(input, label, sourceIds, sourceKindById, tierContext = null, sourceRecordById = null, presentationRecord = null) {
  assertPlainObject(input, label);
  assertExactKeys(input, DETAIL_SECTION_KEYS, label);
  const output = {};
  for (const section of DETAIL_SECTION_KEYS) {
    requireArray(input[section], label + '.' + section);
    let tierBoundItemCount = 0;
    output[section] = input[section].map((item, itemIndex) => {
      const itemLabel = label + '.' + section + '[' + itemIndex + ']';
      assertPlainObject(item, itemLabel);
      if (Object.hasOwn(item, 'parts')) {
        if (!tierContext || section !== 'effects') {
          return compileWeaponComparisonItem(item, itemLabel, section, sourceRecordById, presentationRecord);
        }
        assertExactKeys(item, ['itemId', 'parts', 'claimRefs'], itemLabel);
        requireString(item.itemId, itemLabel + '.itemId');
        requireArray(item.parts, itemLabel + '.parts');
        if (item.parts.length === 0) fail(itemLabel + '.parts must not be empty');
        requireArray(item.claimRefs, itemLabel + '.claimRefs');
        const claimRef = tierContext.claimRef;
        if (item.claimRefs.length !== 1 || item.claimRefs[0] !== claimRef) {
          fail(itemLabel + '.claimRefs must identify the selected tier display claim');
        }
        const resolvedParam = tierContext.params.find(param => param.name === 'movement_speed' && param.bindingRef === claimRef);
        if (!resolvedParam) fail(itemLabel + ' has no selected tier display binding');
        let tierPercentParts = 0;
        const text = item.parts.map((part, partIndex) => {
          const partLabel = itemLabel + '.parts[' + partIndex + ']';
          assertPlainObject(part, partLabel);
          if (part.kind === 'literal') {
            assertExactKeys(part, ['kind', 'text'], partLabel);
            requireString(part.text, partLabel + '.text');
            if (/[{}]|(?:^|\D)\d+(?:\.\d+)?\s*%/.test(part.text)) {
              fail(partLabel + '.literal may not contain template syntax or a hard-coded percentage');
            }
            return part.text;
          }
          if (part.kind === 'signed-percent' || part.kind === 'unsigned-percent') {
            assertExactKeys(part, ['kind', 'bindingRef'], partLabel);
            requireString(part.bindingRef, partLabel + '.bindingRef');
            if (part.bindingRef !== claimRef) fail(partLabel + '.bindingRef does not match the selected tier');
            tierPercentParts += 1;
            if (part.kind === 'unsigned-percent') {
              return resolvedParam.resolvedValue.startsWith('+')
                ? resolvedParam.resolvedValue.slice(1)
                : resolvedParam.resolvedValue;
            }
            return resolvedParam.resolvedValue;
          }
          fail(partLabel + '.kind is unsupported');
        }).join('');
        if (tierPercentParts !== 1) fail(itemLabel + '.parts must contain exactly one selected tier percentage');
        tierBoundItemCount += 1;
        return { itemId: item.itemId, text, claimRefs: [claimRef] };
      }
      const keys = ['itemId', ...(Object.hasOwn(item, 'text') ? ['text'] : []), ...(Object.hasOwn(item, 'claimRefs') ? ['claimRefs'] : []), ...(Object.hasOwn(item, 'termRef') ? ['termRef'] : [])];
      assertExactKeys(item, keys, itemLabel);
      requireString(item.itemId, itemLabel + '.itemId');
      if (!Object.hasOwn(item, 'text') && !Object.hasOwn(item, 'termRef')) fail(itemLabel + ' needs text or termRef');
      if ('text' in item) {
        requireString(item.text, itemLabel + '.text');
        if (tierContext && section === 'effects' && /(?:^|\D)\d+(?:\.\d+)?\s*%/.test(item.text)) {
          fail(itemLabel + '.text may not hard-code a tier percentage');
        }
      }
      if ('claimRefs' in item) {
        requireRefList(item.claimRefs, itemLabel + '.claimRefs');
        for (const claimRef of item.claimRefs) if (!sourceIds.has(claimRef) || sourceKindById.get(claimRef) !== 'claim') fail(itemLabel + ' has an unresolved claimRef');
      }
      if ('termRef' in item && (!sourceIds.has(item.termRef) || sourceKindById.get(item.termRef) !== 'term')) fail(itemLabel + ' has an unresolved termRef');
      return item;
    });
    if (tierContext && section === 'effects' && tierBoundItemCount === 0) {
      fail(label + '.effects must contain a typed selected-tier percentage');
    }
  }
  return output;
}

function normalizeTierSectionBindings(sections, tierContext) {
  const clone = structuredClone(sections);
  for (const section of DETAIL_SECTION_KEYS) {
    for (const item of clone[section]) {
      if (Array.isArray(item.claimRefs) && item.claimRefs.length === 1 && item.claimRefs[0] === tierContext.claimRef) {
        item.claimRefs = ['$selected-tier-claim'];
      }
      for (const part of item.parts ?? []) {
        if ((part.kind === 'signed-percent' || part.kind === 'unsigned-percent') && part.bindingRef === tierContext.claimRef) part.bindingRef = '$selected-tier-claim';
      }
    }
  }
  return JSON.stringify(clone);
}

function compileTierPresentations(record, rawTierPresentations, referenceIds, referenceById, sourceRecordById, sourceKindById, sourceIds, label) {
  assertExactKeys(rawTierPresentations, ['variantRef', 'defaultTier', 'options'], label + '.tierPresentations');
  const variantRef = requireString(rawTierPresentations.variantRef, label + '.tierPresentations.variantRef');
  if (sourceKindById.get(record.entityRef) !== 'blessing') fail(label + '.tierPresentations is only valid for a blessing presentation');
  const blessing = sourceRecordById.get(record.entityRef);
  const variant = sourceRecordById.get(variantRef);
  if (!variant || sourceKindById.get(variantRef) !== 'blessing-variant' || variant.gameReleaseId !== record.gameReleaseId ||
      variant.payload.blessingRef !== record.entityRef || !blessing.payload.variantRefs.includes(variantRef)) {
    fail(label + '.tierPresentations.variantRef must identify a variant of this blessing');
  }
  const definedTiers = variant.payload.definedTiers;
  if (!Array.isArray(definedTiers) || JSON.stringify(definedTiers) !== '[1,2,3,4]' || rawTierPresentations.defaultTier !== 4) {
    fail(label + '.tierPresentations requires the four defined tiers with tier 4 as default');
  }
  requireArray(rawTierPresentations.options, label + '.tierPresentations.options');
  if (rawTierPresentations.options.length !== definedTiers.length ||
      JSON.stringify(rawTierPresentations.options.map(option => option?.tier)) !== JSON.stringify(definedTiers)) {
    fail(label + '.tierPresentations.options must match every defined tier in order');
  }
  if (!record.payload.official?.localizations?.['zh-TW'] || record.payload.official.localizations['zh-TW'].origin !== 'official') {
    fail(label + '.tierPresentations requires native English and zh-TW official templates');
  }
  const baseOfficial = record.payload.official;
  const defaultOption = rawTierPresentations.options.at(-1);
  const defaultParams = defaultOption.params;
  if (JSON.stringify(baseOfficial.params) !== JSON.stringify(defaultParams) ||
      JSON.stringify(baseOfficial.localizations['zh-TW'].params) !== JSON.stringify(defaultParams)) {
    fail(label + '.official params must match the default tier option in both locales');
  }
  const baseParamShape = baseOfficial.params.map(param => ({
    name: param.name, placeholder: param.placeholder, status: param.status, format: param.format,
    bindingRef: param.name === 'movement_speed' ? '$selected-tier-claim' : param.bindingRef
  }));
  const compiledOptions = rawTierPresentations.options.map((option, optionIndex) => {
    const optionLabel = label + '.tierPresentations.options[' + optionIndex + ']';
    assertExactKeys(option, ['tier', 'params', 'detailSections'], optionLabel);
    const tier = option.tier;
    const expectedClaimId = 'darktide:claim:' + variantRef.replace(/^darktide:blessing-variant:/, '') + '-tier' + tier + '-display-percent';
    if (!Number.isInteger(tier) || tier !== definedTiers[optionIndex]) fail(optionLabel + '.tier does not match the source defined tier');
    requireArray(option.params, optionLabel + '.params');
    const paramShape = option.params.map(param => ({
      name: param.name, placeholder: param.placeholder, status: param.status, format: param.format,
      bindingRef: param.name === 'movement_speed' ? '$selected-tier-claim' : param.bindingRef
    }));
    if (JSON.stringify(paramShape) !== JSON.stringify(baseParamShape)) fail(optionLabel + '.params may change only the movement-speed tier claim');
    const movementParam = option.params.find(param => param.name === 'movement_speed');
    if (!movementParam || movementParam.bindingRef !== expectedClaimId) fail(optionLabel + '.movement_speed bindingRef does not identify its tier');
    const tierContext = { tier, variantRef, claimRef: expectedClaimId, params: option.params };
    const optionOfficial = {
      ...baseOfficial,
      params: option.params,
      localizations: { 'zh-TW': { ...baseOfficial.localizations['zh-TW'], params: option.params } }
    };
    const official = compileNativeOfficial(optionOfficial, optionLabel + '.official', record, referenceIds, referenceById, sourceRecordById, sourceKindById, tierContext);
    const detailSections = compileDetailSections(option.detailSections, optionLabel + '.detailSections', sourceIds, sourceKindById, { ...tierContext, params: official.params });
    if (normalizeTierSectionBindings(option.detailSections, tierContext) !== normalizeTierSectionBindings(defaultOption.detailSections, {
      claimRef: 'darktide:claim:' + variantRef.replace(/^darktide:blessing-variant:/, '') + '-tier4-display-percent'
    })) fail(optionLabel + '.detailSections may vary only by the generated tier percentage binding');
    return { tier, official, detailSections };
  });
  const defaultCompiled = compiledOptions.at(-1);
  if (JSON.stringify(record.payload.detailSections) !== JSON.stringify(defaultOption.detailSections)) {
    fail(label + '.detailSections must be the default tier authoring');
  }
  record.payload.official = defaultCompiled.official;
  record.payload.detailSections = defaultCompiled.detailSections;
  return { variantRef, defaultTier: 4, options: compiledOptions };
}

function validateWebAuthoring(authoring, sourceIds, sourceKindById, sourceReferences, gameReleaseId, sourceRecordById) {
  assertExactKeys(authoring, ['schemaVersion', 'fixtureOnly', 'gameReleaseId', 'references', 'records', 'announcements'], 'web-authoring.json');
  if (authoring.schemaVersion !== '1.0.0' || typeof authoring.fixtureOnly !== 'boolean' || authoring.gameReleaseId !== gameReleaseId) {
    fail('Web authoring input is not a compatible W01 package');
  }
  requireArray(authoring.records, 'Web authoring records');
  requireArray(authoring.announcements, 'Web authoring announcements');
  const references = validateSourceReferenceClosure([], authoring.references, 'web');
  const referenceIds = new Set(references.map(reference => reference.sourceId));
  const referenceById = new Map(references.map(reference => [reference.sourceId, reference]));
  for (const reference of references) {
    if (sourceReferences.some(source => source.sourceId === reference.sourceId)) fail('source reference has conflicting owners: ' + reference.sourceId);
  }
  const seen = new Set();
  const recordEnvelopeKeys = ['recordId', 'owner', 'kind', 'gameReleaseId', 'entityRef', 'locale', 'sourceRefs', 'payload', 'reviewState'];
  let usesNativeOfficialLocalizations = false;
  let usesBlessingTierPresentations = false;
  for (const [index, record] of authoring.records.entries()) {
    const label = 'Web authoring record[' + index + ']';
    assertExactKeys(record, recordEnvelopeKeys, label);
    requireString(record.recordId, label + '.recordId');
    if (record.owner !== 'web') fail(label + '.owner violates the owner contract');
    if (!['presentation', 'term-localization'].includes(record.kind)) fail(label + '.kind is unsupported for Web owner');
    if (record.gameReleaseId !== gameReleaseId || record.reviewState !== 'pending') fail(label + ' must remain pending for the fixture release');
    if (record.locale !== 'zh-TW') fail(label + ' requires zh-TW; English fallback is prohibited');
    if (!sourceIds.has(record.entityRef)) fail(label + ' has an unresolved entityRef');
    requireRefList(record.sourceRefs, label + '.sourceRefs');
    for (const sourceRef of record.sourceRefs) if (!referenceIds.has(sourceRef)) fail(label + ' has unresolved Web-owned sourceRef ' + sourceRef);
    assertPlainObject(record.payload, label + '.payload');
    if (seen.has(record.recordId)) fail('duplicate Web authoring recordId ' + record.recordId);
    seen.add(record.recordId);
    if (record.kind === 'presentation') {
      if (!['skill', 'blessing', 'weapon'].includes(sourceKindById.get(record.entityRef))) fail(label + '.entityRef has the wrong owner kind');
      const allowedPayloadKeys = ['name', 'official', 'errata', 'detailSections', 'tierPresentations', 'weaponView'].filter(key => Object.hasOwn(record.payload, key));
      assertExactKeys(record.payload, allowedPayloadKeys, label + '.payload');
      requireString(record.payload.name, label + '.name');
      const expectedChainaxePresentationId = CHAINAXE_PRESENTATION_IDS[record.entityRef];
      if (expectedChainaxePresentationId) {
        if (record.recordId !== expectedChainaxePresentationId || !Object.hasOwn(record.payload, 'weaponView')) {
          fail(label + ' must provide its fixed Source-bound Chainaxe weaponView');
        }
        record.payload.weaponView = compileChainaxeWeaponView(record.payload.weaponView, label + '.weaponView', record, sourceRecordById);
      } else if (Object.hasOwn(record.payload, 'weaponView')) {
        fail(label + '.weaponView is only supported for the pinned Chainaxe marks');
      }
      if (Object.hasOwn(record.payload, 'official') !== Object.hasOwn(record.payload, 'errata')) {
        fail(label + ' must provide official text and errata together when present');
      }
      if (Object.hasOwn(record.payload, 'official')) {
        const official = record.payload.official;
        if (official?.localizations?.['zh-TW']?.origin === 'official') {
          if (!Object.hasOwn(record.payload, 'tierPresentations')) {
            record.payload.official = compileNativeOfficial(official, label + '.official', record, referenceIds, referenceById, sourceRecordById, sourceKindById);
          }
          usesNativeOfficialLocalizations = true;
        } else {
        assertExactKeys(official, ['sourceRef', 'sourceLocale', 'resource', 'key', 'occurrence', 'sourceText', 'sourceTextSha256', 'segments', 'params', 'resolvedText', 'resolvedTextSha256', 'localizations'], label + '.official');
        if (!referenceIds.has(official.sourceRef) || !record.sourceRefs.includes(official.sourceRef)) fail(label + '.official.sourceRef must use the Web-owned registry and record sourceRefs');
        requireString(official.sourceLocale, label + '.official.sourceLocale');
        requireString(official.resource, label + '.official.resource');
        requireString(official.key, label + '.official.key');
        if (!Number.isInteger(official.occurrence) || official.occurrence < 1) fail(label + '.official.occurrence must be a positive integer');
        requireString(official.sourceText, label + '.official.sourceText');
        const sourceTextDigest = sha256(Buffer.from(official.sourceText, 'utf8'));
        if (official.sourceTextSha256 !== sourceTextDigest) fail(label + '.official sourceText hash mismatch');
        requireArray(official.segments, label + '.official.segments');
        if (official.segments.length === 0) fail(label + '.official.segments must not be empty');
        const segmentIds = new Set();
        for (const [segmentIndex, segment] of official.segments.entries()) {
          const segmentLabel = label + '.official.segments[' + segmentIndex + ']';
          assertExactKeys(segment, ['segmentId', 'text', 'sha256'], segmentLabel);
          requireString(segment.segmentId, segmentLabel + '.segmentId');
          requireString(segment.text, segmentLabel + '.text');
          if (segmentIds.has(segment.segmentId)) fail(segmentLabel + ' has a duplicate segmentId');
          segmentIds.add(segment.segmentId);
          if (segment.sha256 !== sha256(Buffer.from(segment.text, 'utf8'))) fail(segmentLabel + ' hash mismatch');
        }
        if (official.segments.map(segment => segment.text).join('') !== official.sourceText) fail(label + '.official segments do not preserve sourceText');
        requireArray(official.params, label + '.official.params');
        requireString(official.resolvedText, label + '.official.resolvedText');
        if (official.resolvedTextSha256 !== sha256(Buffer.from(official.resolvedText, 'utf8'))) fail(label + '.official resolvedText hash mismatch');
        assertExactKeys(official.localizations, ['zh-TW'], label + '.official.localizations');
        const localization = official.localizations['zh-TW'];
        assertExactKeys(localization, ['origin', 'text', 'sha256'], label + '.official.localizations.zh-TW');
        if (localization.origin !== 'faithful-translation') fail(label + '.official zh-TW text must be marked as a faithful translation');
        requireString(localization.text, label + '.official.localizations.zh-TW.text');
        if (localization.sha256 !== sha256(Buffer.from(localization.text, 'utf8'))) fail(label + '.official zh-TW hash mismatch');
        }
        requireArray(record.payload.errata, label + '.errata');
        for (const [erratumIndex, erratum] of record.payload.errata.entries()) {
          const erratumLabel = label + '.errata[' + erratumIndex + ']';
          assertExactKeys(erratum, ['erratumId', 'anchor', 'gameReleaseId', 'context', 'problem', 'claimRef', 'evidenceRefs', 'text', 'reviewState'], erratumLabel);
          requireString(erratum.erratumId, erratumLabel + '.erratumId');
          assertExactKeys(erratum.anchor, ['segmentId', 'sourceTextDigest'], erratumLabel + '.anchor');
          const segment = official.segments.find(item => item.segmentId === erratum.anchor.segmentId);
          if (!segment || segment.sha256 !== erratum.anchor.sourceTextDigest) fail(erratumLabel + ' anchor does not bind to an official segment digest');
          if (erratum.gameReleaseId !== gameReleaseId || erratum.reviewState !== 'pending') fail(erratumLabel + ' must remain pending for the fixture release');
          assertPlainObject(erratum.context, erratumLabel + '.context');
          requireString(erratum.problem, erratumLabel + '.problem');
          requireString(erratum.claimRef, erratumLabel + '.claimRef');
          if (!sourceIds.has(erratum.claimRef) || sourceKindById.get(erratum.claimRef) !== 'claim') fail(erratumLabel + ' has an unresolved claimRef');
          requireRefList(erratum.evidenceRefs, erratumLabel + '.evidenceRefs');
          for (const evidenceRef of erratum.evidenceRefs) if (!sourceIds.has(evidenceRef) || sourceKindById.get(evidenceRef) !== 'evidence') fail(erratumLabel + ' has an unresolved evidenceRef');
          requireString(erratum.text, erratumLabel + '.text');
        }
      }
      if (Object.hasOwn(record.payload, 'tierPresentations')) {
        if (!Object.hasOwn(record.payload, 'official') || !Object.hasOwn(record.payload, 'errata') ||
            record.payload.official?.localizations?.['zh-TW']?.origin !== 'official') {
          fail(label + '.tierPresentations requires native official text and errata');
        }
        record.payload.tierPresentations = compileTierPresentations(record, record.payload.tierPresentations, referenceIds, referenceById, sourceRecordById, sourceKindById, sourceIds, label);
        usesNativeOfficialLocalizations = true;
        usesBlessingTierPresentations = true;
      } else {
        record.payload.detailSections = compileDetailSections(record.payload.detailSections, label + '.detailSections', sourceIds, sourceKindById, null, sourceRecordById, record);
      }
    } else {
      if (sourceKindById.get(record.entityRef) !== 'term') fail(label + '.entityRef must identify a Source term');
      assertExactKeys(record.payload, ['label', 'definition'], label + '.payload');
      requireString(record.payload.label, label + '.label');
      requireString(record.payload.definition, label + '.definition');
    }
  }
  for (const [index, announcement] of authoring.announcements.entries()) {
    const label = 'Web announcement[' + index + ']';
    assertExactKeys(announcement, ['recordId', 'owner', 'kind', 'gameReleaseId', 'locale', 'sourceRefs', 'payload', 'reviewState'], label);
    requireString(announcement.recordId, label + '.recordId');
    if (announcement.owner !== 'web' || announcement.kind !== 'announcement' || announcement.gameReleaseId !== gameReleaseId ||
        announcement.locale !== 'zh-TW' || announcement.reviewState !== 'pending') fail(label + ' must be a pending zh-TW Web announcement');
    requireRefList(announcement.sourceRefs, label + '.sourceRefs');
    for (const sourceRef of announcement.sourceRefs) if (!referenceIds.has(sourceRef)) fail(label + ' has unresolved Web-owned sourceRef ' + sourceRef);
    assertExactKeys(announcement.payload, ['title', 'blocks'], label + '.payload');
    requireString(announcement.payload.title, label + '.payload.title');
    requireArray(announcement.payload.blocks, label + '.payload.blocks');
    if (announcement.payload.blocks.length === 0) fail(label + '.payload.blocks must not be empty');
    const blockIds = new Set();
    for (const [blockIndex, block] of announcement.payload.blocks.entries()) {
      const blockLabel = label + '.payload.blocks[' + blockIndex + ']';
      assertExactKeys(block, ['blockId', 'type', 'text'], blockLabel);
      requireString(block.blockId, blockLabel + '.blockId');
      if (blockIds.has(block.blockId)) fail(blockLabel + ' has a duplicate blockId');
      blockIds.add(block.blockId);
      if (!['heading', 'paragraph'].includes(block.type)) fail(blockLabel + '.type is unsupported for the W01 preview');
      requireString(block.text, blockLabel + '.text');
    }
    if (seen.has(announcement.recordId)) fail('duplicate Web authoring recordId ' + announcement.recordId);
    seen.add(announcement.recordId);
  }
  let warningText;
  if (authoring.fixtureOnly === false) {
    const warningBlocks = authoring.announcements.flatMap(announcement => announcement.payload.blocks)
      .filter(block => block.blockId === 'compatibility-warning');
    if (warningBlocks.length !== 1 || warningBlocks[0].type !== 'paragraph' || warningBlocks[0].text.trim().length === 0) {
      fail('non-fixture Web authoring must contain exactly one non-empty compatibility-warning paragraph');
    }
    warningText = warningBlocks[0].text;
  }
  if (Object.keys(CHAINAXE_MARKS).some(weaponId => sourceRecordById.has(weaponId))) {
    for (const presentationId of Object.values(CHAINAXE_PRESENTATION_IDS)) {
      if (!seen.has(presentationId)) fail('Web authoring is missing the Source-bound Chainaxe presentation ' + presentationId);
    }
  }
  return { records: authoring.records, announcements: authoring.announcements, warningText, references, usesNativeOfficialLocalizations, usesBlessingTierPresentations };
}

function validateSourceReferenceClosure(sourceRecords, sourceRefs, owner) {
  const registry = new Map();
  for (const [index, sourceRef] of sourceRefs.entries()) {
    const label = (owner === 'source' ? 'Source' : 'Web') + ' reference[' + index + ']';
    assertPlainObject(sourceRef, label);
    const locatorKeys = ['repository', 'commit', 'path', 'snapshot'];
    const hasLocator = locatorKeys.some(key => Object.hasOwn(sourceRef, key));
    if (owner === 'source' && sourceRef.sourceId === FIXED_LEGACY_ANALYSIS_REFERENCE.sourceId && !hasLocator) {
      fail(label + ' legacy analysis reference must retain its fixed public locator');
    }
    if (owner !== 'source' && hasLocator) fail(label + ' may not contain Source-owned repository locators');
    if (owner === 'source' && Object.hasOwn(sourceRef, 'officialName')) fail(label + ' may not contain Web-owned officialName data');
    if (hasLocator) {
      if (owner !== 'source' || locatorKeys.some(key => !Object.hasOwn(sourceRef, key))) {
        fail(label + ' public locator must contain repository, commit, path, and snapshot together');
      }
      if (sourceRef.sourceId === FIXED_LEGACY_ANALYSIS_REFERENCE.sourceId) {
        if (sourceRef.repository !== FIXED_LEGACY_ANALYSIS_REFERENCE.repository ||
            sourceRef.commit !== FIXED_LEGACY_ANALYSIS_REFERENCE.commit ||
            sourceRef.path !== FIXED_LEGACY_ANALYSIS_REFERENCE.path) {
          fail(label + ' legacy analysis reference does not match its fixed public locator');
        }
      } else if (sourceRef.repository !== UPSTREAM_GAME_SOURCE_REPOSITORY) {
        fail(label + '.repository is not an allowlisted public Source repository');
      }
      if (typeof sourceRef.commit !== 'string' || !/^[a-f0-9]{40}$/.test(sourceRef.commit)) {
        fail(label + '.commit must be a full lowercase Git SHA');
      }
      safeRelativePath(sourceRef.path, label + '.path');
      assertExactKeys(sourceRef.snapshot, ['commit'], label + '.snapshot');
      if (sourceRef.snapshot.commit !== sourceRef.commit) fail(label + '.snapshot.commit must match its fixed repository commit');
      if (sourceRef.fixtureOnly !== false) fail(label + ' public locator must be explicitly non-fixture');
      requireString(sourceRef.safeSummary, label + '.safeSummary');
    }
    const keys = [
      'sourceId',
      ...(Object.hasOwn(sourceRef, 'fixtureOnly') ? ['fixtureOnly'] : []),
      ...(Object.hasOwn(sourceRef, 'safeSummary') ? ['safeSummary'] : []),
      ...(owner === 'source' && hasLocator ? locatorKeys : []),
      ...(owner === 'web' && Object.hasOwn(sourceRef, 'officialName') ? ['officialName'] : [])
    ];
    assertExactKeys(sourceRef, keys, label);
    requireString(sourceRef.sourceId, label + '.sourceId');
    if ('fixtureOnly' in sourceRef) requireBoolean(sourceRef.fixtureOnly, label + '.fixtureOnly');
    if ('safeSummary' in sourceRef) requireString(sourceRef.safeSummary, label + '.safeSummary');
    if ('officialName' in sourceRef) {
      if (owner !== 'web') fail(label + '.officialName is only valid in the Web-owned registry');
      const officialName = sourceRef.officialName;
      assertExactKeys(officialName, ['sourceLocale', 'resource', 'sourceHash', 'key', 'occurrence', 'text', 'sha256'], label + '.officialName');
      if (!['en', 'zh-TW'].includes(officialName.sourceLocale)) fail(label + '.officialName.sourceLocale is unsupported');
      requireString(officialName.resource, label + '.officialName.resource');
      if (typeof officialName.sourceHash !== 'string' || !/^[a-f0-9]{8}$/.test(officialName.sourceHash)) fail(label + '.officialName.sourceHash must be 8 lowercase hex characters');
      if (officialName.key !== null) requireString(officialName.key, label + '.officialName.key');
      if (!Number.isInteger(officialName.occurrence) || officialName.occurrence < 1) fail(label + '.officialName.occurrence must be a positive locale-local ordinal');
      requireString(officialName.text, label + '.officialName.text');
      if (officialName.sha256 !== sha256(Buffer.from(officialName.text, 'utf8'))) fail(label + '.officialName hash mismatch');
    }
    if (registry.has(sourceRef.sourceId)) fail('duplicate Source reference ' + sourceRef.sourceId);
    registry.set(sourceRef.sourceId, sourceRef);
  }
  for (const record of sourceRecords) {
    for (const sourceRef of record.sourceRefs) if (!registry.has(sourceRef)) fail(record.recordId + ' has unresolved sourceRef ' + sourceRef);
    if (record.kind === 'evidence' && !registry.has(record.payload.sourceRef)) fail(record.recordId + ' has unresolved evidence sourceRef ' + record.payload.sourceRef);
    if (record.kind === 'weapon') {
      for (const missing of record.payload.dataCoverage.missing) {
        if (missing.sourceRef && !registry.has(missing.sourceRef)) fail(record.recordId + ' has unresolved dataCoverage sourceRef ' + missing.sourceRef);
      }
    }
  }
  return [...registry.values()].sort((left, right) => compareUtf8(left.sourceId, right.sourceId));
}

function validateDomainReferences(records, kindById) {
  const check = (from, reference, expectedKinds, label) => {
    if (!kindById.has(reference)) fail(from + ' has unresolved ' + label + ' ' + reference);
    const actualKind = kindById.get(reference);
    if (expectedKinds && !expectedKinds.includes(actualKind)) fail(from + ' has invalid ' + label + ' kind ' + actualKind);
  };
  for (const record of records) {
    const payload = record.payload ?? {};
    const refs = (key, expectedKinds) => {
      const value = payload[key];
      if (typeof value === 'string') check(record.recordId, value, expectedKinds, key);
      if (Array.isArray(value)) for (const item of value) check(record.recordId, item, expectedKinds, key);
    };
    switch (record.kind) {
      case 'skill': refs('termRef', ['term']); refs('claimRefs', ['claim']); break;
      case 'claim':
        refs('targetRef');
        if (payload.context?.weaponRef) check(record.recordId, payload.context.weaponRef, ['weapon'], 'weaponRef');
        refs('evidenceRefs', ['evidence']);
        break;
      case 'evidence': break;
      case 'blessing': refs('variantRefs', ['blessing-variant']); break;
      case 'blessing-variant': refs('blessingRef', ['blessing']); refs('weaponRefs', ['weapon']); break;
      case 'weapon': refs('statRefs', ['stat-definition']); refs('claimRefs', ['claim']); refs('armorRefs'); refs('attackProfileRefs'); break;
      case 'stat-definition': refs('curveRef', ['stat-curve']); refs('claimRefs', ['claim']); break;
      case 'stat-curve': break;
      case 'term': refs('claimRefs', ['claim']); break;
      case 'presentation': {
        check(record.recordId, record.entityRef, ['skill', 'blessing', 'weapon'], 'entityRef');
        const checkDetails = sections => {
          for (const section of Object.values(sections ?? {})) {
          for (const item of section) {
            if ('claimRefs' in item) for (const claimRef of item.claimRefs) check(record.recordId, claimRef, ['claim'], 'claimRef');
            if ('termRef' in item) check(record.recordId, item.termRef, ['term'], 'termRef');
          }
          }
        };
        checkDetails(payload.detailSections);
        for (const section of payload.weaponView?.statSections ?? []) {
          for (const row of section.rows ?? []) {
            for (const claimRef of row.claimRefs ?? []) check(record.recordId, claimRef, ['claim'], 'weaponView claimRef');
          }
        }
        if (payload.tierPresentations) {
          check(record.recordId, payload.tierPresentations.variantRef, ['blessing-variant'], 'tier variantRef');
          for (const option of payload.tierPresentations.options) {
            checkDetails(option.detailSections);
            for (const entry of [option.official, option.official?.localizations?.['zh-TW']]) {
              for (const param of entry?.params ?? []) check(record.recordId, param.bindingRef, ['claim'], 'tier official bindingRef');
            }
          }
        }
        for (const erratum of payload.errata ?? []) {
          check(record.recordId, erratum.claimRef, ['claim'], 'errata claimRef');
          for (const evidenceRef of erratum.evidenceRefs) check(record.recordId, evidenceRef, ['evidence'], 'errata evidenceRef');
        }
        break;
      }
      case 'term-localization': check(record.recordId, record.entityRef, ['term'], 'entityRef'); break;
      case 'game-change': refs('targetRef'); refs('evidenceRefs', ['evidence']); break;
      default: fail(record.recordId + ' has an unsupported shared kind ' + record.kind);
    }
  }
}

function sharedRecordReferences(record, sourceRecordById) {
  const references = [];
  const add = value => {
    if (typeof value === 'string') references.push(value);
    else if (Array.isArray(value)) references.push(...value.filter(item => typeof item === 'string'));
  };
  const payload = record.payload ?? {};
  switch (record.kind) {
    case 'skill': add(payload.termRef); add(payload.claimRefs); break;
    case 'claim': add(payload.targetRef); add(payload.context?.weaponRef); add(payload.evidenceRefs); break;
    case 'blessing': add(payload.variantRefs); break;
    case 'blessing-variant': add(payload.blessingRef); add(payload.weaponRefs); break;
    case 'weapon': add(payload.statRefs); add(payload.armorRefs); add(payload.attackProfileRefs); break;
    case 'stat-definition': add(payload.curveRef); add(payload.claimRefs); break;
    case 'term': add(payload.claimRefs); break;
    case 'presentation':
      add(record.entityRef);
      const addDetails = sections => {
        for (const section of Object.values(sections ?? {})) {
        for (const item of section) { add(item.claimRefs); add(item.termRef); }
        }
      };
      addDetails(payload.detailSections);
      for (const section of payload.weaponView?.statSections ?? []) {
        for (const row of section.rows ?? []) add(row.claimRefs);
      }
      for (const erratum of payload.errata ?? []) { add(erratum.claimRef); add(erratum.evidenceRefs); }
      for (const entry of [payload.official, payload.official?.localizations?.['zh-TW']]) {
        for (const param of entry?.params ?? []) if (sourceRecordById.has(param.bindingRef)) add(param.bindingRef);
      }
      if (payload.tierPresentations) {
        add(payload.tierPresentations.variantRef);
        for (const option of payload.tierPresentations.options) {
          addDetails(option.detailSections);
          for (const entry of [option.official, option.official?.localizations?.['zh-TW']]) {
            for (const param of entry?.params ?? []) if (sourceRecordById.has(param.bindingRef)) add(param.bindingRef);
          }
        }
      }
      break;
    case 'term-localization': add(record.entityRef); break;
    case 'game-change': add(payload.targetRef); add(payload.evidenceRefs); break;
    default: break;
  }
  return references;
}

function dependenciesForDomain(kind, records, domainById, sourceRecordById, useNativeDependencies) {
  if (!useNativeDependencies) return [...DOMAIN_DEPENDENCIES[kind]];
  const dependencies = new Set();
  for (const record of records) {
    for (const reference of sharedRecordReferences(record, sourceRecordById)) {
      const targetDomain = domainById.get(reference);
      if (targetDomain && targetDomain !== kind) dependencies.add(targetDomain);
    }
  }
  return DOMAIN_KINDS.filter(domain => dependencies.has(domain));
}

function currentCommit(repoRoot) {
  try {
    const commit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repoRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    if (/^[a-f0-9]{40}$/.test(commit)) return commit;
  } catch {
    // A locally unpacked fixture may not include Git metadata.
  }
  const envCommit = process.env.GITHUB_SHA;
  if (envCommit && /^[a-f0-9]{40}$/.test(envCommit)) return envCommit;
  return 'working-tree';
}

function addOutput(files, name, bytes) {
  safeRelativePath(name, 'output path');
  files.set(name, Buffer.from(bytes));
}

async function readPreviousOutput(outputRoot) {
  let rootInfo;
  try {
    rootInfo = await lstat(outputRoot);
  } catch (error) {
    if (error?.code === 'ENOENT') return { dataFiles: new Map(), runtimePaths: [], retainedData: null };
    throw error;
  }
  if (rootInfo.isSymbolicLink() || !rootInfo.isDirectory()) fail('W01 output path must be a real directory');
  if ((await readdir(outputRoot)).length === 0) return { dataFiles: new Map(), runtimePaths: [], retainedData: null };

  let previous;
  try {
    previous = parseJson(await readFile(path.join(outputRoot, 'receipt.json')), 'previous W01 receipt.json');
  } catch {
    fail('existing W01 output has no verifiable receipt; refusing to overwrite it');
  }
  const hasCandidatePreviewFlag = Object.hasOwn(previous, 'candidatePreviewOnly');
  const previousKeys = ['schemaVersion', 'requestKind', 'buildId', 'dataRevision', 'contentVersion', 'manifestPath', 'manifestSha256', 'source', 'web', 'fixtureOnly', 'publicationEligible', 'formalPublishAllowed', 'deploymentPerformed', 'files'];
  const expectedPreviousKeys = [
    ...previousKeys,
    ...(hasCandidatePreviewFlag ? ['candidatePreviewOnly'] : []),
    ...(Object.hasOwn(previous, 'retainedData') ? ['retainedData'] : [])
  ];
  assertExactKeys(previous, expectedPreviousKeys, 'previous W01 receipt');
  const isLegacyFixture = previous.fixtureOnly === true && !hasCandidatePreviewFlag;
  const isPendingCandidate = previous.fixtureOnly === false && hasCandidatePreviewFlag && previous.candidatePreviewOnly === true;
  if ((!isLegacyFixture && !isPendingCandidate) || previous.schemaVersion !== '1.0.0' || previous.requestKind !== 'isolated-w01-preview-build' ||
      previous.publicationEligible !== false || previous.formalPublishAllowed !== false || previous.deploymentPerformed !== false) {
    fail('previous W01 receipt is not a quarantined fixture or pending-candidate preview');
  }
  validateContentVersion(previous.contentVersion);
  requireArray(previous.files, 'previous W01 receipt.files');
  await assertExactOutputInventory(outputRoot, previous.files);

  const dataFiles = new Map();
  const runtimePaths = [];
  for (const [index, row] of previous.files.entries()) {
    const label = 'previous W01 receipt.files[' + index + ']';
    assertExactKeys(row, ['path', 'sizeBytes', 'sha256'], label);
    const relativeName = safeRelativePath(row.path, label + '.path');
    const bytes = await readRequired(outputRoot, relativeName);
    if (bytes.byteLength !== row.sizeBytes || sha256(bytes) !== row.sha256) fail('existing W01 output does not match its receipt: ' + relativeName);
    if (relativeName.startsWith('data/')) {
      if (!/^data\/[a-f0-9]{64}\/.+/.test(relativeName)) fail('existing W01 data path is not content-addressed: ' + relativeName);
      dataFiles.set(relativeName, { row, bytes });
    } else if (W01_RUNTIME_OUTPUT_PATHS.has(relativeName)) {
      runtimePaths.push(relativeName);
    } else {
      fail('existing W01 output contains an unsupported path: ' + relativeName);
    }
  }

  const previousVersion = parseJson(await readRequired(outputRoot, 'version.json'), 'previous version.json');
  const previousManifestBytes = await readRequired(outputRoot, previous.manifestPath);
  if (sha256(previousManifestBytes) !== previous.manifestSha256) fail('previous W01 manifest hash does not match its receipt');
  const previousManifest = parseJson(previousManifestBytes, 'previous W01 manifest');
  const previousRelease = previousVersion.game_releases?.[0];
  const expectedPackageKind = isPendingCandidate ? 'pending-preview' : 'fixture';
  if (previousVersion.schema_version !== 2 || previousVersion.package_kind !== expectedPackageKind ||
      previousVersion.build_id !== previous.buildId || previousVersion.data_revision !== previous.dataRevision ||
      previousVersion.game_releases?.length !== 1 || previousRelease?.data_revision !== previous.dataRevision ||
      previousRelease?.content_version !== previous.contentVersion || previousRelease?.manifest_path !== '/' + previous.manifestPath ||
      previousRelease?.manifest_sha256 !== previous.manifestSha256 || previousManifest.schemaVersion !== '2.0.0' ||
      previousManifest.dataRevision !== previous.dataRevision || previousManifest.contentVersion !== previous.contentVersion ||
      previousManifest.fixtureOnly !== previous.fixtureOnly || previousManifest.publicationEligible !== false ||
      previousRelease?.game_version !== previousManifest.gameVersion) {
    fail('previous W01 package does not match its quarantined receipt mode and identity');
  }
  return { dataFiles, runtimePaths, retainedData: previous.retainedData ?? null };
}

async function writeOutputs(outputRoot, files, receipt, previousOutput) {
  for (const name of previousOutput.runtimePaths) {
    await unlink(assertChildPath(outputRoot, path.join(outputRoot, ...safeRelativePath(name).split('/')), 'previous W01 runtime file'));
  }
  if (previousOutput.runtimePaths.length > 0 || previousOutput.dataFiles.size > 0) {
    await unlink(assertChildPath(outputRoot, path.join(outputRoot, 'receipt.json'), 'previous W01 receipt'));
  }
  await mkdir(outputRoot, { recursive: true });
  for (const [name, bytes] of files) {
    const target = assertChildPath(outputRoot, path.join(outputRoot, ...name.split('/')), 'W01 output file');
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, bytes);
  }
  const receiptBytes = jsonBytes(receipt);
  await writeFile(assertChildPath(outputRoot, path.join(outputRoot, 'receipt.json'), 'W01 receipt'), receiptBytes);
}

export async function buildW01({ repoRoot = SCRIPT_ROOT, outputRoot = path.join(repoRoot, 'dist-w01'), mode = 'preview', contentVersion } = {}) {
  repoRoot = path.resolve(repoRoot);
  outputRoot = path.resolve(outputRoot);
  if (!['preview', 'candidate-preview', 'formal'].includes(mode)) fail('mode must be preview, candidate-preview, or formal');
  if (outputRoot === path.join(repoRoot, 'dist')) fail('W01 output may not overwrite the production dist directory');

  const inputRoot = path.join(repoRoot, 'content', 'w01');
  const sourceRoot = path.join(inputRoot, 'source');
  const releaseInputBytes = await readRequired(inputRoot, 'release.json');
  const lockBytes = await readRequired(repoRoot, 'source.lock.json');
  const sourceManifestBytes = await readRequired(sourceRoot, 'source-manifest.json');
  const technicalBytes = await readRequired(sourceRoot, 'technical.json');
  const gameChangesBytes = await readRequired(sourceRoot, 'game-changes.json');
  const webAuthoringBytes = await readRequired(inputRoot, 'web-authoring.json');
  const releaseInput = parseJson(releaseInputBytes, 'content/w01/release.json');
  assertExactKeys(releaseInput, ['schemaVersion', 'contentVersion'], 'content/w01/release.json');
  if (releaseInput.schemaVersion !== '1.0.0') fail('content/w01/release.json schemaVersion is unsupported');
  const resolvedContentVersion = validateContentVersion(contentVersion ?? releaseInput.contentVersion);
  const lock = parseJson(lockBytes, 'source.lock.json');
  const sourceManifest = parseJson(sourceManifestBytes, 'source-manifest.json');
  const technical = parseJson(technicalBytes, 'technical.json');
  const sourceGameChanges = parseJson(gameChangesBytes, 'game-changes.json');
  const webAuthoring = parseJson(webAuthoringBytes, 'web-authoring.json');

  if (sha256(jsonBytes(sourceManifest)) !== lock.manifestSha256) fail('source manifest hash does not match source.lock.json');
  for (const name of SOURCE_ARTIFACTS) {
    const bytes = name === 'technical.json' ? technicalBytes : gameChangesBytes;
    verifyFilePin(sourceManifest, name, bytes, name);
  }
  validateSourceInput(lock, sourceManifest, technical, sourceGameChanges, webAuthoring);

  if (mode === 'formal') fail('formal publication is blocked: W01 only builds isolated fixture or pending-candidate previews');

  requireArray(technical.records, 'technical.json records');
  requireArray(technical.sourceRefs, 'technical.json sourceRefs');
  const sourceRecords = technical.records.map((record, index) => {
    const label = 'Source record[' + index + ']';
    validateRecordEnvelope(record, label, 'source');
    if (record.gameReleaseId !== lock.gameReleaseId || !(record.kind in SOURCE_KIND_DOMAIN)) fail(label + ' has an unsupported source kind or release');
    validateSourcePayload(record.kind, record.payload, label + '.payload');
    return record;
  });
  const sourceRefs = validateSourceReferenceClosure(sourceRecords, technical.sourceRefs, 'source');
  const sourceIds = new Set();
  const sourceKindById = new Map();
  for (const record of sourceRecords) {
    if (sourceIds.has(record.recordId)) fail('duplicate Source recordId ' + record.recordId);
    sourceIds.add(record.recordId);
    sourceKindById.set(record.recordId, record.kind);
  }
  const sourceRecordById = new Map(sourceRecords.map(record => [record.recordId, record]));
  validateChainaxeComparisonSource(sourceRecordById, sourceRefs);
  const webInput = validateWebAuthoring(webAuthoring, sourceIds, sourceKindById, sourceRefs, lock.gameReleaseId, sourceRecordById);

  const sourceFlags = [sourceManifest, technical, sourceGameChanges];
  const allPending = sourceRecords.every(record => record.reviewState === 'pending') &&
    sourceGameChanges.changes.every(change => change.reviewState === 'pending') &&
    webInput.records.every(record => record.reviewState === 'pending') &&
    webInput.announcements.every(record => record.reviewState === 'pending');
  if (mode === 'preview') {
    if (sourceFlags.some(input => input.fixtureOnly !== true || input.publicationEligible !== false) || webAuthoring.fixtureOnly !== true) {
      fail('fixture preview mode requires every pinned owner package to be fixture-only and publication-ineligible');
    }
  } else if (sourceFlags.some(input => input.fixtureOnly !== false || input.publicationEligible !== false) || webAuthoring.fixtureOnly !== false || !allPending) {
    fail('candidate-preview mode requires explicit non-fixture, publication-ineligible inputs with all records pending');
  } else if (sourceRefs.some(reference => reference.fixtureOnly === true) || webInput.references.some(reference => reference.fixtureOnly === true) ||
      /^fixture-/i.test(lock.gameReleaseId) || lock.gameVersion === 'fixture-preview') {
    fail('candidate-preview mode may not contain fixture-owned references or fixture release metadata');
  }

  const baseRecords = [...sourceRecords];
  const records = [...baseRecords, ...webInput.records];
  const recordIds = new Set();
  const kindById = new Map();
  for (const record of records) {
    if (recordIds.has(record.recordId)) fail('duplicate shared recordId ' + record.recordId);
    recordIds.add(record.recordId);
    kindById.set(record.recordId, record.kind);
    if (record.reviewState !== 'approved') continue;
  }

  const domainRecords = Object.fromEntries(DOMAIN_KINDS.map(kind => [kind, []]));
  for (const record of sourceRecords) domainRecords[SOURCE_KIND_DOMAIN[record.kind]].push(record);
  for (const record of webInput.records) {
    const targetKind = record.kind === 'presentation' ? sourceKindById.get(record.entityRef) : 'term';
    const domain = targetKind === 'skill' ? 'skills' : targetKind === 'blessing' ? 'blessings' : targetKind === 'weapon' ? 'weapons' : 'terms';
    domainRecords[domain].push(record);
  }
  const gameChangeRecords = sourceGameChanges.changes.map((change, index) => {
    const label = 'Source game change[' + index + ']';
    assertExactKeys(change, ['changeId', 'owner', 'gameReleaseId', 'entityKind', 'recordId', 'operation', 'comparison', 'changedFields', 'evidenceRefs', 'verificationMethod', 'reviewState'], label);
    if (change.owner !== 'source' || change.gameReleaseId !== lock.gameReleaseId || !RECORD_STATES.has(change.reviewState)) fail(label + ' violates the Source game-change contract');
    requireString(change.changeId, label + '.changeId');
    requireString(change.entityKind, label + '.entityKind');
    requireString(change.recordId, label + '.recordId');
    requireString(change.operation, label + '.operation');
    requireString(change.verificationMethod, label + '.verificationMethod');
    requireRefList(change.evidenceRefs, label + '.evidenceRefs');
    if (!Array.isArray(change.changedFields)) fail(label + '.changedFields must be an array');
    for (const [fieldIndex, field] of change.changedFields.entries()) {
      assertExactKeys(field, ['field', 'before', 'after'], label + '.changedFields[' + fieldIndex + ']');
      requireString(field.field, label + '.changedFields[' + fieldIndex + '].field');
    }
    return {
      recordId: change.changeId,
      owner: 'source',
      kind: 'game-change',
      gameReleaseId: change.gameReleaseId,
      payload: {
        changeId: change.changeId,
        entityKind: change.entityKind,
        targetRef: change.recordId,
        operation: change.operation,
        comparison: change.comparison,
        changedFields: change.changedFields,
        evidenceRefs: change.evidenceRefs,
        verificationMethod: change.verificationMethod
      },
      sourceRefs: [],
      reviewState: change.reviewState
    };
  });
  domainRecords['game-changes'].push(...gameChangeRecords);

  const allSharedRecords = [...records, ...gameChangeRecords];
  for (const change of gameChangeRecords) {
    if (recordIds.has(change.recordId)) fail('duplicate game-change recordId ' + change.recordId);
    recordIds.add(change.recordId);
    kindById.set(change.recordId, change.kind);
  }
  validateDomainReferences(allSharedRecords, kindById);
  const domainById = new Map();
  for (const kind of DOMAIN_KINDS) for (const record of domainRecords[kind]) domainById.set(record.recordId, kind);

  const fixtureOnly = sourceManifest.fixtureOnly || technical.fixtureOnly || webAuthoring.fixtureOnly;
  const publicationEligible = false;
  const authoringCommit = currentCommit(repoRoot);
  const sourceDomains = Object.fromEntries(DOMAIN_KINDS.map(kind => [kind, {
    schemaVersion: '2.0.0',
    gameReleaseId: lock.gameReleaseId,
    gameVersion: lock.gameVersion,
    sourceRevision: lock.sourceRevision,
    fixtureOnly,
    publicationEligible,
    records: domainRecords[kind].sort((left, right) => compareUtf8(left.recordId, right.recordId))
  }]));
  const domainBytes = new Map(DOMAIN_KINDS.map(kind => [kind + '.json', jsonBytes(sourceDomains[kind])]));
  const dataRevision = hashNamedFiles(new Map([
    ['source.lock.json', jsonBytes(lock)],
    ['release.json', jsonBytes({ schemaVersion: releaseInput.schemaVersion, contentVersion: resolvedContentVersion })],
    ['source/references.json', jsonBytes(sourceRefs)],
    ['web/references.json', jsonBytes(webInput.references)],
    ['web/authoring-commit.txt', Buffer.from(authoringCommit + '\n')],
    ...domainBytes
  ]));
  const fileRows = DOMAIN_KINDS.map(kind => {
    const name = kind + '.json';
    const bytes = domainBytes.get(name);
    return {
      kind,
      path: name,
      sizeBytes: bytes.byteLength,
      sha256: sha256(bytes),
      dependencies: dependenciesForDomain(kind, domainRecords[kind], domainById, sourceRecordById, webInput.usesNativeOfficialLocalizations)
    };
  });
  const manifest = {
    schemaVersion: '2.0.0',
    gameReleaseId: lock.gameReleaseId,
    gameVersion: lock.gameVersion,
    contentVersion: resolvedContentVersion,
    dataRevision,
    fixtureOnly,
    publicationEligible,
    source: {
      owner: 'source',
      repository: lock.repository,
      commit: lock.commit,
      sourceRevision: lock.sourceRevision,
      manifestSha256: lock.manifestSha256,
      references: sourceRefs
    },
    web: {
      owner: 'web',
      authoringCommit,
      compilerCommit: authoringCommit,
      references: webInput.references
    },
    compatibility: {
      dataContractMajor: 2,
      requiredFeatures: [
        'official-errata-details-v1',
        ...(webInput.usesNativeOfficialLocalizations ? ['official-native-localizations-v1'] : []),
        ...(webInput.usesBlessingTierPresentations ? [BLESSING_TIER_PRESENTATIONS_FEATURE] : [])
      ],
      gameSnapshotRefs: sourceRefs.map(reference => reference.sourceId)
    },
    files: fileRows,
    changeIndexPath: 'game-changes.json'
  };
  const manifestBytes = jsonBytes(manifest);
  const manifestSha256 = sha256(manifestBytes);
  const manifestPath = 'data/' + dataRevision + '/manifest.json';
  const versionManifestPath = '/' + manifestPath;
  const release = {
    game_version: lock.gameVersion,
    content_version: resolvedContentVersion,
    data_revision: dataRevision,
    manifest_path: versionManifestPath,
    manifest_sha256: manifestSha256
  };
  const versionWithoutBuildId = {
    schema_version: 2,
    data_revision: dataRevision,
    build_id: '',
    game_version: lock.gameVersion,
    package_kind: mode === 'candidate-preview' ? 'pending-preview' : 'fixture',
    game_releases: [release]
  };
  const previewBytes = jsonBytes({
    fixtureOnly,
    publicationEligible,
    ...(mode === 'candidate-preview' ? { candidatePreviewOnly: true, warningText: webInput.warningText } : {}),
    announcements: webInput.announcements
  });
  const baseFiles = new Map([
    ['index.html', Buffer.from(previewAssets.html, 'utf8')],
    ['preview.css', Buffer.from(previewAssets.css, 'utf8')],
    ['preview.js', Buffer.from(previewAssets.js, 'utf8')],
    ['preview.json', previewBytes],
    ['robots.txt', Buffer.from('User-agent: *\nDisallow: /\n', 'utf8')],
    ['_headers', Buffer.from('/*\n  Access-Control-Allow-Origin: *\n  X-Robots-Tag: noindex, noarchive\n', 'utf8')],
    ['version-template.json', jsonBytes(versionWithoutBuildId)],
    [manifestPath, manifestBytes],
    ...[...domainBytes].map(([name, bytes]) => ['data/' + dataRevision + '/' + name, bytes])
  ]);
  const buildId = hashNamedFiles(baseFiles);
  const version = { ...versionWithoutBuildId, build_id: buildId };
  const versionBytes = jsonBytes(version);
  const outputFiles = new Map(baseFiles);
  outputFiles.delete('version-template.json');
  addOutput(outputFiles, 'version.json', versionBytes);
  const previousOutput = await readPreviousOutput(outputRoot);
  for (const [name, previousFile] of previousOutput.dataFiles) {
    const currentBytes = outputFiles.get(name);
    if (currentBytes && !currentBytes.equals(previousFile.bytes)) fail('new W01 build conflicts with an existing immutable data URL: ' + name);
    if (!currentBytes) addOutput(outputFiles, name, previousFile.bytes);
  }
  const receiptFileRows = [...outputFiles].map(([name, bytes]) => ({ path: name, sizeBytes: bytes.byteLength, sha256: sha256(bytes) }))
    .sort((left, right) => compareUtf8(left.path, right.path));
  const receipt = {
    schemaVersion: '1.0.0',
    requestKind: 'isolated-w01-preview-build',
    buildId,
    dataRevision,
    contentVersion: resolvedContentVersion,
    manifestPath,
    manifestSha256,
    source: { repository: lock.repository, commit: lock.commit, sourceRevision: lock.sourceRevision, manifestSha256: lock.manifestSha256 },
    web: { authoringCommit },
    fixtureOnly,
    publicationEligible,
    ...(mode === 'candidate-preview' ? { candidatePreviewOnly: true } : {}),
    formalPublishAllowed: false,
    deploymentPerformed: false,
    files: receiptFileRows,
    ...(previousOutput.retainedData ? { retainedData: previousOutput.retainedData } : {})
  };

  await writeOutputs(outputRoot, outputFiles, receipt, previousOutput);
  const result = { buildId, dataRevision, manifestSha256, manifestPath, outputRoot, receipt };
  return result;
}

export async function assertExactOutputInventory(outputRoot, fileRows) {
  const expectedOutputPaths = new Set([...fileRows.map(entry => entry.path), 'receipt.json']);
  if (expectedOutputPaths.size !== fileRows.length + 1) fail('W01 receipt contains duplicate output paths');
  const seenOutputPaths = new Set();
  for (const relativeName of await readdir(outputRoot, { recursive: true })) {
    const absolute = path.join(outputRoot, relativeName);
    const fileInfo = await lstat(absolute);
    if (fileInfo.isSymbolicLink()) fail('W01 output may not contain symbolic links: ' + relativeName);
    if (!fileInfo.isFile()) continue;
    const normalizedName = relativeName.replaceAll(path.sep, '/');
    if (!expectedOutputPaths.has(normalizedName)) fail('W01 output contains an unlisted file: ' + normalizedName);
    seenOutputPaths.add(normalizedName);
  }
  if (seenOutputPaths.size !== expectedOutputPaths.size) fail('W01 output is missing a receipt-listed file');
}

export async function verifyW01Package(outputRoot = path.join(SCRIPT_ROOT, 'dist-w01')) {
  outputRoot = path.resolve(outputRoot);
  const receiptBytes = await readFile(path.join(outputRoot, 'receipt.json'));
  const receipt = parseJson(receiptBytes, 'W01 receipt.json');
  assertExactKeys(receipt, [
    'schemaVersion', 'requestKind', 'buildId', 'dataRevision', 'contentVersion', 'manifestPath', 'manifestSha256', 'source', 'web',
    'fixtureOnly', 'publicationEligible', ...(Object.hasOwn(receipt, 'candidatePreviewOnly') ? ['candidatePreviewOnly'] : []),
    'formalPublishAllowed', 'deploymentPerformed', 'files', 'retainedData'
  ], 'W01 receipt');
  validateContentVersion(receipt.contentVersion);
  const isFixturePackage = receipt.fixtureOnly === true;
  const isPendingPreview = receipt.candidatePreviewOnly === true;
  if (receipt.requestKind !== 'isolated-w01-preview-build' || typeof receipt.fixtureOnly !== 'boolean' ||
      isPendingPreview !== !isFixturePackage || receipt.publicationEligible !== false ||
      receipt.formalPublishAllowed !== false || receipt.deploymentPerformed !== false) fail('W01 receipt is not a quarantined preview build');
  const retainedManifest = parseJson(await readFile(path.join(SCRIPT_ROOT, 'docs', 'w01', 'retained-preview-manifest.json')), 'retained preview manifest');
  assertExactKeys(retainedManifest, ['schemaVersion', 'baselineCommit', 'dataRevision', 'fileCount', 'totalBytes', 'files'], 'retained preview manifest');
  assertExactKeys(receipt.retainedData, ['baselineCommit', 'dataRevision', 'fileCount', 'totalBytes', 'inventorySha256'], 'W01 retainedData receipt');
  const retainedRows = receipt.files.filter(entry => entry.path.startsWith('data/' + retainedManifest.dataRevision + '/'));
  const expectedRows = [...retainedManifest.files].sort((left, right) => compareUtf8(left.path, right.path));
  const actualRows = [...retainedRows].sort((left, right) => compareUtf8(left.path, right.path));
  if (retainedManifest.schemaVersion !== '1.0.0' || retainedManifest.baselineCommit !== '8a4b3db2b1e835f0757f387ca89a19b9092b35ee' ||
      retainedManifest.dataRevision !== '0ae547d78d49c5d5c46b991df3736f9d868eebd98e902b1a62426dc075d3884b' ||
      retainedManifest.fileCount !== 2277 || retainedManifest.totalBytes !== 9709542 ||
      receipt.retainedData.baselineCommit !== retainedManifest.baselineCommit ||
      receipt.retainedData.dataRevision !== retainedManifest.dataRevision ||
      receipt.retainedData.fileCount !== retainedManifest.fileCount ||
      receipt.retainedData.totalBytes !== retainedManifest.totalBytes ||
      receipt.retainedData.inventorySha256 !== sha256(jsonBytes(retainedManifest)) ||
      JSON.stringify(actualRows) !== JSON.stringify(expectedRows)) {
    fail('W01 receipt does not retain the exact pinned predeployment data inventory');
  }
  for (const entry of receipt.files) {
    assertExactKeys(entry, ['path', 'sizeBytes', 'sha256'], 'W01 receipt file row');
    const bytes = await readRequired(outputRoot, entry.path);
    const fileInfo = await lstat(assertChildPath(outputRoot, path.join(outputRoot, ...safeRelativePath(entry.path).split('/')), 'receipt file'));
    if (bytes.byteLength !== entry.sizeBytes || fileInfo.size !== entry.sizeBytes || sha256(bytes) !== entry.sha256) {
      fail('W01 output file does not match receipt: ' + entry.path);
    }
  }
  await assertExactOutputInventory(outputRoot, receipt.files);

  const version = parseJson(await readFile(path.join(outputRoot, 'version.json')), 'version.json');
  if (version.schema_version !== 2 || version.build_id !== receipt.buildId || version.data_revision !== receipt.dataRevision ||
      version.package_kind !== (isPendingPreview ? 'pending-preview' : 'fixture') || !Array.isArray(version.game_releases) || version.game_releases.length !== 1) {
    fail('W01 version.json does not match the quarantined build receipt or D v2 contract');
  }
  const manifestBytes = await readFile(path.join(outputRoot, ...safeRelativePath(receipt.manifestPath).split('/')));
  if (sha256(manifestBytes) !== receipt.manifestSha256) fail('W01 manifest hash does not match the build receipt');
  const manifest = parseJson(manifestBytes, 'W01 manifest');
  const release = version.game_releases[0];
  if (release.data_revision !== receipt.dataRevision || manifest.dataRevision !== receipt.dataRevision || release.content_version !== receipt.contentVersion ||
      manifest.contentVersion !== receipt.contentVersion ||
      release.manifest_path !== '/' + receipt.manifestPath || release.manifest_sha256 !== receipt.manifestSha256 ||
      release.game_version !== manifest.gameVersion) fail('W01 game_releases entry does not match the D v2 manifest contract');
  const features = manifest.compatibility?.requiredFeatures;
  if (manifest.schemaVersion !== '2.0.0' || manifest.compatibility?.dataContractMajor !== 2 ||
      !Array.isArray(features) || !features.includes('official-errata-details-v1') ||
      features.some(feature => !['official-errata-details-v1', 'official-native-localizations-v1', BLESSING_TIER_PRESENTATIONS_FEATURE].includes(feature)) ||
      manifest.changeIndexPath !== 'game-changes.json' || manifest.fixtureOnly !== isFixturePackage || manifest.publicationEligible !== false ||
      manifest.files.length !== 5 || manifest.files.some((file, index) => file.kind !== DOMAIN_KINDS[index] || file.path !== file.kind + '.json')) {
    fail('W01 package does not match the D v2 contract or exact five quarantined shared domains');
  }
  const activeDataRoot = path.join(outputRoot, 'data', receipt.dataRevision);
  const hasNativeOfficialLocalizations = (await Promise.all(manifest.files.map(async file =>
    parseJson(await readRequired(activeDataRoot, file.path), file.kind + '.json').records.some(record => record.payload?.official?.localizations?.['zh-TW']?.origin === 'official'))
  )).some(Boolean);
  if (hasNativeOfficialLocalizations !== features.includes('official-native-localizations-v1')) fail('W01 native-localization feature flag does not match the shared domains');
  const hasBlessingTierPresentations = (await Promise.all(manifest.files.map(async file =>
    parseJson(await readRequired(activeDataRoot, file.path), file.kind + '.json').records.some(record => Object.hasOwn(record.payload ?? {}, 'tierPresentations')))
  )).some(Boolean);
  if (hasBlessingTierPresentations !== features.includes(BLESSING_TIER_PRESENTATIONS_FEATURE)) {
    fail('W01 blessing-tier feature flag does not match the shared domains');
  }
  return { buildId: receipt.buildId, dataRevision: receipt.dataRevision, fileCount: receipt.files.length, fixtureOnly: isFixturePackage, candidatePreviewOnly: isPendingPreview };
}

function parseCliArgs(args) {
  const options = { mode: 'preview', outputRoot: path.join(SCRIPT_ROOT, 'dist-w01') };
  const seen = new Set();
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--formal' && !seen.has(arg)) {
      seen.add(arg);
      options.mode = 'formal';
    } else if (arg === '--candidate-preview' && !seen.has(arg)) {
      seen.add(arg);
      options.mode = 'candidate-preview';
    } else if (arg === '--output' && !seen.has(arg) && args[index + 1]) {
      seen.add(arg);
      options.outputRoot = path.resolve(args[++index]);
    } else if (arg === '--content-version' && !seen.has(arg) && args[index + 1]) {
      seen.add(arg);
      options.contentVersion = validateContentVersion(args[++index]);
    } else {
      fail('Usage: node scripts/w01-build.mjs [--formal | --candidate-preview] [--content-version major.minor.patch] [--output path]');
    }
  }
  return options;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const result = await buildW01(parseCliArgs(process.argv.slice(2)));
    process.stdout.write('Built isolated W01 ' + (result.receipt.candidatePreviewOnly ? 'pending candidate' : 'fixture') + ' preview build_id=' + result.buildId + ' data_revision=' + result.dataRevision + ' output=' + result.outputRoot + '\n');
  } catch (error) {
    process.stderr.write('W01 preview build failed: ' + (error?.message ?? String(error)) + '\n');
    process.exitCode = error?.message?.startsWith('Usage:') ? 2 : 1;
  }
}
