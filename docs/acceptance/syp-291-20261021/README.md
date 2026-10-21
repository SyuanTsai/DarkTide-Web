# SYP-291 運維交付與證據（2026-10-21）

正式站已由 SYP-290 驗收上線。本次補持續監控、Cloudflare 外完整發布備份、來源重建及獨立還原。操作入口見 [運維手冊](../../OPERATIONS.md)。合併前已完成的實查如下；main 啟用、CI、排程與事件演練的最終 run 及狀態記錄在 [SYP-291 最新交付段落](https://syuantsai.atlassian.net/browse/SYP-291)，不能把本檔的規劃或待執行步驟當作成功證據。

| 實查 | 證據與結果 |
| --- | --- |
| 離站備份 | [published-backups.json](published-backups.json)：三個已正式發布版本各六個 GitHub Release 附件，含來源 commit、build/data/game、public input hash、逐檔 manifest、archive hashes 及 Worker versions。來源只取已公開 Git commit／已核准 static artifact。 |
| 真實取回與來源重建 | [remote-restore.json](remote-restore.json)：三版均從 GitHub Release 重新下載，驗 archive hashes、完整還原，並由各自公開 source archive 重建；每版 2,287 檔的整份 manifest bytes 完全一致。不需 Private／Mods／舊 IO checkout。 |
| 隔離 runtime | [isolated-restore.json](isolated-restore.json)：目前版從遠端備份還原至全新 dist；`npm run smoke:cloudflare` 在本機 Cloudflare runtime 通過深層路由、JSON、快取、署名及缺檔 404。未切換正式站。 |
| 公開內容探測 | [public-monitor.json](public-monitor.json)：正式、預覽及正式 workers.dev 三入口均 healthy，每站 10 個固定檔 hash checks，另核初始 build/data context、follow 署名、路由、MIME／快取與 404。HTML 的動態安全注入與 immutable 檔案雜湊分列，不聲稱邊緣 HTML 與原始成品完全相同。 |
| DNS／TLS | [tls-dns.json](tls-dns.json)：正式 hostname 直接 DNS 與可信 TLSv1.3 握手成功，SAN 含正式 hostname，證書有效至 2027-01-10 UTC。沒有修改 DNS／TLS。 |
| 歷史真實回復 | [historical-rollback-api-receipt.json](historical-rollback-api-receipt.json)：原 run 38223871853 實際回復 `c12ff07d-3671-4925-818b-416fd37b9dea` 100%，回條只記 api-accepted。這是實際 API 回復證據，不能單獨當作公開 HTTPS 回復成功；新的遠端備份還原與 runtime 證據另列。 |
| 用量／錯誤 | 已登入 Dashboard 唯讀核對正式 Worker 與 Host=darktide.tw-syuan.com 的 Analytics。Worker 明示 static-only 不提供 Metrics，Logs／Traces disabled；不把無資料當零錯誤。實際流量統計及截圖留在授權 Jira／本機證據，未公開。每週／事件時的具體檢查方法在運維手冊。 |

新邏輯的專項測試為 `node --test test/operations.test.mjs test/operations-workflow.test.mjs`：10 Pass／0 Fail／0 Skip，含 verified receipt、錯版／credential extras 拒絕、真實 Git/tar roundtrip、篡改前置拒絕、Windows autocrlf、HTML 轉址／動態注入、nofollow、JSON 改 byte、HTML fallback、真實 404，以及 CI 權限／手動回復預設不部署。初次缺模組、Windows 封存換行與 index canonical 探測均實際失敗後修正；未將失敗或第一次解壓成功計為完成。既有完整 suite 曾跑 492 Pass／0 Fail／15 既有 W01 外部依賴 Skip；最終完整結果由本 PR 的自然 CI 核對，Skip 不計通過。

針對最終 diff 的自審未發現仍未處理的 correctness／credential boundary 問題。保留限制：GitHub 排程可延遲／60 日無活動停用；通知 email 送達未實測；用量檢查為已有 Dashboard 的人工運維步驟；監控不是全站逐檔／外部圖片／真瀏覽器巡檢；GitHub owner 仍可刪改 Release。完整原始包的 hash 與還原驗證不因此放寬。

網站原 production code／內容與 1.13.1 基線未修改。SYP-290 已接受限制維持；PR #11／W01 preview 不當作本期正式成果，不合併其他對話 PR，不清理舊 IO，不變更 CF Token、DNS 或防護，不記工時。
