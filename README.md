# 黑潮繁體資料庫

以已核准的公開 JSON 建置繁體中文技能、天賦樹、武器與祝福網站。網站在 Cloudflare Workers Static Assets 執行，建置與部署由 GitHub Actions 完成。

## 在 GitHub 部署
1. 本 PR 合併至 main 後，開啟 Repository Settings → Secrets and variables → Actions。
2. 新增 Repository Secret，名稱為 `CLOUDFLARE_API_TOKEN`，值填入 Cloudflare Token。
3. 開啟 Actions → Static package CI and Cloudflare deployment → Run workflow，選 main。
4. 工作流建置、測試、驗證，部署預覽站，通過後發布正式站 `https://darktide.tw-syuan.com`。

新增或更新 Secret 本身不會觸發部署；首次設定後需手動 Run workflow。之後 main 更新會自動建置與部署。缺 Secret 時建置照常驗證，部署標示等候憑證。

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
