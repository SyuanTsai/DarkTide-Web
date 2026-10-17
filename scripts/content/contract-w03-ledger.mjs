import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdir, readFile, readdir, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync, gzipSync } from 'node:zlib';
import { validateLedgerSnapshot } from './contract-w03-mods.mjs';

export const ENTRY_SCHEMA_VERSION = 'w03.mapping-entry.v1';
export const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export const W03_DOC_ROOT = path.join(REPO_ROOT, 'docs/contracts/w03');

export const FIXED_PINS = Object.freeze({
  web: { repoId: 'web', commit: '2816042d4a7380288ac8e73d1058a8accfe5687b' },
  source: { repoId: 'source', commit: '15f285ec3ad9314435141a18125cabfc1b3d1d19' },
  sourceData: { repoId: 'source', commit: '285a06c8939ac505ac48e4d0e93b939a2b959211' },
  sourceAudit: { repoId: 'source', commit: '982a32dee96d15b895ffcc5fa8839c8d48a132c9' },
  extension: { repoId: 'extension', commit: 'b18f5ee2d7c9886b1d9ecb56f7ece8fca5d32c9a' },
  extensionFormal: { repoId: 'extension', commit: '5a09f3628208550cca8696655f3012c23c53d5e5' },
  extensionInputs: { repoId: 'extension', commit: 'e24f8bd0501ddd901f8d7583f445bda60c4f80b0' },
  sourceCode: { repoId: 'source-code', commit: 'ba6c148f3c2768ca3ce20d846a12e56e2f433f3e' },
  mods: { repoId: 'mods', commit: '241ad76ce62330472aa423055a5b85db59bb6c0d' },
  private: { repoId: 'private', commit: '56bd70c9cea12546fca45f055713fe9200c797d4' },
});

const MODS_INDEX_SHA256 = '90d1d27ed7673db16ff3c5b82640f2af7847466fc5a7a4fcd7d1f9795ee9af16';
const MODS_ENTRY_COUNT = 191861;
const MODS_SOURCE_PATH_COUNT = 83260;
const MODS_SHARD_COUNT = 45;
const MAX_SHARD_CONTENT_BYTES = 8_000_000;
const EXTENSION_C2_RECEIPT_SHA256 = 'e75fca9cc2bdd93ab1c5c60e841d8b3013011fd4bca0946f5259b2bee6aed732';
const EXTENSION_SNAPSHOT_LOCK_SHA256 = '90c13714911497e9c757e8402b3929a1c46c2527053842e83010cec279dcb0b9';
const EXTENSION_DEV_CAPABILITY_SHA256 = 'b2146f185c8be73ff35c4c5fc613df02f2b3ee36f74dca44206897872727cfcf';
const EXTENSION_C2_TOOL_SHA256 = '872e39dd82dcda3729fc3b378075aadc6513924063479b258276241c432cbb05';
const EXTENSION_INPUT_TABLE_SHA256 = '1260539eb8923ef054a9b6aa2dda473e3627ca45508ab72fcee676a3ea07aef4';
const EXTENSION_OVERRIDE_TABLE_SHA256 = '997c38579b04570c6830a07247494832478ff6ac447c0de6ee6b89e85120c3e5';
const WEB_FORMAL_REF_TABLE_SHA256 = '79579cf74fba9310b999fc30bf6526f3e8277bbe74c084fcd6d125b931d094d6';
const SOURCE_FORMAL_REF_TABLE_SHA256 = '1ea4498579b7f36057142acab0db0003e08d56fb9881cc61541de2f1987b5787';
const EXTENSION_FORMAL_REF_TABLE_SHA256 = 'cd5d600a462c0c193bc134ef046acdbe78afcb4cb83d15837922da5641b30441';
const EXPECTED_EXTENSION_INPUT_PATHS = new Set([
  'data/v1/blessing-comparisons.json', 'data/v1/blessing-mechanics.json', 'data/v1/catalog.json',
  'data/v1/class-overview.json', 'data/v1/closure/weapon-actions.catalog.json', 'data/v1/closure/weapons.json',
  'data/v1/domains/abilities.json', 'data/v1/domains/blessings.json', 'data/v1/domains/curios.json',
  'data/v1/domains/weapons.json', 'data/v1/mechanics/abilities.json', 'data/v1/mechanics/catalog-document-bindings.proposal.json',
  'data/v1/mechanics/player-guides.json', 'data/v1/mechanics/reviewed-abilities.json', 'data/v1/review-approvals.json',
  'data/v1/weapon-actions.json', 'data/v1/website-display.json', 'data/v1/website-token-corrections.json',
  'docs/V1_ACTIONS_GAPS_REVIEW.json', 'docs/V1_BLESSINGS_43_CANDIDATES_REVIEW.json',
  'docs/V1_BLESSINGS_43_CROSS_REVIEW.json', 'docs/V1_BLESSING_MECHANICS_REVIEW.json',
  'docs/V1_CATALOG_DOCUMENT_BINDINGS_CROSS_REVIEW.json', 'docs/V1_NON_BLESSING_GAPS_CROSS_REVIEW.json',
  'docs/V1_NON_BLESSING_GAPS_REVIEW.json', 'docs/V1_WEBSITE_DISPLAY_INDEPENDENT_REVIEW.json',
]);
const EXPECTED_WEB_FORMAL_PATHS = new Set([
  'content/contracts/source-v2-snapshot/content/fixtures/v2/representative-source.json',
  'content/contracts/source-v2-snapshot/content/schema/v2/source-contract.schema.json',
  'content/contracts/source-v2-snapshot/scripts/content/contract-validator.mjs',
  'content/contracts/source-v2.lock.json', 'content/contracts/web-authoring.lock.json',
  'content/fixtures/v2/shared-release/announcement-only/data/45e65d1f2bddb96eaf8277213fd9cdbf40aa7cc20bedb1637373df88d5e836ed/announcements.json',
  'content/fixtures/v2/shared-release/announcement-only/data/45e65d1f2bddb96eaf8277213fd9cdbf40aa7cc20bedb1637373df88d5e836ed/manifest.json',
  'content/fixtures/v2/shared-release/announcement-only/fixture.json', 'content/fixtures/v2/shared-release/announcement-only/version.json',
  'content/fixtures/v2/shared-release/valid/data/4e64931c542eb2558c8337a39b8866e8158cb53df92306a84ee1c04b8fbc8d0a/announcements.json',
  'content/fixtures/v2/shared-release/valid/data/4e64931c542eb2558c8337a39b8866e8158cb53df92306a84ee1c04b8fbc8d0a/manifest.json',
  'content/fixtures/v2/shared-release/valid/data/4e64931c542eb2558c8337a39b8866e8158cb53df92306a84ee1c04b8fbc8d0a/skills.json',
  'content/fixtures/v2/shared-release/valid/data/4e64931c542eb2558c8337a39b8866e8158cb53df92306a84ee1c04b8fbc8d0a/terms.json',
  'content/fixtures/v2/shared-release/valid/fixture.json', 'content/fixtures/v2/shared-release/valid/version.json',
  'content/fixtures/v2/web-authoring/official-inputs.json', 'content/fixtures/v2/web-authoring/representative.json',
  'content/schema/v2/shared-release.schema.json', 'content/schema/v2/web-authoring.schema.json',
  'scripts/content/contract-authoring.mjs', 'scripts/content/contract-release.mjs',
]);
const EXPECTED_EXTENSION_OVERRIDE_PATHS = new Set([
  'data/v1/mechanics/player-guides.json', 'data/v1/review-approvals.json',
]);
const W01_REPRESENTATIVE_PATH = 'content/authoring/w01-real-representative-candidate.json';
const W01_REPRESENTATIVE_BLOB = '80a4fd467eb01ddbea9df474a39747c9d4f785ce';
const W01_REPRESENTATIVE_SHA256 = '5201134d9913af3e89b437046bb6cfdd96bac92ab1c49a86e296d3051abf77bf';
const W01_REPRESENTATIVE_BYTES = 210495;
const W01_REPRESENTATIVE_GAME_RELEASE_ID = 'darktide:1.13.2';
const W01_REPRESENTATIVE_GAME_VERSION = '1.13.2';
const W01_REPRESENTATIVE_KIND_COUNTS = Object.freeze({
  'blessing': 1, 'blessing-variant': 1, 'claim': 86, 'evidence': 29, 'skill': 1,
  'stat-curve': 2, 'stat-definition': 2, 'term': 1, 'weapon': 2,
});
const W01_REPRESENTATIVE_UNKNOWN_FIELDS = Object.freeze([
  '/records/10/payload/edgePolicy', '/records/10/payload/interpolation',
  '/records/5/payload/obtainableTiers', '/records/7/payload/obtainableInputRange',
  '/records/8/payload/edgePolicy', '/records/8/payload/interpolation', '/records/9/payload/obtainableInputRange',
]);
const W01_REPRESENTATIVE_KNOWN_ZERO_FIELDS = Object.freeze([
  '/records/106/payload/displayValue', '/records/107/payload/displayValue',
  '/records/120/payload/displayValue', '/records/121/payload/displayValue',
]);
const W01_REPRESENTATIVE_NOT_IMPORTED = Object.freeze([
  { recordIndex: 6, recordId: 'darktide:weapon:chainaxe:p1-m1', field: 'action/profile override resolution', reasonCode: 'NOT_IMPORTED' },
  { recordIndex: 124, recordId: 'darktide:weapon:chainaxe:p1-m2', field: 'action/profile override resolution', reasonCode: 'NOT_IMPORTED' },
]);
const EXPECTED_A_GROUP_COUNTS = Object.freeze({
  'extension-additional-data': 100477,
  'extension-hardcoded-content-candidates': 5,
  'extension-release-inputs': 1136081,
  'extension-runtime-code': 8,
  'extension-runtime-config': 18,
  'extension-runtime-generated': 1,
  'extension-runtime-native-rules': 589,
  'extension-runtime-static-data': 295,
  'source-code-registry': 260,
  'source-formal-contract': 1770,
  'source-legacy-psyker': 382,
  'source-w01-candidates': 3584,
  'source-w01-review': 147,
  'web-published': 68039,
  'web-source-cache': 3,
  'web-source-lock': 9,
  'web-w01-inputs': 3988,
});
const EXPECTED_A_GROUP_COUNTS_TO_SUMMARY = Object.freeze(Object.fromEntries(
  Object.entries(EXPECTED_A_GROUP_COUNTS).map(([groupId, entryCount]) => [groupId, Object.freeze({ entryCount })]),
));
const EXPECTED_A_OWNER_COUNTS = Object.freeze({ extension: 256732, source: 890195, web: 168729 });
const EXPECTED_A_ENTRY_COUNT = Object.values(EXPECTED_A_GROUP_COUNTS).reduce((total, count) => total + count, 0);
const EXPECTED_A_SOURCE_PATH_ENTRY_COUNTS = Object.freeze({
  'extension/data/v1/blessing-comparisons.json': 24460,
  'extension/data/v1/blessing-mechanics.json': 1966,
  'extension/data/v1/catalog.json': 66199,
  'extension/data/v1/class-overview.json': 164,
  'extension/data/v1/closure/abilities.json': 740,
  'extension/data/v1/closure/blessings.json': 14926,
  'extension/data/v1/closure/curios.json': 278,
  'extension/data/v1/closure/weapon-actions.catalog.json': 9911,
  'extension/data/v1/closure/weapons-derived-proposal.json': 2508,
  'extension/data/v1/closure/weapons.json': 2508,
  'extension/data/v1/domains/abilities.json': 116047,
  'extension/data/v1/domains/blessings.json': 417661,
  'extension/data/v1/domains/curios.json': 2310,
  'extension/data/v1/domains/weapons.json': 98386,
  'extension/data/v1/mechanics/abilities.json': 100036,
  'extension/data/v1/mechanics/catalog-document-bindings.proposal.json': 905,
  'extension/data/v1/mechanics/player-guides.json': 14517,
  'extension/data/v1/mechanics/reviewed-abilities-a.json': 33583,
  'extension/data/v1/mechanics/reviewed-abilities-b.json': 23556,
  'extension/data/v1/mechanics/reviewed-abilities-corrections.json': 1628,
  'extension/data/v1/mechanics/reviewed-abilities-d.json': 22641,
  'extension/data/v1/mechanics/reviewed-abilities-focused.json': 617,
  'extension/data/v1/mechanics/reviewed-abilities.json': 127126,
  'extension/data/v1/release.json': 258,
  'extension/data/v1/review-approvals.json': 10624,
  'extension/data/v1/weapon-actions.json': 103930,
  'extension/data/v1/website-display.json': 2223,
  'extension/data/v1/website-token-corrections.json': 102,
  'extension/docs/V1_ACTIONS_GAPS_REVIEW.json': 5980,
  'extension/docs/V1_BLESSING_MECHANICS_REVIEW.json': 2760,
  'extension/docs/V1_BLESSINGS_43_CANDIDATES_REVIEW.json': 14783,
  'extension/docs/V1_BLESSINGS_43_CROSS_REVIEW.json': 2892,
  'extension/docs/V1_CATALOG_DOCUMENT_BINDINGS_CROSS_REVIEW.json': 272,
  'extension/docs/V1_NON_BLESSING_GAPS_CROSS_REVIEW.json': 2748,
  'extension/docs/V1_NON_BLESSING_GAPS_REVIEW.json': 5064,
  'extension/docs/V1_WEBSITE_DISPLAY_INDEPENDENT_REVIEW.json': 2249,
  'extension/extension/adapters.js': 1,
  'extension/extension/content.css': 1,
  'extension/extension/content.js': 3,
  'extension/extension/core.js': 4,
  'extension/extension/data.js': 295,
  'extension/extension/icon-128.png': 1,
  'extension/extension/icon-16.png': 1,
  'extension/extension/icon-32.png': 1,
  'extension/extension/icon-48.png': 1,
  'extension/extension/manifest.json': 18,
  'extension/extension/provider.js': 589,
  'extension/extension/runtime-data.js': 1,
  'source-code/scripts/settings/equipment/weapon_templates/weapon_templates.lua': 260,
  'source/content/authoring/w01-preview.json': 146,
  'source/content/authoring/w01-real-claim-candidate.json': 60,
  'source/content/authoring/w01-real-representative-candidate.json': 3378,
  'source/content/fixtures/v2/representative-source.json': 865,
  'source/content/legacy/mods/241ad76/psyker/README.md': 20,
  'source/content/legacy/mods/241ad76/psyker/en/psyker_brain_burst_improved.md': 105,
  'source/content/legacy/mods/241ad76/psyker/provenance.json': 181,
  'source/content/legacy/mods/241ad76/psyker/psyker_brain_burst_improved.md': 76,
  'source/content/reviews/w01-minimal-human-approval-20261017.json': 90,
  'source/content/schema/v2/source-contract.schema.json': 905,
  'source/docs/w01-real-claim-review.md': 57,
  'web/content/contracts/source-v2-snapshot/content/fixtures/v2/representative-source.json': 1,
  'web/content/contracts/source-v2-snapshot/content/schema/v2/source-contract.schema.json': 1,
  'web/content/contracts/source-v2-snapshot/scripts/content/contract-validator.mjs': 1,
  'web/content/published/content.json': 68039,
  'web/content/w01/composition-receipt.json': 19,
  'web/content/w01/release.json': 2,
  'web/content/w01/rollback.json': 6,
  'web/content/w01/source/game-changes.json': 5,
  'web/content/w01/source/source-manifest.json': 18,
  'web/content/w01/source/technical.json': 3379,
  'web/content/w01/web-authoring.json': 559,
  'web/source.lock.json': 9,
});
const EXPECTED_PUBLISHED_COUNTS = Object.freeze({
  assets: 779, bindings: 1185, blessings: 167, marks: 135, routes: 2269,
  skills: 646, sources: 13, variants: 605, weapons: 70, talent_trees: 7,
});
const EXPECTED_SOURCE_CANDIDATE_COUNTS = Object.freeze({
  realRepresentativeCandidateRecords: 125, previewFixtureRecords: 9, formalSyntheticFixtureRecords: 32,
  allCandidateRowsRemainPlanned: true, approvalCarryForward: 'not-assumed',
});

const OWNER_SET = new Set(['source', 'web', 'private', 'mods', 'extension']);
const TARGET_OWNER_SETS = new Map([
  ['private-archive', new Set(['private'])], ['mods-file', new Set(['mods'])],
  ['source-record', new Set(['source'])], ['source-document', new Set(['source'])],
  ['web-record', new Set(['web'])], ['web-announcement', new Set(['web'])],
  ['extension-runtime-binding', new Set(['extension'])],
  ['legacy-artifact', new Set(['source', 'extension'])],
  ['candidate', new Set(['source', 'web', 'extension'])],
  ['quarantine', new Set(['source', 'web', 'extension'])],
]);
const RELEASE_SCOPE_SET = new Set([
  'unversioned-historical', 'historical-game-release', 'historical-legacy-marker',
  'current-snapshot-candidate', 'registry-snapshot', 'synthetic-only', 'mixed-release-set',
  'release-unspecified', 'announcement-original', 'workflow-document', 'tool-document',
  'reference-document', 'mod-maintenance',
]);
const DISPOSITION_SET = new Set([
  'migrated', 'archived-readable', 'private-restorable', 'kept',
  'deduplicated-with-evidence', 'excluded',
]);
const TARGET_STATUS_SET = new Set(['not-generated', 'existing', 'retained']);
const SELECTOR_SET = new Set(['file', 'json-pointer', 'line-range', 'section', 'occurrence', 'js-literal-pointer']);
const ENTITY_KEY_KIND_SET = new Set(['stable-id', 'legacy-id', 'record-index', 'record-path', 'json-pointer', 'registry-key', 'path-scope', 'git-blob']);
const SHA1_RE = /^[a-f0-9]{40}$/;
const SHA256_RE = /^[a-f0-9]{64}$/;
const compare = (left, right) => left < right ? -1 : left > right ? 1 : 0;
const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const issue = (code, message, pathName = '/') => ({ code, message, path: pathName });

export function sha256Hex(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

export function gitBlobOid(bytes) {
  return createHash('sha1').update(Buffer.from(`blob ${bytes.length}\0`, 'ascii')).update(bytes).digest('hex');
}

export function normalizeLf(bytes) {
  const decoder = new TextDecoder('utf-8', { fatal: true });
  const text = decoder.decode(bytes);
  return Buffer.from(text.replace(/\r\n/g, '\n'), 'utf8');
}

export function hashJsonValue(value) {
  const serialized = JSON.stringify(value);
  if (serialized === undefined) throw new TypeError('JSON value is not serializable');
  return sha256Hex(Buffer.from(serialized, 'utf8'));
}

export function parseJsonPointer(pointer) {
  if (pointer === '') return [];
  if (typeof pointer !== 'string' || !pointer.startsWith('/')) throw new TypeError('JSON pointer must be empty or start with /');
  return pointer.slice(1).split('/').map(piece => {
    if (/~(?![01])/u.test(piece)) throw new TypeError('JSON pointer has an invalid escape');
    return piece.replace(/~1/g, '/').replace(/~0/g, '~');
  });
}

export function selectJsonPointer(value, pointer) {
  let current = value;
  for (const part of parseJsonPointer(pointer)) {
    if (Array.isArray(current)) {
      if (!/^(0|[1-9]\d*)$/u.test(part)) throw new TypeError(`array pointer component is not an index: ${part}`);
      if (!Object.hasOwn(current, part)) throw new TypeError(`JSON pointer does not resolve at ${part}`);
      current = current[Number(part)];
    } else if (isObject(current)) {
      if (!Object.hasOwn(current, part)) throw new TypeError(`JSON pointer does not resolve at ${part}`);
      current = current[part];
    }
    else throw new TypeError(`JSON pointer traverses a scalar at ${part}`);
    if (current === undefined) throw new TypeError(`JSON pointer does not resolve at ${part}`);
  }
  return current;
}

class JsLiteralParser {
  constructor(text, offset = 0) { this.text = text; this.offset = offset; }

  skipSpace() {
    while (this.offset < this.text.length) {
      if (/\s/u.test(this.text[this.offset])) { this.offset++; continue; }
      if (this.text.startsWith('//', this.offset)) {
        const end = this.text.indexOf('\n', this.offset + 2);
        this.offset = end < 0 ? this.text.length : end + 1;
        continue;
      }
      if (this.text.startsWith('/*', this.offset)) {
        const end = this.text.indexOf('*/', this.offset + 2);
        if (end < 0) throw new SyntaxError('unterminated JS literal comment');
        this.offset = end + 2;
        continue;
      }
      break;
    }
  }

  parseString() {
    const quote = this.text[this.offset++];
    let value = '';
    while (this.offset < this.text.length) {
      const character = this.text[this.offset++];
      if (character === quote) return value;
      if (character !== '\\') { value += character; continue; }
      if (this.offset >= this.text.length) break;
      const escaped = this.text[this.offset++];
      const simple = { n: '\n', r: '\r', t: '\t', b: '\b', f: '\f', v: '\v', '0': '\0', '\\': '\\', "'": "'", '"': '"', '/': '/' };
      if (Object.hasOwn(simple, escaped)) { value += simple[escaped]; continue; }
      if (escaped === '\n') continue;
      if (escaped === '\r') { if (this.text[this.offset] === '\n') this.offset++; continue; }
      if (escaped === 'x') {
        const hex = this.text.slice(this.offset, this.offset + 2);
        if (!/^[a-f\d]{2}$/iu.test(hex)) throw new SyntaxError('invalid JS hexadecimal string escape');
        value += String.fromCodePoint(Number.parseInt(hex, 16));
        this.offset += 2;
        continue;
      }
      if (escaped === 'u') {
        if (this.text[this.offset] === '{') {
          const end = this.text.indexOf('}', this.offset + 1);
          if (end < 0) throw new SyntaxError('invalid JS Unicode code point escape');
          const hex = this.text.slice(this.offset + 1, end);
          if (!/^[a-f\d]{1,6}$/iu.test(hex)) throw new SyntaxError('invalid JS Unicode code point escape');
          value += String.fromCodePoint(Number.parseInt(hex, 16));
          this.offset = end + 1;
          continue;
        }
        const hex = this.text.slice(this.offset, this.offset + 4);
        if (!/^[a-f\d]{4}$/iu.test(hex)) throw new SyntaxError('invalid JS Unicode string escape');
        value += String.fromCharCode(Number.parseInt(hex, 16));
        this.offset += 4;
        continue;
      }
      value += escaped;
    }
    throw new SyntaxError('unterminated JS string literal');
  }

  parseKey() {
    this.skipSpace();
    const character = this.text[this.offset];
    if (character === '"' || character === "'") return this.parseString();
    const match = /^[A-Za-z_$][\w$]*/u.exec(this.text.slice(this.offset));
    if (!match) throw new SyntaxError(`unsupported JS object key near offset ${this.offset}`);
    this.offset += match[0].length;
    return match[0];
  }

  parseValue() {
    this.skipSpace();
    const character = this.text[this.offset];
    if (character === '{') {
      this.offset++;
      const value = {};
      this.skipSpace();
      if (this.text[this.offset] === '}') { this.offset++; return value; }
      while (this.offset < this.text.length) {
        const key = this.parseKey();
        this.skipSpace();
        if (this.text[this.offset++] !== ':') throw new SyntaxError('expected colon in JS object literal');
        Object.defineProperty(value, key, { value: this.parseValue(), enumerable: true, configurable: true, writable: true });
        this.skipSpace();
        const delimiter = this.text[this.offset++];
        if (delimiter === '}') return value;
        if (delimiter !== ',') throw new SyntaxError('expected comma or closing brace in JS object literal');
        this.skipSpace();
        if (this.text[this.offset] === '}') { this.offset++; return value; }
      }
      throw new SyntaxError('unterminated JS object literal');
    }
    if (character === '[') {
      this.offset++;
      const value = [];
      this.skipSpace();
      if (this.text[this.offset] === ']') { this.offset++; return value; }
      while (this.offset < this.text.length) {
        value.push(this.parseValue());
        this.skipSpace();
        const delimiter = this.text[this.offset++];
        if (delimiter === ']') return value;
        if (delimiter !== ',') throw new SyntaxError('expected comma or closing bracket in JS array literal');
        this.skipSpace();
        if (this.text[this.offset] === ']') { this.offset++; return value; }
      }
      throw new SyntaxError('unterminated JS array literal');
    }
    if (character === '"' || character === "'") return this.parseString();
    const number = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/u.exec(this.text.slice(this.offset));
    if (number) { this.offset += number[0].length; return Number(number[0]); }
    const identifier = /^[A-Za-z_$][\w$]*/u.exec(this.text.slice(this.offset));
    if (!identifier) throw new SyntaxError(`unsupported JS literal near offset ${this.offset}`);
    this.offset += identifier[0].length;
    if (identifier[0] === 'true') return true;
    if (identifier[0] === 'false') return false;
    if (identifier[0] === 'null') return null;
    if (identifier[0] === 'undefined') return undefined;
    throw new SyntaxError(`non-literal identifier in JS object data: ${identifier[0]}`);
  }
}

/** Parse a named static object-literal root without executing any repository code. */
export function parseStaticJsRoot(sourceText, rootName) {
  const assignment = rootName === 'data'
    ? /\bconst\s+data\s*=\s*/u.exec(sourceText)
    : rootName === 'nativeFragmentRules' ? /\bconst\s+nativeFragmentRules\s*=\s*/u.exec(sourceText) : null;
  if (!assignment) throw new Error(`unsupported static JS root: ${rootName}`);
  const parser = new JsLiteralParser(sourceText, assignment.index + assignment[0].length);
  const root = parser.parseValue();
  if (rootName === 'nativeFragmentRules') {
    if (!Array.isArray(root)) throw new TypeError('nativeFragmentRules root is not an array literal');
    const remaining = sourceText.slice(parser.offset);
    const push = /\bnativeFragmentRules\.push\s*\(\s*/u.exec(remaining);
    if (push) {
      const pushParser = new JsLiteralParser(sourceText, parser.offset + push.index + push[0].length);
      root.push(pushParser.parseValue());
    }
  } else if (!isObject(root)) throw new TypeError(`${rootName} root is not an object literal`);
  return root;
}

function validateHash(value, expression, code, pathName, issues) {
  if (typeof value !== 'string' || !expression.test(value)) issues.push(issue(code, 'hash has an invalid encoding or length', pathName));
}

function validateSelectorAndFragment(entry, issues) {
  const { selector, source, fragment } = entry;
  if (!isObject(selector) || !SELECTOR_SET.has(selector.kind) || typeof selector.locator !== 'string' || !selector.locator) {
    issues.push(issue('selector-shape', 'selector kind and locator are required', '/selector'));
    return;
  }
  if (!isObject(fragment)) {
    issues.push(issue('fragment-shape', 'fragment must be an object', '/fragment'));
    return;
  }
  if (fragment.normalization === 'git-blob') {
    validateHash(fragment.gitBlobOid, SHA1_RE, 'fragment-git-blob', '/fragment/gitBlobOid', issues);
    if (selector.kind !== 'file' || fragment.gitBlobOid !== source.gitBlobOid
      || Object.hasOwn(fragment, 'sha256') || Object.hasOwn(fragment, 'serialization')) {
      issues.push(issue('fragment-union', 'git-blob requires a whole-file selector and exact source blob OID only', '/fragment'));
    }
    return;
  }
  if (fragment.normalization === 'raw' || fragment.normalization === 'lf') {
    validateHash(fragment.sha256, SHA256_RE, 'fragment-sha256', '/fragment/sha256', issues);
    if (Object.hasOwn(fragment, 'gitBlobOid') || Object.hasOwn(fragment, 'serialization')) {
      issues.push(issue('fragment-union', 'raw/lf fragments cannot include another hash domain', '/fragment'));
    }
    if (!Number.isSafeInteger(selector.startByte) || !Number.isSafeInteger(selector.endByte)
      || selector.startByte < 0 || selector.endByte < selector.startByte) {
      issues.push(issue('selector-byte-range', 'raw/lf selectors require an exact nonnegative UTF-8 byte range', '/selector'));
    }
    return;
  }
  if (fragment.serialization === 'json-value-json-stringify' || fragment.serialization === 'js-value-json-stringify') {
    validateHash(fragment.sha256, SHA256_RE, 'fragment-sha256', '/fragment/sha256', issues);
    const requiredSelector = fragment.serialization === 'json-value-json-stringify' ? 'json-pointer' : 'js-literal-pointer';
    if (selector.kind !== requiredSelector || Object.hasOwn(fragment, 'normalization') || Object.hasOwn(fragment, 'gitBlobOid')) {
      issues.push(issue('fragment-union', `${fragment.serialization} requires ${requiredSelector} and only a SHA-256`, '/fragment'));
    }
    return;
  }
  issues.push(issue('fragment-kind', 'fragment must use Git blob, raw/lf byte range, JSON value, or JS literal value hashing', '/fragment'));
}

/** Validate one shared W03 mapping-entry.v1 row without consulting a repository. */
export function validateMappingEntry(entry) {
  const issues = [];
  if (!isObject(entry)) return [issue('entry-shape', 'entry must be a JSON object')];
  if (entry.schemaVersion !== ENTRY_SCHEMA_VERSION) {
    issues.push(issue('entry-schema-version', 'entry schemaVersion must be w03.mapping-entry.v1', '/schemaVersion'));
  }
  if (typeof entry.entryId !== 'string' || !entry.entryId.trim()) issues.push(issue('entry-id', 'entryId is required', '/entryId'));
  if (!isObject(entry.source) || typeof entry.source.repoId !== 'string' || !entry.source.repoId
    || !SHA1_RE.test(entry.source.commit ?? '') || !safeRepoPath(entry.source.path)
    || !SHA1_RE.test(entry.source.gitBlobOid ?? '')) {
    issues.push(issue('source-shape', 'source requires repoId, exact commit, safe relative path, and Git blob OID', '/source'));
  }
  if (!isObject(entry.sourceEntityKey) || !ENTITY_KEY_KIND_SET.has(entry.sourceEntityKey.kind)) {
    issues.push(issue('source-entity-key', 'sourceEntityKey must use a closed identity kind', '/sourceEntityKey'));
  } else if (entry.sourceEntityKey.value === null) {
    if (typeof entry.sourceEntityKey.reason !== 'string' || !entry.sourceEntityKey.reason.trim()) {
      issues.push(issue('source-entity-key-reason', 'null source entity value requires a specific reason', '/sourceEntityKey/reason'));
    }
  } else if ((typeof entry.sourceEntityKey.value !== 'string' && typeof entry.sourceEntityKey.value !== 'number')
    || String(entry.sourceEntityKey.value).trim() === '' || entry.sourceEntityKey.reason !== null) {
    issues.push(issue('source-entity-key-value', 'source entity value must be stable and cannot also carry a null reason', '/sourceEntityKey'));
  }
  validateSelectorAndFragment(entry, issues);
  if (!OWNER_SET.has(entry.owner)) issues.push(issue('owner', 'owner is outside the W03 closed owner set', '/owner'));
  if (!isObject(entry.target)) issues.push(issue('target-shape', 'target must be an object', '/target'));
  else {
    const target = entry.target;
    if (!TARGET_STATUS_SET.has(target.status)) issues.push(issue('target-status', 'target status must be not-generated, existing, or retained', '/target/status'));
    const validOwnerSet = TARGET_OWNER_SETS.get(target.kind);
    if (!validOwnerSet) issues.push(issue('target-kind', 'target kind is outside the W03 typed target vocabulary', '/target/kind'));
    else if (!validOwnerSet.has(entry.owner)) issues.push(issue('owner-target-kind', `target kind ${target.kind} is incompatible with owner ${entry.owner}`, '/owner'));
    if (typeof target.fieldPath !== 'string' || !target.fieldPath.trim()) issues.push(issue('target-field', 'target fieldPath is required even for an uncreated target', '/target/fieldPath'));
    if (target.recordId === null) {
      if (typeof target.recordIdNotApplicableReason !== 'string' || !target.recordIdNotApplicableReason.trim()) {
        issues.push(issue('target-record-reason', 'null recordId requires a nonempty reason', '/target/recordIdNotApplicableReason'));
      }
    } else if (typeof target.recordId !== 'string' || !target.recordId.trim() || Object.hasOwn(target, 'recordIdNotApplicableReason')) {
      issues.push(issue('target-record-id', 'recordId must be a stable ID and cannot carry a null reason', '/target/recordId'));
    }
    if (target.gameReleaseId === null) {
      if (typeof target.gameReleaseIdNotApplicableReason !== 'string' || !target.gameReleaseIdNotApplicableReason.trim()) {
        issues.push(issue('target-game-release-reason', 'null gameReleaseId requires a nonempty reason', '/target/gameReleaseIdNotApplicableReason'));
      }
    } else if (typeof target.gameReleaseId !== 'string' || !target.gameReleaseId.trim() || Object.hasOwn(target, 'gameReleaseIdNotApplicableReason')) {
      issues.push(issue('target-game-release-id', 'target gameReleaseId must be stable and cannot carry a null reason', '/target/gameReleaseId'));
    }
    if (target.status === 'not-generated') {
      if (target.repoId !== null || target.commit !== null || target.path !== null
        || typeof target.reason !== 'string' || !target.reason.trim()) {
        issues.push(issue('target-status-locator', 'not-generated target requires null locator and a reason', '/target'));
      }
    } else if (typeof target.repoId !== 'string' || !target.repoId || !SHA1_RE.test(target.commit ?? '') || !safeRepoPath(target.path)) {
      issues.push(issue('target-locator', 'existing or retained target requires exact repo, commit, and safe path', '/target'));
    }
  }
  if (!isObject(entry.scope) || !RELEASE_SCOPE_SET.has(entry.scope.releaseScope)) {
    issues.push(issue('scope-shape', 'scope must use a closed releaseScope value', '/scope'));
  } else if (entry.scope.gameReleaseId === null) {
    if (typeof entry.scope.reason !== 'string' || !entry.scope.reason.trim()) issues.push(issue('scope-version-reason', 'null scope gameReleaseId requires a reason', '/scope/reason'));
  } else if (typeof entry.scope.gameReleaseId !== 'string' || !entry.scope.gameReleaseId.trim() || Object.hasOwn(entry.scope, 'reason')) {
    issues.push(issue('scope-version-id', 'scope gameReleaseId must be stable or null with a reason', '/scope/gameReleaseId'));
  }
  if (entry.mappingStatus !== 'planned' || !DISPOSITION_SET.has(entry.intendedDisposition)
    || !isObject(entry.actualOutcome) || entry.actualOutcome.status !== 'not-started') {
    issues.push(issue('planned-outcome', 'W03 entries must remain planned with not-started actual outcome', '/actualOutcome'));
  }
  if (!isObject(entry.review) || entry.review.carryForward !== 'not-assumed' || !Array.isArray(entry.review.basisRefs)
    || !['pending', 'not-applicable'].includes(entry.review.state)) {
    issues.push(issue('review-state', 'review must not carry forward approval and must be pending or not-applicable', '/review'));
  }
  if (typeof entry.linkDisposition !== 'string' || !entry.linkDisposition.trim()) issues.push(issue('link-disposition', 'linkDisposition is required', '/linkDisposition'));
  if (!isObject(entry.rollback) || entry.rollback.repoId !== entry.source?.repoId || entry.rollback.commit !== entry.source?.commit
    || entry.rollback.path !== entry.source?.path || entry.rollback.gitBlobOid !== entry.source?.gitBlobOid) {
    issues.push(issue('rollback-pointer', 'rollback must reference the exact source Git blob', '/rollback'));
  }
  return issues;
}

export function safeRepoPath(value) {
  return typeof value === 'string' && value.length > 0 && !value.startsWith('/') && !value.includes('\\')
    && !value.split('/').some(part => part === '' || part === '.' || part === '..');
}

function decodeUtf8(bytes) {
  return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
}

/** Verify a fragment against exact fixed source bytes; JSON value hashing is JSON.stringify UTF-8, not raw source bytes. */
export function verifyEntryFragment(entry, sourceBytes) {
  if (!Buffer.isBuffer(sourceBytes)) sourceBytes = Buffer.from(sourceBytes);
  const { selector, fragment } = entry;
  try {
    let actual;
    if (fragment?.normalization === 'git-blob') actual = gitBlobOid(sourceBytes);
    else if (fragment?.normalization === 'raw' || fragment?.normalization === 'lf') {
      const { startByte, endByte } = selector;
      if (!Number.isSafeInteger(startByte) || !Number.isSafeInteger(endByte) || startByte < 0 || endByte < startByte || endByte > sourceBytes.length) {
        throw new RangeError('fragment byte range is outside the source');
      }
      let selected = sourceBytes.subarray(startByte, endByte);
      decodeUtf8(selected);
      if (fragment.normalization === 'lf') selected = normalizeLf(selected);
      actual = sha256Hex(selected);
    } else if (fragment?.serialization === 'json-value-json-stringify') {
      const parsed = JSON.parse(decodeUtf8(sourceBytes));
      actual = hashJsonValue(selectJsonPointer(parsed, selector.locator));
    } else if (fragment?.serialization === 'js-value-json-stringify') {
      const parsed = parseStaticJsRoot(decodeUtf8(sourceBytes), selector.root);
      actual = hashJsonValue(selectJsonPointer(parsed, selector.locator));
    } else throw new Error('unsupported fragment hash domain');
    const expected = fragment.sha256 ?? fragment.gitBlobOid;
    return { valid: actual === expected, expected, actual, reason: actual === expected ? null : 'fragment hash differs from fixed source bytes' };
  } catch (error) {
    return { valid: false, expected: fragment?.sha256 ?? fragment?.gitBlobOid ?? null, actual: null, reason: error.message };
  }
}

function parseJsonBytes(bytes) {
  return JSON.parse(decodeUtf8(bytes));
}

function jsonPointerEscape(value) {
  return String(value).replace(/~/g, '~0').replace(/\//g, '~1');
}

/** Offline index validation. shards is a Map of repo-relative shard paths to their exact file bytes. */
export function verifyLedgerBundle(ledger, shards, { includeSummary = false } = {}) {
  const issues = [];
  const summaryCounts = { totalEntries: 0, byOwner: new Map(), byTargetStatus: new Map(), byReleaseScope: new Map(), bySourcePath: new Map(), bySourceArtifact: new Map(), groups: {} };
  const increment = (counts, key) => {
    if (typeof key === 'string') counts.set(key, (counts.get(key) ?? 0) + 1);
  };
  if (!isObject(ledger) || ledger.schemaVersion !== 1 || ledger.entrySchemaVersion !== ENTRY_SCHEMA_VERSION) {
    const result = [issue('ledger-schema', 'mapping ledger must declare schemaVersion 1 and the fixed entry schema')];
    return includeSummary ? { issues: result, summary: null } : result;
  }
  if (!isObject(ledger.groups) || !Array.isArray(ledger.shards) || !(shards instanceof Map)) {
    const result = [issue('ledger-shape', 'ledger groups, shard index, and supplied shard map are required')];
    return includeSummary ? { issues: result, summary: null } : result;
  }
  if (ledger.shards.length === 0 || Object.keys(ledger.groups).length === 0) {
    issues.push(issue('ledger-empty', 'offline mapping ledger must contain at least one group and shard'));
  }
  const byPath = new Map();
  for (const descriptor of ledger.shards) {
    if (!isObject(descriptor) || !safeRepoPath(descriptor.path) || !descriptor.path.startsWith('extension/')
      || !descriptor.path.endsWith('.json') || descriptor.encoding !== 'gzip-base64' || byPath.has(descriptor.path)
      || !Number.isSafeInteger(descriptor.entryCount) || descriptor.entryCount < 1
      || !Number.isSafeInteger(descriptor.containerBytes) || descriptor.containerBytes < 1
      || !SHA256_RE.test(descriptor.containerSha256 ?? '')
      || !Number.isSafeInteger(descriptor.compressedBytes) || descriptor.compressedBytes < 1
      || !SHA256_RE.test(descriptor.compressedSha256 ?? '')
      || !Number.isSafeInteger(descriptor.contentBytes) || descriptor.contentBytes < 1 || descriptor.contentBytes > MAX_SHARD_CONTENT_BYTES
      || !SHA256_RE.test(descriptor.contentSha256 ?? '')) {
      issues.push(issue('shard-descriptor', 'shard descriptor requires a safe gzip path, bounded content size, counts, and both digests', '/shards'));
      continue;
    }
    byPath.set(descriptor.path, descriptor);
  }
  const listed = new Set();
  const counts = new Map();
  const entryIds = new Set();
  for (const [groupId, group] of Object.entries(ledger.groups)) {
    if (!isObject(group) || !Number.isSafeInteger(group.entryCount) || group.entryCount < 0 || !Array.isArray(group.shardPaths)) {
      issues.push(issue('group-descriptor', 'group requires an entryCount and shardPaths', `/groups/${groupId}`));
      continue;
    }
    let count = 0;
    for (const shardPath of group.shardPaths) {
      if (listed.has(shardPath)) issues.push(issue('shard-multiple-groups', 'each shard must belong to exactly one group', `/groups/${groupId}/shardPaths`));
      listed.add(shardPath);
      const descriptor = byPath.get(shardPath);
      const bytes = shards.get(shardPath);
      if (!descriptor || descriptor.groupId !== groupId) {
        issues.push(issue('shard-unindexed', 'group references an unknown or differently-grouped shard', `/groups/${groupId}/shardPaths`));
        continue;
      }
      if (!Buffer.isBuffer(bytes)) {
        issues.push(issue('shard-missing', `missing shard bytes: ${shardPath}`, `/shards/${shardPath}`));
        continue;
      }
      if (bytes.length !== descriptor.containerBytes || sha256Hex(bytes) !== descriptor.containerSha256) {
        issues.push(issue('shard-container-integrity', `shard container size or SHA-256 mismatch: ${shardPath}`, `/shards/${shardPath}`));
        continue;
      }
      let envelope;
      try { envelope = parseJsonBytes(bytes); }
      catch (error) {
        issues.push(issue('shard-container-json', `shard container is not valid UTF-8 JSON: ${error.message}`, `/shards/${shardPath}`));
        continue;
      }
      if (!isObject(envelope) || envelope.encoding !== 'gzip-base64' || typeof envelope.data !== 'string'
        || Object.keys(envelope).length !== 2 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u.test(envelope.data)) {
        issues.push(issue('shard-container-shape', 'shard container must contain only encoding=gzip-base64 and canonical base64 data', `/shards/${shardPath}`));
        continue;
      }
      const compressedBytes = Buffer.from(envelope.data, 'base64');
      if (compressedBytes.length !== descriptor.compressedBytes || compressedBytes.toString('base64') !== envelope.data
        || sha256Hex(compressedBytes) !== descriptor.compressedSha256) {
        issues.push(issue('shard-compressed-integrity', `base64 gzip payload size or SHA-256 mismatch: ${shardPath}`, `/shards/${shardPath}`));
        continue;
      }
      let contentBytes;
      try { contentBytes = gunzipSync(compressedBytes, { maxOutputLength: MAX_SHARD_CONTENT_BYTES + 1 }); }
      catch (error) {
        issues.push(issue('shard-gzip', `shard is not bounded valid gzip: ${error.message}`, `/shards/${shardPath}`));
        continue;
      }
      if (contentBytes.length !== descriptor.contentBytes || contentBytes.length > MAX_SHARD_CONTENT_BYTES
        || sha256Hex(contentBytes) !== descriptor.contentSha256) {
        issues.push(issue('shard-content-integrity', `uncompressed shard size or SHA-256 mismatch: ${shardPath}`, `/shards/${shardPath}`));
        continue;
      }
      let shard;
      try { shard = parseJsonBytes(contentBytes); }
      catch (error) {
        issues.push(issue('shard-json', `shard is not valid UTF-8 JSON: ${error.message}`, `/shards/${shardPath}`));
        continue;
      }
      if (!isObject(shard) || shard.entrySchemaVersion !== ENTRY_SCHEMA_VERSION || shard.groupId !== groupId || !Array.isArray(shard.entries)) {
        issues.push(issue('shard-shape', 'shard must match the indexed group and contain entries', `/shards/${shardPath}`));
        continue;
      }
      if (shard.entries.length !== descriptor.entryCount) issues.push(issue('shard-count', 'shard entry count differs from index', `/shards/${shardPath}`));
      count += shard.entries.length;
      for (let rowIndex = 0; rowIndex < shard.entries.length; rowIndex++) {
        const row = shard.entries[rowIndex];
        summaryCounts.totalEntries++;
        increment(summaryCounts.byOwner, row?.owner);
        increment(summaryCounts.byTargetStatus, row?.target?.status);
        increment(summaryCounts.byReleaseScope, row?.scope?.releaseScope);
        if (typeof row?.source?.repoId === 'string' && typeof row?.source?.path === 'string') {
          increment(summaryCounts.bySourcePath, `${row.source.repoId}/${row.source.path}`);
          if (typeof row.source.commit === 'string' && typeof row.source.gitBlobOid === 'string') {
            const artifactKey = JSON.stringify([row.source.repoId, row.source.commit, row.source.path]);
            const artifact = summaryCounts.bySourceArtifact.get(artifactKey) ?? {
              repoId: row.source.repoId, commit: row.source.commit, path: row.source.path,
              gitBlobOid: row.source.gitBlobOid, entryCount: 0,
            };
            if (artifact.gitBlobOid !== row.source.gitBlobOid) {
              issues.push(issue('source-artifact-blob-conflict', 'one pinned source file is represented by multiple Git blobs', `/shards/${shardPath}/${rowIndex}/source/gitBlobOid`));
            }
            artifact.entryCount++;
            summaryCounts.bySourceArtifact.set(artifactKey, artifact);
          }
        }
        const rowIssues = validateMappingEntry(row);
        for (const item of rowIssues) issues.push(issue(`entry-${item.code}`, `${shardPath}#${rowIndex}: ${item.message}`, item.path));
        if (entryIds.has(row?.entryId)) issues.push(issue('entry-id-duplicate', `duplicate entryId ${row.entryId}`, `/shards/${shardPath}/${rowIndex}/entryId`));
        else if (typeof row?.entryId === 'string') entryIds.add(row.entryId);
      }
    }
    counts.set(groupId, count);
    summaryCounts.groups[groupId] = { entryCount: count };
    if (count !== group.entryCount) issues.push(issue('group-count', 'group entry count differs from its shards', `/groups/${groupId}/entryCount`));
  }
  for (const [shardPath] of byPath) if (!listed.has(shardPath)) issues.push(issue('shard-unreferenced', 'index contains an unreferenced shard', `/shards/${shardPath}`));
  for (const shardPath of shards.keys()) if (!byPath.has(shardPath)) issues.push(issue('shard-extra', 'supplied shard is not listed in the index', `/shards/${shardPath}`));
  const summary = {
    totalEntries: summaryCounts.totalEntries,
    byOwner: Object.fromEntries([...summaryCounts.byOwner].sort(([a], [b]) => compare(a, b))),
    byTargetStatus: Object.fromEntries([...summaryCounts.byTargetStatus].sort(([a], [b]) => compare(a, b))),
    byReleaseScope: Object.fromEntries([...summaryCounts.byReleaseScope].sort(([a], [b]) => compare(a, b))),
    sourcePathEntryCounts: Object.fromEntries([...summaryCounts.bySourcePath].sort(([a], [b]) => compare(a, b))),
    sourceArtifactEntries: [...summaryCounts.bySourceArtifact.values()].sort((a, b) => compare(
      JSON.stringify([a.repoId, a.commit, a.path]), JSON.stringify([b.repoId, b.commit, b.path]))),
    groups: Object.fromEntries(Object.entries(summaryCounts.groups).sort(([a], [b]) => compare(a, b))),
  };
  return includeSummary ? { issues, summary } : issues;
}

function gitBytes(repoRoot, args, encoding = null) {
  return execFileSync('git', args, { cwd: repoRoot, encoding: encoding ?? undefined, maxBuffer: 256 * 1024 * 1024 });
}

function gitHead(repoRoot) {
  return gitBytes(repoRoot, ['rev-parse', 'HEAD'], 'utf8').trim();
}

function parseGitTreeBuffer(bytes) {
  const rows = [];
  const decoder = new TextDecoder('utf-8', { fatal: true });
  let offset = 0;
  while (offset < bytes.length) {
    const nul = bytes.indexOf(0, offset);
    if (nul < 0) throw new Error('git ls-tree output is not NUL terminated');
    const record = bytes.subarray(offset, nul);
    const tab = record.indexOf(9);
    if (tab < 0) throw new Error('git ls-tree record lacks metadata/path separator');
    const metadata = record.subarray(0, tab).toString('ascii');
    const match = /^(\d{6}) blob ([a-f0-9]{40})\s+(\d+)$/u.exec(metadata);
    if (!match) throw new Error(`unsupported git ls-tree metadata: ${metadata}`);
    const relativePath = decoder.decode(record.subarray(tab + 1));
    if (!safeRepoPath(relativePath)) throw new Error(`unsafe Git tree path: ${relativePath}`);
    rows.push({ mode: match[1], gitBlobOid: match[2], bytes: Number(match[3]), path: relativePath });
    offset = nul + 1;
  }
  return rows;
}

function gitTree(repoRoot, commit) {
  const bytes = gitBytes(repoRoot, ['ls-tree', '-r', '-l', '-z', commit]);
  return new Map(parseGitTreeBuffer(bytes).map(row => [row.path, row]));
}

function readGitBlob(repoRoot, tree, commit, relativePath) {
  const row = tree.get(relativePath);
  if (!row) throw new Error(`pinned path is missing from ${commit}: ${relativePath}`);
  const bytes = gitBytes(repoRoot, ['cat-file', 'blob', row.gitBlobOid]);
  if (bytes.length !== row.bytes || gitBlobOid(bytes) !== row.gitBlobOid) throw new Error(`Git blob bytes do not match tree entry: ${relativePath}`);
  return { row, bytes };
}

function ensureHead(repoRoot, expectedCommit, label) {
  const actual = gitHead(repoRoot);
  if (actual !== expectedCommit) throw new Error(`${label} HEAD must be ${expectedCommit}; found ${actual}`);
}

function getJsonValueByPointer(bytes, pointer) {
  return selectJsonPointer(parseJsonBytes(bytes), pointer);
}

function rootGameRelease(value, inherited = null) {
  if (isObject(value) && typeof value.gameReleaseId === 'string' && value.gameReleaseId.trim()) return value.gameReleaseId;
  return inherited;
}

const IDENTITY_FIELDS = [
  'recordId', 'record_id', 'id', 'weaponId', 'weapon_id', 'abilityId', 'ability_id',
  'claim_id', 'variantId', 'variant_id', 'mark_id', 'asset_id', 'source_id',
  'skillId', 'skill_id', 'blessingId', 'blessing_id',
  'curioId', 'curio_id', 'traitId', 'perkId', 'markId', 'classId', 'typeId',
  'fieldPath', 'field_path', 'comparisonPath', 'key', 'node_id', 'talentKey',
  'talentId', 'recordIndex', 'catalogIndex', 'index', 'sourceId', 'source_id',
];

export function identityForObject(value, pointer, inherited, collection = null, repoId = null) {
  if (!isObject(value)) return inherited;
  if (repoId === 'source' && /^\/records\/\d+\/.+/u.test(pointer) && inherited) return inherited;
  const segments = pointer.split('/').slice(1).map(part => part.replace(/~1/g, '/').replace(/~0/g, '~'));
  const priority = ['claim_id'];
  if (segments[0] === 'variants' || collection === 'variants') priority.push('variant_id');
  if (segments[0] === 'marks' || collection === 'marks') priority.push('mark_id');
  if (segments[0] === 'assets' || collection === 'assets') priority.push('asset_id');
  if (segments[0] === 'sources' || collection === 'sources') priority.push('source_id', 'sourceId');
  if (segments[0] === 'skills' || collection === 'skills') priority.push('skill_id', 'skillId');
  if (segments[0] === 'weapons' || collection === 'weapons') priority.push('weapon_id', 'weaponId');
  if (segments[0] === 'blessings' || collection === 'blessings') priority.push('blessing_id', 'blessingId');
  for (const field of [...new Set([...priority, ...IDENTITY_FIELDS])]) {
    const candidate = value[field];
    if ((typeof candidate === 'string' && candidate.trim()) || (typeof candidate === 'number' && Number.isFinite(candidate))) {
      const kind = field === 'recordIndex' || field === 'catalogIndex' || field === 'index' ? 'record-index'
        : field === 'fieldPath' || field === 'field_path' || field === 'comparisonPath' ? 'record-path'
          : typeof candidate === 'string' && /^(?:[a-z0-9_-]+:){1,}/iu.test(candidate) ? 'stable-id' : 'legacy-id';
      return { kind, value: String(candidate), reason: null };
    }
  }
  if (!inherited) return { kind: 'json-pointer', value: pointer || '/', reason: null };
  return inherited;
}

const WEB_TEXT_FIELDS = new Set([
  'name', 'nameEnglish', 'name_english', 'name_en', 'name_zh_tw', 'englishName', 'chineseName',
  'description', 'descriptionEnglish', 'description_english', 'description_en', 'description_zh_tw',
  'effect', 'effectEnglish', 'effect_zh_tw', 'mechanics_zh_tw', 'english', 'chinese', 'original',
  'originalEnglish', 'originalChinese', 'proposedChinese', 'previousChinese', 'translated', 'translation',
  'label', 'title', 'text', 'paragraph', 'wording', 'websiteText', 'websiteEnglish', 'websiteChinese',
  'nativeEnglish', 'displayName', 'displayText', 'caption', 'alt', 'content', 'heading',
]);
const SOURCE_REFERENCE_FIELDS = new Set([
  'sourceRef', 'sourceRefs', 'sourceId', 'source_id', 'sourceRevision', 'sourceBuild', 'basedOn',
  'sourceFiles', 'sourceRanges', 'sourceEvidenceRefs', 'evidenceRefs', 'gitBlobOid', 'sha256',
  'gitBlob', 'snapshot', 'gameReleaseId', 'claimRefs', 'tier_claims', 'available_tiers',
  'defined_tiers', 'weaponIds', 'weapon_ids', 'weaponId', 'weapon_id', 'abilityId', 'ability_id',
  'skillId', 'skill_id', 'variantId', 'variant_id', 'blessingId', 'blessing_id', 'markId',
  'trait_item', 'trait_category', 'bindings', 'routes', 'assetId', 'asset_id', 'controllerApproved',
  'runtimeApproved', 'gameTested', 'runtimeReady', 'runtimeExportEligible', 'exportApproved',
  'approved', 'reviewer', 'reviewedAt', 'verdict', 'semanticReview', 'completedReview',
]);
const EXTENSION_PROCESS_FIELDS = new Set([
  'controllerApproved', 'runtimeApproved', 'runtimeReady', 'runtimeExportEligible', 'exportApproved',
  'approved', 'reviewer', 'reviewedAt', 'verdict', 'semanticReview', 'completedReview',
  'review', 'reviewer', 'reviewPolicy', 'approval', 'approvalReceipt', 'carryForward',
]);

function ownerForField({ repoId, sourcePath, pointer, key, value, collection }) {
  if (repoId === 'source' && sourcePath.startsWith('content/legacy/mods/')) {
    if (sourcePath.endsWith('.md')) return 'web';
    if (sourcePath.endsWith('/provenance.json')) {
      if (EXTENSION_PROCESS_FIELDS.has(key)) return 'extension';
      if (SOURCE_REFERENCE_FIELDS.has(key) || /(?:source|commit|build|snapshot|hash|evidence|claim|release)/iu.test(key)) return 'source';
      if (WEB_TEXT_FIELDS.has(key)) return 'web';
    }
  }
  if (repoId === 'source' && (/^content\/(?:schema\/v2|fixtures\/v2|authoring\/w01|reviews\/w01-minimal-human-approval)/u.test(sourcePath))) {
    return 'source';
  }
  if (repoId === 'web' && sourcePath === 'content/published/content.json') {
    if (collection === 'sources') return 'source';
    if (collection === 'assets' || collection === 'routes') return 'web';
    if (pointer.startsWith('/talent_trees/')) return SOURCE_REFERENCE_FIELDS.has(key) ? 'source' : 'web';
    if (collection === 'bindings' || pointer.includes('/claims/') || /\/(?:claimRefs|tier_claims|defined_tiers|available_tiers)(?:\/|$)/u.test(pointer)) return 'source';
    if (SOURCE_REFERENCE_FIELDS.has(key)) return 'source';
    if (WEB_TEXT_FIELDS.has(key) || /(?:^|_)zh_tw$/iu.test(key) || /(?:name|description|effect|mechanics|summary|title)/iu.test(key)) return 'web';
    if (['assets', 'routes', 'sources'].includes(collection)) return collection === 'sources' ? 'source' : 'web';
    if (['weapons', 'blessings', 'marks', 'variants', 'skills', 'bindings', 'talent_trees'].includes(collection)) return 'source';
    return 'web';
  }
  if (repoId === 'web' && sourcePath.startsWith('content/w01/')) {
    if (sourcePath.endsWith('web-authoring.json') || sourcePath.includes('announcement') || sourcePath.endsWith('release.json')) return 'web';
    if (sourcePath.includes('/source/')) return 'source';
    return sourcePath.includes('rollback') || sourcePath.includes('composition-receipt') ? 'web' : 'source';
  }
  if (repoId === 'web' && (sourcePath === 'source.lock.json' || sourcePath === 'content/source.lock.json')) return 'web';
  if (repoId === 'extension' && sourcePath.startsWith('docs/')) {
    if (EXTENSION_PROCESS_FIELDS.has(key)) return 'extension';
    if (SOURCE_REFERENCE_FIELDS.has(key)) return 'source';
    if (WEB_TEXT_FIELDS.has(key) || /(?:english|chinese|translation|display|website|label|description|name)/iu.test(key)) return 'web';
    return 'extension';
  }
  if (repoId === 'extension' && sourcePath === 'data/v1/mechanics/player-guides.json') {
    const pathSegments = pointer.split('/').slice(1).map(part => part.replace(/~1/g, '/').replace(/~0/g, '~'));
    const hasSegment = names => pathSegments.some(part => names.has(part));
    if (EXTENSION_PROCESS_FIELDS.has(key) || hasSegment(new Set(['review', 'reviews', 'approval', 'approvals', 'verification', 'cross_review']))) return 'extension';
    if (SOURCE_REFERENCE_FIELDS.has(key) || hasSegment(new Set(['sourceRefs', 'sourceRef', 'sourceIds', 'sourceId', 'evidenceRefs', 'claimRefs', 'claims', 'gameReleaseId', 'weaponIds', 'skillIds']))) return 'source';
    if (hasSegment(new Set(['sections', 'heading', 'paragraphs'])) || WEB_TEXT_FIELDS.has(key)) return 'web';
  }
  if (repoId === 'extension' && (sourcePath.endsWith('review-approvals.json') || sourcePath.includes('reviewed-abilities'))) return 'extension';
  if (repoId === 'extension' && (sourcePath.includes('website-display') || sourcePath.includes('website-token-corrections')
    || sourcePath.includes('player-guides') || sourcePath.endsWith('catalog.json'))) {
    if (EXTENSION_PROCESS_FIELDS.has(key)) return 'extension';
    if (SOURCE_REFERENCE_FIELDS.has(key)) return 'source';
    if (WEB_TEXT_FIELDS.has(key) || /(?:english|chinese|translation|display|website|label|description|name)/iu.test(key)) return 'web';
  }
  if (EXTENSION_PROCESS_FIELDS.has(key)) return 'extension';
  if (SOURCE_REFERENCE_FIELDS.has(key)) return 'source';
  if (WEB_TEXT_FIELDS.has(key) || /(?:english|chinese|translation|display|website|label|description)/iu.test(key)) return 'web';
  if (repoId === 'extension' && sourcePath.startsWith('data/v1/')) return 'source';
  if (repoId === 'web') return 'web';
  if (repoId === 'source') return 'source';
  return 'extension';
}

function ownerForStaticJsField({ rootName, pointer, key }) {
  const segments = pointer.split('/').slice(1).map(part => part.replace(/~1/g, '/').replace(/~0/g, '~'));
  const contains = segment => segments.includes(segment);
  if (rootName === 'data') {
    if (contains('perkEffects') || contains('fragments') || contains('details')
      || ['suffix', 'englishSuffix'].includes(key)
      || WEB_TEXT_FIELDS.has(key) || /(?:english|chinese|translation|display|description|effect|label|name)/iu.test(key)) return 'web';
    if (contains('hashes') || contains('hash')
      || ['hash', 'hashes', 'icon', 'iconPath', 'weaponIconPath', 'path', 'weaponPath', 'url'].includes(key)) return 'extension';
    if (SOURCE_REFERENCE_FIELDS.has(key) || ['id', 'version', 'revision'].includes(key)) return 'source';
    return 'source';
  }
  if (rootName === 'nativeFragmentRules') {
    if (contains('domShape') || ['kind', 'color', 'breaksBefore', 'domShape', 'icon', 'iconPath', 'hash', 'hashes', 'url'].includes(key)) {
      return 'extension';
    }
    if (SOURCE_REFERENCE_FIELDS.has(key)) return 'source';
    if (WEB_TEXT_FIELDS.has(key) || /(?:english|chinese|translation|display|description|effect|label|name)/iu.test(key)) return 'web';
    return 'source';
  }
  if (WEB_TEXT_FIELDS.has(key) || /(?:name|description|effect|translation|label|display|chinese|english)/iu.test(key)) return 'web';
  return 'source';
}

function releaseScopeFor(repoId, sourcePath, gameReleaseId, synthetic = false) {
  if (synthetic || sourcePath.includes('/fixtures/v2/') || sourcePath.endsWith('/w01-preview.json')) {
    return { gameReleaseId: gameReleaseId ?? null, releaseScope: 'synthetic-only', reason: gameReleaseId ? undefined : 'synthetic fixture has no stable game release' };
  }
  if (repoId === 'source' && sourcePath.startsWith('content/authoring/w01-')) {
    return gameReleaseId
      ? { gameReleaseId, releaseScope: 'current-snapshot-candidate', reason: undefined }
      : { gameReleaseId: null, releaseScope: 'release-unspecified', reason: 'W01 authoring candidate has no explicit gameReleaseId at this field' };
  }
  if (sourcePath === 'content/published/content.json') {
    return { gameReleaseId: null, releaseScope: 'historical-game-release', reason: 'published package identifies game_version 1.13.1 rather than a Source gameReleaseId' };
  }
  if (repoId === 'source' && sourcePath.includes('/legacy/mods/')) {
    return { gameReleaseId: null, releaseScope: 'historical-legacy-marker', reason: 'legacy Mod archive is pinned to its own historical source and does not assert a current gameReleaseId' };
  }
  if (repoId === 'source' && gameReleaseId) return { gameReleaseId, releaseScope: gameReleaseId.startsWith('fixture:') ? 'synthetic-only' : 'current-snapshot-candidate', reason: undefined };
  if (repoId === 'source-code') return { gameReleaseId: null, releaseScope: 'registry-snapshot', reason: 'fixed code registry snapshot does not prove a game release' };
  if (repoId === 'extension' && sourcePath.startsWith('extension/')) {
    return { gameReleaseId: null, releaseScope: 'historical-game-release', reason: 'Extension bundle text records 1.13.1/build 25606770 but is not a formal gameReleaseId match' };
  }
  if (repoId === 'extension' && sourcePath.startsWith('data/v1/')) {
    return { gameReleaseId: null, releaseScope: 'historical-legacy-marker', reason: 'legacy data is tied to its 1.13.1 source snapshot, not a current release claim' };
  }
  if (repoId === 'extension' && sourcePath.startsWith('docs/')) {
    return { gameReleaseId: null, releaseScope: 'reference-document', reason: 'review document scope is historical and has no canonical gameReleaseId' };
  }
  if (repoId === 'web' && sourcePath.startsWith('content/w01/')) {
    return { gameReleaseId: gameReleaseId ?? null, releaseScope: gameReleaseId ? 'current-snapshot-candidate' : 'release-unspecified', reason: gameReleaseId ? undefined : 'W01 Web preview input has no canonical gameReleaseId at this field' };
  }
  if (gameReleaseId) return { gameReleaseId, releaseScope: 'current-snapshot-candidate', reason: undefined };
  return { gameReleaseId: null, releaseScope: 'release-unspecified', reason: `${repoId} source field has no verified canonical gameReleaseId` };
}

function targetKindFor(owner, sourcePath) {
  if (owner === 'source') return sourcePath.startsWith('content/schema/') || sourcePath.endsWith('.md') ? 'source-document' : 'source-record';
  if (owner === 'web') return /announcement|公告/iu.test(sourcePath) ? 'web-announcement' : 'web-record';
  if (owner === 'extension') return sourcePath.startsWith('docs/') || sourcePath.startsWith('data/v1/') || sourcePath.includes('review') ? 'legacy-artifact' : 'extension-runtime-binding';
  if (owner === 'private') return 'private-archive';
  if (owner === 'mods') return 'mods-file';
  throw new Error(`unsupported owner: ${owner}`);
}

function entryIdFor(repoId, commit, sourcePath, selector, owner) {
  return `w03-${sha256Hex(Buffer.from([repoId, commit, sourcePath, selector.kind, selector.locator, owner].join('\n'), 'utf8')).slice(0, 24)}`;
}

function baseEntry({ repoId, commit, sourcePath, blobOid, selector, fragment, owner, sourceEntityKey, fieldPath, gameReleaseId, releaseScope, scopeReason, targetRecordId = null, targetRecordReason, targetGameReleaseId = null, targetGameReleaseReason, targetRepo = null, targetCommit = null, targetPath = null, targetStatus = 'not-generated', targetKind, targetReason, intendedDisposition = 'migrated', linkDisposition = 'planned-reference-only', splitGroupId }) {
  const targetExists = targetStatus !== 'not-generated';
  const source = { repoId, commit, path: sourcePath, gitBlobOid: blobOid };
  const target = {
    repoId: targetExists ? targetRepo : null,
    commit: targetExists ? targetCommit : null,
    path: targetExists ? targetPath : null,
    fieldPath,
    gameReleaseId: targetGameReleaseId,
    ...(targetGameReleaseId === null ? { gameReleaseIdNotApplicableReason: targetGameReleaseReason } : {}),
    recordId: targetRecordId,
    ...(targetRecordId === null ? { recordIdNotApplicableReason: targetRecordReason } : {}),
    kind: targetKind,
    status: targetStatus,
    ...(targetExists ? {} : { reason: targetReason }),
  };
  const scope = {
    gameReleaseId,
    releaseScope,
    ...(gameReleaseId === null ? { reason: scopeReason } : {}),
  };
  return {
    schemaVersion: ENTRY_SCHEMA_VERSION,
    entryId: entryIdFor(repoId, commit, sourcePath, selector, owner),
    source,
    sourceEntityKey,
    selector,
    fragment,
    owner,
    target,
    scope,
    mappingStatus: 'planned',
    intendedDisposition,
    actualOutcome: { status: 'not-started' },
    review: { carryForward: 'not-assumed', basisRefs: ['W03 fixed-input inventory; prior review state is not inherited'], state: 'pending' },
    linkDisposition,
    rollback: { ...source },
    ...(splitGroupId ? { splitGroupId } : {}),
  };
}

function existingTargetFor(owner, sourceRepoId, sourceCommit, sourcePath, sourceEntityKey, fieldPath, sourceGameReleaseId, isDocument = false) {
  const sameOwnerRepo = (owner === sourceRepoId) || (owner === 'extension' && sourceRepoId === 'extension');
  if (!sameOwnerRepo) return null;
  const kind = targetKindFor(owner, sourcePath);
  const recordId = ['stable-id', 'legacy-id', 'record-index', 'record-path'].includes(sourceEntityKey.kind)
    ? String(sourceEntityKey.value) : null;
  return {
    targetRepo: sourceRepoId,
    targetCommit: sourceCommit,
    targetPath: sourcePath,
    targetStatus: 'existing',
    targetKind: isDocument && owner === 'source' ? 'source-document' : kind,
    targetRecordId: recordId,
    targetRecordReason: recordId === null ? 'existing field is anchored by its exact source pointer and has no canonical record ID' : undefined,
    targetGameReleaseId: sourceGameReleaseId ?? null,
    targetGameReleaseReason: sourceGameReleaseId ? undefined : 'existing source field has no canonical gameReleaseId at this location',
  };
}

function newMappingEntry({ repoId, commit, sourcePath, blobOid, owner, selector, fragment, sourceEntityKey, fieldPath, sourceGameReleaseId, scope, target, intendedDisposition, linkDisposition, splitGroupId }) {
  const defaultTarget = target ?? existingTargetFor(owner, repoId, commit, sourcePath, sourceEntityKey, fieldPath, sourceGameReleaseId);
  const targetStatus = defaultTarget?.targetStatus ?? 'not-generated';
  const kind = defaultTarget?.targetKind ?? targetKindFor(owner, sourcePath);
  return baseEntry({
    repoId, commit, sourcePath, blobOid, selector, fragment, owner, sourceEntityKey,
    fieldPath: defaultTarget?.fieldPath ?? fieldPath,
    gameReleaseId: scope.gameReleaseId,
    releaseScope: scope.releaseScope,
    scopeReason: scope.reason,
    targetRecordId: defaultTarget?.targetRecordId ?? null,
    targetRecordReason: defaultTarget?.targetRecordReason ?? 'canonical target record ID is not assigned for this planned mapping',
    targetGameReleaseId: defaultTarget?.targetGameReleaseId ?? null,
    targetGameReleaseReason: defaultTarget?.targetGameReleaseReason ?? 'planned target release has not been independently bound to a canonical gameReleaseId',
    targetRepo: defaultTarget?.targetRepo ?? null,
    targetCommit: defaultTarget?.targetCommit ?? null,
    targetPath: defaultTarget?.targetPath ?? null,
    targetStatus,
    targetKind: kind,
    targetReason: defaultTarget?.targetReason ?? 'target mapping is planned and has not been generated',
    intendedDisposition: intendedDisposition ?? (targetStatus === 'existing' ? 'kept' : 'migrated'),
    linkDisposition: linkDisposition ?? (targetStatus === 'existing' ? 'retain-exact-source-location' : 'planned-reference-only'),
    splitGroupId,
  });
}

export function collectJsonMappingEntries({ repoId, commit, sourcePath, blobOid, bytes, synthetic = false, forcedOwner = null }) {
  const root = parseJsonBytes(bytes);
  const entries = [];
  const sourceDoc = ['source', 'web', 'extension'].includes(repoId) ? repoId : 'extension';
  function visit(value, pointer, inheritedIdentity, inheritedRelease, parentCollection = null, parentPointer = '') {
    const entity = identityForObject(value, pointer, inheritedIdentity, parentCollection, repoId);
    const gameReleaseId = rootGameRelease(value, inheritedRelease);
    if (Array.isArray(value)) {
      if (!value.length) emit(value, pointer, entity, gameReleaseId, parentCollection, parentPointer, '');
      else value.forEach((item, index) => visit(item, `${pointer}/${index}`, entity, gameReleaseId, parentCollection, pointer));
      return;
    }
    if (isObject(value)) {
      const keys = Object.keys(value);
      if (!keys.length) emit(value, pointer, entity, gameReleaseId, parentCollection, parentPointer, '');
      for (const key of keys) {
        const child = value[key];
        const childPointer = `${pointer}/${jsonPointerEscape(key)}`;
        const nextCollection = pointer === '' ? key : parentCollection;
        visit(child, childPointer, entity, gameReleaseId, nextCollection, pointer);
      }
      return;
    }
    emit(value, pointer, entity, gameReleaseId, parentCollection, parentPointer, pointer.slice(pointer.lastIndexOf('/') + 1));
  }
  function emit(value, pointer, entity, gameReleaseId, collection, parentPointer, key) {
    if (value === undefined) return;
    const owner = forcedOwner ?? ownerForField({ repoId: sourceDoc, sourcePath, pointer, key, value, collection });
    const scope = releaseScopeFor(sourceDoc, sourcePath, gameReleaseId, synthetic);
    const selector = { kind: 'json-pointer', locator: pointer };
    const fragment = { serialization: 'json-value-json-stringify', sha256: hashJsonValue(value) };
    const identity = entity ?? { kind: 'json-pointer', value: pointer || '/', reason: null };
    const target = existingTargetFor(owner, repoId, commit, sourcePath, identity, pointer || '/', gameReleaseId,
      sourcePath.includes('/schema/') || sourcePath.endsWith('.md'));
    const splitGroupId = `split-${sha256Hex(Buffer.from(`${repoId}\n${commit}\n${sourcePath}\n${parentPointer || '/'}`, 'utf8')).slice(0, 16)}`;
    entries.push(newMappingEntry({
      repoId, commit, sourcePath, blobOid, owner, selector, fragment, sourceEntityKey: identity,
      fieldPath: pointer || '/', sourceGameReleaseId: gameReleaseId, scope, target,
      splitGroupId,
    }));
  }
  visit(root, '', null, null);
  return entries;
}

function wholeFileEntry({ repoId, commit, sourcePath, blobOid, owner, scope, targetKind, targetStatus = 'existing', targetRepo = repoId, targetCommit = commit, targetPath = sourcePath, intendedDisposition = 'kept', linkDisposition = 'retain-exact-source-location' }) {
  const selector = { kind: 'file', locator: 'file' };
  const sourceEntityKey = { kind: 'path-scope', value: sourcePath, reason: null };
  const target = targetStatus === 'existing' || targetStatus === 'retained' ? {
    targetRepo, targetCommit, targetPath, targetStatus, targetKind: targetKind ?? targetKindFor(owner, sourcePath),
    targetRecordId: null, targetRecordReason: 'whole-file artifact has no game record ID',
    targetGameReleaseId: null, targetGameReleaseReason: 'whole-file artifact has no canonical gameReleaseId',
  } : {
    targetKind: targetKind ?? targetKindFor(owner, sourcePath), targetStatus,
    targetRecordId: null, targetRecordReason: 'whole-file target is not a game record',
    targetGameReleaseId: null, targetGameReleaseReason: 'whole-file target has no canonical gameReleaseId',
    targetReason: 'whole-file target has not been generated',
  };
  return newMappingEntry({
    repoId, commit, sourcePath, blobOid, owner, selector,
    fragment: { normalization: 'git-blob', gitBlobOid: blobOid },
    sourceEntityKey, fieldPath: 'file', sourceGameReleaseId: scope.gameReleaseId,
    scope, target, intendedDisposition, linkDisposition,
  });
}

function collectJsLiteralEntries({ repoId, commit, sourcePath, blobOid, bytes, rootName, forceOwnerForField = null, sourceText = null, rootValue = null }) {
  sourceText ??= decodeUtf8(bytes);
  rootValue ??= parseStaticJsRoot(sourceText, rootName);
  const entries = [];
  function visit(value, pointer, inheritedIdentity, inheritedRelease, parentPointer = '') {
    const entity = identityForObject(value, pointer, inheritedIdentity, null, repoId);
    const release = rootGameRelease(value, inheritedRelease);
    if (Array.isArray(value)) {
      if (!value.length) emit(value, pointer, entity, release, parentPointer, '');
      else value.forEach((child, index) => visit(child, `${pointer}/${index}`, entity, release, pointer));
      return;
    }
    if (isObject(value)) {
      const keys = Object.keys(value);
      if (!keys.length) emit(value, pointer, entity, release, parentPointer, '');
      for (const key of keys) visit(value[key], `${pointer}/${jsonPointerEscape(key)}`, entity, release, pointer);
      return;
    }
    emit(value, pointer, entity, release, parentPointer, pointer.slice(pointer.lastIndexOf('/') + 1));
  }
  function emit(value, pointer, entity, gameReleaseId, parentPointer, key) {
    if (value === undefined) return;
    const owner = forceOwnerForField
      ? forceOwnerForField({ key, pointer, value, rootName })
      : ownerForStaticJsField({ rootName, pointer, key });
    const scope = releaseScopeFor(repoId, sourcePath, gameReleaseId);
    const selector = { kind: 'js-literal-pointer', root: rootName, locator: pointer };
    const fragment = { serialization: 'js-value-json-stringify', sha256: hashJsonValue(value) };
    const identity = entity ?? { kind: 'json-pointer', value: pointer || '/', reason: null };
    const target = existingTargetFor(owner, repoId, commit, sourcePath, identity, pointer || '/', gameReleaseId);
    const splitGroupId = `split-${sha256Hex(Buffer.from(`${repoId}\n${commit}\n${sourcePath}\n${rootName}\n${parentPointer || '/'}`, 'utf8')).slice(0, 16)}`;
    entries.push(newMappingEntry({ repoId, commit, sourcePath, blobOid, owner, selector, fragment,
      sourceEntityKey: identity, fieldPath: pointer || '/', sourceGameReleaseId: gameReleaseId, scope,
      target, splitGroupId }));
  }
  visit(rootValue, '', null, null);
  return entries;
}

function canonicalJson(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (isObject(value)) return `{${Object.keys(value).sort(compare).map(key => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}

function parseArgs(args) {
  const result = { mode: args.length === 0 ? 'verify' : null };
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (arg === '--help') { result.mode = 'help'; continue; }
    if (arg === '--verify') { result.mode = 'verify'; continue; }
    if (arg === '--generate') { result.mode = 'generate'; continue; }
    if (arg.startsWith('--') && index + 1 < args.length) result[arg.slice(2)] = args[++index];
    else throw new Error(`unsupported CLI argument: ${arg}`);
  }
  return result;
}

async function collectShardBytes(root, relativePaths) {
  const map = new Map();
  for (const relativePath of relativePaths) map.set(relativePath, await readFile(path.join(root, ...relativePath.split('/'))));
  return map;
}

async function listDocumentFiles(root, prefix = '') {
  let entries;
  try { entries = await readdir(path.join(root, ...prefix.split('/').filter(Boolean)), { withFileTypes: true }); }
  catch (error) { if (error.code === 'ENOENT') return []; throw error; }
  const files = [];
  for (const entry of entries) {
    const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isSymbolicLink()) throw new Error(`W03 document tree cannot contain symlinks: ${relativePath}`);
    if (entry.isDirectory()) files.push(...await listDocumentFiles(root, relativePath));
    else if (entry.isFile()) files.push(relativePath);
    else throw new Error(`W03 document tree contains a non-file entry: ${relativePath}`);
  }
  return files.sort(compare);
}

async function removePreviousAShards(outRoot) {
  const oldIndexPath = path.join(outRoot, 'mapping-ledger.json');
  let oldIndex = null;
  try { oldIndex = parseJsonBytes(await readFile(oldIndexPath)); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  const existingFiles = await listDocumentFiles(outRoot, 'extension');
  if (!oldIndex) {
    if (existingFiles.length) throw new Error('refusing to overwrite an Extension output directory without its previous A index');
    return;
  }
  if (!Array.isArray(oldIndex.shards)) throw new Error('refusing to clean Extension outputs without a prior A shard index');
  const previousPaths = oldIndex.shards.map(item => item?.path);
  if (previousPaths.some(item => typeof item !== 'string' || !safeRepoPath(item) || !item.startsWith('extension/'))
    || new Set(previousPaths).size !== previousPaths.length) {
    throw new Error('refusing to clean Extension outputs from an unsafe or duplicate prior A index');
  }
  const indexedFiles = [...previousPaths].sort(compare);
  if (JSON.stringify(existingFiles) !== JSON.stringify(indexedFiles)) {
    throw new Error('refusing to delete stale Extension files not exactly owned by the prior A index');
  }
  for (const relativePath of previousPaths) {
    await unlink(path.join(outRoot, ...relativePath.split('/')));
  }
}

async function verifyIndexedFileSet(docRoot, aLedger, modsIndex) {
  const expected = new Set([
    'README.md', 'coverage.json', 'mapping-ledger.json', 'scope-manifest.json',
    'mods/README.md', 'mods/mapping-ledger.json',
    ...aLedger.shards.map(item => item.path),
    ...modsIndex.shards.map(item => item.path),
  ]);
  const actual = await listDocumentFiles(docRoot);
  const missing = [...expected].filter(item => !actual.includes(item)).sort(compare);
  const extra = actual.filter(item => !expected.has(item));
  if (missing.length || extra.length) {
    throw new Error(`W03 output file set mismatch: missing=${missing[0] ?? 'none'}; extra=${extra[0] ?? 'none'}`);
  }
}

export function validateIndexedFileList(aLedger, modsIndex, actualFiles) {
  if (!isObject(aLedger) || !Array.isArray(aLedger.shards) || !isObject(modsIndex) || !Array.isArray(modsIndex.shards)
    || !Array.isArray(actualFiles)) return [issue('file-set-shape', 'A/B shard indexes and the actual file list are required')];
  const expected = new Set([
    'README.md', 'coverage.json', 'mapping-ledger.json', 'scope-manifest.json',
    'mods/README.md', 'mods/mapping-ledger.json',
    ...aLedger.shards.map(item => item?.path), ...modsIndex.shards.map(item => item?.path),
  ]);
  const actual = new Set(actualFiles);
  const issues = [];
  for (const file of expected) if (!actual.has(file)) issues.push(issue('file-set-missing', `indexed W03 output is missing: ${file}`, `/${file}`));
  for (const file of actual) if (!expected.has(file)) issues.push(issue('file-set-extra', `W03 output is not indexed: ${file}`, `/${file}`));
  if (actual.size !== actualFiles.length) issues.push(issue('file-set-duplicate', 'actual W03 file list contains duplicates'));
  return issues;
}

export function validateCoverageSummary(coverage, summary) {
  const issues = [];
  if (!isObject(coverage) || coverage.schemaVersion !== 'w03.coverage.v1' || !isObject(summary)) {
    return [issue('coverage-shape', 'coverage must use w03.coverage.v1 and have an independently computed row summary')];
  }
  for (const field of ['totalEntries', 'byOwner', 'byTargetStatus', 'byReleaseScope', 'sourcePathEntryCounts', 'sourceArtifactEntries', 'groups']) {
    if (stableJson(coverage[field]) !== stableJson(summary[field])) {
      issues.push(issue('coverage-mismatch', `coverage ${field} differs from verified ledger rows`, `/${field}`));
    }
  }
  if (stableJson(summary.groups) !== stableJson(EXPECTED_A_GROUP_COUNTS_TO_SUMMARY)) {
    issues.push(issue('coverage-required-groups', 'the fixed 17 W03 groups and their expected row counts must all be present', '/groups'));
  }
  if (stableJson(summary.byOwner) !== stableJson(EXPECTED_A_OWNER_COUNTS)) {
    issues.push(issue('coverage-required-owner-counts', 'owner totals differ from the fixed root/ancestor classification census', '/byOwner'));
  }
  if (summary.totalEntries !== EXPECTED_A_ENTRY_COUNT) {
    issues.push(issue('coverage-required-total', 'verified W03 row count differs from the fixed input inventory', '/totalEntries'));
  }
  if (stableJson(summary.sourcePathEntryCounts) !== stableJson(EXPECTED_A_SOURCE_PATH_ENTRY_COUNTS)) {
    issues.push(issue('coverage-required-source-paths', 'fixed source paths and row counts are incomplete or changed', '/sourcePathEntryCounts'));
  }
  return issues;
}

export function validateCoverageManifestBindings(coverage, manifest) {
  const issues = [];
  const fail = (code, message, pathName) => issues.push(issue(code, message, pathName));
  if (!isObject(coverage) || !isObject(manifest)) {
    return [issue('coverage-manifest-shape', 'coverage and scope manifest objects are required')];
  }
  const equal = (left, right) => stableJson(left) === stableJson(right);
  const comparisons = [
    ['sourceCandidateCounts', coverage.sourceCandidateCounts, manifest.sourceCandidates],
    ['extensionInputVerification', coverage.extensionInputVerification, manifest.extensionInputProvenance],
    ['formalContractReferences', coverage.formalContractReferences, manifest.formalContractReferences],
    ['legacyHardcodedContentReview', coverage.legacyHardcodedContentReview, manifest.legacyHardcodedContentReview],
    ['codeRegistry', coverage.codeRegistry, manifest.codeRegistry],
  ];
  for (const [name, actual, expected] of comparisons) {
    if (!isObject(actual) || !isObject(expected) || !equal(actual, expected)) {
      fail('coverage-manifest-mismatch', `coverage ${name} differs from the scope manifest`, `/${name}`);
    }
  }
  if (!equal(coverage.publishedCounts, manifest.webSnapshot?.counts)
    || !equal(coverage.publishedCounts, EXPECTED_PUBLISHED_COUNTS)
    || manifest.webSnapshot?.packageKind !== 'published' || manifest.webSnapshot?.gameVersion !== '1.13.1'
    || manifest.webSnapshot?.scope !== 'historical-only') {
    fail('coverage-published-snapshot', 'historical published counts must match the pinned Web scope and must not imply current coverage', '/publishedCounts');
  }
  if (coverage.uniqueSkillIds !== manifest.webSnapshot?.uniqueSkillIds || coverage.uniqueSkillIds !== 640) {
    fail('coverage-unique-skills', 'unique skill identity count differs from the fixed historical snapshot', '/uniqueSkillIds');
  }
  if (!equal(coverage.sourceCandidateCounts, EXPECTED_SOURCE_CANDIDATE_COUNTS)) {
    fail('coverage-source-candidates', 'candidate coverage counts or no-carry-forward status differ from fixed inputs', '/sourceCandidateCounts');
  }
  if (coverage.additionalExtensionDataCount !== 9) {
    fail('coverage-additional-extension-data', 'the fixed additional Extension data/v1 input set is incomplete', '/additionalExtensionDataCount');
  }
  if (!Array.isArray(manifest.inputArtifacts)) {
    fail('scope-input-artifacts', 'scope manifest must list the fixed inventoried source artifacts', '/inputArtifacts');
  } else {
    const keys = manifest.inputArtifacts.map(item => `${item?.repoId}/${item?.path}`);
    const expectedKeys = Object.keys(EXPECTED_A_SOURCE_PATH_ENTRY_COUNTS).filter(key => !key.startsWith('extension/')
      || !EXPECTED_EXTENSION_INPUT_PATHS.has(key.slice('extension/'.length)));
    const uniqueKeys = new Set(keys);
    if (keys.length !== 46 || uniqueKeys.size !== keys.length
      || expectedKeys.some(key => !uniqueKeys.has(key))
      || keys.some(key => !Object.hasOwn(EXPECTED_A_SOURCE_PATH_ENTRY_COUNTS, key))) {
      fail('scope-input-artifact-set', 'the 46 explicit whole-file/source artifacts do not match the fixed row source inventory', '/inputArtifacts');
    }
    const sourceArtifacts = new Map((coverage.sourceArtifactEntries ?? []).map(item => [
      JSON.stringify([item.repoId, item.commit, item.path]), item,
    ]));
    for (const item of manifest.inputArtifacts) {
      const actual = sourceArtifacts.get(JSON.stringify([item.repoId, item.commit, item.path]));
      if (!actual || actual.gitBlobOid !== item.gitBlobOid || actual.entryCount < 1) {
        fail('scope-artifact-row-binding', `source artifact is not bound to the mapped rows: ${item.repoId}/${item.path}`, '/inputArtifacts');
      }
    }
    for (const input of manifest.extensionInputProvenance?.verifiedInputs ?? []) {
      const actual = sourceArtifacts.get(JSON.stringify(['extension', input.exactSourceCommit, input.path]));
      if (!actual || actual.gitBlobOid !== input.gitBlobOid || actual.entryCount < 1) {
        fail('scope-extension-input-row-binding', `declared Extension input has no mapped rows with the verified blob: ${input.path}`, '/extensionInputProvenance/verifiedInputs');
      }
    }
  }
  return issues;
}

export function validateScopeBindings(manifest) {
  const issues = [];
  const fail = (code, message, pathName = '/') => issues.push(issue(code, message, pathName));
  if (!isObject(manifest) || manifest.schemaVersion !== 'w03.scope-manifest.v1'
    || manifest.entrySchemaVersion !== ENTRY_SCHEMA_VERSION) {
    return [issue('scope-shape', 'scope manifest must declare the fixed W03 schema versions')];
  }
  const generatedFrom = manifest.generatedFrom;
  const expectedPinKeys = Object.keys(FIXED_PINS).sort(compare);
  if (!isObject(generatedFrom) || JSON.stringify(Object.keys(generatedFrom).sort(compare)) !== JSON.stringify(expectedPinKeys)) {
    fail('scope-pins', 'scope must contain exactly the fixed Web, Source, Extension, Mods, Private, and code pins', '/generatedFrom');
  } else {
    for (const [name, pin] of Object.entries(FIXED_PINS)) {
      if (generatedFrom[name]?.repoId !== pin.repoId || generatedFrom[name]?.commit !== pin.commit) {
        fail('scope-pin-mismatch', `generatedFrom.${name} differs from the fixed repository pin`, `/generatedFrom/${name}`);
      }
    }
  }

  const refs = manifest.formalContractReferences;
  if (!isObject(refs)) {
    fail('formal-refs', 'formal Source/Web and Extension contract references are required', '/formalContractReferences');
  } else {
    const sourceRefs = refs.source?.files;
    const sourceExpected = new Map([
      ['content/schema/v2/source-contract.schema.json', '4e413bafdd7478dda7527b3824ec36509b966343dc9f2e5e838063f80d002737'],
      ['content/fixtures/v2/representative-source.json', '849aaa1adba8d73a8c3963de70b5af5e8d4aa9c4c55b9d69c0f74152c79b7b75'],
      ['scripts/content/contract-validator.mjs', '7fbab2de7890e231a7c6e317f2997c1ca3939c17dc87483e927e91b6c6537aaa'],
    ]);
    if (!Array.isArray(sourceRefs) || refs.source.repoId !== 'source' || refs.source.commit !== FIXED_PINS.source.commit
      || sourceRefs.length !== sourceExpected.size || sha256Hex(Buffer.from(canonicalJson(sourceRefs), 'utf8')) !== SOURCE_FORMAL_REF_TABLE_SHA256) {
      fail('formal-source-refs', 'the three fixed Source v2 schema/fixture/validator refs are incomplete or changed', '/formalContractReferences/source');
    } else {
      for (const file of sourceRefs) {
        if (!sourceExpected.has(file.path) || file.rawSha256 !== sourceExpected.get(file.path)
          || file.repoId !== 'source' || file.commit !== FIXED_PINS.source.commit || file.owner !== 'source'
          || !SHA1_RE.test(file.gitBlobOid ?? '') || !Number.isSafeInteger(file.byteLength) || file.byteLength < 1) {
          fail('formal-source-file', `invalid or unexpected Source v2 reference: ${file.path}`, '/formalContractReferences/source/files');
        }
      }
    }

    const webRefs = refs.web?.files;
    const webPaths = Array.isArray(webRefs) ? new Set(webRefs.map(file => file.path)) : new Set();
    if (!Array.isArray(webRefs) || refs.web.repoId !== 'web' || refs.web.commit !== FIXED_PINS.web.commit
      || webPaths.size !== EXPECTED_WEB_FORMAL_PATHS.size
      || [...EXPECTED_WEB_FORMAL_PATHS].some(item => !webPaths.has(item))
      || sha256Hex(Buffer.from(canonicalJson(webRefs), 'utf8')) !== WEB_FORMAL_REF_TABLE_SHA256) {
      fail('formal-web-refs', 'the owner-locked Web authoring, official-input, release, and fixture refs are incomplete or changed', '/formalContractReferences/web');
    } else {
      for (const file of webRefs) {
        if (file.repoId !== 'web' || file.commit !== FIXED_PINS.web.commit || file.owner !== 'web'
          || !SHA1_RE.test(file.gitBlobOid ?? '') || !SHA256_RE.test(file.rawSha256 ?? '')
          || !Number.isSafeInteger(file.byteLength) || file.byteLength < 1) {
          fail('formal-web-file', `invalid Web contract reference: ${file.path}`, '/formalContractReferences/web/files');
        }
      }
    }

    const ext = refs.extensionFormal;
    const extPinValid = isObject(ext) && ext.repoId === 'extension' && ext.commit === FIXED_PINS.extensionFormal.commit
      && ext.ownerSnapshotLock?.path === 'content/contracts/w02/owner-snapshot.lock.json'
      && ext.ownerSnapshotLock?.rawSha256 === EXTENSION_SNAPSHOT_LOCK_SHA256
      && ext.snapshotLockSha256 === EXTENSION_SNAPSHOT_LOCK_SHA256
      && ext.capabilityLock?.path === 'content/contracts/w02/dev-capability.json'
      && ext.capabilityLock?.rawSha256 === EXTENSION_DEV_CAPABILITY_SHA256
      && ext.conformanceTool?.path === 'scripts/w02/contract-conformance.mjs'
      && ext.conformanceTool?.rawSha256 === EXTENSION_C2_TOOL_SHA256
      && sha256Hex(Buffer.from(canonicalJson([ext.ownerSnapshotLock, ext.capabilityLock, ext.conformanceTool]), 'utf8')) === EXTENSION_FORMAL_REF_TABLE_SHA256;
    if (!extPinValid) fail('formal-extension-refs', 'formal Extension owner/C2 refs differ from the fixed W02 contract pin', '/formalContractReferences/extensionFormal');
    const c2 = ext?.c2ReceiptEvidence;
    if (!isObject(c2) || c2.sha256 !== EXTENSION_C2_RECEIPT_SHA256 || c2.snapshotLockSha256 !== EXTENSION_SNAPSHOT_LOCK_SHA256
      || c2.contractVersion !== '1.0.0' || c2.packageVersion !== '0.2.30' || c2.runtimeIntegration !== false
      || c2.publicationEligible !== false || c2.contentCopied !== false) {
      fail('formal-extension-c2', 'C2 evidence must remain bound to its fixed receipt and cannot imply runtime/publication approval', '/formalContractReferences/extensionFormal/c2ReceiptEvidence');
    }
    if (refs.extensionLegacy?.repoId !== 'extension' || refs.extensionLegacy.commit !== FIXED_PINS.extension.commit) {
      fail('legacy-extension-pin', 'the historical b18 Extension input must remain separate from formal 5a09 contracts', '/formalContractReferences/extensionLegacy');
    }
  }

  const provenance = manifest.extensionInputProvenance;
  const inputs = provenance?.verifiedInputs;
  const inputPaths = Array.isArray(inputs) ? new Set(inputs.map(input => input.path)) : new Set();
  if (!isObject(provenance) || provenance.extensionManifestCommit !== FIXED_PINS.extension.commit
    || provenance.declaredInputCommit !== FIXED_PINS.extensionInputs.commit
    || provenance.verifiedInputCount !== 26 || provenance.declaredInputSha256Matches !== 26
    || !Array.isArray(inputs) || inputs.length !== 26 || inputPaths.size !== 26
    || inputPaths.size !== EXPECTED_EXTENSION_INPUT_PATHS.size
    || [...EXPECTED_EXTENSION_INPUT_PATHS].some(item => !inputPaths.has(item))
      || sha256Hex(Buffer.from(canonicalJson(inputs), 'utf8')) !== EXTENSION_INPUT_TABLE_SHA256) {
    fail('extension-input-set', 'the 26 fixed Extension inputs are incomplete, duplicated, or changed', '/extensionInputProvenance/verifiedInputs');
  } else {
    for (const input of inputs) {
      const expectedSource = EXPECTED_EXTENSION_OVERRIDE_PATHS.has(input.path)
        ? FIXED_PINS.extension.commit : FIXED_PINS.extensionInputs.commit;
      if (input.declaredInputCommit !== FIXED_PINS.extensionInputs.commit || input.exactSourceCommit !== expectedSource
        || !['raw', 'lf'].includes(input.normalization) || !SHA256_RE.test(input.expectedSha256 ?? '')
        || input.actualSha256 !== input.expectedSha256 || !SHA1_RE.test(input.gitBlobOid ?? '')
        || !Number.isSafeInteger(input.byteLength) || input.byteLength < 1) {
        fail('extension-input-provenance', `invalid fixed Extension input provenance: ${input.path}`, '/extensionInputProvenance/verifiedInputs');
      }
    }
  }
  const overrides = provenance?.exactSourceCommitOverrides;
  const overridePaths = Array.isArray(overrides) ? new Set(overrides.map(item => item.path)) : new Set();
  if (!Array.isArray(overrides) || overrides.length !== 2 || overridePaths.size !== 2
    || [...EXPECTED_EXTENSION_OVERRIDE_PATHS].some(item => !overridePaths.has(item))
    || sha256Hex(Buffer.from(canonicalJson(overrides), 'utf8')) !== EXTENSION_OVERRIDE_TABLE_SHA256) {
    fail('extension-input-overrides', 'exactly the two verified e24-to-b18 path-level exceptions are required', '/extensionInputProvenance/exactSourceCommitOverrides');
  } else {
    for (const override of overrides) {
      const input = inputs?.find(item => item.path === override.path);
      if (!input || override.declaredInputCommit !== FIXED_PINS.extensionInputs.commit
        || override.exactSourceCommit !== FIXED_PINS.extension.commit || override.exactBlobOid !== input.gitBlobOid
        || override.declaredSha256 !== input.expectedSha256 || !SHA256_RE.test(override.e24Sha256 ?? '')
        || override.e24Sha256 === override.declaredSha256) {
        fail('extension-input-override-provenance', `invalid exact-source override: ${override.path}`, '/extensionInputProvenance/exactSourceCommitOverrides');
      }
    }
  }
  return issues;
}

async function verifyModsLedger(docRoot) {
  const relativePath = 'mods/mapping-ledger.json';
  const bytes = await readFile(path.join(docRoot, ...relativePath.split('/')));
  const indexSha256 = sha256Hex(bytes);
  if (indexSha256 !== MODS_INDEX_SHA256) throw new Error(`frozen Mods ledger index SHA-256 mismatch: ${indexSha256}`);
  const index = parseJsonBytes(bytes);
  if (index.format !== 'w03-mods-mapping-ledger.v1' || index.entrySchemaVersion !== ENTRY_SCHEMA_VERSION
    || index.source?.repoId !== 'mods' || index.source.commit !== FIXED_PINS.mods.commit
    || index.source.pathCount !== MODS_SOURCE_PATH_COUNT || index.entryCount !== MODS_ENTRY_COUNT
    || index.shards?.length !== MODS_SHARD_COUNT) {
    throw new Error('frozen Mods ledger metadata does not match the W03-A pinned contract');
  }
  const shardBytes = await collectShardBytes(docRoot, index.shards.map(item => item.path));
  const issues = validateLedgerSnapshot(index, Object.fromEntries(shardBytes));
  if (issues.length) throw new Error(`frozen Mods ledger validation failed: ${issues[0].code} ${issues[0].message}`);
  return { index, indexSha256 };
}

function pointerRowsForMarkdown({ repoId, commit, sourcePath, blobOid, bytes, owner }) {
  decodeUtf8(bytes);
  const rows = [];
  let startByte = 0;
  let lineNumber = 1;
  while (startByte < bytes.length || (bytes.length === 0 && lineNumber === 1)) {
    const newline = bytes.indexOf(0x0a, startByte);
    const endByte = newline < 0 ? bytes.length : newline + 1;
    const locator = `L${lineNumber}-L${lineNumber}`;
    const selector = { kind: 'line-range', locator, startByte, endByte };
    const fragment = { normalization: 'raw', sha256: sha256Hex(bytes.subarray(startByte, endByte)) };
    const sourceEntityKey = { kind: 'record-index', value: lineNumber, reason: null };
    const scope = releaseScopeFor(repoId, sourcePath, null);
    const target = existingTargetFor(owner, repoId, commit, sourcePath, sourceEntityKey, `line[${lineNumber}]`, null, owner === 'source');
    rows.push(newMappingEntry({ repoId, commit, sourcePath, blobOid, owner, selector, fragment, sourceEntityKey,
      fieldPath: `line[${lineNumber}]`, sourceGameReleaseId: null, scope, target,
      intendedDisposition: owner === repoId ? 'kept' : 'archived-readable',
      linkDisposition: owner === repoId ? 'retain-exact-source-location' : 'planned-web-text-reference-only' }));
    if (newline < 0) break;
    startByte = endByte;
    lineNumber++;
  }
  return rows;
}

function supplementalLiteralEntry({ commit, sourcePath, blobOid, bytes, literal, owner, fieldPath, linkDisposition }) {
  const needle = Buffer.from(literal, 'utf8');
  const startByte = bytes.indexOf(needle);
  if (startByte < 0 || bytes.indexOf(needle, startByte + 1) >= 0) {
    throw new Error(`expected one exact supplemental literal in ${sourcePath}: ${fieldPath}`);
  }
  const endByte = startByte + needle.length;
  let lineNumber = 1;
  for (let index = 0; index < startByte; index++) if (bytes[index] === 0x0a) lineNumber++;
  const sourceEntityKey = { kind: 'legacy-id', value: 'riposte-paired-transonic-blades', reason: null };
  const scope = releaseScopeFor('extension', sourcePath, null);
  return newMappingEntry({
    repoId: 'extension', commit, sourcePath, blobOid, owner,
    selector: { kind: 'line-range', locator: `L${lineNumber}:${fieldPath}`, startByte, endByte },
    fragment: { normalization: 'raw', sha256: sha256Hex(bytes.subarray(startByte, endByte)) },
    sourceEntityKey, fieldPath, sourceGameReleaseId: null, scope,
    linkDisposition,
  });
}

function makeCandidateTarget({ sourcePath, fieldPath, reason, kind = 'source-record' }) {
  return {
    targetRepo: null, targetCommit: null, targetPath: null, targetFieldPath: fieldPath,
    targetStatus: 'not-generated', targetKind: kind,
    targetRecordId: null, targetRecordReason: 'canonical target record ID is not assigned for this snapshot candidate',
    targetGameReleaseId: null, targetGameReleaseReason: 'registry snapshot does not establish a canonical game release',
    targetReason: reason ?? `candidate from ${sourcePath} is not asserted as a current published record`,
  };
}

function parseLuaTemplateGroups(sourceText) {
  const declaration = /\blocal\s+template_groups\s*=\s*\{/u.exec(sourceText);
  if (!declaration) throw new Error('pinned weapon_templates.lua lacks local template_groups table');
  const outerOpen = declaration.index + declaration[0].lastIndexOf('{');
  const groups = [];
  let depth = 0;
  let quote = null;
  let escaped = false;
  let lineComment = false;
  let blockStart = -1;
  for (let index = outerOpen; index < sourceText.length; index++) {
    const character = sourceText[index];
    const next = sourceText[index + 1];
    if (lineComment) { if (character === '\n') lineComment = false; continue; }
    if (quote) {
      if (escaped) escaped = false;
      else if (character === '\\') escaped = true;
      else if (character === quote) quote = null;
      continue;
    }
    if (character === '-' && next === '-') { lineComment = true; index++; continue; }
    if (character === '"' || character === "'") { quote = character; continue; }
    if (character === '{') {
      depth++;
      if (depth === 2) blockStart = index;
    } else if (character === '}') {
      if (depth === 2 && blockStart >= 0) {
        const blockEnd = index + 1;
        const blockText = sourceText.slice(blockStart, blockEnd);
        const tokens = [];
        const tokenPattern = /"(?:\\.|[^"\\])*"/gu;
        for (const token of blockText.matchAll(tokenPattern)) {
          const tokenStart = blockStart + token.index;
          const value = JSON.parse(token[0]);
          tokens.push({ value, startIndex: tokenStart, endIndex: tokenStart + token[0].length });
        }
        if (tokens.length === 0) throw new Error(`template group block ${groups.length} has no quoted group name`);
        groups.push({ index: groups.length, tokens });
        blockStart = -1;
      }
      depth--;
      if (depth === 0) return groups;
      if (depth < 0) break;
    }
  }
  throw new Error('pinned template_groups table is unterminated');
}

function codeRegistryRows({ repoRoot, repoTree, sourcePath, commit, candidateSourceBytes }) {
  const blob = readGitBlob(repoRoot, repoTree, commit, sourcePath);
  const sourceText = decodeUtf8(blob.bytes);
  const groups = parseLuaTemplateGroups(sourceText);
  const candidateDoc = parseJsonBytes(candidateSourceBytes);
  const templateToCandidate = new Map();
  const walk = (value, parentRecord = null) => {
    if (Array.isArray(value)) { for (const item of value) walk(item, parentRecord); return; }
    if (!isObject(value)) return;
    const record = typeof value.recordId === 'string' ? value : parentRecord;
    if (typeof value.templateKey === 'string' && record) {
      const list = templateToCandidate.get(value.templateKey) ?? [];
      list.push(record.recordId);
      templateToCandidate.set(value.templateKey, list);
    }
    for (const child of Object.values(value)) walk(child, record);
  };
  walk(candidateDoc);
  const rows = [];
  const seenTemplateIds = new Set();
  const treePathsByBasename = new Map();
  for (const treePath of repoTree.keys()) {
    if (!treePath.startsWith('scripts/settings/equipment/weapon_templates/') || !treePath.endsWith('.lua')) continue;
    const basename = path.posix.basename(treePath, '.lua');
    const list = treePathsByBasename.get(basename) ?? [];
    list.push(treePath);
    treePathsByBasename.set(basename, list);
  }
  const addRegistryRow = ({ value, token, identitySuffix, fieldPath, reason, groupName, templateKey = null }) => {
    const startByte = Buffer.byteLength(sourceText.slice(0, token.startIndex), 'utf8');
    const endByte = Buffer.byteLength(sourceText.slice(0, token.endIndex), 'utf8');
    const selector = { kind: 'line-range', locator: `template_groups[${token.groupIndex}].${identitySuffix}`, startByte, endByte };
    const fragment = { normalization: 'raw', sha256: sha256Hex(blob.bytes.subarray(startByte, endByte)) };
    const scope = { gameReleaseId: null, releaseScope: 'registry-snapshot', reason: 'source-code template membership is a pinned registry snapshot, not a game-build or player-availability proof' };
    const sourceEntityKey = { kind: 'registry-key', value, reason: null };
    const candidates = templateKey ? templateToCandidate.get(templateKey) ?? [] : [];
    rows.push(newMappingEntry({
      repoId: 'source-code', commit, sourcePath, blobOid: blob.row.gitBlobOid, owner: 'source', selector,
      fragment, sourceEntityKey, fieldPath, sourceGameReleaseId: null, scope,
      target: makeCandidateTarget({ sourcePath, fieldPath, reason }),
      intendedDisposition: 'migrated',
      linkDisposition: candidates.length
        ? `exact-templateKey-also-present-in-W01-representative-candidate:${candidates.join(',')}; no player-availability-or-full-build-compatibility-claim`
        : 'registry-snapshot-candidate-only; no W01 representative templateKey match or current availability claim',
    }));
  };
  for (const group of groups) {
    const groupToken = { ...group.tokens[0], groupIndex: group.index };
    const groupName = groupToken.value;
    addRegistryRow({ value: groupName, token: groupToken, identitySuffix: 'group-key', fieldPath: `weaponTemplateGroup.${groupName}`,
      reason: 'group identity is known from source registry; this does not imply a player-available weapon', groupName });
    for (let memberIndex = 1; memberIndex < group.tokens.length; memberIndex++) {
      const token = { ...group.tokens[memberIndex], groupIndex: group.index };
      const templateKey = token.value;
      if (seenTemplateIds.has(templateKey)) throw new Error(`template key appears more than once in pinned groups: ${templateKey}`);
      seenTemplateIds.add(templateKey);
      const filePaths = treePathsByBasename.get(templateKey) ?? [];
      if (filePaths.length !== 1) throw new Error(`registry template ${templateKey} resolves to ${filePaths.length} template files`);
      addRegistryRow({ value: templateKey, token, identitySuffix: `members[${memberIndex - 1}]`, fieldPath: 'weapon.templateKey',
        reason: 'template key exists in the pinned code registry; player availability and full-build compatibility remain unverified', groupName, templateKey });
    }
  }
  if (groups.length !== 57 || seenTemplateIds.size !== 203) {
    throw new Error(`pinned registry count mismatch: groups=${groups.length}, uniqueTemplateIds=${seenTemplateIds.size}`);
  }
  return { rows, groups, templateIds: [...seenTemplateIds].sort(compare), templateToCandidate };
}

function shardGroup(groupId, rows, outRoot) {
  const shards = [];
  const paths = [];
  const chunks = [];
  let current = [];
  const maxBytes = MAX_SHARD_CONTENT_BYTES;
  const header = `{\n  "entrySchemaVersion": ${JSON.stringify(ENTRY_SCHEMA_VERSION)},\n  "groupId": ${JSON.stringify(groupId)},\n  "entries": [\n`;
  const footer = '\n  ]\n}\n';
  const fixedBytes = Buffer.byteLength(header, 'utf8') + Buffer.byteLength(footer, 'utf8');
  let currentBytes = fixedBytes;
  const flush = () => {
    if (!current.length) return;
    const index = chunks.length + 1;
    const contentBytes = Buffer.from(canonicalJson({ entrySchemaVersion: ENTRY_SCHEMA_VERSION, groupId, entries: current }), 'utf8');
    if (contentBytes.length > maxBytes) throw new Error(`generated shard exceeds 8 MB cap: ${groupId}`);
    const compressedBytes = gzipSync(contentBytes, { level: 9, mtime: 0 });
    const shardBytes = Buffer.from(canonicalJson({ encoding: 'gzip-base64', data: compressedBytes.toString('base64') }), 'ascii');
    chunks.push(shardBytes);
    const relativePath = `extension/${groupId}-${String(index).padStart(4, '0')}.json`;
    paths.push(relativePath);
    shards.push({ path: relativePath, groupId, entryCount: current.length, encoding: 'gzip-base64',
      containerBytes: shardBytes.length, containerSha256: sha256Hex(shardBytes),
      compressedBytes: compressedBytes.length, compressedSha256: sha256Hex(compressedBytes),
      contentBytes: contentBytes.length, contentSha256: sha256Hex(contentBytes) });
    current = [];
    currentBytes = fixedBytes;
  };
  for (const row of rows) {
    const rowText = JSON.stringify(row, null, 2).split('\n').map(line => `    ${line}`).join('\n');
    const rowBytes = Buffer.byteLength(rowText, 'utf8');
    if (currentBytes + (current.length ? 2 : 0) + rowBytes > maxBytes && current.length) flush();
    if (currentBytes + (current.length ? 2 : 0) + rowBytes > maxBytes) throw new Error(`single mapping entry exceeds shard cap: ${groupId}`);
    current.push(row);
    currentBytes += (current.length > 1 ? 2 : 0) + rowBytes;
  }
  flush();
  return { descriptors: shards, paths, chunks, group: { entryCount: rows.length, shardPaths: paths } };
}

function summarizeEntries(groups) {
  const allRows = Object.values(groups).flat();
  const countBy = (selector) => Object.fromEntries([...new Set(allRows.map(selector))].sort(compare).map(key => [key, allRows.filter(row => selector(row) === key).length]));
  const sourcePathEntryCounts = new Map();
  const sourceArtifactEntries = new Map();
  for (const row of allRows) {
    if (typeof row?.source?.repoId !== 'string' || typeof row?.source?.path !== 'string') continue;
    const key = `${row.source.repoId}/${row.source.path}`;
    sourcePathEntryCounts.set(key, (sourcePathEntryCounts.get(key) ?? 0) + 1);
    if (typeof row.source.commit === 'string' && typeof row.source.gitBlobOid === 'string') {
      const artifactKey = JSON.stringify([row.source.repoId, row.source.commit, row.source.path]);
      const artifact = sourceArtifactEntries.get(artifactKey) ?? {
        repoId: row.source.repoId, commit: row.source.commit, path: row.source.path,
        gitBlobOid: row.source.gitBlobOid, entryCount: 0,
      };
      artifact.entryCount++;
      sourceArtifactEntries.set(artifactKey, artifact);
    }
  }
  return {
    totalEntries: allRows.length,
    byOwner: countBy(row => row.owner),
    byTargetStatus: countBy(row => row.target.status),
    byReleaseScope: countBy(row => row.scope.releaseScope),
    sourcePathEntryCounts: Object.fromEntries([...sourcePathEntryCounts].sort(([a], [b]) => compare(a, b))),
    sourceArtifactEntries: [...sourceArtifactEntries.values()].sort((a, b) => compare(
      JSON.stringify([a.repoId, a.commit, a.path]), JSON.stringify([b.repoId, b.commit, b.path]))),
    groups: Object.fromEntries(Object.entries(groups).sort(([a], [b]) => compare(a, b)).map(([groupId, rows]) => [groupId, { entryCount: rows.length }])),
  };
}

export function summarizeCurrentRepresentativeCandidate(document, artifact) {
  if (!isObject(document) || !Array.isArray(document.records)) throw new TypeError('W01 representative candidate must contain a records array');
  const kindCounts = new Map();
  const valueCounts = { known: 0, unknown: 0, knownZero: 0 };
  const unknownFields = [];
  const knownZeroFields = [];
  const notImported = [];
  const partialRecordIndexes = new Set();
  const recordIds = [];
  const missingRecordIndices = [];
  const recordKinds = [];
  const isDecimalZero = value => typeof value === 'string' && /^[-+]?0+(?:\.0*)?(?:[eE][+-]?\d+)?$/u.test(value);
  const walk = (value, pointer, recordIndex) => {
    if (Array.isArray(value)) {
      value.forEach((child, index) => walk(child, `${pointer}/${index}`, recordIndex));
      return;
    }
    if (!isObject(value)) return;
    if (value.status === 'known') {
      valueCounts.known++;
      if (isDecimalZero(value.decimal)) {
        valueCounts.knownZero++;
        knownZeroFields.push({ fieldPath: pointer, decimal: value.decimal, unit: value.unit ?? null });
      }
    } else if (value.status === 'unknown') {
      valueCounts.unknown++;
      unknownFields.push({ fieldPath: pointer, reasonCode: value.reasonCode ?? null });
    }
    if (value.status === 'partial' && pointer.endsWith('/dataCoverage')) {
      partialRecordIndexes.add(recordIndex);
      for (const missing of value.missing ?? []) {
        if (missing?.reasonCode === 'NOT_IMPORTED') {
          notImported.push({ recordIndex, recordId: document.records[recordIndex]?.recordId ?? null,
            field: missing.field ?? null, reasonCode: missing.reasonCode });
        }
      }
    }
    for (const [key, child] of Object.entries(value)) walk(child, `${pointer}/${jsonPointerEscape(key)}`, recordIndex);
  };
  document.records.forEach((record, recordIndex) => {
    if (typeof record?.recordId === 'string' && record.recordId) recordIds.push(record.recordId);
    else missingRecordIndices.push(recordIndex);
    if (typeof record?.kind === 'string' && record.kind) {
      recordKinds.push(record.kind);
      kindCounts.set(record.kind, (kindCounts.get(record.kind) ?? 0) + 1);
    }
    walk(record, `/records/${recordIndex}`, recordIndex);
  });
  const recordIdCounts = new Map();
  for (const recordId of recordIds) recordIdCounts.set(recordId, (recordIdCounts.get(recordId) ?? 0) + 1);
  const duplicateRecordIds = [...recordIdCounts].filter(([, count]) => count > 1).map(([recordId]) => recordId).sort(compare);
  unknownFields.sort((a, b) => compare(a.fieldPath, b.fieldPath));
  knownZeroFields.sort((a, b) => compare(a.fieldPath, b.fieldPath));
  notImported.sort((a, b) => a.recordIndex - b.recordIndex || compare(a.field ?? '', b.field ?? ''));
  return {
    schemaVersion: 'w03.current-representative-coverage.v1',
    candidate: {
      repoId: artifact.repoId, commit: artifact.commit, path: artifact.path,
      gitBlobOid: artifact.gitBlobOid, byteLength: artifact.byteLength, rawSha256: artifact.rawSha256,
      gameReleaseId: document.gameReleaseId ?? null, gameVersion: document.gameVersion ?? null,
    },
    recordIdentity: {
      recordCount: document.records.length, recordIdPresent: recordIds.length,
      uniqueRecordIdCount: recordIdCounts.size, missingRecordIndices, duplicateRecordIds,
      kindCounts: Object.fromEntries([...kindCounts].sort(([a], [b]) => compare(a, b))),
    },
    valueCoverage: {
      knownCount: valueCounts.known, knownZeroCount: valueCounts.knownZero, unknownCount: valueCounts.unknown,
      knownZeroFields, unknownFields, partialRecordCount: partialRecordIndexes.size, notImportedCount: notImported.length, notImported,
    },
    requiredFields: {
      recordId: { present: recordIds.length, missing: missingRecordIndices.length },
      kind: { present: recordKinds.length, missing: document.records.length - recordKinds.length },
      semanticRequiredFields: 'not-revalidated-in-W03; the fixed Source v2 contract is referenced, but this inventory does not assert full candidate completeness',
    },
    scope: 'representative W01 candidate only; not full current-game catalog coverage',
  };
}

export function validateCurrentRepresentativeCoverage(summary, manifest) {
  const issues = [];
  const fail = (code, message) => issues.push(issue(code, message, '/currentRepresentativeCoverage'));
  if (!isObject(summary) || summary.schemaVersion !== 'w03.current-representative-coverage.v1') {
    fail('representative-coverage-shape', 'current representative coverage summary is missing or has an unsupported schema');
    return issues;
  }
  const artifact = manifest.inputArtifacts?.find(item => item.repoId === 'source'
    && item.commit === FIXED_PINS.sourceData.commit && item.path === W01_REPRESENTATIVE_PATH);
  const candidate = summary.candidate;
  if (!artifact || !isObject(candidate) || candidate.repoId !== 'source' || candidate.commit !== FIXED_PINS.sourceData.commit
    || candidate.path !== W01_REPRESENTATIVE_PATH || candidate.gitBlobOid !== W01_REPRESENTATIVE_BLOB
    || candidate.byteLength !== W01_REPRESENTATIVE_BYTES || candidate.rawSha256 !== W01_REPRESENTATIVE_SHA256
    || candidate.gameReleaseId !== W01_REPRESENTATIVE_GAME_RELEASE_ID || candidate.gameVersion !== W01_REPRESENTATIVE_GAME_VERSION
    || artifact.gitBlobOid !== W01_REPRESENTATIVE_BLOB || artifact.byteLength !== W01_REPRESENTATIVE_BYTES
    || artifact.rawSha256 !== W01_REPRESENTATIVE_SHA256) {
    fail('representative-coverage-source', 'representative summary is not bound to the fixed 125-record Source 1.13.2 candidate artifact');
  }
  const identity = summary.recordIdentity;
  const expectedKinds = JSON.stringify(W01_REPRESENTATIVE_KIND_COUNTS);
  if (!isObject(identity) || identity.recordCount !== 125 || identity.recordIdPresent !== 125
    || identity.uniqueRecordIdCount !== 125 || identity.missingRecordIndices?.length !== 0
    || identity.duplicateRecordIds?.length !== 0 || JSON.stringify(identity.kindCounts) !== expectedKinds) {
    fail('representative-coverage-identity', 'record identity or kind coverage differs from the fixed representative candidate');
  }
  const values = summary.valueCoverage;
  if (!isObject(values) || values.knownCount !== 244 || values.knownZeroCount !== 4 || values.unknownCount !== 7
    || values.partialRecordCount !== 2 || values.notImportedCount !== 2
    || JSON.stringify(values.knownZeroFields?.map(item => item.fieldPath)) !== JSON.stringify(W01_REPRESENTATIVE_KNOWN_ZERO_FIELDS)
    || values.knownZeroFields?.some(item => item.decimal !== '0.00' || item.unit !== 'percent')
    || JSON.stringify(values.unknownFields?.map(item => item.fieldPath)) !== JSON.stringify(W01_REPRESENTATIVE_UNKNOWN_FIELDS)
    || values.unknownFields?.some(item => item.reasonCode !== 'NOT_VERIFIED')
    || JSON.stringify(values.notImported) !== JSON.stringify(W01_REPRESENTATIVE_NOT_IMPORTED)) {
    fail('representative-coverage-values', 'known, known-zero, unknown, partial, or NOT_IMPORTED counts/locations differ from the fixed candidate');
  }
  if (summary.requiredFields?.recordId?.present !== 125 || summary.requiredFields?.recordId?.missing !== 0
    || summary.requiredFields?.kind?.present !== 125 || summary.requiredFields?.kind?.missing !== 0
    || summary.requiredFields?.semanticRequiredFields !== 'not-revalidated-in-W03; the fixed Source v2 contract is referenced, but this inventory does not assert full candidate completeness'
    || summary.scope !== 'representative W01 candidate only; not full current-game catalog coverage') {
    fail('representative-coverage-required-fields', 'required-field and scope limitations must stay explicit');
  }
  return issues;
}

function jsonArtifact({ repoId, commit, tree, sourcePath, owner = null, synthetic = false, forcedOwner = null }) {
  const { row, bytes } = readGitBlob(tree.repoRoot, tree.map, commit, sourcePath);
  const rows = collectJsonMappingEntries({ repoId, commit, sourcePath, blobOid: row.gitBlobOid, bytes, synthetic, forcedOwner });
  return { rows, artifact: { repoId, commit, path: sourcePath, gitBlobOid: row.gitBlobOid, byteLength: row.bytes, rawSha256: sha256Hex(bytes), ...(owner ? { owner } : {}) } };
}

function appendRows(groups, groupId, rows) {
  groups[groupId] ??= [];
  const destination = groups[groupId];
  for (let index = 0; index < rows.length; index++) destination.push(rows[index]);
}

async function generateLedger(args) {
  const requiredArgs = ['web-root', 'source-root', 'extension-root', 'extension-formal-root', 'source-code-root', 'out-root'];
  if (requiredArgs.some(key => typeof args[key] !== 'string' || args[key].trim() === '')) {
    throw new Error('generate requires --web-root, --source-root, --extension-root, --extension-formal-root, --source-code-root, and --out-root');
  }
  const webRoot = path.resolve(args['web-root'] ?? '');
  const sourceRoot = path.resolve(args['source-root'] ?? '');
  const extensionRoot = path.resolve(args['extension-root'] ?? '');
  const extensionFormalRoot = path.resolve(args['extension-formal-root'] ?? '');
  const sourceCodeRoot = path.resolve(args['source-code-root'] ?? '');
  const outRoot = path.resolve(args['out-root'] ?? '');
  if (![webRoot, sourceRoot, extensionRoot, extensionFormalRoot, sourceCodeRoot, outRoot].every(Boolean) || outRoot !== W03_DOC_ROOT) {
    throw new Error(`--generate requires five fixed repo roots and --out-root ${W03_DOC_ROOT}`);
  }
  const verifiedMods = await verifyModsLedger(outRoot);
  ensureHead(webRoot, FIXED_PINS.web.commit, 'Web');
  ensureHead(sourceRoot, FIXED_PINS.source.commit, 'Source');
  ensureHead(extensionRoot, FIXED_PINS.extension.commit, 'Extension');
  ensureHead(extensionFormalRoot, FIXED_PINS.extensionFormal.commit, 'Extension W02 formal contract');
  ensureHead(sourceCodeRoot, FIXED_PINS.sourceCode.commit, 'Source-Code');

  const webTree = gitTree(webRoot, FIXED_PINS.web.commit);
  const sourceCurrentTree = gitTree(sourceRoot, FIXED_PINS.source.commit);
  const sourceDataTree = gitTree(sourceRoot, FIXED_PINS.sourceData.commit);
  const sourceAuditTree = gitTree(sourceRoot, FIXED_PINS.sourceAudit.commit);
  const extensionReleaseTree = gitTree(extensionRoot, FIXED_PINS.extension.commit);
  const extensionInputTree = gitTree(extensionRoot, FIXED_PINS.extensionInputs.commit);
  const extensionFormalTree = gitTree(extensionFormalRoot, FIXED_PINS.extensionFormal.commit);
  const codeTree = gitTree(sourceCodeRoot, FIXED_PINS.sourceCode.commit);
  const trees = {
    web: { repoRoot: webRoot, map: webTree },
    sourceCurrent: { repoRoot: sourceRoot, map: sourceCurrentTree },
    sourceData: { repoRoot: sourceRoot, map: sourceDataTree },
    sourceAudit: { repoRoot: sourceRoot, map: sourceAuditTree },
    extensionRelease: { repoRoot: extensionRoot, map: extensionReleaseTree },
    extensionInput: { repoRoot: extensionRoot, map: extensionInputTree },
    extensionFormal: { repoRoot: extensionFormalRoot, map: extensionFormalTree },
    sourceCode: { repoRoot: sourceCodeRoot, map: codeTree },
  };

  const groups = {};
  const artifacts = [];
  const addJson = (groupId, repoId, commit, treeRef, sourcePath, options = {}) => {
    const item = jsonArtifact({ repoId, commit, tree: treeRef, sourcePath, ...options });
    appendRows(groups, groupId, item.rows);
    artifacts.push(item.artifact);
    return item;
  };
  const addText = ({ groupId, repoId, commit, treeRef, sourcePath, owner }) => {
    const { row, bytes } = readGitBlob(treeRef.repoRoot, treeRef.map, commit, sourcePath);
    const entries = pointerRowsForMarkdown({ repoId, commit, sourcePath, blobOid: row.gitBlobOid, bytes, owner });
    appendRows(groups, groupId, entries);
    artifacts.push({ repoId, commit, path: sourcePath, gitBlobOid: row.gitBlobOid, byteLength: row.bytes, rawSha256: sha256Hex(bytes), owner, selectorGranularity: 'every exact UTF-8 line including newline bytes' });
  };
  const pinnedArtifactRef = ({ repoId, commit, treeRef, sourcePath, owner, role }) => {
    const file = readGitBlob(treeRef.repoRoot, treeRef.map, commit, sourcePath);
    return { repoId, commit, path: sourcePath, gitBlobOid: file.row.gitBlobOid, byteLength: file.row.bytes,
      rawSha256: sha256Hex(file.bytes), owner, role };
  };
  const lockedFilesFor = ({ owner, repoId, commit, treeRef, lockFiles }) => lockFiles.map(item => {
    const reference = pinnedArtifactRef({ repoId, commit, treeRef, sourcePath: item.path, owner,
      role: 'W02 owner-locked contract input' });
    if (reference.byteLength !== item.sizeBytes || reference.rawSha256 !== item.sha256) {
      throw new Error(`W02 ${owner} owner-lock file mismatch: ${item.path}`);
    }
    return reference;
  });
  const extensionOwnerLock = pinnedArtifactRef({ repoId: 'extension', commit: FIXED_PINS.extensionFormal.commit,
    treeRef: trees.extensionFormal, sourcePath: 'content/contracts/w02/owner-snapshot.lock.json', owner: 'extension',
    role: 'W02 immutable owner snapshot lock' });
  if (extensionOwnerLock.rawSha256 !== EXTENSION_SNAPSHOT_LOCK_SHA256) throw new Error('fixed Extension W02 owner snapshot lock SHA-256 mismatch');
  const extensionOwnerLockDoc = parseJsonBytes(readGitBlob(extensionFormalRoot, extensionFormalTree,
    FIXED_PINS.extensionFormal.commit, extensionOwnerLock.path).bytes);
  const sourceOwner = extensionOwnerLockDoc.owners?.source;
  const webOwner = extensionOwnerLockDoc.owners?.web;
  if (sourceOwner?.commit !== FIXED_PINS.source.commit || webOwner?.commit !== FIXED_PINS.web.commit
    || !Array.isArray(sourceOwner.files) || sourceOwner.files.length !== 3
    || !Array.isArray(webOwner.files) || webOwner.files.length !== 21) {
    throw new Error('fixed Extension owner lock does not match the pinned Source/Web contract owners');
  }
  const sourceFormalReferences = lockedFilesFor({ owner: 'source', repoId: 'source', commit: FIXED_PINS.source.commit,
    treeRef: trees.sourceCurrent, lockFiles: sourceOwner.files });
  const webFormalReferences = lockedFilesFor({ owner: 'web', repoId: 'web', commit: FIXED_PINS.web.commit,
    treeRef: trees.web, lockFiles: webOwner.files });
  const webAuthoringContractPaths = [
    'content/contracts/web-authoring.lock.json',
    'content/fixtures/v2/web-authoring/official-inputs.json',
    'content/fixtures/v2/web-authoring/representative.json',
    'content/schema/v2/shared-release.schema.json',
    'content/schema/v2/web-authoring.schema.json',
    'scripts/content/contract-authoring.mjs',
    'scripts/content/contract-release.mjs',
  ];
  const webFormalPaths = new Set(webFormalReferences.map(reference => reference.path));
  if (webAuthoringContractPaths.some(sourcePath => !webFormalPaths.has(sourcePath))) {
    throw new Error('Web W02 owner lock is missing an authoring, official-input, fixture, or release-contract file');
  }
  const webAuthoringReferences = webFormalReferences.filter(reference => webAuthoringContractPaths.includes(reference.path));
  const webAuthoringLockDoc = parseJsonBytes(readGitBlob(webRoot, webTree, FIXED_PINS.web.commit,
    'content/contracts/web-authoring.lock.json').bytes);
  const officialInputsRef = webAuthoringReferences.find(reference => reference.path === 'content/fixtures/v2/web-authoring/official-inputs.json');
  if (webAuthoringLockDoc.officialInputs?.path !== officialInputsRef.path
    || webAuthoringLockDoc.officialInputs?.sha256 !== officialInputsRef.rawSha256) {
    throw new Error('Web authoring lock does not bind the fixed official-input fixture bytes');
  }
  const extensionDevCapability = pinnedArtifactRef({ repoId: 'extension', commit: FIXED_PINS.extensionFormal.commit,
    treeRef: trees.extensionFormal, sourcePath: 'content/contracts/w02/dev-capability.json', owner: 'extension',
    role: 'W02 C2 capability lock' });
  const extensionC2Tool = pinnedArtifactRef({ repoId: 'extension', commit: FIXED_PINS.extensionFormal.commit,
    treeRef: trees.extensionFormal, sourcePath: 'scripts/w02/contract-conformance.mjs', owner: 'extension',
    role: 'W02 C2 conformance tool' });
  if (extensionDevCapability.rawSha256 !== EXTENSION_DEV_CAPABILITY_SHA256
    || extensionC2Tool.rawSha256 !== EXTENSION_C2_TOOL_SHA256) {
    throw new Error('fixed Extension W02 C2 capability or conformance tool hash mismatch');
  }
  const extensionDevCapabilityDoc = parseJsonBytes(readGitBlob(extensionFormalRoot, extensionFormalTree,
    FIXED_PINS.extensionFormal.commit, extensionDevCapability.path).bytes);
  if (extensionDevCapabilityDoc.contractVersion !== '1.0.0'
    || extensionDevCapabilityDoc.snapshotLockSha256 !== EXTENSION_SNAPSHOT_LOCK_SHA256
    || extensionDevCapabilityDoc.runtimeIntegration !== false || extensionDevCapabilityDoc.publicationEligible !== false) {
    throw new Error('fixed Extension W02 C2 capability lock changed its pinned non-runtime contract state');
  }
  const formalContractReferences = {
    source: { repoId: 'source', commit: FIXED_PINS.source.commit, ownerLockSource: 'Extension W02 owner snapshot lock', files: sourceFormalReferences },
    web: { repoId: 'web', commit: FIXED_PINS.web.commit, ownerLockSource: 'Extension W02 owner snapshot lock',
      files: webFormalReferences, authoringAndReleaseContractFiles: webAuthoringReferences },
    extensionFormal: { repoId: 'extension', commit: FIXED_PINS.extensionFormal.commit, scope: 'formal W02 owner/C2 contracts',
      ownerSnapshotLock: extensionOwnerLock, snapshotLockSha256: EXTENSION_SNAPSHOT_LOCK_SHA256,
      capabilityLock: extensionDevCapability, conformanceTool: extensionC2Tool,
      c2ReceiptEvidence: { path: '.tmp/w02-20261018/extension-final-conformance.json', sha256: EXTENSION_C2_RECEIPT_SHA256,
        contractVersion: extensionDevCapabilityDoc.contractVersion, packageVersion: extensionDevCapabilityDoc.packageVersion,
        snapshotLockSha256: extensionDevCapabilityDoc.snapshotLockSha256, runtimeIntegration: false, publicationEligible: false,
        contentCopied: false } },
    extensionLegacy: { repoId: 'extension', commit: FIXED_PINS.extension.commit,
      scope: 'historical release inputs and runtime snapshot only; not the formal W02 contract owner pin' },
  };

  // Web's published package is a historical 1.13.1 package; W01 inputs remain their own preview scope.
  const published = addJson('web-published', 'web', FIXED_PINS.web.commit, trees.web, 'content/published/content.json');
  for (const sourcePath of [
    'content/w01/web-authoring.json', 'content/w01/release.json', 'content/w01/composition-receipt.json',
    'content/w01/rollback.json', 'content/w01/source/technical.json', 'content/w01/source/source-manifest.json',
    'content/w01/source/game-changes.json',
  ]) addJson('web-w01-inputs', 'web', FIXED_PINS.web.commit, trees.web, sourcePath);
  const webSourceLockPaths = ['source.lock.json', 'content/source.lock.json'].filter(sourcePath => webTree.has(sourcePath));
  if (webSourceLockPaths.length === 0) throw new Error('fixed Web tree has no source lock file');
  for (const sourcePath of webSourceLockPaths) addJson('web-source-lock', 'web', FIXED_PINS.web.commit, trees.web, sourcePath);
  for (const sourcePath of [
    'content/contracts/source-v2-snapshot/content/schema/v2/source-contract.schema.json',
    'content/contracts/source-v2-snapshot/content/fixtures/v2/representative-source.json',
    'content/contracts/source-v2-snapshot/scripts/content/contract-validator.mjs',
  ]) {
    const file = readGitBlob(webRoot, webTree, FIXED_PINS.web.commit, sourcePath);
    groups['web-source-cache'] ??= [];
    groups['web-source-cache'].push(wholeFileEntry({ repoId: 'web', commit: FIXED_PINS.web.commit, sourcePath,
      blobOid: file.row.gitBlobOid, owner: 'source', scope: { gameReleaseId: null, releaseScope: 'release-unspecified', reason: 'immutable Source-owned cache only; the Web copy does not create a new technical owner or game release' },
      targetKind: sourcePath.endsWith('.mjs') ? 'source-document' : 'source-record', targetStatus: 'not-generated',
      intendedDisposition: 'kept', linkDisposition: 'immutable Source-owned cache; verify exact bytes against fixed Source owner inputs' }));
    artifacts.push({ repoId: 'web', commit: FIXED_PINS.web.commit, path: sourcePath,
      gitBlobOid: file.row.gitBlobOid, byteLength: file.row.bytes, rawSha256: sha256Hex(file.bytes), owner: 'source',
      disposition: 'immutable-cache-not-second-owner' });
  }

  // Formal v2 Source contract and 32-row synthetic representative fixture are pinned independently from W01 candidate data.
  addJson('source-formal-contract', 'source', FIXED_PINS.source.commit, trees.sourceCurrent, 'content/schema/v2/source-contract.schema.json', { forcedOwner: 'source' });
  const syntheticFixture = addJson('source-formal-contract', 'source', FIXED_PINS.source.commit, trees.sourceCurrent, 'content/fixtures/v2/representative-source.json', { synthetic: true, forcedOwner: 'source' });
  for (const sourcePath of [
    'content/authoring/w01-preview.json', 'content/authoring/w01-real-claim-candidate.json',
    'content/authoring/w01-real-representative-candidate.json',
  ]) addJson('source-w01-candidates', 'source', FIXED_PINS.sourceData.commit, trees.sourceData, sourcePath, { forcedOwner: 'source' });
  addJson('source-w01-review', 'source', FIXED_PINS.sourceAudit.commit, trees.sourceAudit, 'content/reviews/w01-minimal-human-approval-20261017.json', { forcedOwner: 'source' });
  addText({ groupId: 'source-w01-review', repoId: 'source', commit: FIXED_PINS.sourceData.commit, treeRef: trees.sourceData, sourcePath: 'docs/w01-real-claim-review.md', owner: 'source' });
  for (const sourcePath of [
    'content/legacy/mods/241ad76/psyker/README.md',
    'content/legacy/mods/241ad76/psyker/en/psyker_brain_burst_improved.md',
    'content/legacy/mods/241ad76/psyker/psyker_brain_burst_improved.md',
  ]) addText({ groupId: 'source-legacy-psyker', repoId: 'source', commit: FIXED_PINS.sourceData.commit, treeRef: trees.sourceData, sourcePath, owner: 'source' });
  addJson('source-legacy-psyker', 'source', FIXED_PINS.sourceData.commit, trees.sourceData, 'content/legacy/mods/241ad76/psyker/provenance.json');

  // Verify the Extension release manifest against exact Git blobs. Two declared inputs are present at b18, not e24.
  const releaseManifestArtifact = readGitBlob(extensionRoot, extensionReleaseTree, FIXED_PINS.extension.commit, 'data/v1/release.json');
  const extensionReleaseManifest = parseJsonBytes(releaseManifestArtifact.bytes);
  if (extensionReleaseManifest.inputCommit !== FIXED_PINS.extensionInputs.commit || extensionReleaseManifest.inputs?.length !== 26) {
    throw new Error('fixed Extension release manifest does not declare the expected 26-input e24 snapshot');
  }
  const extensionInputOverrides = [];
  const verifiedExtensionInputs = [];
  const expectedProtected = new Set([
    'docs/V1_BLESSINGS_43_CANDIDATES_REVIEW.json', 'docs/V1_BLESSINGS_43_CROSS_REVIEW.json',
    'docs/V1_NON_BLESSING_GAPS_CROSS_REVIEW.json', 'docs/V1_NON_BLESSING_GAPS_REVIEW.json',
    'docs/V1_WEBSITE_DISPLAY_INDEPENDENT_REVIEW.json',
  ]);
  for (const input of extensionReleaseManifest.inputs) {
    const e24 = readGitBlob(extensionRoot, extensionInputTree, FIXED_PINS.extensionInputs.commit, input.path);
    const e24Normalized = input.normalization === 'lf' ? normalizeLf(e24.bytes) : e24.bytes;
    const e24Sha = sha256Hex(e24Normalized);
    let selected = e24;
    let selectedCommit = FIXED_PINS.extensionInputs.commit;
    let selectedNormalized = e24Normalized;
    if (e24Sha !== input.sha256) {
      const b18 = readGitBlob(extensionRoot, extensionReleaseTree, FIXED_PINS.extension.commit, input.path);
      const b18Normalized = input.normalization === 'lf' ? normalizeLf(b18.bytes) : b18.bytes;
      const b18Sha = sha256Hex(b18Normalized);
      if (b18Sha !== input.sha256) throw new Error(`Extension input does not match declared hash at e24 or b18: ${input.path}`);
      selected = b18;
      selectedCommit = FIXED_PINS.extension.commit;
      selectedNormalized = b18Normalized;
      extensionInputOverrides.push({ path: input.path, declaredInputCommit: FIXED_PINS.extensionInputs.commit,
        exactSourceCommit: selectedCommit, e24Sha256: e24Sha, declaredSha256: input.sha256, exactBlobOid: selected.row.gitBlobOid });
    }
    if (selected.row.path.endsWith('.json')) {
      const mapped = collectJsonMappingEntries({ repoId: 'extension', commit: selectedCommit, sourcePath: input.path,
        blobOid: selected.row.gitBlobOid, bytes: selected.bytes });
      groups['extension-release-inputs'] ??= [];
      appendRows(groups, 'extension-release-inputs', mapped);
    } else {
      throw new Error(`declared Extension input is not JSON and needs a specific selector policy: ${input.path}`);
    }
    verifiedExtensionInputs.push({ path: input.path, declaredInputCommit: extensionReleaseManifest.inputCommit,
      normalization: input.normalization, expectedSha256: input.sha256,
      actualSha256: sha256Hex(selectedNormalized), exactSourceCommit: selectedCommit, gitBlobOid: selected.row.gitBlobOid,
      byteLength: selected.row.bytes });
  }
  const localStatusText = gitBytes(extensionRoot, ['status', '--porcelain=v1', '--untracked-files=all'], 'utf8').replace(/\r?\n$/u, '');
  const localStatus = localStatusText.split(/\r?\n/u).filter(Boolean);
  const localPaths = localStatus.map(line => line.slice(3).replace(/^"|"$/gu, '')).sort(compare);
  const expectedPaths = [...expectedProtected].sort(compare);
  if (localPaths.length !== expectedPaths.length || localPaths.some((value, index) => value !== expectedPaths[index])) {
    throw new Error(`Extension checkout has unexpected local changes; protected count=${expectedPaths.length}, actual count=${localPaths.length}`);
  }
  const protectedLocalOverlays = [];
  for (const sourcePath of expectedPaths) {
    const localBytes = await readFile(path.join(extensionRoot, ...sourcePath.split('/')));
    const normalized = normalizeLf(localBytes);
    const declared = extensionReleaseManifest.inputs.find(input => input.path === sourcePath);
    const lfSha = sha256Hex(normalized);
    if (!declared || lfSha !== declared.sha256) throw new Error(`protected Extension local overlay differs from its declared normalized hash: ${sourcePath}`);
    protectedLocalOverlays.push({ path: sourcePath, status: 'preserve-local-review-overlay', byteLength: localBytes.length,
      rawSha256: sha256Hex(localBytes), normalizedLfSha256: lfSha });
  }
  const extensionReleaseScope = releaseScopeFor('extension', 'data/v1/release.json', null);
  groups['extension-release-inputs'] ??= [];
  appendRows(groups, 'extension-release-inputs', collectJsonMappingEntries({ repoId: 'extension', commit: FIXED_PINS.extension.commit,
    sourcePath: 'data/v1/release.json', blobOid: releaseManifestArtifact.row.gitBlobOid, bytes: releaseManifestArtifact.bytes, forcedOwner: 'extension' }));
  artifacts.push({ repoId: 'extension', commit: FIXED_PINS.extension.commit, path: 'data/v1/release.json',
    gitBlobOid: releaseManifestArtifact.row.gitBlobOid, byteLength: releaseManifestArtifact.row.bytes, rawSha256: sha256Hex(releaseManifestArtifact.bytes) });

  // Preserve every additional data/v1 JSON file that is not one of the 26 declared inputs.
  const declaredExtensionPaths = new Set(extensionReleaseManifest.inputs.map(input => input.path));
  const additionalDataPaths = [...extensionReleaseTree.keys()].filter(sourcePath => sourcePath.startsWith('data/v1/')
    && sourcePath.endsWith('.json') && !declaredExtensionPaths.has(sourcePath) && sourcePath !== 'data/v1/release.json').sort(compare);
  for (const sourcePath of additionalDataPaths) addJson('extension-additional-data', 'extension', FIXED_PINS.extension.commit, trees.extensionRelease, sourcePath);

  // Runtime input set: native static literals are parsed without executing code; generated runtime data is retained whole.
  for (const bundlePath of extensionReleaseManifest.bundleFiles) {
    const sourcePath = `extension/${bundlePath}`;
    const file = readGitBlob(extensionRoot, extensionReleaseTree, FIXED_PINS.extension.commit, sourcePath);
    if (bundlePath === 'data.js' || bundlePath === 'provider.js') {
      const rootName = bundlePath === 'data.js' ? 'data' : 'nativeFragmentRules';
      const rows = collectJsLiteralEntries({ repoId: 'extension', commit: FIXED_PINS.extension.commit,
        sourcePath, blobOid: file.row.gitBlobOid, bytes: file.bytes, rootName });
      groups[bundlePath === 'data.js' ? 'extension-runtime-static-data' : 'extension-runtime-native-rules'] ??= [];
      appendRows(groups, bundlePath === 'data.js' ? 'extension-runtime-static-data' : 'extension-runtime-native-rules', rows);
      artifacts.push({ repoId: 'extension', commit: FIXED_PINS.extension.commit, path: sourcePath,
        gitBlobOid: file.row.gitBlobOid, byteLength: file.row.bytes, rawSha256: sha256Hex(file.bytes), selectorMode: 'safe-static-literal-parser' });
    } else if (bundlePath === 'runtime-data.js') {
      groups['extension-runtime-generated'] ??= [];
      groups['extension-runtime-generated'].push(wholeFileEntry({ repoId: 'extension', commit: FIXED_PINS.extension.commit,
        sourcePath, blobOid: file.row.gitBlobOid, owner: 'extension', scope: releaseScopeFor('extension', sourcePath, null),
        intendedDisposition: 'kept', linkDisposition: 'generated-runtime-projection-retained-whole; content depends on declared Extension input set' }));
      artifacts.push({ repoId: 'extension', commit: FIXED_PINS.extension.commit, path: sourcePath,
        gitBlobOid: file.row.gitBlobOid, byteLength: file.row.bytes, rawSha256: sha256Hex(file.bytes), selectorMode: 'generated-whole-file-projection' });
    } else if (bundlePath === 'manifest.json') {
      const mapped = collectJsonMappingEntries({ repoId: 'extension', commit: FIXED_PINS.extension.commit, sourcePath,
        blobOid: file.row.gitBlobOid, bytes: file.bytes, forcedOwner: 'extension' });
      groups['extension-runtime-config'] ??= [];
      appendRows(groups, 'extension-runtime-config', mapped);
      artifacts.push({ repoId: 'extension', commit: FIXED_PINS.extension.commit, path: sourcePath,
        gitBlobOid: file.row.gitBlobOid, byteLength: file.row.bytes, rawSha256: sha256Hex(file.bytes), selectorMode: 'json-field' });
    } else {
      groups['extension-runtime-code'] ??= [];
      groups['extension-runtime-code'].push(wholeFileEntry({ repoId: 'extension', commit: FIXED_PINS.extension.commit,
        sourcePath, blobOid: file.row.gitBlobOid, owner: 'extension', scope: releaseScopeFor('extension', sourcePath, null),
        intendedDisposition: 'kept', linkDisposition: 'runtime-code-or-asset-retained-whole; no game-data meaning inferred' }));
      artifacts.push({ repoId: 'extension', commit: FIXED_PINS.extension.commit, path: sourcePath,
        gitBlobOid: file.row.gitBlobOid, byteLength: file.row.bytes, rawSha256: sha256Hex(file.bytes), selectorMode: 'whole-file-runtime-artifact' });
    }
  }

  // Keep matcher code Extension-owned, while exposing only the directly embedded Riposte values and player-facing fragments as pending owner-specific candidates.
  const corePath = 'extension/core.js';
  const contentPath = 'extension/content.js';
  const coreBlob = readGitBlob(extensionRoot, extensionReleaseTree, FIXED_PINS.extension.commit, corePath);
  const contentBlob = readGitBlob(extensionRoot, extensionReleaseTree, FIXED_PINS.extension.commit, contentPath);
  const hardcodedBlessingRows = [
    supplementalLiteralEntry({ commit: FIXED_PINS.extension.commit, sourcePath: corePath, blobOid: coreBlob.row.gitBlobOid,
      bytes: coreBlob.bytes, literal: '10|12|14|16', owner: 'source', fieldPath: 'blessing.tierValues',
      linkDisposition: 'historical Extension matcher literal; same legacy blessing identity binds to data.js /blessing/tierValues entries; Source candidate only, review pending, no current-release inference' }),
    supplementalLiteralEntry({ commit: FIXED_PINS.extension.commit, sourcePath: corePath, blobOid: coreBlob.row.gitBlobOid,
      bytes: coreBlob.bytes, literal: '4s', owner: 'source', fieldPath: 'blessing.duration',
      linkDisposition: 'historical Extension matcher literal; same legacy blessing identity binds to data.js /blessing/duration; Source candidate only, review pending, no current-release inference' }),
    supplementalLiteralEntry({ commit: FIXED_PINS.extension.commit, sourcePath: corePath, blobOid: coreBlob.row.gitBlobOid,
      bytes: coreBlob.bytes, literal: '成功閃避後，爆擊率 +${match[1]}%，持續 4 秒。', owner: 'web', fieldPath: 'blessing.description',
      linkDisposition: 'historical Extension player-facing template; Web wording candidate only, review pending, interpolation and mechanics are not normalized or approved' }),
    supplementalLiteralEntry({ commit: FIXED_PINS.extension.commit, sourcePath: contentPath, blobOid: contentBlob.row.gitBlobOid,
      bytes: contentBlob.bytes, literal: 'Critical Chance for 4s on successful Dodge.', owner: 'web', fieldPath: 'blessing.officialDescriptionSuffix',
      linkDisposition: 'legacy UI fallback match text; Web-origin candidate only, not proof of an official source snapshot, review pending' }),
    supplementalLiteralEntry({ commit: FIXED_PINS.extension.commit, sourcePath: contentPath, blobOid: contentBlob.row.gitBlobOid,
      bytes: contentBlob.bytes, literal: '爆擊率，成功閃避後持續 4 秒。', owner: 'web', fieldPath: 'blessing.localizedDescriptionSuffix',
      linkDisposition: 'legacy player-facing Traditional Chinese fallback; Web wording candidate only, review pending' }),
  ];
  appendRows(groups, 'extension-hardcoded-content-candidates', hardcodedBlessingRows);
  const staticBlessingRows = groups['extension-runtime-static-data'].filter(row => row.source.path === 'extension/data.js'
    && row.sourceEntityKey.kind === 'legacy-id' && row.sourceEntityKey.value === 'riposte-paired-transonic-blades');
  const staticBindingPointers = ['/blessing/tierValues/0', '/blessing/tierValues/1', '/blessing/tierValues/2',
    '/blessing/tierValues/3', '/blessing/duration'];
  const staticBindingRefs = staticBindingPointers.map(pointer => {
    const row = staticBlessingRows.find(item => item.selector.locator === pointer);
    if (!row || row.owner !== 'source' || row.review.state !== 'pending') {
      throw new Error(`historical Extension blessing static binding is missing or has unexpected ownership: ${pointer}`);
    }
    return { sourcePath: row.source.path, selector: row.selector, fieldPath: row.fieldPath,
      sourceEntityKey: row.sourceEntityKey, fragment: row.fragment, owner: row.owner, reviewState: row.review.state };
  });
  const hardcodedContentReview = {
    legacyExtensionCommit: FIXED_PINS.extension.commit,
    formalW02ExtensionContractCommit: FIXED_PINS.extensionFormal.commit,
    supplementalRows: hardcodedBlessingRows.map(row => ({ sourcePath: row.source.path, selector: row.selector,
      owner: row.owner, fieldPath: row.fieldPath, sourceEntityKey: row.sourceEntityKey,
      fragment: row.fragment, reviewState: row.review.state, targetStatus: row.target.status,
      linkDisposition: row.linkDisposition })),
    sameLegacyBlessingStaticBindings: staticBindingRefs,
    otherMatcherDisposition: [
      { function: 'resolveCurioEffect', lineRange: 'L39-L44', remainsExtensionOwnedLogic: true,
        staticValues: 'data.curioEffects fields are separately inventoried; no generic matcher is converted into a Source rule' },
      { function: 'resolveWeaponPerk', lineRange: 'L48-L52', remainsExtensionOwnedLogic: true,
        staticValues: 'data.weaponPerks fields are separately inventoried; no current-game validity is inferred' },
    ],
    contentUiDisposition: { sourcePath: contentPath, lines: 'whole file (611 source lines); fallback fragments at L96 are separately inventoried', owner: 'extension',
      note: 'Overlay controls, status, labels, and local explanatory UI remain Extension-owned; only the explicit blessing fallback fragments above are Web wording candidates.' },
    limitations: ['all supplemental rows remain pending and not-generated', 'legacy b18 snapshot is not the formal 5a09 W02 Extension contract pin',
      'no matcher algorithm, tier resolution, full-build equivalence, or runtime behavior is promoted into a formal game record'],
  };

  // Code registry identities are listed as candidates only; exact template files are checked by basename, not inferred as player items.
  const representative = readGitBlob(sourceRoot, sourceDataTree, FIXED_PINS.sourceData.commit, 'content/authoring/w01-real-representative-candidate.json');
  const registry = codeRegistryRows({ repoRoot: sourceCodeRoot, repoTree: codeTree, sourcePath: 'scripts/settings/equipment/weapon_templates/weapon_templates.lua',
    commit: FIXED_PINS.sourceCode.commit, candidateSourceBytes: representative.bytes });
  groups['source-code-registry'] = registry.rows;
  artifacts.push({ repoId: 'source-code', commit: FIXED_PINS.sourceCode.commit,
    path: 'scripts/settings/equipment/weapon_templates/weapon_templates.lua', gitBlobOid: codeTree.get('scripts/settings/equipment/weapon_templates/weapon_templates.lua').gitBlobOid,
    byteLength: codeTree.get('scripts/settings/equipment/weapon_templates/weapon_templates.lua').bytes,
    rawSha256: sha256Hex(readGitBlob(sourceCodeRoot, codeTree, FIXED_PINS.sourceCode.commit, 'scripts/settings/equipment/weapon_templates/weapon_templates.lua').bytes),
    selectorMode: 'exact-template-group-and-member-string-literals', groupCount: registry.groups.length, uniqueTemplateCount: registry.templateIds.length });

  // Fixed published aggregate counts and synthetic/source candidate counts support coverage without promoting scope.
  const publishedDoc = parseJsonBytes(published.artifact ? readGitBlob(webRoot, webTree, FIXED_PINS.web.commit, 'content/published/content.json').bytes : Buffer.alloc(0));
  const w01Representative = parseJsonBytes(readGitBlob(sourceRoot, sourceDataTree, FIXED_PINS.sourceData.commit, 'content/authoring/w01-real-representative-candidate.json').bytes);
  const w01Preview = parseJsonBytes(readGitBlob(sourceRoot, sourceDataTree, FIXED_PINS.sourceData.commit, 'content/authoring/w01-preview.json').bytes);
  const sourceFixtureObject = parseJsonBytes(readGitBlob(sourceRoot, sourceCurrentTree, FIXED_PINS.source.commit, 'content/fixtures/v2/representative-source.json').bytes);
  const publishedCounts = Object.fromEntries(['assets', 'bindings', 'blessings', 'marks', 'routes', 'skills', 'sources', 'variants', 'weapons', 'talent_trees']
    .map(key => [key, Array.isArray(publishedDoc[key]) ? publishedDoc[key].length : 0]));
  const uniqueSkillIds = new Set((publishedDoc.skills ?? []).map(row => row.skill_id).filter(value => typeof value === 'string')).size;
  const candidateWeaponTemplateKeys = [];
  for (const record of w01Representative.records ?? []) {
    const key = record?.payload?.templateKey;
    if (typeof key === 'string') candidateWeaponTemplateKeys.push({ recordId: record.recordId, templateKey: key });
  }
  const registryCrossCheck = candidateWeaponTemplateKeys.map(candidate => ({ ...candidate, registryMatch: registry.templateIds.includes(candidate.templateKey) }));

  const ledger = { schemaVersion: 1, entrySchemaVersion: ENTRY_SCHEMA_VERSION, groups: {}, shards: [] };
  const outputs = [];
  for (const [groupId, rows] of Object.entries(groups).sort(([a], [b]) => compare(a, b))) {
    const result = shardGroup(groupId, rows, outRoot);
    ledger.groups[groupId] = result.group;
    ledger.shards.push(...result.descriptors);
    for (let index = 0; index < result.paths.length; index++) outputs.push({ path: result.paths[index], bytes: result.chunks[index] });
  }
  const entrySummary = summarizeEntries(groups);
  const localInputProvenance = {
    extensionManifestCommit: FIXED_PINS.extension.commit,
    declaredInputCommit: extensionReleaseManifest.inputCommit,
    verifiedInputCount: verifiedExtensionInputs.length,
    declaredInputSha256Matches: verifiedExtensionInputs.length,
    exactSourceCommitOverrides: extensionInputOverrides,
    verifiedInputs: verifiedExtensionInputs,
    protectedLocalOverlays,
  };
  const sourceCandidateCounts = {
    realRepresentativeCandidateRecords: w01Representative.records?.length ?? 0,
    previewFixtureRecords: w01Preview.records?.length ?? 0,
    formalSyntheticFixtureRecords: sourceFixtureObject.records?.length ?? 0,
    allCandidateRowsRemainPlanned: true,
    approvalCarryForward: 'not-assumed',
  };
  const representativeArtifact = artifacts.find(item => item.repoId === 'source'
    && item.commit === FIXED_PINS.sourceData.commit && item.path === W01_REPRESENTATIVE_PATH);
  if (!representativeArtifact) throw new Error('fixed W01 representative candidate artifact reference is missing');
  const currentRepresentativeCoverage = summarizeCurrentRepresentativeCandidate(w01Representative, representativeArtifact);
  const scopeManifest = {
    schemaVersion: 'w03.scope-manifest.v1',
    entrySchemaVersion: ENTRY_SCHEMA_VERSION,
    generatedFrom: {
      web: FIXED_PINS.web, source: FIXED_PINS.source, sourceData: FIXED_PINS.sourceData,
      sourceAudit: FIXED_PINS.sourceAudit, extension: FIXED_PINS.extension, extensionInputs: FIXED_PINS.extensionInputs,
      extensionFormal: FIXED_PINS.extensionFormal,
      sourceCode: FIXED_PINS.sourceCode, mods: FIXED_PINS.mods, private: FIXED_PINS.private,
    },
    formalContractReferences,
    legacyHardcodedContentReview: hardcodedContentReview,
    inputArtifacts: artifacts.sort((a, b) => compare(`${a.repoId}/${a.path}`, `${b.repoId}/${b.path}`)),
    extensionInputProvenance: localInputProvenance,
    privateSafeSummary: { sourceCommit: FIXED_PINS.private.commit, ...verifiedMods.index.privateToolReceipt,
      status: 'protected-private-tool-summary-only; no private paths or per-file digests copied' },
    modsLedger: { status: 'separate-owner-index', path: 'mods/mapping-ledger.json', sourceCommit: FIXED_PINS.mods.commit,
      indexSha256: verifiedMods.indexSha256, entryCount: verifiedMods.index.entryCount,
      sourcePathCount: verifiedMods.index.source.pathCount, shardCount: verifiedMods.index.shards.length,
      localModsDeltaReceipt: verifiedMods.index.localModsDeltaReceipt },
    webSnapshot: { packageKind: 'published', gameVersion: publishedDoc.game_version, scope: 'historical-only', counts: publishedCounts,
      uniqueSkillIds, talentTreeGraphLayout: 'retained historical Web artifact; formal v2 Source contract has no graph/layout target fields' },
    sourceCandidates: sourceCandidateCounts,
    codeRegistry: { path: 'scripts/settings/equipment/weapon_templates/weapon_templates.lua', commit: FIXED_PINS.sourceCode.commit,
      declaredGroups: registry.groups.length, nonemptyGroups: registry.groups.filter(group => group.tokens.length > 1).length,
      emptyGroups: registry.groups.filter(group => group.tokens.length === 1).map(group => group.tokens[0].value),
      uniqueTemplateIds: registry.templateIds.length, templateFilesFound: registry.templateIds.length,
      currentCandidateTemplateKeyCrossCheck: registryCrossCheck,
      limits: ['registry membership is not player availability', 'code snapshot row does not prove all action/profile resolution', 'no full-game patch-label equivalence is inferred'] },
    historicalAndNotImportedRules: [
      '1.13.1 published content and Extension legacy snapshot remain historical; they are not promoted to current release records.',
      'The 32-record formal fixture is synthetic; W01 real representative candidate is not global current coverage.',
      'NOT_IMPORTED and absent profile coverage remain explicit gaps, not typed unknowns or known absence.',
      "All rows are planned and review carry-forward is not assumed; W01's two approved claims do not approve other rows.",
      'Any exact historical graph/layout field without a formal target remains retained artifact coverage, not a claimed structured migration.',
    ],
  };
  const coverage = { schemaVersion: 'w03.coverage.v1', ...entrySummary,
    sourceCandidateCounts, publishedCounts, uniqueSkillIds, extensionInputVerification: localInputProvenance,
    currentRepresentativeCoverage, formalContractReferences, legacyHardcodedContentReview: hardcodedContentReview,
    additionalExtensionDataCount: additionalDataPaths.length,
    codeRegistry: scopeManifest.codeRegistry,
    owners: ['source', 'web', 'extension', 'mods', 'private'],
    notClaimed: ['current-game completeness', 'build-wide code equivalence', 'mechanics re-analysis', 'approval inheritance', 'actual migration or restore'] };
  const readme = `# W03 extension ledger\n\nThis is a deterministic, read-only scope and mapping inventory. Every row remains \`planned\` with \`actualOutcome.status=not-started\`; prior review states are not inherited. It does not migrate content, approve claims, or establish global current-game completeness.\n\n## Ownership and version scope\n\n- Web published content is pinned as historical game version ${publishedDoc.game_version}; it is not a current package count. Talent-tree graph/layout stays a retained historical artifact because the formal Source v2 contract has no graph/layout target shape.\n- Source v2 schema and representative fixture are pinned to ${FIXED_PINS.source.commit}; the fixture is synthetic. W01 candidate records and the narrow two-claim audit remain separately pinned; the approval is not carried to any other row.\n- The coverage report separately counts known values, known-zero values, unknown values, and NOT_IMPORTED fields for the fixed 125-record W01 representative candidate. Its two NOT_IMPORTED action/profile-resolution gaps are not converted into unknown values; this is representative scope, not a full-game completeness claim.\n- Extension's 26 declared inputs are verified against the fixed release manifest. Its global inputCommit is ${extensionReleaseManifest.inputCommit}; the two documented path-level source-commit exceptions are preserved in scope-manifest.json. Five local review overlays are represented only by path, status, size, and hashes; their bodies are not copied.\n- Source-code registry has ${registry.groups.length} groups (${registry.groups.filter(group => group.tokens.length === 1).length} empty) and ${registry.templateIds.length} unique template IDs. Registry membership does not establish player availability or full-build equivalence.\n- Private input and Mods local delta details are limited to safe aggregate metadata.\n\n## Hash domains and verification\n\n\`git-blob\` rows bind an exact whole-file Git object. \`raw\` line ranges hash exact UTF-8 bytes, including newline bytes and using byte offsets. JSON and static-JavaScript pointers use parsed-value \`JSON.stringify(value)\` UTF-8 SHA-256; this is not a raw-source-byte hash.\n\nRun \`node scripts/content/contract-w03-ledger.mjs\` to verify the checked A ledger and its frozen Mods index offline. A extension shards use deterministic gzip payloads in LF-safe JSON/base64 containers; the verifier checks both compressed and uncompressed hashes with a bounded decompression limit. Rebuild only with the fixed roots and \`--generate\`; generation fails unless repository HEADs, source blobs, and protected input state match the recorded pins.\n`;
  const readmeWithContractPins = `${readme}\n## Formal W02 owner contracts\n\nThe formal Source/Web contract references are verified from their fixed owner-locked Git objects. Extension's formal W02 owner/C2 contract pin is ${FIXED_PINS.extensionFormal.commit}; the b18 legacy snapshot and its e24 manifest inputs remain a separate historical inventory. The C2 receipt is referenced by SHA-256 in scope-manifest.json and is not treated as runtime integration or publication approval.\n`;

  await removePreviousAShards(outRoot);
  await mkdir(path.join(outRoot, 'extension'), { recursive: true });
  for (const output of outputs) await writeFile(path.join(outRoot, ...output.path.split('/')), output.bytes);
  await writeFile(path.join(outRoot, 'mapping-ledger.json'), Buffer.from(canonicalJson(ledger), 'utf8'));
  await writeFile(path.join(outRoot, 'scope-manifest.json'), Buffer.from(canonicalJson(scopeManifest), 'utf8'));
  await writeFile(path.join(outRoot, 'coverage.json'), Buffer.from(canonicalJson(coverage), 'utf8'));
  await writeFile(path.join(outRoot, 'README.md'), Buffer.from(readmeWithContractPins, 'utf8'));
  return { valid: true, ...entrySummary, shardCount: ledger.shards.length, artifactCount: artifacts.length,
    extensionInputs: verifiedExtensionInputs.length, extensionOverrides: extensionInputOverrides.length,
    localOverlays: protectedLocalOverlays.length, registryGroups: registry.groups.length, registryTemplates: registry.templateIds.length };
}

export async function verifyCheckedLedger(docRoot = W03_DOC_ROOT) {
  const manifest = parseJsonBytes(await readFile(path.join(docRoot, 'scope-manifest.json')));
  const ledger = parseJsonBytes(await readFile(path.join(docRoot, 'mapping-ledger.json')));
  const coverage = parseJsonBytes(await readFile(path.join(docRoot, 'coverage.json')));
  if (manifest.schemaVersion !== 'w03.scope-manifest.v1' || coverage.schemaVersion !== 'w03.coverage.v1') {
    throw new Error('scope manifest or coverage schema is not the expected W03 version');
  }
  const scopeIssues = validateScopeBindings(manifest);
  if (scopeIssues.length) throw new Error(`offline W03 scope verification failed: ${scopeIssues[0].code} ${scopeIssues[0].path}`);
  const mods = await verifyModsLedger(docRoot);
  if (manifest.modsLedger?.indexSha256 !== mods.indexSha256
    || manifest.modsLedger.entryCount !== mods.index.entryCount
    || manifest.modsLedger.sourcePathCount !== mods.index.source.pathCount
    || manifest.modsLedger.shardCount !== mods.index.shards.length
    || JSON.stringify(manifest.modsLedger.localModsDeltaReceipt) !== JSON.stringify(mods.index.localModsDeltaReceipt)
    || Object.entries(mods.index.privateToolReceipt).some(([key, value]) => manifest.privateSafeSummary?.[key] !== value)) {
    throw new Error('A scope manifest does not bind the verified frozen Mods ledger metadata');
  }
  const shardMap = await collectShardBytes(docRoot, ledger.shards.map(item => item.path));
  const bundle = verifyLedgerBundle(ledger, shardMap, { includeSummary: true });
  const issues = bundle.issues;
  if (issues.length) throw new Error(`offline W03 verify failed with ${issues.length} issue(s): ${issues[0].code} ${issues[0].path}`);
  const coverageIssues = validateCoverageSummary(coverage, bundle.summary);
  if (coverageIssues.length) throw new Error(`offline W03 coverage verification failed: ${coverageIssues[0].code} ${coverageIssues[0].path}`);
  const representativeIssues = validateCurrentRepresentativeCoverage(coverage.currentRepresentativeCoverage, manifest);
  if (representativeIssues.length) throw new Error(`offline W03 representative coverage failed: ${representativeIssues[0].code} ${representativeIssues[0].path}`);
  const mirrorIssues = validateCoverageManifestBindings(coverage, manifest);
  if (mirrorIssues.length) throw new Error(`offline W03 manifest/coverage verification failed: ${mirrorIssues[0].code} ${mirrorIssues[0].path}`);
  await verifyIndexedFileSet(docRoot, ledger, mods.index);
  return { valid: true, shardCount: ledger.shards.length, groupCount: Object.keys(ledger.groups).length,
    entryCount: bundle.summary.totalEntries,
    modsEntryCount: mods.index.entryCount, modsShardCount: mods.index.shards.length, manifest, coverage };
}

async function main() {
  let args;
  try { args = parseArgs(process.argv.slice(2)); }
  catch (error) { process.stderr.write(`${error.message}\n`); return 2; }
  if (args.mode === 'help') {
    process.stdout.write('W03 A ledger: no arguments or --verify validates the checked ledger offline; --generate requires fixed repository roots and --out-root.\n');
    return 0;
  }
  if (args.mode === 'verify') {
    try {
      const result = await verifyCheckedLedger();
      process.stdout.write(`${JSON.stringify({ valid: true, entries: result.entryCount, groups: result.groupCount, shards: result.shardCount,
        modsEntries: result.modsEntryCount, modsShards: result.modsShardCount })}\n`);
      return 0;
    } catch (error) { process.stderr.write(`${error.message}\n`); return 1; }
  }
  if (args.mode === 'generate') {
    try {
      const result = await generateLedger(args);
      process.stdout.write(`${JSON.stringify(result)}\n`);
      return 0;
    } catch (error) { process.stderr.write(`${error.message}\n`); return 1; }
  }
  process.stderr.write('Use no arguments, --verify, --generate, or --help.\n');
  return 2;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().then(code => { process.exitCode = code; }).catch(error => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}
