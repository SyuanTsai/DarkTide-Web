# SYP-291：正式站運維交接計畫

## 1. 目的與界線

正式站已由 SYP-290 驗收上線。以 main `61f1dcda6cb80fb1ee2bf595b3b9a082825a912f` 為基準，補足可持續監控、Cloudflare 之外的完整成品備份與獨立還原。沿用純 Workers Static Assets、已接受的 SPA／內容限制及 Games Lantern 署名，不修改網站內容、DNS、防護、Token 或 PR #11。SYP-292 不在本次範圍。

驗收：正式與預覽 HTTPS／版本／雜湊內容檢查實跑；自動排程與失敗處置可查；非短期 artifact 的公開備份包含完整成品、精確公開來源、逐檔雜湊與部署對照；從備份取回至隔離目錄驗證並實際提供內容。未取得的儀表板數據或通知結果明列未驗證。

## 2. 最小變更

- `src/operations/`、`scripts/operations-*.mjs`：沿用 `verifyStaticPackage` 與 `verifyOrigin`，對已核准的 published 成品製作備份；監控另比對固定備份清單內的 version、catalog、各類代表 JSON、全部 JS/CSS、robots/sitemap。HTML 200 不構成內容通過。備份只從嚴格成品清單及精確公開 Git commit 打包。
- `.github/workflows/static-ci.yml`：部署已驗證成功後，另一個無 Cloudflare Secret 的 job 保存相同 artifact 至 GitHub Release。Release 含 source archive、完整 static archive、manifest、部署回條、SHA256SUMS 與 provenance；重跑不得覆寫不同 bytes。
- `.github/workflows/operations-monitor.yml`：每半小時及手動檢查正式／預覽。使用 GitHub Release 的固定 manifest 驗證；保存報告、失敗使 workflow 失敗，GitHub Actions 原生通知與操作手冊提供處置。排程可能延誤／60 日無活動停用的限制明示。通知送達須另有證據，不由設定推定。
- `.github/workflows/operations-restore.yml`：main 手動選精確 Release，預設只在隔離 runtime 還原驗證；明確 `publish=true` 才復用既有 preview→production 發布流程。監控以單一 bot 事件記錄異常／恢復。實際探測確認 Cloudflare 會轉址 index.html 並注入動態安全腳本，因此線上 HTML 改核 build/data context 與直接 follow 署名；固定 JSON／JS／CSS 仍逐位元組比對，封存／還原仍驗完整 HTML 雜湊，不改防護。
- 運維手冊與本輪證據索引：用量／錯誤查看入口、檢查頻率、故障分類、備份保留、精確回復與完整還原步驟。正式版本不為演練任意切換。

## 3. 測試情境

- UnitT10：備份只接受 verified 且與成品 build/data 相符的部署回條；fixture／損毀檔／不同版拒絕，不能產出成功備份。
- UnitT20：HTTP 200 但 JSON 位元組改變、HTML fallback、錯版本、404 失真皆失敗；健康來源通過。
- InterT30：備份封裝後在新目錄解開，核 archive SHA、完整 manifest／strict verify，來源 archive 可自行重建同一 build，然後本機 Cloudflare runtime 提供同版內容與署名。
- 新邏輯先最小 Red→Green，再重構；YAML 配置依 Testing 規則免 test-first，但檢查語法、權限／事件 guard、實際 PR／main workflow。

## 4. 交付與回復

先最小測試與 syntax／contract，再沿既有完整 CI。從原已驗收 run 39541306251 取得備份並實際取回還原；引用歷史真實 rollback 的精確 run／版本並核對目前保留資料。新 CI 變更先經 PR 驗證，再依授權啟用；不得把未合併配置稱為已運作。GitHub Release 長期保留，不自動淘汰，最少保留目前及前兩個完整正式成品，刪除須另有明確決定。CI 檢查失敗不影響目前線上版本；必要時回退本次運維 commit，原已驗收網站與備份仍可用。

## 5. 風險與待核對

Cloudflare Dashboard 目前需登入，未讀到實際用量；不擴張 Editor Token。GitHub 排程不是即時／高可用 SLA，Actions 與備份同在 GitHub，另可將已公開 release 下載至獨立儲存。既有 W01 的隔離 preview 保留與 PR #11 不等於本正式站已交付。以本次實際證據決定可完成項，不預先結案。
