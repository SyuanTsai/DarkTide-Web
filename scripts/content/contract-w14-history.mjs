import { createHash } from 'node:crypto';
import { lstat, readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { validatePublishedContent } from '../../src/published/contract.mjs';

export const W14_HISTORY_SCHEMA = 'w14.historical-player-index.v1';
export const W14_HISTORY_DIRECTORY = 'content/history/1.13.1';
export const W14_HISTORY_OUTPUT_PREFIX = 'history/1.13.1';
export const FIXED_HISTORY_PUBLIC_OUTPUT = Object.freeze({
  manifestByteLength: 4470,
  manifestSha256: '8b6786c6fdbf984b4bb94caadd502d794a0d1211b47a6493dff60463b73164ec',
  projectionByteLength: 766979,
  projectionSha256: '0a9d143d7174f7516bd59b0928c4e06b372480e408ffe7e2fe52f4906a34c6bb',
});

export const FIXED_HISTORY_SOURCE = Object.freeze({
  repository: 'SyuanTsai/DarkTide-Web',
  commit: '61f1dcda6cb80fb1ee2bf595b3b9a082825a912f',
  path: 'content/published/content.json',
  gameVersion: '1.13.1',
  packageKind: 'published',
  schemaVersion: 2,
  byteLength: 3956394,
  sha256: '3f3c24874004d67aa7e03b045ca5f9a7409a0bea3e9136247852c26ec2c34bcc',
  staticBackup: Object.freeze({
    releaseTag: 'site-61f1dcda6cb80fb1ee2bf595b3b9a082825a912f-39541306251-1',
    deploymentRun: 'https://github.com/SyuanTsai/DarkTide-Web/actions/runs/39541306251',
    buildId: '75a9a5bbb34153ef8d891a56401d3c457819b32482b54adf288419b7e51efff8',
    dataRevision: '0ae547d78d49c5d5c46b991df3736f9d868eebd98e902b1a62426dc075d3884b',
    archiveName: 'static-site.tar.gz',
    archiveByteLength: 1288950,
    archiveSha256: '7db6888ded82f3442f2d37f8a6cf7c10cf90bf80cd58476c6557ba444c72a555',
    releaseUrl: 'https://github.com/SyuanTsai/DarkTide-Web/releases/tag/site-61f1dcda6cb80fb1ee2bf595b3b9a082825a912f-39541306251-1',
    archiveUrl: 'https://github.com/SyuanTsai/DarkTide-Web/releases/download/site-61f1dcda6cb80fb1ee2bf595b3b9a082825a912f-39541306251-1/static-site.tar.gz',
  }),
});

const REQUIRED_COLLECTIONS = Object.freeze(['skills', 'weapons', 'blessings', 'marks', 'variants']);
const ALLOWED_INPUT_FILES = new Set(['manifest.json', 'player-index.json', 'source-content.json']);
const MAX_HISTORY_SOURCE_BYTES = 4_000_000;
const MAX_HISTORY_PROJECTION_BYTES = 2_000_000;
const MAX_HISTORY_MANIFEST_BYTES = 64_000;

const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const jsonBytes = value => Buffer.from(JSON.stringify(value, null, 2) + '\n', 'utf8');
const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);

function decodeJsonBytes(bytes, label) {
  if (!Buffer.isBuffer(bytes)) throw new TypeError(`${label} must be a Buffer`);
  let text;
  try { text = new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
  catch { throw new Error(`${label} is not valid UTF-8`); }
  if (!Buffer.from(text, 'utf8').equals(bytes)) throw new Error(`${label} is not canonical UTF-8`);
  try { return JSON.parse(text); }
  catch { throw new Error(`${label} is not valid JSON`); }
}

function parsePublishedHistorySource(sourceBytes) {
  const source = decodeJsonBytes(sourceBytes, 'fixed 1.13.1 history source');
  if (source.schema_version !== FIXED_HISTORY_SOURCE.schemaVersion
    || source.package_kind !== FIXED_HISTORY_SOURCE.packageKind
    || source.game_version !== FIXED_HISTORY_SOURCE.gameVersion) {
    throw new Error('fixed 1.13.1 history source identity differs from the pinned published input');
  }
  validatePublishedContent(source);
  return source;
}

function assertFixedHistorySource(sourceBytes) {
  if (!Buffer.isBuffer(sourceBytes) || sourceBytes.byteLength !== FIXED_HISTORY_SOURCE.byteLength
    || sha256(sourceBytes) !== FIXED_HISTORY_SOURCE.sha256) {
    throw new Error('fixed 1.13.1 history source does not match the pinned published bytes');
  }
  return parsePublishedHistorySource(sourceBytes);
}

function uniqueMap(rows, idField, collection) {
  const map = new Map();
  for (const row of rows) {
    const id = row?.[idField];
    if (typeof id !== 'string' || !id.trim()) throw new Error(`historical ${collection} has a missing stable identity`);
    if (map.has(id)) throw new Error(`duplicate ${collection} identity: ${id}`);
    map.set(id, row);
  }
  return map;
}

function cleanText(value) { return typeof value === 'string' && value.trim() ? value : null; }
function categoryLabel(value) {
  if (value === 'melee') return '近戰';
  if (value === 'ranged') return '遠程';
  if (value === 'mixed') return '混合';
  return typeof value === 'string' && /[\u3400-\u9fff]/u.test(value) ? value : null;
}

function makeEntry(kind, id, name, optional = {}) {
  if (!cleanText(name)) return null;
  const entry = { kind, id, name };
  if (optional.category) entry.category = optional.category;
  if (optional.summary) entry.summary = optional.summary;
  if (Object.hasOwn(optional, 'trigger')) entry.trigger = optional.trigger;
  if (optional.relatedNames?.length) entry.relatedNames = optional.relatedNames;
  if (optional.parentName) entry.parentName = optional.parentName;
  if (Number.isSafeInteger(optional.relatedCount)) entry.relatedCount = optional.relatedCount;
  if (Array.isArray(optional.definedTiers) && optional.definedTiers.length) entry.definedTiers = optional.definedTiers;
  return entry;
}

/** Project only the player fields from an already schema-shaped historical published content object. */
export function projectW14HistoryPlayerRows(source) {
  if (!isObject(source) || source.schema_version !== FIXED_HISTORY_SOURCE.schemaVersion
    || source.package_kind !== FIXED_HISTORY_SOURCE.packageKind || source.game_version !== FIXED_HISTORY_SOURCE.gameVersion
    || REQUIRED_COLLECTIONS.some(collection => !Array.isArray(source[collection]))) {
    throw new Error('historical player projection requires the 1.13.1 published collections');
  }
  const skillIds = new Set();
  for (const row of source.skills) {
    const id = `${row.archetype}/${row.skill_id}`;
    if (!row.archetype || !row.skill_id || skillIds.has(id)) throw new Error(`duplicate or missing skill identity: ${id}`);
    skillIds.add(id);
  }
  const weaponById = uniqueMap(source.weapons, 'weapon_id', 'weapon');
  const blessingById = uniqueMap(source.blessings, 'blessing_id', 'blessing');
  uniqueMap(source.marks, 'mark_id', 'mark');
  uniqueMap(source.variants, 'variant_id', 'variant');
  const entries = [];
  const excluded = { skills: 0, weapons: 0, blessings: 0, marks: 0, variants: 0 };
  const excludedReasons = Object.fromEntries(REQUIRED_COLLECTIONS.map(kind => [kind, {
    missingTraditionalChineseName: 0,
    missingLocalizedParent: 0,
  }]));

  for (const row of source.skills) {
    const id = `${row.archetype}/${row.skill_id}`;
    const entry = makeEntry('skill', id, row.name_zh_tw, {
      category: cleanText(row.category), summary: cleanText(row.effect_zh_tw),
    });
    if (entry) entries.push(entry);
    else { excluded.skills++; excludedReasons.skills.missingTraditionalChineseName++; }
  }

  const marksByWeapon = new Map();
  for (const mark of source.marks) {
    if (!weaponById.has(mark.weapon_id)) continue;
    const values = marksByWeapon.get(mark.weapon_id) ?? [];
    values.push(mark);
    marksByWeapon.set(mark.weapon_id, values);
  }
  for (const row of source.weapons) {
    const relatedNames = (marksByWeapon.get(row.weapon_id) ?? []).map(mark => cleanText(mark.name_zh_tw)).filter(Boolean);
    const entry = makeEntry('weapon', row.weapon_id, row.name_zh_tw, {
      category: categoryLabel(row.category), relatedNames,
    });
    if (entry) entries.push(entry);
    else { excluded.weapons++; excludedReasons.weapons.missingTraditionalChineseName++; }
  }

  const variantsByBlessing = new Map();
  for (const variant of source.variants) {
    if (variant.blessing_id && blessingById.has(variant.blessing_id)) {
      const values = variantsByBlessing.get(variant.blessing_id) ?? [];
      values.push(variant);
      variantsByBlessing.set(variant.blessing_id, values);
    }
  }
  for (const row of source.blessings) {
    const relatedCount = variantsByBlessing.get(row.blessing_id)?.length ?? 0;
    const entry = makeEntry('blessing', row.blessing_id, row.name_zh_tw, {
      category: categoryLabel(row.category),
      summary: cleanText(row.effect_zh_tw),
      trigger: cleanText(row.trigger_zh_tw),
      relatedCount,
    });
    if (entry) entries.push(entry);
    else { excluded.blessings++; excludedReasons.blessings.missingTraditionalChineseName++; }
  }

  for (const row of source.marks) {
    const parent = weaponById.get(row.weapon_id);
    const parentName = cleanText(parent?.name_zh_tw);
    const entry = parentName && makeEntry('mark', row.mark_id, row.name_zh_tw, { parentName });
    if (entry) entries.push(entry);
    else {
      excluded.marks++;
      if (!cleanText(row.name_zh_tw)) excludedReasons.marks.missingTraditionalChineseName++;
      else excludedReasons.marks.missingLocalizedParent++;
    }
  }

  for (const row of source.variants) {
    const blessing = row.blessing_id ? blessingById.get(row.blessing_id) : null;
    const weapon = row.weapon_id ? weaponById.get(row.weapon_id) : null;
    const blessingName = cleanText(blessing?.name_zh_tw);
    const weaponName = cleanText(weapon?.name_zh_tw);
    const parentName = blessingName ?? weaponName;
    if (!parentName) {
      excluded.variants++;
      excludedReasons.variants.missingLocalizedParent++;
      continue;
    }
    const relationLabel = blessingName ? '（祝福變體）' : '（武器相關資料）';
    const tiers = Array.isArray(row.defined_tiers)
      && row.defined_tiers.length > 0
      && row.defined_tiers.every(tier => Number.isInteger(tier) && tier >= 1 && tier <= 4)
      ? [...row.defined_tiers] : null;
    const entry = makeEntry('variant', row.variant_id, parentName + relationLabel, {
      category: categoryLabel(blessing?.category ?? weapon?.category),
      summary: cleanText(row.effect_zh_tw),
      definedTiers: tiers,
    });
    if (entry) entries.push(entry);
    else { excluded.variants++; excludedReasons.variants.missingLocalizedParent++; }
  }

  const projection = {
    schemaVersion: W14_HISTORY_SCHEMA,
    gameVersion: FIXED_HISTORY_SOURCE.gameVersion,
    counts: {
      skills: source.skills.length,
      weapons: source.weapons.length,
      blessings: source.blessings.length,
      marks: source.marks.length,
      variants: source.variants.length,
    },
    entries,
  };
  const report = {
    sourceCounts: projection.counts,
    projectedCounts: Object.fromEntries(REQUIRED_COLLECTIONS.map(kind => [kind, entries.filter(entry => entry.kind === kind.slice(0, -1)).length])),
    excluded,
    excludedReasons,
  };
  return { projection, report, projectionBytes: jsonBytes(projection) };
}

/** Build a player-facing projection only after verifying the exact previously published 1.13.1 package. */
export function createW14HistoryPlayerProjection(sourceBytes) {
  return projectW14HistoryPlayerRows(assertFixedHistorySource(sourceBytes));
}

/** Bind the player projection to the exact public source input and verified static backup. */
export function createW14HistoryManifest(sourceBytes, projectionBytes, report) {
  assertFixedHistorySource(sourceBytes);
  if (!Buffer.isBuffer(projectionBytes) || projectionBytes.byteLength > MAX_HISTORY_PROJECTION_BYTES) {
    throw new Error('historical player projection exceeds its fixed output bound');
  }
  return {
    schemaVersion: W14_HISTORY_SCHEMA,
    gameVersion: FIXED_HISTORY_SOURCE.gameVersion,
    source: {
      repository: FIXED_HISTORY_SOURCE.repository,
      commit: FIXED_HISTORY_SOURCE.commit,
      path: FIXED_HISTORY_SOURCE.path,
      gameVersion: FIXED_HISTORY_SOURCE.gameVersion,
      packageKind: FIXED_HISTORY_SOURCE.packageKind,
      schemaVersion: FIXED_HISTORY_SOURCE.schemaVersion,
      byteLength: FIXED_HISTORY_SOURCE.byteLength,
      sha256: FIXED_HISTORY_SOURCE.sha256,
      staticBackup: structuredClone(FIXED_HISTORY_SOURCE.staticBackup),
    },
    projection: {
      path: 'player-index.json',
      byteLength: projectionBytes.byteLength,
      sha256: sha256(projectionBytes),
      counts: report.projectedCounts,
      excludedCounts: report.excluded,
      excludedReasons: report.excludedReasons,
      fieldAllowlist: {
        skills: ['skill_id', 'name_zh_tw', 'category', 'effect_zh_tw'],
        weapons: ['weapon_id', 'name_zh_tw', 'category', 'mark_ids->marks.name_zh_tw'],
        blessings: ['blessing_id', 'name_zh_tw', 'category', 'effect_zh_tw', 'trigger_zh_tw', 'variant_ids->variants'],
        marks: ['mark_id', 'name_zh_tw', 'weapon_id->weapons.name_zh_tw'],
        variants: ['variant_id', 'blessing_id->blessings.name_zh_tw', 'weapon_id->weapons.name_zh_tw', 'effect_zh_tw', 'defined_tiers'],
      },
      excludedFields: ['claims', 'tier_claims', 'assets', 'bindings', 'routes', 'sources', 'talent_trees', 'source_ids', 'archetype'],
    },
    fullPlayerSnapshot: FIXED_HISTORY_SOURCE.staticBackup.archiveUrl,
    technicalSourceRepository: 'https://github.com/SyuanTsai/DarkTide-Source-Data',
    projectionReport: report,
  };
}

export function verifyW14HistoryPackage({ sourceBytes, projectionBytes, manifestBytes }) {
  if (!Buffer.isBuffer(sourceBytes) || sourceBytes.byteLength > MAX_HISTORY_SOURCE_BYTES) {
    throw new Error('historical source input exceeds its fixed byte bound');
  }
  if (!Buffer.isBuffer(projectionBytes) || projectionBytes.byteLength > MAX_HISTORY_PROJECTION_BYTES) {
    throw new Error('historical player projection exceeds its fixed byte bound');
  }
  if (!Buffer.isBuffer(manifestBytes) || manifestBytes.byteLength > MAX_HISTORY_MANIFEST_BYTES) {
    throw new Error('historical manifest exceeds its fixed byte bound');
  }
  assertFixedHistorySource(sourceBytes);
  const manifest = decodeJsonBytes(manifestBytes, 'historical player manifest');
  const generated = createW14HistoryPlayerProjection(sourceBytes);
  if (!generated.projectionBytes.equals(projectionBytes)) throw new Error('historical projection bytes differ from the fixed source field allowlist');
  const expectedManifest = createW14HistoryManifest(sourceBytes, projectionBytes, generated.report);
  if (!jsonBytes(expectedManifest).equals(manifestBytes)) throw new Error('historical manifest does not bind the exact source and projection bytes');
  const publicPackage = verifyW14HistoryPublicFiles({ manifestBytes, projectionBytes });
  const projection = publicPackage.projection;
  return { manifest, projection, report: generated.report };
}

/** Verify exactly the fixed public player files without requiring raw technical input in the static artifact. */
export function verifyW14HistoryPublicFiles({ manifestBytes, projectionBytes }) {
  if (!Buffer.isBuffer(manifestBytes) || manifestBytes.byteLength !== FIXED_HISTORY_PUBLIC_OUTPUT.manifestByteLength ||
      sha256(manifestBytes) !== FIXED_HISTORY_PUBLIC_OUTPUT.manifestSha256) {
    throw new Error('historical public manifest differs from its fixed 1.13.1 bytes');
  }
  if (!Buffer.isBuffer(projectionBytes) || projectionBytes.byteLength !== FIXED_HISTORY_PUBLIC_OUTPUT.projectionByteLength ||
      sha256(projectionBytes) !== FIXED_HISTORY_PUBLIC_OUTPUT.projectionSha256) {
    throw new Error('historical public player projection differs from its fixed 1.13.1 bytes');
  }
  const manifest = decodeJsonBytes(manifestBytes, 'historical player manifest');
  if (manifest.schemaVersion !== W14_HISTORY_SCHEMA || manifest.gameVersion !== FIXED_HISTORY_SOURCE.gameVersion ||
      manifest.source?.sha256 !== FIXED_HISTORY_SOURCE.sha256 || manifest.projection?.path !== 'player-index.json' ||
      manifest.projection?.sha256 !== FIXED_HISTORY_PUBLIC_OUTPUT.projectionSha256 ||
      manifest.projection?.byteLength !== FIXED_HISTORY_PUBLIC_OUTPUT.projectionByteLength) {
    throw new Error('historical public manifest identity does not match its fixed input');
  }
  const projection = decodeJsonBytes(projectionBytes, 'historical player projection');
  if (projection.schemaVersion !== W14_HISTORY_SCHEMA || projection.gameVersion !== FIXED_HISTORY_SOURCE.gameVersion ||
      !Array.isArray(projection.entries) || !isObject(projection.counts)) {
    throw new Error('historical public projection has an invalid fixed schema');
  }
  return { manifest, projection };
}

async function readBoundedRegularFile(root, relativePath, maxBytes) {
  const target = path.resolve(root, ...relativePath.split('/'));
  const relative = path.relative(path.resolve(root), target);
  if (!relative || relative === '..' || relative.startsWith('..' + path.sep) || path.isAbsolute(relative)) {
    throw new Error('historical package path escaped its fixed root');
  }
  let current = path.resolve(root);
  const segments = relativePath.split('/');
  for (let index = 0; index < segments.length; index++) {
    current = path.join(current, segments[index]);
    const info = await lstat(current).catch(error => error.code === 'ENOENT' ? null : Promise.reject(error));
    if (!info || info.isSymbolicLink()) throw new Error(`historical package input is missing or linked: ${relativePath}`);
    if (index < segments.length - 1 && !info.isDirectory()) throw new Error(`historical package parent is not a directory: ${relativePath}`);
    if (index === segments.length - 1 && !info.isFile()) throw new Error(`historical package input is not a regular file: ${relativePath}`);
    if (index === segments.length - 1 && info.size > maxBytes) throw new Error(`historical package input exceeds its fixed byte bound: ${relativePath}`);
  }
  return readFile(target);
}

/** Verify the complete local history source package and return only its two player-public files. */
export async function loadW14HistoryStaticFiles(root) {
  if (typeof root !== 'string' || !root) throw new TypeError('repository root is required');
  const sourceBytes = await readBoundedRegularFile(root, `${W14_HISTORY_DIRECTORY}/source-content.json`, MAX_HISTORY_SOURCE_BYTES);
  const projectionBytes = await readBoundedRegularFile(root, `${W14_HISTORY_DIRECTORY}/player-index.json`, MAX_HISTORY_PROJECTION_BYTES);
  const manifestBytes = await readBoundedRegularFile(root, `${W14_HISTORY_DIRECTORY}/manifest.json`, MAX_HISTORY_MANIFEST_BYTES);
  const directory = path.join(root, ...W14_HISTORY_DIRECTORY.split('/'));
  const entries = await readdir(directory, { withFileTypes: true });
  if (entries.length !== ALLOWED_INPUT_FILES.size || entries.some(entry => !entry.isFile() || entry.isSymbolicLink() || !ALLOWED_INPUT_FILES.has(entry.name))) {
    throw new Error('historical package directory contains an unapproved file');
  }
  verifyW14HistoryPackage({ sourceBytes, projectionBytes, manifestBytes });
  return new Map([
    [`${W14_HISTORY_OUTPUT_PREFIX}/manifest.json`, manifestBytes],
    [`${W14_HISTORY_OUTPUT_PREFIX}/player-index.json`, projectionBytes],
  ]);
}

export async function generateW14HistoryPackage(root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')) {
  const sourceBytes = await readBoundedRegularFile(root, `${W14_HISTORY_DIRECTORY}/source-content.json`, MAX_HISTORY_SOURCE_BYTES);
  const generated = createW14HistoryPlayerProjection(sourceBytes);
  const manifestBytes = jsonBytes(createW14HistoryManifest(sourceBytes, generated.projectionBytes, generated.report));
  const directory = path.join(root, ...W14_HISTORY_DIRECTORY.split('/'));
  await Promise.all([
    writeFile(path.join(directory, 'player-index.json'), generated.projectionBytes),
    writeFile(path.join(directory, 'manifest.json'), manifestBytes),
  ]);
  verifyW14HistoryPackage({ sourceBytes, projectionBytes: generated.projectionBytes, manifestBytes });
  return {
    gameVersion: FIXED_HISTORY_SOURCE.gameVersion,
    sourceBytes: sourceBytes.length,
    sourceSha256: sha256(sourceBytes),
    projectionBytes: generated.projectionBytes.length,
    projectionSha256: sha256(generated.projectionBytes),
    projectedCounts: generated.report.projectedCounts,
    excludedCounts: generated.report.excluded,
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (process.argv.length !== 3 || process.argv[2] !== '--generate') throw new Error('Usage: node scripts/content/contract-w14-history.mjs --generate');
    process.stdout.write(JSON.stringify(await generateW14HistoryPackage()) + '\n');
  } catch (error) {
    process.stderr.write('W14 history projection failed: ' + (error?.message ?? String(error)) + '\n');
    process.exitCode = 1;
  }
}
