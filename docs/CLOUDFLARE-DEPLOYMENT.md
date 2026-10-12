# GitHub Actions 部署黑潮繁體資料庫

## 操作入口
整個建置與部署在 GitHub hosted runner 執行，使用 Node.js 24、固定 lockfile 與 Wrangler。使用者不需要安裝工具或在自己的電腦執行 PowerShell。

在本 PR 合併至 main 後：
1. 前往 [Repository Actions Secrets](https://github.com/SyuanTsai/DarkTide-Web/settings/secrets/actions)。
2. 選 New repository secret。
3. Name：`CLOUDFLARE_API_TOKEN`；Secret：貼入 Cloudflare Token。
4. 前往 [GitHub Actions](https://github.com/SyuanTsai/DarkTide-Web/actions)。
5. 選 `Static package CI and Cloudflare deployment` → Run workflow → main → Run workflow。

Token 存入 GitHub Secret，勿貼到對話、Issue、PR 或程式碼。Account ID 已固定，無需另外新增 Account ID Secret。
新增 Secret 不會自動觸發 workflow；首次設定後需 Run workflow。之後 main 的 push 自動執行。Run workflow 僅能從 main 正式部署。

## Cloudflare 目標
- 產品：Workers Static Assets，純靜態、Free。
- 帳號：`38d350980998e83d3f405aff0170921a`。
- 預覽 Worker：`darktide-zh-tw-preview`，使用帳號現有 workers.dev 子網域。
- 正式 Worker：`darktide-zh-tw`。
- 正式網址：`https://darktide.tw-syuan.com`。
- 不建立自訂後端、R2、KV、D1，也不變更 Nameserver 或 DNSSEC。

Token 需允許在指定帳號建立 Workers、部署兩個 Worker、讀取既有 deployment 及 workers.dev subdomain，並在 tw-syuan.com 管理 Custom Domain／Workers Routes。新權限模式首次建立需 Workers 產品層級 Admin，以及指定 zone 的 Workers Routes Write。worker與網域就緒後可再收窄日常部署權限。
若帳號 workers.dev 子網域尚未設定、Token權限不足或現有網域紀錄衝突，工作流會報出診斷並停止，不改動其他服務。

## 自動流程
1. PR／fork：無部署 secrets，執行測試、公開 JSON 正式建置、strict verify、Wrangler dry-run、Cloudflare 本機 runtime 與瀏覽器 smoke。
2. main／手動 main：同樣建置一次，保存完整已驗證 artifact。
3. 部署 job 下載同一 artifact，再驗證；不重建、不讀私人來源。
4. Token 未設定：摘要標示等待 Token，部署跳過。
5. 驗證 SHA 仍為 main 最新，避免舊任務覆蓋新版；部署 job 序列化。
6. 先部署預覽並驗首頁、深層路由、版本、三類 JSON、缺檔404、快取與可見署名。
7. 通過才部署相同產物至正式 Worker。Wrangler Custom Domain 設定建立網站對應 DNS 與憑證，再檢查正式 HTTPS。
8. 在 Actions artifacts 保存完整網站與不含 Token 的版本 receipt。憑證若仍待驗證而超過重試期限，稍後重跑工作流。

worker回復：正式部署／檢查失敗，有前版則透過 API 恢復之前完整 versions/percentage，receipt 記錄 api-accepted；是否實際恢復仍須線上驗證。首次沒有前版不虛構回復。Custom Domain／DNS 不會因 Worker版本回復而自動移除。

## 已知限制
網站為需要 JavaScript 的 SPA；首次原始 HTML 不含逐筆頁面內容／分享卡。圖示依核准外部來源載入。來源缺專屬圖示／額外機制與祝福等級可取得性仍依既有內容紀錄追蹤。

## 官方文件
- [GitHub Actions Secrets](https://docs.github.com/en/actions/security-for-github-actions/security-guides/using-secrets-in-github-actions)
- [Cloudflare GitHub Actions](https://developers.cloudflare.com/workers/ci-cd/external-cicd/github-actions/)
- [Workers 權限](https://developers.cloudflare.com/workers/authorization/workers/)
- [Custom Domains](https://developers.cloudflare.com/workers/configuration/routing/custom-domains/)
