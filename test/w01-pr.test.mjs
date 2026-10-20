import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';
import { ensureCandidatePullRequest, normalizeWebRepositoryUrl } from '../scripts/w01-pr.mjs';
import { jsonBytes, sha256 } from '../src/static/common.mjs';

const request = {
  repository: 'https://github.com/SyuanTsai/DarkTide-Source-Data',
  commit: '2c1e26ecde70773fc2588a8a70baba9a28770586',
  sourceRevision: 'a'.repeat(64),
  manifestSha256: 'b'.repeat(64)
};
function receipt() {
  return {
    schemaVersion: '1.0.0',
    requestId: sha256(jsonBytes(request)),
    request,
    sourceLockSha256: 'c'.repeat(64),
    artifacts: [],
    candidate: {
      repository: 'https://github.com/SyuanTsai/DarkTide-Web',
      branch: 'codex/SYP-311-w01',
      baseBranch: 'main'
    },
    fixtureOnly: true,
    publicationEligible: false,
    formalPublishAllowed: false
  };
}

const nativeCompositionReceipt = JSON.parse(readFileSync(new URL('../content/w01/composition-receipt.json', import.meta.url), 'utf8'));

// Scenario: the fixed W01 candidate branch already has an open pull request.
// Purpose: rerunning the gh executor reuses the same PR and never creates a duplicate.
test('UnitT10_existing-w01-pull-request-is-reused', () => {
  let calls = 0;
  const result = ensureCandidatePullRequest({
    receipt: receipt(),
    runGh: args => {
      calls += 1;
      assert.equal(args[0], 'pr');
      return JSON.stringify([{
        number: 7,
        url: 'https://github.com/SyuanTsai/DarkTide-Web/pull/7',
        state: 'OPEN',
        headRefName: 'codex/SYP-311-w01',
        baseRefName: 'main'
      }]);
    }
  });
  assert.deepEqual(result, { created: false, number: 7, url: 'https://github.com/SyuanTsai/DarkTide-Web/pull/7', state: 'OPEN' });
  assert.equal(calls, 1);
});

// Scenario: the fixed branch has no PR and the helper creates one with a multiline description.
// Purpose: gh receives exact body bytes through a private temporary file that is removed afterward.
test('UnitT15_create-uses-private-body-file-and-cleans-it-up', () => {
  let listCalls = 0;
  let bodyPath;
  const result = ensureCandidatePullRequest({
    receipt: receipt(),
    runGh: args => {
      if (args[1] === 'list') {
        listCalls += 1;
        return JSON.stringify(listCalls === 1 ? [] : [{
          number: 12,
          url: 'https://github.com/SyuanTsai/DarkTide-Web/pull/12',
          state: 'OPEN',
          headRefName: 'codex/SYP-311-w01',
          baseRefName: 'main'
        }]);
      }
      assert.deepEqual(args.slice(-2, -1), ['--body-file']);
      bodyPath = args.at(-1);
      const body = readFileSync(bodyPath, 'utf8');
      assert.match(body, /Source commit: 2c1e26ecde70773fc2588a8a70baba9a28770586\nSource revision:/);
      assert.match(body, /fixture-only and publication-ineligible\. Formal content still requires human review\.$/);
      return '';
    }
  });
  assert.deepEqual(result, { created: true, number: 12, url: 'https://github.com/SyuanTsai/DarkTide-Web/pull/12', state: 'OPEN' });
  assert.equal(existsSync(bodyPath), false);
});

// Scenario: no PR exists, then a concurrent caller creates the same branch PR first.
// Purpose: the executor rechecks and reuses the single new PR after a create race.
test('UnitT20_create-race-rechecks-and-reuses-existing-pr', () => {
  let listCalls = 0;
  let createCalls = 0;
  const result = ensureCandidatePullRequest({
    receipt: receipt(),
    runGh: args => {
      if (args[1] === 'list') {
        listCalls += 1;
        return JSON.stringify(listCalls === 1 ? [] : [{
          number: 8,
          url: 'https://github.com/SyuanTsai/DarkTide-Web/pull/8',
          state: 'OPEN',
          headRefName: 'codex/SYP-311-w01',
          baseRefName: 'main'
        }]);
      }
      if (args[1] === 'create') {
        createCalls += 1;
        throw new Error('already exists');
      }
      throw new Error('unexpected gh call');
    }
  });
  assert.deepEqual(result, { created: false, number: 8, url: 'https://github.com/SyuanTsai/DarkTide-Web/pull/8', state: 'OPEN' });
  assert.equal(listCalls, 2);
  assert.equal(createCalls, 1);
});

// Scenario: only a closed PR exists for the deterministic candidate branch.
// Purpose: the helper refuses to create another PR or silently reopen a human-closed review.
test('UnitT30_closed-pull-request-is-not-duplicated-or-reopened', () => {
  assert.throws(() => ensureCandidatePullRequest({
    receipt: receipt(),
    runGh: () => JSON.stringify([{
      number: 9,
      url: 'https://github.com/SyuanTsai/DarkTide-Web/pull/9',
      state: 'CLOSED',
      headRefName: 'codex/SYP-311-w01',
      baseRefName: 'main'
    }])
  }), /refusing to create a duplicate/);
});

// Scenario: the exact public Source composition is a non-fixture candidate and PR #8 already exists.
// Purpose: allow the pending native composition to use the reviewed PR without creating a duplicate.
test('UnitT40_native-source-composition-reuses-existing-w01-pr-8', () => {
  let calls = 0;
  const result = ensureCandidatePullRequest({
    receipt: nativeCompositionReceipt,
    runGh: args => {
      calls += 1;
      assert.equal(args[1], 'list');
      return JSON.stringify([{
        number: 8,
        url: 'https://github.com/SyuanTsai/DarkTide-Web/pull/8',
        state: 'OPEN',
        headRefName: 'codex/SYP-311-w01',
        baseRefName: 'main'
      }]);
    }
  });
  assert.equal(nativeCompositionReceipt.fixtureOnly, false);
  assert.deepEqual(result, { created: false, number: 8, url: 'https://github.com/SyuanTsai/DarkTide-Web/pull/8', state: 'OPEN' });
  assert.equal(calls, 1);
});

// Scenario: the exact public Source composition has no open PR yet.
// Purpose: keep its PR description quarantined and explicitly pending without calling it fixture-only.
test('UnitT50_native-source-pr-description-says-pending-not-fixture-only', () => {
  let listCalls = 0;
  let body;
  const result = ensureCandidatePullRequest({
    receipt: nativeCompositionReceipt,
    runGh: args => {
      if (args[1] === 'list') {
        listCalls += 1;
        return JSON.stringify(listCalls === 1 ? [] : [{
          number: 21,
          url: 'https://github.com/SyuanTsai/DarkTide-Web/pull/21',
          state: 'OPEN',
          headRefName: 'codex/SYP-311-w01',
          baseRefName: 'main'
        }]);
      }
      assert.equal(args[1], 'create');
      const bodyPath = args.at(-1);
      assert.equal(args.at(-2), '--body-file');
      body = readFileSync(bodyPath, 'utf8');
      return '';
    }
  });
  assert.equal(result.created, true);
  assert.match(body, /non-fixture pending preview and publication-ineligible/i);
  assert.match(body, /Formal content still requires human review\./);
  assert.doesNotMatch(body, /fixture-only/i);
});

// Scenario: a composition receipt has mixed or publishable flags.
// Purpose: reject invalid quarantine modes before the GitHub executor can make any remote call.
test('UnitT60_invalid-composition-quarantine-flags-reject-before-gh', () => {
  for (const invalidReceipt of [
    { ...nativeCompositionReceipt, fixtureOnly: 'false' },
    { ...nativeCompositionReceipt, publicationEligible: true },
    { ...nativeCompositionReceipt, formalPublishAllowed: true },
    Object.fromEntries(Object.entries(nativeCompositionReceipt).filter(([key]) => key !== 'fixtureOnly'))
  ]) {
    let calls = 0;
    assert.throws(() => ensureCandidatePullRequest({
      receipt: invalidReceipt,
      runGh: () => { calls += 1; return '[]'; }
    }));
    assert.equal(calls, 0);
  }
});

// Scenario: the isolated checkout uses SSH while GitHub Actions may report HTTPS.
// Purpose: recognize only equivalent URLs for the one fixed Web repository without mutating remote configuration.
test('UnitT70_equivalent-github-remotes-normalize-to-the-fixed-web-repository', () => {
  for (const remote of [
    'git@github.com:SyuanTsai/DarkTide-Web.git',
    'ssh://git@github.com/SyuanTsai/DarkTide-Web.git',
    'https://github.com/SyuanTsai/DarkTide-Web.git',
    'https://github.com/SyuanTsai/DarkTide-Web'
  ]) assert.equal(normalizeWebRepositoryUrl(remote), 'https://github.com/SyuanTsai/DarkTide-Web');
  for (const remote of [
    'git@github.com:someone-else/DarkTide-Web.git',
    'https://github.com/SyuanTsai/DarkTide-Source-Data.git',
    'https://github.com.evil.example/SyuanTsai/DarkTide-Web.git',
    'https://user@github.com/SyuanTsai/DarkTide-Web.git',
    null
  ]) assert.equal(normalizeWebRepositoryUrl(remote), null);
});
