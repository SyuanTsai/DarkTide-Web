# 公開 HTTPS 診斷計畫（2026-10-12）

- 目標與證據：兩個指定 Worker 的 Editor 部署成功，預覽 HTTPS 通過；正式網域的 version.json 在 GitHub 執行器回傳 403，本機則回傳 200。先辨識公開 HTTP 錯誤，無須 Cloudflare 登入。
- 修改：新增 .github/workflows/public-http-diagnostics.yml。僅手動或該工作流程的 PR 變更觸發，使用 contents: read；不使用 Secret、production environment 或任何部署 API。以部署相同的 Node fetch 讀取正式、預覽與正式 Worker 的公開 version.json。
- 診斷輸出：只記錄狀態、最終公開網址、允許的回應標頭、HTML 標題、可辨識的 Cloudflare 錯誤代碼／challenge 標記，或既有公開版本識別。省略完整 HTML、Cookie、challenge payload 與所有憑證。
- 驗證：YAML 與 Node 語法、工作流程權限／無 Secret／僅 GET 契約；在 PR 的 GitHub 執行器實際執行。設定變更豁免 TDD，以執行證據驗收。403 是診斷結果，不能被當成正式部署通過。
- 相容性與回復：不改既有部署或回復驗證，不變更網站、安全設定、Token、DNS。移除新增工作流程即可回復；正式站維持目前已回復版本。實際防護類型尚待此次回應確認，不能先推論為特定 WAF 規則。

## 實際 GitHub 執行結果

2026-10-12 17:05:20（臺灣時間）的唯讀診斷已完成：

- 正式 darktide.tw-syuan.com/version.json：403，server=cloudflare，cf-mitigated=challenge，content-type=text/html，頁面標題 Just a moment...；Ray ID a494f1368e81720b-SEA。
- 預覽 Worker version.json：200，資料版本 0ae547d78d49…（新文字）。
- 正式 Worker 的 workers.dev version.json：200，資料版本 5ac8fad1f619…（已回復舊版）。

證據：[GitHub 診斷 run 38227606834](https://github.com/SyuanTsai/DarkTide-Web/actions/runs/38227606834)。Cloudflare 官方文件確認 cf-mitigated: challenge 表示人機驗證頁：[Detect a Challenge Page response](https://developers.cloudflare.com/cloudflare-challenges/challenge-types/challenge-pages/detect-response/)。

結論：Token 已能部署兩個既有 Worker；目前失敗屬正式網域的公開 HTTPS 人機驗證。此回應不能分辨發出驗證的是哪項安全服務／規則，不能直接推論為 Bot Fight Mode、Under Attack Mode 或特定 WAF 規則。

不要求使用者讓 Codex 登入 Cloudflare。可由使用者自行查看該主機、路徑及時間的 Security Events，回報 Service 與規則名稱；再針對來源提出設定方案。未核對及授權前不改防護，不繞過 challenge，不把 403 或預覽成功當成正式站驗收通過。正式站仍維持已回復的舊版。
