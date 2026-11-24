# 黑潮繁體資料庫

## Overview

**What it is:** Darktide Traditional Chinese Database is a reference website for Warhammer 40,000: Darktide. Visit [darktide.tw-syuan.com](https://darktide.tw-syuan.com).

**Problem it solves:** Players can use one Traditional Chinese site to look up class talents, skills, weapons, and blessing effects.

**Key features**

- Class talent trees with icons and skill lists with images and descriptions of effects and mechanics.
- Weapon and blessing references that show shared blessing effects once and let you switch weapons on the same page when effects differ.
- A standalone, read-only [1.13.1 history snapshot](https://darktide.tw-syuan.com/history/1.13.1/).

**Requirements:** Local development uses Node.js 24.

**Testing and deployment:** GitHub Actions runs tests with `node --test` and browser smoke checks with Playwright. The deployment workflow builds production data from a pinned [DarkTide-Source-Data](https://github.com/SyuanTsai/DarkTide-Source-Data) commit and deploys the site to Cloudflare Workers Static Assets.

**Quick start:**

1. Install dependencies with `npm ci`.
2. Install Chromium with `npx playwright install chromium`.
3. Run tests with `npm test`.
4. Build the site with fixture data using `npm run build:fixture`.
5. Preview locally with `npm run serve:static -- 8087`.

**Attribution:** Icons come from approved sources, with credit to Games Lantern. Where source-specific assets are unavailable, the site uses clearly identified generic icons.

## 概覽

**網站簡介：** 黑潮繁體資料庫是《Warhammer 40,000: Darktide》的繁體中文資料查詢網站。[前往網站](https://darktide.tw-syuan.com)。

**解決的問題：** 玩家可在同一個繁體中文網站查閱職業天賦、技能、武器與祝福效果。

**主要功能**

- 附圖示的職業天賦樹，以及附圖片、效果與機制說明的技能清單。
- 武器與祝福資料會將共用的祝福效果只列一次。效果有差異時，可在同一頁切換武器。
- 獨立唯讀的 [1.13.1 歷史摘要](https://darktide.tw-syuan.com/history/1.13.1/)。

**開發需求：** 本機開發使用 Node.js 24。

**測試與部署：** GitHub Actions 以 `node --test` 執行測試，並用 Playwright 執行瀏覽器冒煙測試。部署工作流程使用固定的 [DarkTide-Source-Data](https://github.com/SyuanTsai/DarkTide-Source-Data) commit 建置正式站資料，並將網站部署至 Cloudflare Workers Static Assets。

**快速開始：**

1. 執行 `npm ci` 安裝相依套件。
2. 執行 `npx playwright install chromium` 安裝 Chromium。
3. 執行 `npm test` 執行測試。
4. 執行 `npm run build:fixture`，以測試資料建置網站。
5. 執行 `npm run serve:static -- 8087` 在本機預覽。

**素材署名：** 圖示依核准來源引用並保留 Games Lantern 署名。缺少來源專屬素材時，網站使用明示的通用圖示。

---

以已核准的公開 JSON 建置繁體中文技能、天賦樹、武器與祝福網站。網站在 Cloudflare Workers Static Assets 執行，建置與部署由 GitHub Actions 完成。

## 在 GitHub 部署
1. 本 PR 合併至 main 後，開啟 Repository Settings → Secrets and variables → Actions。
2. 新增 Repository Secret，名稱為 `CLOUDFLARE_API_TOKEN`，值填入 Cloudflare Token。
3. 開啟 Actions → Deploy pinned Source-Data to Cloudflare → Run workflow，選 main，輸入 Source-Data 的完整 40 碼 commit。
4. 工作流測試、建置指定來源、驗證及部署預覽站，通過後發布正式站 `https://darktide.tw-syuan.com`，再核對線上來源 commit 與瀏覽器頁面。

新增或更新 Secret 與 main 更新均不會觸發部署；正式部署只接受手動 Run workflow。缺 Secret 時既有 credential 檢查會中止部署。

回滾時，從上一個成功部署記錄取得 Source-Data commit，用該 commit 重跑 `deploy.yml`。工作流重新建置、驗證及部署，不依賴舊 state branch 或 shared release 備份。`operations-monitor.yml` 定期驗證公開版本、manifest、分檔雜湊、靜態資產及 404；它不查詢舊備份。WP8 首次部署後，可另開單移除 monitor 的 legacy-w09 相容分支。歷史部署與備份手冊保留於 docs，舊入口已退役。

## 網站內容
- 七職業圖示天賦樹、技能清單圖片與條列效果／機制。
- 武器以主武器呈現，祝福共用效果去重，有差異時在同頁切換武器。
- 圖示依核准來源引用並保留 Games Lantern 署名；缺來源專屬素材使用明示的通用圖示。
- 網站由指定 Source-Data commit 的 `data/` 建置；1.13.1 是獨立唯讀歷史摘要，見[歷史入口](https://darktide.tw-syuan.com/history/1.13.1/)。
- 完整固定來源、current/history 範圍與逐列遷移 outcome 請見[W14 遷移索引](docs/contracts/w14/README.md)。
- 舊 query id 與詳情路徑的精確對應、固定 1.13.4 策略、離線更新方式與「找不到」清單，見[舊網址相容契約](docs/contracts/legacy-urls.md)。

## 開發
需要 Node.js 24。網站直接讀 Source-Data；公開部署不包含私人來源 checkout 或原始素材包。
```sh
npm ci
npx playwright install chromium
npm test
npm run build:fixture
```
此流程只建置與驗證，不需要部署 Token，也不建立 Cloudflare 資源。
`npm run serve:static -- 8087` 可在本機預覽。
# Source-Data 直接建置（SYP-388）

```powershell
node scripts/build.mjs --source-data <checkout目錄> --source-data-commit <40碼小寫SHA> --site-origin https://darktide.tw-syuan.com
npm run build:fixture
npm run smoke:browser
```

指定 commit 必須等於 checkout 的 HEAD。若來源含 `pipeline/validate.mjs`，先執行它，再驗證 Web 所需欄位、唯一 ID、版本及四類檔案。驗證失敗不寫入新 dist；既有成功產物保留。沒有 `data/current.json` 的過渡版本無法部署。舊 W08／W09 compose、overlay、proposal 與 handoff 入口已移除。

每個版本各有 `/data/<dataRevision>/manifest.json`，schemaVersion 為 `3.0.0`。manifest 保留 `gameVersion`、`dataRevision`、`files[]`（kind、path、sizeBytes、sha256、dependencies），來源為 `source: {repository: "SyuanTsai/DarkTide-Source-Data", commit, dataSchemaVersion, textBatch}`。`dataRevision` 是不含自身欄位之 manifest 的兩格縮排 JSON 加 LF 的 SHA-256。`/version.json` schema_version 為 3，保留 game_releases 指標位置；每筆包含 game_version、data_revision、manifest_path、manifest_sha256，無 W02／W09 content version 或 receipt。分檔完整保留 Source-Data item；index 只存 id、name、family／mark、path。武器依 family、祝福每筆一個 shard，單檔上限為 `16 * 1024 * 1024`。

給 WP6 外掛的固定路徑契約：

- `/source-data/current.json` 與來源 `data/current.json` 位元組相同，採 `no-cache, must-revalidate`。
- `current.versions` 每版四類各有 transport manifest；原始 bytes 依下述門檻提供單檔或分片，採一年 immutable 快取；已發布版本資料應保持凍結。
- 與 Extension loader 一致，每個版本的單一類別原始檔上限為 32 MiB（33,554,432 bytes），四類加 `current.json` 合計上限為 64 MiB（67,108,864 bytes）；超過時建置失敗。
- JSON 使用 `application/json; charset=utf-8`，`.bin` 使用 `application/octet-stream`，允許跨來源 GET／HEAD：`Access-Control-Allow-Origin: *` 與 `Access-Control-Allow-Methods: GET, HEAD`。
- 網站新版本由版本指標切換；`/history/1.13.1/` 仍使用原固定歷史公開投影。

公告直接讀取 `content/authoring/v2/w15/announcement-candidate.json`（5 筆）及 `content/authoring/v2/official-announcements/20261030/announcements.json`（3 筆），不經 compose。與既有公告分檔的 8 筆 ID 及全部顯示欄位深度比對一致。遊戲變更只經 `src/build/game-changes.mjs` 取得；沒有上一版及凍結資料時顯示空狀態，1.13.4 使用凍結 W12 資料。

正式部署由 `.github/workflows/deploy.yml` 的 workflow_dispatch 觸發，需明確輸入 Source-Data commit；使用 production environment 與既有 Cloudflare versions upload／deploy、預覽驗證及回復流程。部署後核對線上 manifest 的 source.commit，再執行線上 browser smoke。PR／push 的 static-ci 只執行測試、fixture 建置與 smoke，不部署。此工作未觸發部署或 push。


`/source-data/<version>/<category>.manifest.json` describes the immutable raw-byte transport (`transportSchemaVersion` 1.0.0): total byte length and SHA-256, and ordered parts with index, relative path, offset, length and SHA-256. At most 20 MiB uses the original JSON as a single part. Above 20 MiB, raw bytes are split into 20 MiB `.part-NNNN.bin` files; the original JSON is also provided through 25 MiB. Above 25 MiB the original JSON is unavailable (404), so older extensions must upgrade before the Web release. Reassemble bytes before decoding. JSON manifests use `application/json; charset=utf-8`, binary parts use `application/octet-stream`; both retain CORS GET/HEAD and immutable caching. `current.json` remains byte-identical and no-cache. Missing files return 404. Deploy Extension support first.
