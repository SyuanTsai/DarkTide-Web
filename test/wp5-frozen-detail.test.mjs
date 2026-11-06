import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { createServer } from 'node:http';
import { chromium } from 'playwright';
import { createSharedViewModel } from '../web/shared-view.mjs';

// Scenario: Browse a real frozen 1.13.4 record through the Source-Data renderer.
// Purpose: Display the actual data revision and source commit without undefined legacy fields.
test('InterT10_凍結紀錄詳情顯示來源資料版本', async () => {
  const frozen = JSON.parse(await readFile(new URL('../content/history/1.13.4/game-changes.json', import.meta.url)));
  const item = createSharedViewModel({ domains: [frozen], gameReleaseId: frozen.gameReleaseId }).getGameChanges({}).items[0];
  const revision = 'a'.repeat(64), commit = 'b'.repeat(40);
  const server = createServer(async (req, res) => {
    if (req.url.startsWith('/web/')) {
      const name = req.url.slice('/web/'.length);
      try { res.writeHead(200, { 'content-type': 'text/javascript' }); res.end(await readFile(new URL(`../web/${name}`, import.meta.url))); } catch { res.end(); }
      return;
    }
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(`<main></main><p id="meta"></p><script type="module">
      import {renderSharedPage} from '/web/shared-render.mjs';
      const result = {sourceData:true, status:'ready', versions:[{game_version:'1.13.4'}], pointer:{game_version:'1.13.4', data_revision:'${revision}'}, manifest:{gameVersion:'1.13.4', dataRevision:'${revision}', source:{commit:'${commit}'}}, domains:[{kind:'game-changes',document:${JSON.stringify(frozen)}}]};
      renderSharedPage({main:document.querySelector('main'),buildMeta:document.querySelector('#meta'),result,url:new URL(location.href)});
    </script>`);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  let browser;
  try {
    const executablePath = process.env.SYP_W10_CHROMIUM_EXE || ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(existsSync);
    browser = await chromium.launch({ headless: true, ...(executablePath ? { executablePath } : {}) });
    const page = await browser.newPage();
    await page.goto(`http://127.0.0.1:${server.address().port}/game-changes/?version=1.13.4&id=${encodeURIComponent(item.changeId)}`);
    await page.locator('.shared-change-summary').waitFor();
    const text = await page.locator('main').innerText();
    assert.match(text, new RegExp(`網站資料版本：${revision}`));
    assert.ok(text.includes(commit));
    assert.doesNotMatch(text, /undefined/);
  } finally { await browser?.close(); await new Promise(resolve => server.close(resolve)); }
});
