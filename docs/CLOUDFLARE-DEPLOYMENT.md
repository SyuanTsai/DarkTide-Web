# GitHub Actions 部署黑潮繁體資料庫

## 操作入口
整個建置與部署在 GitHub hosted runner 執行，使用 Node.js 24、固定 lockfile 與 Wrangler。使用者不需要安裝工具或在自己的電腦執行 PowerShell。

在本 PR 合併至 main 後：
1. 前往 [Repository Actions Secrets](https://github.com/SyuanTsai/DarkTide-Web/settings/secrets/actions)。
2. 選 New repository secret。
3. Name：`CLOUDFLARE_API_TOKEN`；Secret：貼入 Cloudflare Token。
4. 前往 [GitHub Actions](https://github.com/SyuanTsai/DarkTide-Web/actions)。
5. 選 `Deploy pinned Source-Data to Cloudflare` → Run workflow → main，填入 `source_data_commit`（40 碼小寫 SHA）→ Run workflow。

Token 存入 GitHub Secret，勿貼到對話、Issue、PR 或程式碼。Account ID 已固定，無需另外新增 Account ID Secret。
新增 Secret 與 main push 不會自動觸發部署；正式部署只接受 workflow_dispatch，並使用 production environment 的保護設定。

## Cloudflare 目標
- 產品：Workers Static Assets，純靜態、Free。
- 帳號：`38d350980998e83d3f405aff0170921a`。
- 預覽 Worker：`darktide-zh-tw-preview`，使用帳號現有 workers.dev 子網域。
- 正式 Worker：`darktide-zh-tw`。
- 正式網址：`https://darktide.tw-syuan.com`。
- 不建立自訂後端、R2、KV、D1，也不變更 Nameserver 或 DNSSEC。

日常更新只需要指定 darktide-zh-tw 與 darktide-zh-tw-preview 的 Editor。此工作流程要求兩個 Worker 與其連線已存在，使用 versions upload 與指定 Worker 的 deployments API 更新版本，不查詢帳號級子網域，也不重新設定 Custom Domain。初始建立另需由具 Workers 產品層級 Admin 與指定 zone 的 Workers Routes Write 權限者完成；詳細流程見 [指定 Worker Editor 部署](WORKER-EDITOR-DEPLOYMENT.md)。
若帳號 workers.dev 子網域尚未設定、Token權限不足或現有網域紀錄衝突，工作流會報出診斷並停止，不改動其他服務。

## 自動流程
1. PR／push：static-ci 執行測試、Source-Data fixture 建置與瀏覽器 smoke，不部署。
2. 手動部署：先驗證輸入 SHA，再 checkout Web 與 Source-Data 指定 commit；兩者皆不保留 Git credentials。
3. Windows runner 使用 Node 24、`npm ci` 與 Chromium，執行 `npm test`。
4. 建置前確認 Source-Data HEAD 與輸入相同，執行來源 validator 與 Web 驗證。缺 current.json 或資料無效即失敗，不進入部署。
5. 以正式 origin 建置，再驗證產物及 browser smoke。Token 未設定時既有 credential 檢查中止部署。`darktide-cloudflare-production` 序列化正式部署，不取消進行中工作。
6. 先部署預覽並驗路由、版本、所有 manifest／分檔、`/source-data/` 位元組、CORS、快取、缺檔 404 與署名。
7. 通過才將同一產物發佈至正式 Worker，保留既有 Custom Domain、DNS 與憑證連線。
8. 部署後在線上 origin 執行 runtime 與 browser smoke，核對 manifest.source.commit 等於輸入 SHA。receipt 在工作目錄 `.deployment/` 產生。

worker回復：正式部署／檢查失敗，有前版則透過 API 恢復之前完整 versions/percentage，receipt 記錄 api-accepted；是否實際恢復仍須線上驗證。首次沒有前版不虛構回復。Custom Domain／DNS 不會因 Worker版本回復而自動移除。

## 已知限制
網站為需要 JavaScript 的 SPA；首次原始 HTML 不含逐筆頁面內容／分享卡。圖示依核准外部來源載入。來源缺專屬圖示／額外機制與祝福等級可取得性仍依既有內容紀錄追蹤。

## 官方文件
- [GitHub Actions Secrets](https://docs.github.com/en/actions/security-for-github-actions/security-guides/using-secrets-in-github-actions)
- [Cloudflare GitHub Actions](https://developers.cloudflare.com/workers/ci-cd/external-cicd/github-actions/)
- [Workers 權限](https://developers.cloudflare.com/workers/authorization/workers/)
- [Custom Domains](https://developers.cloudflare.com/workers/configuration/routing/custom-domains/)


`/source-data/<version>/<category>.manifest.json` describes the immutable raw-byte transport (`transportSchemaVersion` 1.0.0): total byte length and SHA-256, and ordered parts with index, relative path, offset, length and SHA-256. At most 20 MiB uses the original JSON as a single part. Above 20 MiB, raw bytes are split into 20 MiB `.part-NNNN.bin` files; the original JSON is also provided through 25 MiB. Above 25 MiB the original JSON is unavailable (404), so older extensions must upgrade before the Web release. Reassemble bytes before decoding. JSON manifests use `application/json; charset=utf-8`, binary parts use `application/octet-stream`; both retain CORS GET/HEAD and immutable caching. `current.json` remains byte-identical and no-cache. Missing files return 404. Deploy Extension support first.
