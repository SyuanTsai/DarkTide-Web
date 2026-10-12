# 指定 Worker Editor 的部署驗證

現有網站日常部署所需的 Token 範圍為指定的 darktide-zh-tw 與 darktide-zh-tw-preview，角色為 Editor。初始 Worker 與 DNS／Custom Domain／workers.dev 連線必須已建立。

部署流程先驗證公開靜態成品與兩個 Worker 的 deployments 讀取權限，取得正式站原有流量版本組合；再執行 Wrangler versions upload，從結構化 version-upload 輸出核對精確 Worker 名稱與唯一 UUID，使用該 Worker 的 deployments API 發佈 100% 流量。先檢查預覽 HTTPS，再核對成品未變，最後發佈與核對正式 HTTPS。

此流程不呼叫帳號級 workers/subdomain、不重新設定網域連線，也不建立／刪除 Worker。預覽 URL 固定為已驗證的 https://darktide-zh-tw-preview.syuan-tsai.workers.dev；如果帳號子網域由使用者另行變更，需同步 PREVIEW_ORIGIN 與相應測試。

正式站失敗仍透過 deployments API 恢復原有完整版本比例。無效上傳輸出不進入流量發佈，預覽或其權限檢查失敗不會更新正式站。

## 本機驗證

- 全部測試：295 項通過。
- 新增指定 Worker 範圍／預覽權限檢查；上傳輸出的精確版本、空白／錯誤 JSON／錯誤 Worker／無效 UUID／重複版本檢查。
- 既有成品變更停止、正式站失敗恢復舊版本、缺少憑證不呼叫 API 的測試仍通過。
- 腳本語法、靜態成品及部署設定驗證通過。
- Wrangler 4.149.0 的兩份 versions upload --dry-run 均通過，未使用 Token 或對外部署。

## 實際交付證據

正式 GitHub Actions 需使用現有指定 Worker Editor Secret 完成發佈；以執行紀錄及 .deployment/last-deployment.json 確認 preview／production 的 verified 結果，並確認正式站 data_revision=0ae547d78d49… 與改寫文字。成功前不可宣稱已上線。

[Cloudflare Workers 角色與範圍](https://developers.cloudflare.com/workers/authorization/workers/) 說明 Editor 可以更新既有 Worker、版本與部署；變更連線和建立資源需另有對應權限。本流程限於既有網站版本更新。
