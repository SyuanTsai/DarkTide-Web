# 部署修正計畫：僅使用指定 Worker 的 Editor（2026-10-12）

## 目標、證據與範圍

兩個既有 Worker（darktide-zh-tw／darktide-zh-tw-preview）的 Editor Token 應能完成 GitHub Actions 部署。使用者已確認資源範圍涵蓋兩者；新 Token 的兩次實際部署在帳號級 GET workers/subdomain 收到 403，而指定正式 Worker 的 deployments 查詢已通過。

不增加 Token 權限，不建立／刪除 Worker，不變更 DNS、Custom Domain 或 workers.dev 連線。保留純靜態成品、預覽先行、正式站 HTTPS 核對與完整舊版本回復。

## 修改

- src/deploy/cloudflare.mjs：將預覽網址固定為既有、已驗證的 darktide-zh-tw-preview.syuan-tsai.workers.dev，停止查詢帳號級子網域。上傳前分別查詢兩個指定 Worker 的 deployments，權限不足仍停止。
- scripts/cloudflare-deploy.mjs：使用已鎖定 Wrangler 4.149.0 的 versions upload 上傳版本（支援純 Static Assets），讀取結構化 version-upload 輸出，核對 Worker 名稱與唯一 UUID，然後以該 Worker 的 deployments API 配置 100% 流量。不用會重新同步連線的 wrangler deploy。
- 版本解析先驗證再發佈，拒絕空、錯誤 JSON、其他 Worker、多個上傳版本或無效 UUID。輸出只存放既有忽略的 .deployment 目錄；不保存或顯示 Token。
- 既有 Custom Domain／workers.dev 連線保持已設定狀態；首次建立環境需要另外由具建立權限的使用者完成，不以窄範圍 Token 建立資源。

## 測試與驗收

先新增「指定 Worker Editor 可部署，帳號查詢拒絕時仍不被呼叫」單元測試重現失敗，再實作。新增結構化版本 ID 的正常／空值／錯誤 Worker／重複／無效 UUID 測試，以及預覽 Worker 無權限時不上傳測試。維持預覽失敗、成品變更、正式失敗回復舊版本、憑證不外洩的既有測試。

跑完整 npm test、靜態建置與部署設定驗證；以 Wrangler versions upload --dry-run 確認兩份設定支援純靜態版本上傳。PR CI 與審查通過後，仍由 GitHub Actions 使用現有 Secret 發佈，不從本機讀取 Secret。

## 相容性、回復與上線核對

公開網站、資料契約、成品內容及 Token 保持不變。改變的是部署方式，不再重設已存在的連線。正式站出錯仍由現有 deployments API 恢復先前完整流量比例；版本上傳失敗不發佈，預覽失敗不碰正式站。若工具或 API 對窄範圍 Token 仍不相容，保留舊正式站並回報實際端點，不自動要求 Admin。

成功訊號為此次 GitHub Actions 部署紀錄 verified，預覽與正式站均讀到 data_revision=0ae547d78d49…；再核對掌擊祝福與連續射擊新文字。只更新既有兩個 Worker 的假設已由先前成功部署與使用者確認支持。
