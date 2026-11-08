# SYP-388 直接 Source-Data 建置驗收

日期：2026-11-06。依 spec1／spec2 完成七段實作與分段 commit，未 push、未部署。舊 W09／compose／overlay／proposal／W12 程式保留。

## 資料與路徑契約

- 每版各有 /data/<dataRevision>/manifest.json（schemaVersion 3.0.0），保留 gameVersion、dataRevision、files 的 kind/path/sizeBytes/sha256/dependencies。
- source 為 repository、commit、dataSchemaVersion、textBatch；不含 W02／W09 專屬 release receipt 等欄位。
- dataRevision 是移除自身欄位後的 manifest 兩格縮排 JSON 加 LF 的 SHA-256；同輸入完整 dist byte 相同。
- /version.json 使用 schema_version 3，game_releases 每筆保留 game_version、data_revision、manifest_path、manifest_sha256。
- 詳情分檔的 item 與 Source-Data 深度相等；index 只存清單所需欄位。武器依 family；祝福依既有 W08 每筆一個 shard。瀏覽器依路由及選定 family／祝福載入需要的分檔。
- 單檔 16 MiB，來自 scripts/content/contract-release.mjs 的 MAX_DOMAIN_BYTES；manifest 保留既有瀏覽器 256 KiB 上限，超限在建置時拒絕。
- /source-data/current.json 原樣複製；current.versions 每版四類依下述 transport manifest 提供原始 bytes，current 採 no-cache, must-revalidate，版本目錄採一年 immutable。
- JSON 使用 application/json; charset=utf-8，.bin 使用 application/octet-stream；均回傳 Access-Control-Allow-Origin: *、Access-Control-Allow-Methods: GET, HEAD。本機 server 拒絕 POST。
- 1.13.1 history 的兩份公開固定檔維持原位元組；1.13.4 凍結 game-changes 的 SHA-256 為 2569ddfeb2b8e1250a69869163a66f132776569e64558ab8ff8806f6cb66bc5c，已核對線上 manifest。

## 公告比對

Web 直接讀取 W15 announcement-candidate.json 的 5 筆及 official-announcements/20261030/announcements.json 的 3 筆。與既有 proposal 00df56f240b76463ff8e29c80d17009ae7c2e67b120711715fca575b6ee4b045 的公告分檔深度比對：8 筆 ID、scope、title、publishedOn、revision、source、blocks、assets 全部一致；差異 0。不經 compose。

## 驗證結果

| 指令或驗證 | 結果 |
| --- | --- |
| node --test test/wp5-*.test.mjs | 17／17 通過 |
| node --test test/wp5-*.test.mjs test/static-build.test.mjs test/cloudflare-deploy.test.mjs | 47／47 通過 |
| npm run build:fixture | 通過，48 個檔案 |
| npm run smoke:browser | 通過，使用本機既有 Chrome，未下載瀏覽器 |
| node scripts/verify-static.mjs dist | 通過 |
| node scripts/verify-deploy-config.mjs | 通過 |
| 既有 W12／W13 公告／W14 history／W15 瀏覽器整合測試 | 11／11 通過，使用 SYP_W10_CHROMIUM_EXE 指向既有 Chrome |
| Source-Data 1396e47 原始 pipeline/validate.mjs --root <fixture> | OK；使用允許的暫存 worktree，完成後已移除 |
| Cloudflare 本機 runtime smoke | 通過；使用暫存 Git fixture 的 published 測試產物，未呼叫部署。完成後 dist 重建回 fixture |
| npm test（本機 Chrome 與 Windows 原生 tar） | 887 項：858 通過、11 失敗、18 既有 skip；詳見下列清單 |

本輪新測試沒有 skip。未刪除或跳過舊測試；受新版 fixture 影響的 static CLI 測試已更新並通過。專案相依套件由 npm ci --offline --ignore-scripts 安裝，未下載第三方程式。較早的完整測試因缺 Playwright 套件／瀏覽器等環境問題失敗；補齊離線套件並使用本機 Chrome 後，舊瀏覽器測試已通過。另一次繼承 Git 長路徑設定的完整診斷，在原有 contract-w09-release 測試超過約 15 分鐘仍持續運算，已停止其程序樹；不以該未完成診斷宣稱測試通過。

## 完整測試尚存的舊流程／環境失敗

這些測試及其固定來源資料未在本輪修改（git diff 67f2744 的對應舊來源路徑為空），未改寫資料鎖或放寬斷言。最後完整重跑失敗清單：

- test/contract-w09-release.test.mjs — InterT13_missing-selected-composition-is-pending-without-allocation-or-package-write：隔離 clone 遇到既有深層檔名超過 Windows Git 長路徑限制。
- test/contract-w09-release.test.mjs — InterT14_formal-source-replay-prepares-a-candidate-package-and-reuses-its-nested-files：隔離 clone 遇到既有深層檔名超過 Windows Git 長路徑限制。
- test/contract-w14-ledger.test.mjs — UnitT17_generated-registry-report-is-row-bound-and-not-an-availability-claim：既有 W03 shard／mapping ledger 與 W14 固定索引的驗證失敗。
- test/contract-w14-ledger.test.mjs — UnitT140_only_fixed_current_web_announcement_rows_may_be_deferred_to_w15：既有 W03 shard／mapping ledger 與 W14 固定索引的驗證失敗。
- test/contract-w14-ledger.test.mjs — UnitT170_mods_walker_uses_one_w03_root_for_index_and_shard_paths：既有 W03 shard／mapping ledger 與 W14 固定索引的驗證失敗。
- test/contract-w14-ledger.test.mjs — UnitT195_web_presentation_owner_identity_stays_distinct_from_its_source_entity_ref：既有 W03 shard／mapping ledger 與 W14 固定索引的驗證失敗。
- test/contracts-archive.test.mjs — UnitT10_pack-creates-digest-bound-manifest-from-fixed-commit：Windows 原生 tar 不支援舊封存流程使用的 --force-local；原預設 GNU tar 則使 operations 備份流程誤判 C: 為遠端位置。
- test/contracts-archive.test.mjs — UnitT20_restore-verifies-download-and-files-before-writing-target：Windows 原生 tar 不支援舊封存流程使用的 --force-local；原預設 GNU tar 則使 operations 備份流程誤判 C: 為遠端位置。
- test/w13-ranged-authoring.test.mjs — UnitT10_w13-ranged-candidate-preserves-approved-w07-receipts-and-validates-new-review-state：既有 authoring.json 位元組與 lock 不一致。
- test/w13-ranged-preview.test.mjs — UnitT24_w13-ranged-preview-uses-pinned-historical-w09-selection-snapshot：既有 cached selected W09 snapshot 與歷史 pin 不一致。
- test/w17-official-name-provenance.test.mjs — UnitT40_renders_the_three_scoped_names_from_the_digest_checked_d8d_candidate：既有 announcements.json 為 931285 bytes，固定 candidate manifest 預期 911542 bytes。

正式 workflow 的 npm test gate 保留，因此舊測試失敗仍會阻擋部署。未觸發遠端 Actions，亦未對實際 WP8 正式資料執行部署。

## 顯示與相容性限制

必需的五節、官方原文／勘誤、unknown、glossary 標示、LV1–4、family／mark、職業／tree／parents／nodeType、術語分類均已對應。空節不顯示，unknown 不以 null 呈現。params 的鍵名及未列入單位對照的 unit 仍使用來源識別字；未額外建立 icon、context、refs 或 aliases 的專用互動頁面，這些欄位仍完整保存在 item 與原樣來源檔。本輪未使用真實 WP8 正式版輸入，驗證以兩版本合格 fixture 為依據。

回復方式：新舊入口並存，可回復本輪 commits 恢復原建置；Source-Data 原始 repo 與已凍結歷史檔無需修改。遠端部署沿用既有 preview-first、versions upload／deploy 與失敗回復流程，部署後另核對線上 source.commit。

## 新增／修改檔案完整清單

- .gitattributes
- .github/workflows/deploy.yml
- .github/workflows/static-ci.yml
- README.md
- content/history/1.13.4/README.md
- content/history/1.13.4/game-changes.json
- docs/CLOUDFLARE-DEPLOYMENT.md
- scripts/browser-smoke.mjs
- scripts/build.mjs
- scripts/cloudflare-runtime-smoke.mjs
- scripts/serve.mjs
- scripts/shared-browser-smoke.mjs
- scripts/source-browser-smoke.mjs
- src/build/announcements.mjs
- src/build/build.mjs
- src/build/game-changes.mjs
- src/build/headers.mjs
- src/build/site-data.mjs
- src/build/source-data.mjs
- src/build/verify.mjs
- src/deploy/cloudflare.mjs
- src/static/verify.mjs
- test/fixtures/source-data/data/9.9.1/blessings.json
- test/fixtures/source-data/data/9.9.1/skills.json
- test/fixtures/source-data/data/9.9.1/terms.json
- test/fixtures/source-data/data/9.9.1/weapons.json
- test/fixtures/source-data/data/9.9.2/blessings.json
- test/fixtures/source-data/data/9.9.2/skills.json
- test/fixtures/source-data/data/9.9.2/terms.json
- test/fixtures/source-data/data/9.9.2/weapons.json
- test/fixtures/source-data/data/current.json
- test/fixtures/source-data/pipeline/state.json
- test/static-build.test.mjs
- test/wp5-announcements.test.mjs
- test/wp5-build.test.mjs
- test/wp5-client.test.mjs
- test/wp5-deploy.test.mjs
- test/wp5-display.test.mjs
- test/wp5-game-changes.test.mjs
- test/wp5-site-data.test.mjs
- test/wp5-source-data.test.mjs
- test/wp5-workflow.test.mjs
- web/app.mjs
- web/shared-client.mjs
- web/shared-render.mjs
- web/shared-view.mjs
- web/source-client.mjs
- web/style.css
- docs/contracts/wp5-source-data-acceptance.md


`/source-data/<version>/<category>.manifest.json` describes the immutable raw-byte transport (`transportSchemaVersion` 1.0.0): total byte length and SHA-256, and ordered parts with index, relative path, offset, length and SHA-256. At most 20 MiB uses the original JSON as a single part. Above 20 MiB, raw bytes are split into 20 MiB `.part-NNNN.bin` files; the original JSON is also provided through 25 MiB. Above 25 MiB the original JSON is unavailable (404), so older extensions must upgrade before the Web release. Reassemble bytes before decoding. JSON manifests use `application/json; charset=utf-8`, binary parts use `application/octet-stream`; both retain CORS GET/HEAD and immutable caching. `current.json` remains byte-identical and no-cache. Missing files return 404. Deploy Extension support first.
