# 公開 HTTPS 診斷計畫（2026-10-12）

- 目標與證據：兩個指定 Worker 的 Editor 部署成功，預覽 HTTPS 通過；正式網域的 version.json 在 GitHub 執行器回傳 403，本機則回傳 200。先辨識公開 HTTP 錯誤，無須 Cloudflare 登入。
- 修改：新增 .github/workflows/public-http-diagnostics.yml。僅手動或該工作流程的 PR 變更觸發，使用 contents: read；不使用 Secret、production environment 或任何部署 API。以部署相同的 Node fetch 讀取正式、預覽與正式 Worker 的公開 version.json。
- 診斷輸出：只記錄狀態、最終公開網址、允許的回應標頭、HTML 標題、可辨識的 Cloudflare 錯誤代碼／challenge 標記，或既有公開版本識別。省略完整 HTML、Cookie、challenge payload 與所有憑證。
- 驗證：YAML 與 Node 語法、工作流程權限／無 Secret／僅 GET 契約；在 PR 的 GitHub 執行器實際執行。設定變更豁免 TDD，以執行證據驗收。403 是診斷結果，不能被當成正式部署通過。
- 相容性與回復：不改既有部署或回復驗證，不變更網站、安全設定、Token、DNS。移除新增工作流程即可回復；正式站維持目前已回復版本。實際防護類型尚待此次回應確認，不能先推論為特定 WAF 規則。
