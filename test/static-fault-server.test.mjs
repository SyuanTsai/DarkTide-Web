import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import {
  createBrowserFaultServer,
  createOldData404Server,
  parseFaultArgs
} from '../scripts/browser-fault-server.mjs';

const revision = 'a'.repeat(64);
const buildId = 'b'.repeat(64);
const detailPath = `/data/${revision}/details/weapons/practice-rifle.json`;
const imagePath = `/data/${revision}/icons/practice-rifle.png`;

async function listening(server, port = 0) {
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', resolve);
  });
  return `http://127.0.0.1:${server.address().port}`;
}

async function close(server) {
  if (server?.listening) await new Promise(resolve => server.close(resolve));
}

function makeUpstream() {
  return createServer((request, response) => {
    response.setHeader('content-type', 'application/json; charset=utf-8');
    if (request.url === '/version.json') {
      response.end(JSON.stringify({
        schema_version: 2,
        data_revision: revision,
        build_id: buildId,
        game_version: 'fixture',
        package_kind: 'fixture'
      }));
    } else response.end(JSON.stringify({ ok: true, path: request.url }));
  });
}

test('UnitT10_fault_proxy_arguments_require_explicit_safe_loopback_targets', () => {
  // Scenario: A developer starts the manual fault proxy with CLI-controlled options.
  // Purpose: Restrict the test utility to known modes, exact public paths, and a local upstream.
  const parsed = parseFaultArgs(['--mode', 'bad-json-once', '--path', detailPath]);
  assert.equal(parsed.mode, 'bad-json-once');
  assert.equal(parsed.targetPath, detailPath);
  assert.equal(parsed.port, 8088);
  assert.throws(() => parseFaultArgs(['--mode', 'missing-image', '--path', detailPath]), /safe missing-image target/);
  assert.equal(parseFaultArgs(['--mode', 'missing-remote-image', '--path', detailPath]).mode, 'missing-remote-image');
  assert.throws(() => parseFaultArgs(['--mode', 'bad-json-once', '--path', detailPath, '--upstream', 'https://example.com']), /loopback HTTP/);
});

test('InterT10_bad_json_is_injected_once_then_retry_passes_through', async () => {
  // Scenario: The selected detail endpoint returns malformed JSON once, then the upstream response.
  // Purpose: Reproduce the browser retry flow without changing static artifacts or the upstream server.
  const upstream = makeUpstream();
  let proxy;
  let upstreamUrl;
  try {
    upstreamUrl = await listening(upstream);
    proxy = createBrowserFaultServer({ mode: 'bad-json-once', targetPath: detailPath, upstream: new URL(upstreamUrl) });
    const proxyUrl = await listening(proxy);
    const first = await fetch(proxyUrl + detailPath);
    assert.equal(first.status, 200);
    assert.equal(first.headers.get('x-browser-fault'), 'bad-json-once');
    await assert.rejects(first.json());
    const retry = await fetch(proxyUrl + detailPath);
    assert.equal(retry.status, 200);
    assert.equal(retry.headers.get('x-browser-fault'), 'proxy');
    assert.deepEqual(await retry.json(), { ok: true, path: detailPath });
  } finally {
    await close(proxy);
    await close(upstream);
  }
});

test('InterT20_old_data_404_changes_version_identity_and_returns_detail_not_found', async () => {
  // Scenario: A detail path is missing from an old revision while version.json exposes a newer identity.
  // Purpose: Exercise the stale-data browser message using valid synthetic 64-character hashes.
  const upstream = makeUpstream();
  let proxy;
  try {
    const upstreamUrl = await listening(upstream);
    proxy = createOldData404Server({ targetPath: detailPath, upstream: new URL(upstreamUrl) });
    const proxyUrl = await listening(proxy);
    const missing = await fetch(proxyUrl + detailPath);
    assert.equal(missing.status, 404);
    assert.equal(missing.headers.get('x-browser-fault'), 'old-data-404');
    const versionResponse = await fetch(proxyUrl + '/version.json');
    const version = await versionResponse.json();
    assert.equal(versionResponse.status, 200);
    assert.equal(versionResponse.headers.get('x-browser-fault'), 'old-data-404-version');
    assert.match(version.data_revision, /^[a-f0-9]{64}$/);
    assert.match(version.build_id, /^[a-f0-9]{64}$/);
    assert.notEqual(version.data_revision, revision);
    assert.notEqual(version.build_id, buildId);
  } finally {
    await close(proxy);
    await close(upstream);
  }
});

test('InterT30_missing_image_returns_404_for_only_the_selected_icon', async () => {
  // Scenario: A detail page requests a selected icon URL that the proxy marks unavailable.
  // Purpose: Verify the browser can exercise its image-error presentation while other requests pass through.
  const upstream = makeUpstream();
  let proxy;
  try {
    const upstreamUrl = await listening(upstream);
    proxy = createBrowserFaultServer({ mode: 'missing-image', targetPath: imagePath, upstream: new URL(upstreamUrl) });
    const proxyUrl = await listening(proxy);
    const missing = await fetch(proxyUrl + imagePath);
    assert.equal(missing.status, 404);
    assert.equal(missing.headers.get('x-browser-fault'), 'missing-image');
    const detail = await fetch(proxyUrl + detailPath);
    assert.equal(detail.status, 200);
    assert.equal(detail.headers.get('x-browser-fault'), 'proxy');
  } finally {
    await close(proxy);
    await close(upstream);
  }
});

test('InterT40_missing_remote_image_rewrites_one_github_attachment_on_only_the_selected_detail', async () => {
  // Scenario: The selected detail JSON contains a remote GitHub attachment and a second detail is requested through the same proxy.
  // Purpose: Reproduce a real remote image error without downloading or intercepting GitHub traffic, while preserving every other response byte.
  const original = {
    kind: 'weapon',
    id: 'practice-rifle',
    assets: [
      {
        asset_id: 'remote-icon',
        path: null,
        source_url: 'https://github.com/user-attachments/assets/12345678-1234-4234-9234-123456789abc',
        attribution: { text: 'Games Lantern', href: 'https://gameslantern.com/', follow_required: true }
      },
      { asset_id: 'second-icon', path: null, source_url: 'https://github.com/user-attachments/assets/aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee', attribution: null }
    ],
    record: { weapon_id: 'practice-rifle' }
  };
  const other = { kind: 'weapon', id: 'other-rifle', assets: [], record: { weapon_id: 'other-rifle' } };
  const upstream = createServer((request, response) => {
    response.setHeader('content-type', 'application/json; charset=utf-8');
    if (request.url === detailPath) response.end(JSON.stringify(original));
    else response.end(JSON.stringify(other));
  });
  let proxy;
  try {
    const upstreamUrl = await listening(upstream);
    proxy = createBrowserFaultServer({ mode: 'missing-remote-image', targetPath: detailPath, upstream: new URL(upstreamUrl) });
    const proxyUrl = await listening(proxy);

    const targetedResponse = await fetch(proxyUrl + detailPath);
    assert.equal(targetedResponse.status, 200);
    assert.equal(targetedResponse.headers.get('content-type'), 'application/json; charset=utf-8');
    assert.equal(targetedResponse.headers.get('x-browser-fault'), 'missing-remote-image');
    const targeted = await targetedResponse.json();
    assert.deepEqual(targeted, {
      ...original,
      assets: [
        { ...original.assets[0], source_url: 'https://github.com/user-attachments/assets/00000000-0000-0000-0000-000000000000' },
        original.assets[1]
      ]
    });

    const otherResponse = await fetch(proxyUrl + detailPath.replace('practice-rifle', 'other-rifle'));
    assert.equal(otherResponse.status, 200);
    assert.equal(otherResponse.headers.get('x-browser-fault'), 'proxy');
    assert.equal(await otherResponse.text(), JSON.stringify(other));
  } finally {
    await close(proxy);
    await close(upstream);
  }
});
