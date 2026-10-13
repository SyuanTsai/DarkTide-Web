import assert from 'node:assert/strict';
import test from 'node:test';
import { ensureCandidatePullRequest } from '../scripts/w01-pr.mjs';
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