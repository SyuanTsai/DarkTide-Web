import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { createW09SourceFetch } from '../scripts/content/contract-w09-source-fetch.mjs';

const API_ROOT = 'https://api.github.com/repos/SyuanTsai/DarkTide-Source-Data';
const RELEASE_ID = 'w09-' + 'a'.repeat(32);
const SOURCE_TAG = 'w09-source-' + RELEASE_ID;
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

async function readOptionalBytes(filePath) {
  try { return await readFile(filePath); }
  catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}

// Scenario: the selected Source archive resolver issues a fixed-repository API GET with existing headers and redirect policy.
// Purpose: authenticate that exact request without mutating caller state or exposing the token in other request metadata.
test('UnitT10_fixed-source-api-get-adds-auth-without-mutating-init', async () => {
  const token = 'ghs_example-token_123';
  const controller = new AbortController();
  const originalHeaders = new Headers({ Accept: 'application/vnd.github+json', 'X-Trace': 'keep' });
  const init = { method: 'GET', headers: originalHeaders, redirect: 'error', signal: controller.signal };
  let received;
  const fetchImpl = async (url, requestInit) => {
    received = { url, requestInit };
    return new Response(null, { status: 404 });
  };

  const fetchSource = createW09SourceFetch({ fetchImpl, token });
  const response = await fetchSource(`${API_ROOT}/releases/tags/${SOURCE_TAG}`, init);

  assert.equal(response.status, 404, 'the pinned source resolver still receives its normal response');
  assert.equal(received.requestInit.headers.get('authorization'), `Bearer ${token}`);
  assert.equal(received.requestInit.headers.get('accept'), 'application/vnd.github+json');
  assert.equal(received.requestInit.headers.get('x-trace'), 'keep');
  assert.equal(received.requestInit.redirect, 'error');
  assert.equal(received.requestInit.signal, controller.signal);
  assert.notStrictEqual(received.requestInit, init, 'the authenticated request uses a shallow init copy');
  assert.strictEqual(init.headers, originalHeaders);
  assert.equal(originalHeaders.has('authorization'), false, 'the original headers remain untouched');
});

// Scenario: the resolver calls release, tag-reference, tag-object, and asset endpoints, while arbitrary URLs and methods may also reach the transport.
// Purpose: keep credentials limited to exact HTTPS Source-repository read endpoints and GET requests.
test('UnitT20-authentication-is-limited-to-fixed-source-read-endpoints', async () => {
  const token = 'ghs_example-token_123';
  const requests = [];
  const fetchSource = createW09SourceFetch({
    token,
    fetchImpl: async (url, init) => {
      requests.push({ url: String(url), init });
      return new Response(null, { status: 204 });
    },
  });
  const allowed = [
    `${API_ROOT}/releases/tags/${SOURCE_TAG}`,
    `${API_ROOT}/git/ref/tags/${SOURCE_TAG}`,
    `${API_ROOT}/git/tags/${'b'.repeat(40)}`,
    `${API_ROOT}/releases/assets/77`,
  ];
  for (const url of allowed) await fetchSource(url, { method: 'GET' });

  const untrusted = [
    [`https://api.github.com.evil.invalid/repos/SyuanTsai/DarkTide-Source-Data/releases/tags/${SOURCE_TAG}`, 'GET'],
    [`https://api.github.com:443/repos/SyuanTsai/DarkTide-Source-Data/releases/tags/${SOURCE_TAG}`, 'GET'],
    [`https://user@api.github.com/repos/SyuanTsai/DarkTide-Source-Data/releases/tags/${SOURCE_TAG}`, 'GET'],
    [`http://api.github.com/repos/SyuanTsai/DarkTide-Source-Data/releases/tags/${SOURCE_TAG}`, 'GET'],
    [`https://api.github.com/repos/Other/Source/releases/tags/${SOURCE_TAG}`, 'GET'],
    [`${API_ROOT}/issues/42`, 'GET'],
    [`${API_ROOT}/releases/tags/${SOURCE_TAG}`, 'POST'],
  ];
  for (const [url, method] of untrusted) {
    const init = { method, headers: new Headers({ Accept: 'application/json' }), redirect: 'manual' };
    await fetchSource(url, init);
    const forwarded = requests.at(-1);
    assert.strictEqual(forwarded.init, init, `${url} ${method} keeps the caller init and receives no credential copy`);
    assert.equal(new Headers(forwarded.init.headers).has('authorization'), false, `${url} ${method} receives no Authorization`);
  }

  assert.equal(requests.length, allowed.length + untrusted.length);
  for (const request of requests.slice(0, allowed.length)) {
    assert.equal(request.init.headers.get('authorization'), `Bearer ${token}`);
  }
});

// Scenario: GitHub's asset API returns a manual redirect to a release-assets CDN.
// Purpose: preserve the pinned resolver's redirect mode while never forwarding the API token to the CDN.
test('UnitT30-manual-asset-redirect-does-not-carry-api-token-to-cdn', async () => {
  const token = 'ghs_example-token_123';
  const calls = [];
  const fetchSource = createW09SourceFetch({
    token,
    fetchImpl: async (url, init) => {
      calls.push({ url: String(url), init });
      if (calls.length === 1) {
        return new Response(null, { status: 302, headers: { Location: 'https://release-assets.githubusercontent.com/archive' } });
      }
      return new Response(null, { status: 200 });
    },
  });

  const redirectResponse = await fetchSource(`${API_ROOT}/releases/assets/77`, {
    method: 'GET', headers: { Accept: 'application/octet-stream' }, redirect: 'manual',
  });
  assert.equal(redirectResponse.status, 302, 'the wrapper returns the redirect for the pinned manual-redirect validator');
  assert.equal(calls[0].init.redirect, 'manual');
  assert.equal(calls[0].init.headers.get('authorization'), `Bearer ${token}`);

  await fetchSource('https://release-assets.githubusercontent.com/archive', {
    method: 'GET', headers: { Accept: 'application/octet-stream' }, redirect: 'manual',
  });
  assert.equal(new Headers(calls[1].init.headers).has('authorization'), false);
  assert.equal(calls[1].init.redirect, 'manual');
});

// Scenario: an authenticated Source API request receives 403 or 429 with a mixture of valid and malformed rate-limit headers.
// Purpose: expose only status and validated numeric rate-limit values, never response body, credentials, or arbitrary headers.
test('UnitT40-http-failure-diagnostics-are-numeric-and-secret-free', async () => {
  const token = 'ghs_example-token_123';
  for (const { status, headers, expected, omitted } of [
    { status: 403, headers: { 'X-RateLimit-Remaining': '0', 'X-RateLimit-Reset': '1790000000', 'X-Private': token }, expected: ['HTTP 403', 'remaining=0', 'reset=1790000000'], omitted: [] },
    { status: 429, headers: { 'X-RateLimit-Remaining': '1.5', 'X-RateLimit-Reset': 'never' }, expected: ['HTTP 429'], omitted: ['remaining=', 'reset='] },
  ]) {
    const fetchSource = createW09SourceFetch({
      token,
      fetchImpl: async () => new Response(`body contains ${token}`, { status, headers }),
    });
    await assert.rejects(fetchSource(`${API_ROOT}/releases/tags/${SOURCE_TAG}`, { method: 'GET' }), error => {
      for (const text of expected) assert.ok(error.message.includes(text), `diagnostic includes ${text}`);
      for (const text of omitted) assert.ok(!error.message.includes(text), `diagnostic omits malformed ${text}`);
      assert.ok(!error.message.includes(token), 'diagnostic never includes the bearer token');
      assert.ok(!error.message.includes('body contains'), 'diagnostic never includes response body');
      assert.ok(!error.message.includes('X-Private'), 'diagnostic never includes arbitrary response headers');
      return true;
    });
  }
});

// Scenario: an approved Source API GET's underlying transport rejects with an error containing a dummy bearer value.
// Purpose: keep network-failure diagnostics generic so CLI stderr cannot echo the credential.
test('UnitT45-transport-exception-does-not-leak-token', async () => {
  const token = 'ghs_fake_transport_token_123';
  const fetchSource = createW09SourceFetch({
    token,
    fetchImpl: async () => { throw new Error(`transport failure echoed ${token}`); },
  });
  await assert.rejects(fetchSource(`${API_ROOT}/releases/tags/${SOURCE_TAG}`, { method: 'GET' }), error => {
    assert.equal(error.message, 'W09 Source API GET transport failed before receiving a response');
    assert.ok(!error.message.includes(token));
    return true;
  });
});

// Scenario: an absent or malformed token is supplied to the formal publisher transport.
// Purpose: fail closed with a generic message before constructing an Authorization header or leaking a header-parser error.
test('UnitT50-invalid-token-is-rejected-without-echoing-value', async () => {
  for (const token of [undefined, '', 'ghs_bad\r\nAuthorization: leaked', 'token with spaces']) {
    assert.throws(() => createW09SourceFetch({ token }), error => {
      assert.match(error.message, /W09_GIT_TOKEN/u);
      if (typeof token === 'string' && token.length > 0) {
        assert.ok(!error.message.includes(token), 'validation errors do not echo token input');
      }
      return true;
    });
  }
});

// Scenario: the actual promotion CLI starts with no composition override and a malformed dummy workflow token.
// Purpose: prove it rejects credentials before owner-state restore or Source network access, without echoing the token or changing release state.
test('UnitT60-cli-rejects-malformed-token-before-owner-state-restore', async () => {
  const statePath = new URL('../content/contracts/w09/release-state.json', import.meta.url);
  const stateBefore = await readOptionalBytes(statePath);
  const token = 'dummy token must not be echoed';
  const childEnv = { ...process.env, W09_GIT_TOKEN: token, W09_STATE_BRANCH: 'invalid branch name' };
  delete childEnv.W09_COMPOSITION_ROOT;
  delete childEnv.W09_EXPECTED_COMPOSITION_COMMIT;

  const result = spawnSync(process.execPath, ['scripts/promote-w09-release.mjs'], {
    cwd: REPO_ROOT,
    env: childEnv,
    encoding: 'utf8',
    windowsHide: true,
  });

  assert.equal(result.error, undefined);
  assert.equal(result.status, 1, result.stderr);
  assert.match(result.stderr, /W09_GIT_TOKEN is required and must use a valid Bearer token format/u);
  assert.ok(!result.stderr.includes(token), 'CLI stderr never echoes the dummy token');
  assert.doesNotMatch(result.stderr, /owner state branch/u, 'the invalid branch sentinel proves state-store creation was not reached');
  assert.equal(result.stdout, '');
  assert.deepEqual(await readOptionalBytes(statePath), stateBefore, 'CLI rejection leaves the release-state file unchanged');
});
