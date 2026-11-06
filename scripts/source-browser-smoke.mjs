import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { createStaticServer } from './serve.mjs';
import { existsSync } from 'node:fs';
export function assertBlessingTiers(text, tiers, fixture = false) {
  for (const { tier } of tiers) assert.ok(text.includes(`LV${tier}`), `missing LV${tier}`);
  if (fixture) for (const tier of [1, 2, 3, 4]) assert.ok(text.includes(`LV${tier}`), `missing fixture LV${tier}`);
}
export async function runSourceBrowserSmoke(distPath, verification, { origin } = {}) {
  let server;
  if(!origin){server=await createStaticServer({distPath});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));origin=`http://127.0.0.1:${server.address().port}`;}
  let browser;
  try {
    const localBrowser=['C:/Program Files/Google/Chrome/Application/chrome.exe','C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(existsSync);
    browser=await chromium.launch({headless:true,...(!existsSync(chromium.executablePath()) && localBrowser ? {executablePath:localBrowser} : {})});
    const page=await browser.newPage({viewport:{width:390,height:844}});const errors=[];page.on('pageerror',e=>errors.push(e.message));
    const goto=async route=>{await page.goto(origin+route);await page.locator('#main h1').waitFor();assert.doesNotMatch(await page.locator('#main').innerText(),/資料驗證失敗|共享資料未能通過/);};
    const versionResponse=await page.request.get(origin+'/version.json');const version=await versionResponse.json();
    assert.equal(version.build_id,verification.build_id);
    for(const pointer of version.game_releases){
      const manifest=await(await page.request.get(origin+pointer.manifest_path)).json();
      assert.equal(manifest.gameVersion,pointer.game_version);
      await goto(`/skills/?version=${pointer.game_version}`);
      assert.ok(await page.locator('[data-item-id]').count());
      await goto(`/blessings/?version=${pointer.game_version}`);
      await page.locator('#main a[href*="id="]').first().click();await page.locator('[data-item-id]').first().waitFor();
      const id=new URL(page.url()).searchParams.get('id');
      const blessingFile=manifest.files.find(f=>f.kind==='blessings-index');
      const index=await(await page.request.get(origin+`/data/${manifest.dataRevision}/${blessingFile.path}`)).json();
      const shard=index.items.find(item=>item.id===id);
      const blessing=await(await page.request.get(origin+`/data/${manifest.dataRevision}/${shard.path}`)).json();
      assertBlessingTiers(await page.locator('#main').innerText(),blessing.items.find(item=>item.id===id).values.tiers,verification.package_kind==='fixture');
      await goto(`/weapons/?version=${pointer.game_version}`);
      await page.locator('nav[aria-label="武器型號"] a').first().click();await page.locator('[data-item-id]').first().waitFor();
      await goto(`/terms/?version=${pointer.game_version}`);
      assert.ok(await page.locator('nav[aria-label="術語分類"] a').count());
      await goto(`/game-changes/?version=${pointer.game_version}`);
      if(!manifest.files.some(f=>f.kind==='game-changes'))assert.ok((await page.locator('#main').innerText()).includes('此版本尚無遊戲變更紀錄'));
    }
    if(verification.package_kind==='fixture'){
      await goto('/skills/?version=9.9.2');const text=await page.locator('#main').innerText();
      for(const expected of ['官方原文','原始碼未公開','非官方譯名','效果','條件','計算','補充','額外'])assert.ok(text.includes(expected),expected);
      assert.equal(await page.locator('[data-item-id="darktide:skill:fixture_b"] [data-section]').count(),1);
      await goto('/blessings/?id=darktide%3Ablessing%3Afixture_a');assert.ok((await page.locator('.source-errata').first().innerText()).includes('勘誤'));
    }
    await goto('/announcements/');assert.equal(await page.locator('.shared-announcement-entry').count(),8);
    await page.locator('.shared-announcement-entry a[href^="/announcements/"]').first().click();await page.locator('.shared-announcement-content').waitFor();
    await goto('/history/1.13.1/');assert.match(await page.locator('#main').innerText(),/1.13.1 歷史資料/);
    assert.deepEqual(errors,[]);
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'mobile layout overflows');
    const response=await page.request.get(origin+'/source-data/current.json');assert.equal(response.headers()['access-control-allow-origin'],'*');assert.match(response.headers()['cache-control'],/no-cache/);
    console.log('Source-Data browser smoke passed: versions, explanations, tiers, family pages, announcements, history and mobile layout.');
  }finally{if(browser)await browser.close();if(server)await new Promise(resolve=>server.close(resolve));}
}
