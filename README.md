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
- 遊戲資料基線為 1.13.1；神聖工具單筆另附 1.13.2 原始碼查核，不代表整站升版或遊戲內實測。

## 開發
需要 Node.js 24。公開模型只保存在 `content/published/content.json`，不包含私人來源 checkout 或原始素材包。
```sh
npm ci
npx playwright install chromium
npm test
npm run prepare:deploy
```
此流程只建置與驗證，不需要部署 Token，也不建立 Cloudflare 資源。
`npm run serve:static -- 8087` 可在本機預覽。
