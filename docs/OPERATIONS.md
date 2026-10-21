# 正式站監控、備份與回復

維護者：此 Repo 的 owner／production environment 管理者。正式入口為 https://darktide.tw-syuan.com/，預覽為 https://darktide-zh-tw-preview.syuan-tsai.workers.dev/；正式 Worker 的直接入口為 https://darktide-zh-tw.syuan-tsai.workers.dev/。三者應提供同一 published build。純 Workers Static Assets，不需要私人來源、舊 IO、R2 或自寫 Worker 服務。

## 日常檢查與事件

[Static site operations monitor](https://github.com/SyuanTsai/DarkTide-Web/actions/workflows/operations-monitor.yml) 每小時 UTC 第 17、47 分執行；臺灣同為每小時第 17、47 分。也可在 main 手動 Run workflow。它從實際 version 選擇已保留的 GitHub Release manifest，核對三個 HTTPS 入口的版本／快取／初始署名／深層路由／JSON MIME／缺檔真實 404，以及固定清單內 version、catalog、三類代表 JSON、全部 JS/CSS、robots、sitemap 的 SHA-256。這是代表內容探測，非每半小時重新抓取全站所有資料，也非完整瀏覽器／外部圖片巡檢。

HTML 核對 build/data context 與直接 follow 署名，不把邊緣 HTML 當成逐位元組不變；Cloudflare 可能注入[動態安全腳本](https://developers.cloudflare.com/cloudflare-challenges/challenge-types/javascript-detections/)。原始 HTML 的精確雜湊仍在備份與完整還原驗證中。JSON／JS／CSS 等固定檔維持 SHA-256 比對。

失敗使 workflow 失敗，並開一張 bot 擁有的 `[Operations] Static site incident`；重複失敗沿用同一張，恢復後加實際成功 run 連結並關閉。事件、Actions run 與報告 artifact 都是處置入口。GitHub email／手機推播是否送達仍取決於使用者的通知設定，不能由事件建立推定。`alert_exercise=true` 只演練異常事件路徑，報告清楚標註受控演練，不改網站也不聲稱真實故障；下一次正常執行驗證恢復。

GitHub 排程可能延遲或漏執行；公開 Repo 連續 60 天無活動會停用排程，詳見[官方 schedule 限制](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#schedule)。維護者每週及每次收到事件時，查看最近一次成功 run 與排程是否 enabled；超過 90 分鐘無新 run 就手動執行並查 Actions 狀態。未提供即時 SLA，也沒有宣稱另有獨立第三方 on-call 通知。

| 症狀 | 處置 |
| --- | --- |
| TLS／DNS／無回應 | 比較三入口；只正式 hostname 失敗時查看 Custom Domain／TLS／zone 事件；三者皆失敗時先查 Cloudflare 狀態與目前部署。 |
| 403／challenge | 保存狀態碼與 Ray ID，由 owner 查 Security Events 的實際服務；不自行關防護、不擴 Token。 |
| version／hash／JSON／JS 不一致 | 保留報告與 current／previous 版本對照，執行下方精確備份還原；不可混用舊 HTML 與新資料。 |
| 找不到該 build 的備份 | 先查 static-ci 的 backup job。新部署與備份短暫交界可重跑；持續缺少備份是待處理的保存缺口，不標成網站內容毀損。 |
| 外部圖片／玩家內容異常 | 用實際瀏覽器和精確來源核對；保持 SYP-290 已接受的來源限制，不任意代換同名素材。 |

## 用量與錯誤

Cloudflare Dashboard → `darktide-zh-tw` Overview 已實查顯示：只有 Static Assets 的服務不提供 Worker Metrics；Logs／Traces 為 disabled。無資料不能當作零 invocation 或零錯誤。流量與 HTTP 錯誤使用 [tw-syuan.com Analytics → Requests](https://dash.cloudflare.com/38d350980998e83d3f405aff0170921a/tw-syuan.com/analytics/requests)，**Host equals darktide.tw-syuan.com**，查看最近 24 小時的 requests、data transfer、cache hit rate、status codes／5xx。不要把整個 zone 的其他服務算到本站，也不要把監控負向測試和掃描造成的 404 全算成服務故障。

維護者每週及事件發生時核對上述用量／錯誤趨勢；5xx 出現或流量／傳輸量相對正常基線突增時，檢查路徑、狀態碼和 Security Events，再決定處置。這是已存在、可實際操作的 Dashboard 檢查；沒有聲稱新增 Analytics API、自動用量告警或啟用 Worker Logs。機密流量細節與 Dashboard 截圖不放公開 Repo。

依 2026-10-21 核對的[官方 Static Assets 計費](https://developers.cloudflare.com/workers/static-assets/billing-and-limitations/)，靜態請求免費且不設數量上限；有 Worker 執行時才另依 Workers 計費。本服務沒有 `main`、`run_worker_first` 或儲存 binding。另按[官方平台上限](https://developers.cloudflare.com/workers/platform/limits/#static-assets)核對 Free 每版本 20,000 檔、單檔 25 MiB；每次發布以 `artifact-manifest.json` 取得實際檔數及最大檔，接近上限前處理，不能拿 Worker 每日 invocation 配額套用純靜態請求。

## 長期備份與版本對照

[Releases](https://github.com/SyuanTsai/DarkTide-Web/releases) 的 `site-<40位來源commit>-<原run>-<attempt>` 保存已驗證正式成品。部署成功後，static-ci 的 backup job 下載同一 artifact，strict verify 與 receipt 核對後發布，接著從 Release 真實下載至新目錄、完整還原，並以 source archive 重建相同 inventory。它沒有 Cloudflare Secret，也不部署。

每包包含 `static-site.tar.gz`（完整 2,287 檔基線，後續版本按 manifest）、`source.tar.gz`（精確公開 Git commit）、`artifact-manifest.json`（逐檔 path／size／SHA-256）、`deployment.json`（Worker versions／百分比）、`backup.json`（commit、build、data、game、published input hash、run 與 archive hashes）及 `SHA256SUMS`。只封裝嚴格 verified published 成品與既有公開來源，沒有私人遊戲原檔或 Secret。公開成品的 game_version 取自該包 version.json；不能把另一路 W01 的 source.lock 當成本站已升級的證據。

保存政策：Release 不設自動過期、不自動刪除，長期保留所有已發布包；最低不得少於目前版及前兩個完整正式版本，包含仍有明示歷史引用的版本。刪除另行審核／授權，保留來源 Git 歷史與永久對照索引。Actions 的成品 14 天、部署／監控回條 30 天只是短期診斷，不代替 Release。GitHub owner 仍能變更或刪除 Release；它不等於供應商保證的不可變儲存。可將六個已公開附件另下載至維護者自有備份，避免 GitHub 成為唯一存放處。

初始已保存、取回還原並逐檔重建的三版：

| 來源 commit／run | build_id | 正式 Worker version |
| --- | --- | --- |
| [61f1dcd / 39541306251](https://github.com/SyuanTsai/DarkTide-Web/releases/tag/site-61f1dcda6cb80fb1ee2bf595b3b9a082825a912f-39541306251-1) | `75a9a5bbb34153ef8d891a56401d3c457819b32482b54adf288419b7e51efff8` | `45770a28-fd27-445a-98e9-7d619764f3db` |
| [8a4b3db / 38228876589](https://github.com/SyuanTsai/DarkTide-Web/releases/tag/site-8a4b3db2b1e835f0757f387ca89a19b9092b35ee-38228876589-1) | `98034cf0847d344da1d43e9b08e8059fdbad1527a4cfd347b263c3a4958ed013` | `4b6e8e63-e2d2-4313-89b7-357685799999` |
| [8948651 / 38206216896](https://github.com/SyuanTsai/DarkTide-Web/releases/tag/site-8948651eb9e88b8514a172a4666fd8c47671499c-38206216896-1) | `611fa6b4d1b64e3fbcbb2c37d7007f0437f3754e74a39878b9a0d2d80496c11f` | `adca1132-587d-4801-a389-c2c5d12b6dcb` |

## 還原與回復

1. 到 [Restore retained static package](https://github.com/SyuanTsai/DarkTide-Web/actions/workflows/operations-restore.yml)，選 **main**，填精確 Release tag。先保持 `publish=false`。
2. 工作流取回六個附件，核 SHA256SUMS／archive hashes，拒絕越界路徑與 links，在全新 dist 解開完整包，strict verify，再實跑本機 Cloudflare runtime。預設不呼叫正式 API、不改 preview／production。結果在 restore report。
3. 需要真正回復時，先核准所選完整版本的內容與署名仍可用，再以相同 tag、`publish=true` 執行。工作流使用現有兩個 Worker 的 Editor Secret；沿用既有 preview → production → 公開 HTTPS 檢查和失敗自動回復，不重建成另一包，也不改 DNS／TLS／安全設定。此動作會以整組舊版取代目前版；只有需要處置故障或已有明確發布決定時才選。
4. 檢查實際 deployed versions 100%、三入口 version／內容 hashes 及必要署名。成功後原 Release 追加本次 recovery run ID 的部署回條與 hash，不覆寫原備份；失敗時保留 workflow 回條，API accepted 不代表 HTTPS 已回復。

Cloudflare 內仍保留所選舊 version 時，也能在 Deployments 將已核對版本設為 100%；操作後同樣核對公開 HTTPS 與固定清單。若 version 已被清除，使用上述完整備份重新上傳。歷史 [run 38223871853](https://github.com/SyuanTsai/DarkTide-Web/actions/runs/38223871853) 確有 `rolled-back` 回條，回到 `c12ff07d-3671-4925-818b-416fd37b9dea` 100%；其回條只記 `api-accepted`，不能單靠它宣稱獨立 HTTPS 回復通過。本期用新的離站備份取回／來源重建／隔離 runtime 補足獨立還原證據，不為演練任意切正式站。

離線亦可下載六附件後執行 `node scripts/operations-restore.mjs --backup <下載目錄> --output <全新站點目錄> --source-output <全新來源目錄>`；要重建時，用來源目錄自己的 `scripts/build.mjs --site-origin https://darktide.tw-syuan.com`。對照完整 manifest，不只對照檔案數。所有輸出目錄須不存在；工具不刪舊資料。Windows source archive 明確使用 `git -c core.autocrlf=false archive`，避免個人換行設定改變來源 bytes。

SYP-290 的 SPA／分享卡、來源內容與等級可取得性限制維持原驗收。本手冊不宣告 SYP-311／PR #11 完成，也不授權 SYP-292 舊 IO 清理。
