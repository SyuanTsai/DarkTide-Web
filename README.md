# 黑潮繁體資料庫

以已核准的公開 JSON 建置繁體中文技能、天賦樹、武器與祝福網站。網站在 Cloudflare Workers Static Assets 執行，建置與部署由 GitHub Actions 完成。

## 在 GitHub 部署
1. 本 PR 合併至 main 後，開啟 Repository Settings → Secrets and variables → Actions。
2. 新增 Repository Secret，名稱為 `CLOUDFLARE_API_TOKEN`，值填入 Cloudflare Token。
3. 開啟 Actions → Deploy pinned Source-Data to Cloudflare → Run workflow，選 main，輸入 Source-Data 的完整 40 碼 commit。
4. 工作流測試、建置指定來源、驗證及部署預覽站，通過後發布正式站 `https://darktide.tw-syuan.com`，再核對線上來源 commit 與瀏覽器頁面。

新增或更新 Secret 與 main 更新均不會觸發部署；正式部署只接受手動 Run workflow。缺 Secret 時既有 credential 檢查會中止部署。

詳見 [GitHub 部署說明](docs/CLOUDFLARE-DEPLOYMENT.md)；日常維護請看 [監控、備份與回復手冊](docs/OPERATIONS.md)。

## 網站內容
- 七職業圖示天賦樹、技能清單圖片與條列效果／機制。
- 武器以主武器呈現，祝福共用效果去重，有差異時在同頁切換武器。
- 圖示依核准來源引用並保留 Games Lantern 署名；缺來源專屬素材使用明示的通用圖示。
- 目前網站的 1.13.2.2 shared package 由 Source 技術資料與 Web 文案組成；可由[版本資訊](https://darktide.tw-syuan.com/version.json)查看，並由其指向的[現版 manifest](https://darktide.tw-syuan.com/data/82b79e47e88717b4237655fe4909f0754bac18238c3a23530b985effd60f3130/manifest.json)固定為遊戲版本 1.13.2、SteamBuild_25681127。1.13.1 是獨立唯讀歷史摘要，見[歷史入口](https://darktide.tw-syuan.com/history/1.13.1/)。
- 完整固定來源、current/history 範圍與逐列遷移 outcome 請見[W14 遷移索引](docs/contracts/w14/README.md)。
- W15 公告、術語、工作流程及逐列 owner 移交候選仍待審核，請見[W15 遷移索引](docs/contracts/w15/migration-index.md)；候選未進入現版發布資料。

## 開發
需要 Node.js 24。[`content/published/content.json`](content/published/content.json) 是保留的 1.13.1 legacy baseline，不是現版唯一資料來源；目前網站使用由 Source 技術資料與 Web 文案組成的 1.13.2.2 shared package，版本資訊見 [version.json](https://darktide.tw-syuan.com/version.json)。1.13.1 的唯讀歷史摘要入口為 [history/1.13.1](https://darktide.tw-syuan.com/history/1.13.1/)。來源、保存範圍與逐列遷移 outcome 見 [W14 遷移索引](docs/contracts/w14/README.md)。公開部署不包含私人來源 checkout 或原始素材包。
```sh
npm ci
npx playwright install chromium
npm test
npm run prepare:deploy
```
此流程只建置與驗證，不需要部署 Token，也不建立 Cloudflare 資源。
`npm run serve:static -- 8087` 可在本機預覽。
# Source-Data 直接建置（SYP-388）

```powershell
node scripts/build.mjs --source-data <checkout目錄> --source-data-commit <40碼小寫SHA> --site-origin https://darktide.tw-syuan.com
npm run build:fixture
npm run smoke:browser
```

指定 commit 必須等於 checkout 的 HEAD。若來源含 `pipeline/validate.mjs`，先執行它，再驗證 Web 所需欄位、唯一 ID、版本及四類檔案。驗證失敗不寫入新 dist；既有成功產物保留。沒有 `data/current.json` 的過渡版本無法部署。舊建置／W09／compose／overlay／proposal 入口本輪保留。

每個版本各有 `/data/<dataRevision>/manifest.json`，schemaVersion 為 `3.0.0`。manifest 保留 `gameVersion`、`dataRevision`、`files[]`（kind、path、sizeBytes、sha256、dependencies），來源為 `source: {repository: "SyuanTsai/DarkTide-Source-Data", commit, dataSchemaVersion, textBatch}`。`dataRevision` 是不含自身欄位之 manifest 的兩格縮排 JSON 加 LF 的 SHA-256。`/version.json` schema_version 為 3，保留 game_releases 指標位置；每筆包含 game_version、data_revision、manifest_path、manifest_sha256，無 W02／W09 content version 或 receipt。分檔完整保留 Source-Data item；index 只存 id、name、family／mark、path。武器依 family、祝福每筆一個 shard，單檔上限沿用 `scripts/content/contract-release.mjs` 的 `16 * 1024 * 1024`。

給 WP6 外掛的固定路徑契約：

- `/source-data/current.json` 與來源 `data/current.json` 位元組相同，採 `no-cache, must-revalidate`。
- `/source-data/<version>/{skills,weapons,blessings,terms}.json` 包含 current.versions 全部版本，與來源位元組相同，採一年 immutable 快取；已發布版本資料應保持凍結。
- `/source-data/*` 使用 `application/json; charset=utf-8`，允許跨來源 GET／HEAD：`Access-Control-Allow-Origin: *` 與 `Access-Control-Allow-Methods: GET, HEAD`。
- 網站新版本由版本指標切換；`/history/1.13.1/` 仍使用原固定歷史公開投影。

公告直接讀取 `content/authoring/v2/w15/announcement-candidate.json`（5 筆）及 `content/authoring/v2/official-announcements/20261030/announcements.json`（3 筆），不經 compose。與既有公告分檔的 8 筆 ID 及全部顯示欄位深度比對一致。遊戲變更只經 `src/build/game-changes.mjs` 取得；沒有上一版及凍結資料時顯示空狀態，1.13.4 使用凍結 W12 資料。

正式部署由 `.github/workflows/deploy.yml` 的 workflow_dispatch 觸發，需明確輸入 Source-Data commit；使用 production environment 與既有 Cloudflare versions upload／deploy、預覽驗證及回復流程。部署後核對線上 manifest 的 source.commit，再執行線上 browser smoke。PR／push 的 static-ci 只執行測試、fixture 建置與 smoke，不部署。此工作未觸發部署或 push。

