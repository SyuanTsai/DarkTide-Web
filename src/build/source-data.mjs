import { readFile, lstat } from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const execute = promisify(execFile);
export const CATEGORIES = ['skills', 'weapons', 'blessings', 'terms'];
export const SUPPORTED_SCHEMA_VERSIONS = Object.freeze({ '1.0.0': { extended: false, mechanics: false }, '1.1.0': { extended: true, mechanics: false }, '1.2.0': { extended: true, mechanics: true } });
const versionPattern = /^[0-9]+(?:\.[0-9]+){1,3}$/;
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const keysOnly = (value, keys) => object(value) && Object.keys(value).every(key => keys.includes(key));
const requireValue = (condition, message) => { if (!condition) throw new Error(`Source-Data: ${message}`); };
const pointer = x => typeof x === 'string' && /^(\/([^~/]|~[01])*)+$/.test(x);
const location = x => keysOnly(x, ['path', 'line']) && typeof x.path === 'string' && x.path.length > 0 && Number.isInteger(x.line) && x.line >= 1;
const locations = x => Array.isArray(x) && x.length > 0 && x.every(location);
const refId = /^[A-Za-z0-9_./-]+#[A-Za-z0-9_.:\[\]-]+$/;
const unknowns = ['NOT_VERIFIED', 'SOURCE_UNAVAILABLE', 'CONFLICTING_EVIDENCE', 'NOT_EXPOSED_BY_SOURCE', 'DYNAMIC_VALUE'];
function mechanics(value) {
  const scalar = x => x === null || typeof x === 'string' || typeof x === 'boolean' || typeof x === 'number' && Number.isFinite(x);
  return object(value) && Object.entries(value).every(([key, p]) => /^[a-z][a-z0-9_]*(\.[a-z0-9_]+){0,7}$/.test(key)
    && keysOnly(p, ['value', 'unit', 'unknown']) && Object.hasOwn(p, 'value') && (scalar(p.value) || Array.isArray(p.value) && p.value.every(scalar))
    && (!Object.hasOwn(p, 'unit') || typeof p.unit === 'string' && /^[a-z][a-z0-9-]*$/.test(p.unit))
    && (p.value === null ? unknowns.includes(p.unknown) : !Object.hasOwn(p, 'unknown')));
}

async function regularBytes(directory, relative) {
  let current = directory;
  for (const part of relative.split('/')) {
    current = path.join(current, part);
    const info = await lstat(current).catch(() => null);
    requireValue(info && !info.isSymbolicLink(), `${relative} missing or symbolic link`);
  }
  requireValue((await lstat(current)).isFile(), `${relative} must be a file`);
  return readFile(current);
}
function parse(bytes, label) {
  try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); }
  catch { throw new Error(`Source-Data: invalid JSON in ${label}`); }
}
function params(value, label) {
  requireValue(object(value), `${label} params required`);
  for (const [key, param] of Object.entries(value)) {
    requireValue(object(param) && Object.hasOwn(param, 'value'), `${label} params.${key} invalid`);
    requireValue(param.value !== null || typeof param.unknown === 'string', `${label} params.${key} null without unknown`);
  }
}
function validateDamageProfiles(v, label) {
  const unknowns = [null, 'NOT_VERIFIED', 'SOURCE_UNAVAILABLE', 'CONFLICTING_EVIDENCE', 'NOT_EXPOSED_BY_SOURCE', 'DYNAMIC_VALUE'];
  const loc = x => keysOnly(x, ['path', 'line']) && typeof x.path === 'string' && x.path.length > 0 && Number.isInteger(x.line) && x.line >= 1;
  const power = x => keysOnly(x, ['kind', 'min', 'max', 'unknown', 'source']) && ['fixed', 'lerp', 'unknown'].includes(x.kind) && unknowns.includes(x.unknown) && loc(x.source) && (x.kind === 'unknown' ? x.min === null && x.max === null && x.unknown !== null : Number.isFinite(x.min) && Number.isFinite(x.max) && x.unknown === null);
  const level = x => keysOnly(x, ['value', 'unknown', 'source']) && unknowns.includes(x.unknown) && loc(x.source) && (x.value === null ? x.unknown !== null : Number.isFinite(x.value) && x.unknown === null);
  const binding = x => keysOnly(x, ['action', 'kind', 'template', 'powerLevel', 'source']) && typeof x.action === 'string' && x.action.length > 0 && ['action', 'hitScan', 'projectile', 'shotshell', 'flamerGas', 'explosion'].includes(x.kind) && (x.template === null || typeof x.template === 'string') && loc(x.source) && (['hitScan', 'projectile'].includes(x.kind) ? typeof x.template === 'string' && x.template.length > 0 && level(x.powerLevel) : !Object.hasOwn(x, 'powerLevel'));
  const distribution = x => keysOnly(x, ['target', 'range', 'attack', 'impact']) && (x.target === null || x.target === 'default' || Number.isInteger(x.target) && x.target >= 1) && [null, 'near', 'far'].includes(x.range) && power(x.attack) && power(x.impact);
  requireValue(Array.isArray(v.damageProfiles) && v.damageProfiles.every(x => keysOnly(x, ['id', 'distributions', 'bindings', 'unknown', 'source']) && typeof x.id === 'string' && x.id.length > 0 && Array.isArray(x.distributions) && x.distributions.every(distribution) && Array.isArray(x.bindings) && x.bindings.every(binding) && unknowns.includes(x.unknown) && loc(x.source)), `${label} damageProfiles invalid`);
  const ids = new Set(v.damageProfiles.map(x => x.id));
  requireValue(v.attackCombos.every(c => c.steps.every(s => s.damageProfile === null || ids.has(s.damageProfile))), `${label} damageProfile reference invalid`);
}
function validateItem(item, category, ids, features) {
  const label = `${category}/${item?.id}`;
  requireValue(object(item) && typeof item.id === 'string' && item.id.startsWith(`darktide:${category === 'blessings' ? 'blessing' : category.slice(0, -1)}:`), `${label} invalid id`);
  requireValue(!ids.has(item.id), `${label} duplicate id`); ids.add(item.id);
  requireValue(typeof item.key === 'string' && item.key.length > 0, `${label} key required`);
  requireValue(object(item.name) && ['official', 'glossary', 'internal'].includes(item.name.origin)
    && [item.name.zh, item.name.en].every(x => x === null || typeof x === 'string'), `${label} name invalid`);
  requireValue(object(item.official) && ['zh', 'en'].every(key => item.official[key] === null || typeof item.official[key] === 'string'), `${label} official invalid`);
  requireValue(object(item.explanation) && ['effect', 'conditions', 'calculation', 'notes', 'extra'].every(key => typeof item.explanation[key] === 'string'), `${label} explanation invalid`);
  requireValue(keysOnly(item.explanation, ['effect', 'conditions', 'calculation', 'notes', 'extra', 'effectOrigin']), `${label} explanation invalid`);
  requireValue(!Object.hasOwn(item.explanation, 'effectOrigin') || (features.extended && ['skills', 'blessings'].includes(category) && ['official', 'unofficial-translation'].includes(item.explanation.effectOrigin)), `${label} effectOrigin invalid`);
  requireValue(!Object.hasOwn(item, 'retainedFrom') || (features.extended && keysOnly(item.retainedFrom, ['gameVersion','sourceCommit','textBatch']) && typeof item.retainedFrom.gameVersion === 'string' && versionPattern.test(item.retainedFrom.gameVersion) && typeof item.retainedFrom.sourceCommit === 'string' && /^[a-fA-F0-9]{40}$/.test(item.retainedFrom.sourceCommit) && typeof item.retainedFrom.textBatch === 'string' && /^[A-Za-z0-9._-]{1,128}$/.test(item.retainedFrom.textBatch)), `${label} retainedFrom invalid`);
  requireValue(Array.isArray(item.errata) && item.errata.every(x => keysOnly(x, ['locale','official','corrected','valueRefs','sources','anchor']) && ['en', 'zh'].includes(x.locale)
    && ['official', 'corrected'].every(key => typeof x[key] === 'string') && Array.isArray(x.valueRefs) && x.valueRefs.length > 0 && x.valueRefs.every(pointer) && locations(x.sources)), `${label} errata invalid`);
  requireValue(item.errata.every(x => !Object.hasOwn(x, 'anchor') || (keysOnly(x.anchor, ['field','locale','text','occurrence','itemId','param','tier']) && ['official', 'name', 'displayParameter'].includes(x.anchor.field) && x.anchor.locale === x.locale && typeof x.anchor.text === 'string' && x.anchor.text.length > 0 && Number.isInteger(x.anchor.occurrence) && x.anchor.occurrence >= 1 && (!Object.hasOwn(x.anchor, 'itemId') || typeof x.anchor.itemId === 'string' && /^darktide:(skill|weapon|blessing|term):[a-z0-9_.:-]+$/.test(x.anchor.itemId)) && (x.anchor.field === 'displayParameter' ? typeof x.anchor.param === 'string' && /^[a-z][a-z0-9_]*$/.test(x.anchor.param) && (!Object.hasOwn(x.anchor, 'tier') || Number.isInteger(x.anchor.tier) && x.anchor.tier >= 1 && x.anchor.tier <= 4) && ((x.anchor.itemId?.startsWith('darktide:blessing:') ?? (category === 'blessings')) ? Object.hasOwn(x.anchor, 'tier') : true) : !Object.hasOwn(x.anchor, 'param') && !Object.hasOwn(x.anchor, 'tier')))), `${label} errata anchor invalid`);
  requireValue(object(item.source) && /^[a-fA-F0-9]{40}$/.test(item.source.commit) && Array.isArray(item.source.files), `${label} source invalid`);
  requireValue(!Object.hasOwn(item.source, 'valueSources') || features.mechanics && object(item.source.valueSources) && Object.entries(item.source.valueSources).every(([key, value]) => pointer(key) && locations(value)), `${label} valueSources invalid`);
  requireValue(!Object.hasOwn(item.source, 'codeRefs') || features.mechanics && object(item.source.codeRefs) && Object.entries(item.source.codeRefs).every(([key, value]) => refId.test(key) && keysOnly(value, ['path','symbol','sha256']) && typeof value.path === 'string' && typeof value.symbol === 'string' && key === `${value.path}#${value.symbol}` && typeof value.sha256 === 'string' && /^[a-f0-9]{64}$/.test(value.sha256)), `${label} codeRefs invalid`);
  requireValue(!Object.hasOwn(item, 'citations') || features.mechanics && ['skills','blessings'].includes(category) && Array.isArray(item.citations) && item.citations.every(c => keysOnly(c, ['section','text','codeRefs','valueRefs']) && ['effect','conditions','calculation','notes','extra'].includes(c.section) && typeof c.text === 'string' && c.text.length > 0 && Array.isArray(c.codeRefs) && c.codeRefs.every(x => typeof x === 'string' && refId.test(x)) && new Set(c.codeRefs).size === c.codeRefs.length && Array.isArray(c.valueRefs) && c.valueRefs.every(pointer) && new Set(c.valueRefs).size === c.valueRefs.length && c.codeRefs.length + c.valueRefs.length > 0), `${label} citations invalid`);
  const v = item.values; requireValue(object(v), `${label} values required`); params(v.params, label);
  requireValue(!Object.hasOwn(v, 'mechanics') || features.mechanics && ['skills','blessings'].includes(category) && mechanics(v.mechanics), `${label} mechanics invalid`);
  requireValue(!Object.hasOwn(v, 'damageProfiles') || (category === 'weapons' && features.extended), `${label} damageProfiles forbidden`);
  if (category === 'skills') requireValue(['archetype', 'tree', 'nodeType'].every(key => typeof v[key] === 'string') && Array.isArray(v.parents) && Number.isInteger(v.maxPoints), `${label} skill values invalid`);
  if (category === 'weapons') requireValue(['family', 'mark', 'weaponType'].every(key => typeof v[key] === 'string' && v[key]) && ['archetypes', 'actions', 'bars', 'blessings'].every(key => Array.isArray(v[key])), `${label} weapon values invalid`);
  if (category === 'weapons') {
    requireValue(v.actions.every(action => object(action) && object(action.name) && ['zh','en'].every(key => action.name[key] === null || typeof action.name[key] === 'string')), `${label} weapon actions invalid`);
    requireValue(v.bars.every(bar => object(bar) && object(bar.name) && ['zh','en'].every(key => bar.name[key] === null || typeof bar.name[key] === 'string') && Array.isArray(bar.stats)
      && bar.stats.every(stat => object(stat) && object(stat.name) && ['zh','en'].every(key => stat.name[key] === null || typeof stat.name[key] === 'string') && Number.isFinite(stat.min) && Number.isFinite(stat.max))), `${label} weapon bars invalid`);
    if (!features.extended) requireValue(!Object.hasOwn(v, 'curves') && !Object.hasOwn(v, 'attackCombos') && v.bars.every(b => b.stats.every(s => !Object.hasOwn(s, 'curveId'))), `${label} 1.1.0 weapon fields forbidden`);
    else {
      const source = x => object(x) && typeof x.path === 'string' && x.path.length > 0 && Number.isInteger(x.line) && x.line >= 1;
      const name = x => object(x) && ['zh', 'en'].every(k => x[k] === null || typeof x[k] === 'string');
      const unknowns = [null, 'LERP_T_OUT_OF_RANGE', 'NONLINEAR_COMBINATION', 'NONLINEAR_LERP', 'CONDITIONAL_CHAIN', 'CHAIN_TARGET_NOT_FOUND', 'CHAIN_START_AMBIGUOUS', 'CHAIN_CYCLE_WITHOUT_ATTACK', 'DYNAMIC_VALUE', 'REFERENCE_NOT_FOUND', 'DAMAGE_PROFILE_BINDING_NOT_FOUND'];
      requireValue(Array.isArray(v.curves) && v.curves.every(c => object(c) && ['id','bar','stat'].every(k => typeof c[k] === 'string') && name(c.name) && object(c.input) && c.input.source === 'base_stat_value' && c.input.unit === 'ratio' && c.input.min === 0 && c.input.max === 1 && ['linear','unknown'].includes(c.interpolation) && Array.isArray(c.knots) && c.knots.length === 2 && c.knots.every(k => object(k) && [0,1].includes(k.input) && (k.output === null || Number.isFinite(k.output) || (Array.isArray(k.output) && k.output.every(Number.isFinite)))) && (c.outputUnit === null || typeof c.outputUnit === 'string') && (c.unknown === null || typeof c.unknown === 'string') && source(c.source)), `${label} curves invalid`);
      requireValue(Array.isArray(v.attackCombos) && v.attackCombos.every(c => object(c) && typeof c.id === 'string' && ['light','heavy'].includes(c.kind) && typeof c.start === 'string' && Array.isArray(c.steps) && c.steps.every(s => object(s) && typeof s.action === 'string' && typeof s.input === 'string' && name(s.name) && (s.damageProfile === null || typeof s.damageProfile === 'string') && (s.damageProfileUnknown === null || typeof s.damageProfileUnknown === 'string')) && (c.loopsTo === null || (Number.isInteger(c.loopsTo) && c.loopsTo >= 0)) && (c.unknown === null || typeof c.unknown === 'string') && source(c.source)), `${label} attackCombos invalid`);
      requireValue(v.curves.every(c => unknowns.includes(c.unknown) && (c.interpolation !== 'unknown' || (c.unknown !== null && c.knots.every(k => k.output === null))) && (c.unknown !== null || (c.interpolation === 'linear' && c.knots.every(k => k.output !== null)))) && v.attackCombos.every(c => unknowns.includes(c.unknown) && c.steps.every(s => unknowns.includes(s.damageProfileUnknown) && (s.damageProfile === null ? s.damageProfileUnknown !== null : s.damageProfileUnknown === null))), `${label} curve or combo unknown invalid`);
      if (Object.hasOwn(v, 'damageProfiles')) validateDamageProfiles(v, label);
      const curveIds = new Set(v.curves.map(c => c.id));
      requireValue(curveIds.size === v.curves.length, `${label} duplicate curve id`);
      requireValue(v.curves.every(c => keysOnly(c, ['id','bar','stat','name','input','interpolation','knots','outputUnit','unknown','source']) && keysOnly(c.name, ['zh','en']) && keysOnly(c.input, ['source','unit','min','max']) && keysOnly(c.source, ['path','line']) && c.knots.every(k => keysOnly(k, ['input','output']))) && v.attackCombos.every(c => keysOnly(c, ['id','kind','start','steps','loopsTo','unknown','source']) && keysOnly(c.source, ['path','line']) && c.steps.every(s => keysOnly(s, ['action','input','name','damageProfile','damageProfileUnknown']) && keysOnly(s.name, ['zh','en']))), `${label} curve or combo properties invalid`);
      requireValue(v.bars.every(b => b.stats.every(s => typeof s.curveId === 'string' && curveIds.has(s.curveId))), `${label} curveId invalid`);
    }
  }
  if (category === 'terms') requireValue(typeof v.category === 'string' && Array.isArray(v.refs), `${label} term values invalid`);
  if (category === 'blessings') {
    requireValue(Array.isArray(v.weapons) && Array.isArray(v.tiers) && v.tiers.length > 0, `${label} blessing values invalid`);
    let last = 0;
    for (const tier of v.tiers) {
      requireValue(Number.isInteger(tier.tier) && tier.tier > last && tier.tier <= 4, `${label} tiers invalid`);
      last = tier.tier; params(tier.params, label);
      requireValue(!Object.hasOwn(tier, 'mechanics') || features.mechanics && mechanics(tier.mechanics), `${label} tier mechanics invalid`);
    }
  }
}

export async function loadSourceData({ directory, commit, fixture = false }) {
  directory = path.resolve(directory);
  let head;
  if (!fixture || commit) {
    head = (await execute('git', ['-C', directory, 'rev-parse', 'HEAD'])).stdout.trim();
    requireValue(!commit || (/^[0-9a-f]{40}$/.test(commit) && head === commit), `HEAD ${head} does not match requested commit ${commit}`);
  }
  const validator = path.join(directory, 'pipeline/validate.mjs');
  if (await lstat(validator).catch(() => null)) {
    try { await execute(process.execPath, [validator], { cwd: directory, maxBuffer: 4 * 1024 * 1024 }); }
    catch (error) { throw new Error(`Source-Data pipeline validation failed: ${error.stderr || error.message}`); }
  }
  const rawFiles = new Map();
  const read = async relative => {
    const bytes = await regularBytes(directory, `data/${relative}`); rawFiles.set(relative, bytes);
    return parse(bytes, relative);
  };
  const current = await read('current.json');
  requireValue(Object.hasOwn(SUPPORTED_SCHEMA_VERSIONS, current.schemaVersion), `unsupported schemaVersion ${current.schemaVersion}`);
  requireValue(versionPattern.test(current.gameVersion) && current.path === `data/${current.gameVersion}`, 'current.json schema/version/path invalid');
  requireValue(Array.isArray(current.versions) && current.versions.length > 0 && current.versions.every(v => typeof v === 'string' && versionPattern.test(v))
    && new Set(current.versions).size === current.versions.length && current.versions.includes(current.gameVersion), 'current.json versions invalid');
  const compare = (a, b) => { const x = a.split('.').map(BigInt), y = b.split('.').map(BigInt); for (let i = 0; i < Math.max(x.length, y.length); i++) { if ((x[i] ?? 0n) !== (y[i] ?? 0n)) return (x[i] ?? 0n) < (y[i] ?? 0n) ? -1 : 1; } return 0; };
  requireValue(current.versions.every((v, i) => i === 0 || compare(current.versions[i - 1], v) < 0), 'current.json versions must be sorted');
  requireValue(/^[a-fA-F0-9]{40}$/.test(current.sourceCommit) && typeof current.textBatch === 'string' && current.textBatch.length > 0, 'current.json source metadata invalid');
  const dataByVersion = {};
  for (const version of current.versions) {
    const files = {}; const ids = new Set();
    for (const category of CATEGORIES) {
      const file = await read(`${version}/${category}.json`);
      requireValue(Object.hasOwn(SUPPORTED_SCHEMA_VERSIONS, file.schemaVersion), `unsupported schemaVersion ${file.schemaVersion}`);
      requireValue(file.category === category && file.gameVersion === version && Array.isArray(file.items), `${version}/${category}.json metadata invalid`);
      requireValue(/^[a-fA-F0-9]{40}$/.test(file.sourceCommit) && typeof file.textBatch === 'string', `${version}/${category}.json source metadata invalid`);
      for (const item of file.items) { validateItem(item, category, ids, SUPPORTED_SCHEMA_VERSIONS[file.schemaVersion]); requireValue(item.source.commit === file.sourceCommit, `${item.id} source commit mismatch`); }
      files[category] = file;
    }
    requireValue(CATEGORIES.every(c => files[c].schemaVersion === files.skills.schemaVersion && files[c].sourceCommit === files.skills.sourceCommit && files[c].textBatch === files.skills.textBatch), `${version} files disagree`);
    requireValue(version !== current.gameVersion || files.skills.schemaVersion === current.schemaVersion, `${version} current schemaVersion mismatch`);
    dataByVersion[version] = files;
  }
  return { current, dataByVersion, rawFiles, commit: head ?? current.sourceCommit };
}
