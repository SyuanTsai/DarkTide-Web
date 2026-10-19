# W07 r5／F20：逐欄摘要與所綁欄位的審核相依

本報告所在 Web commit 是 r5 固定版本；修前為 `c87a4a833fc872affe8bbc8657cc39a5090ea775`。Source 維持 `f5514e4361d09361d9621e885082b7b5c51d1c95`。W07 仍待人類驗收、SYP-339 進行中，W06 SYP-338 維持 Done。停 W07，不進 W08、不合併或正式發布、不清理 Mods。

## 問題與最小修補

Root 先用固定 c87 版本獨立重現：同一合法 Source game-change 已含 A／B 兩個 changedFields，Web 對 `/fieldSummaries/0/summary` 建立 approved 合成 receipt，再只將摘要的 `field` 從 A 改到 B，文字、targetId、fieldPath、Source 都不變。validator 仍 valid，但 targetDigest／dependenciesDigest 皆未變，舊審核錯誤維持 approved。

Luna 先加入 UnitT75，取得真正的 approved／stale Red，再只在 `computeReviewDigests` 的精確 game-change per-field summary scope 加入 `{ kind: 'game-change-field-summary-binding', field }` dependency。摘要文字的 targetDigest 與原 Source dependencies 不變；whole collection 與其他 scopes 不新增依賴。缺少 field identity 直接拒絕，未擴大合法 path 或寫入 receipt。

## 獨立覆核與相容性

Root 透過公開 validator／createReviewReceipt／computeReviewDigests／getReviewState 驗證：

| 變動 | 本欄 | 相鄰欄 | game summary／無關 presentation |
| --- | --- | --- | --- |
| 同欄同文 | approved | approved | approved |
| 本欄改綁或改摘要文字 | stale | approved | approved |
| 相鄰欄改綁或改文字 | approved | stale | approved |
| 相同摘要文字跨欄交換 field，或反轉陣列 | stale | stale | approved |

whole collection 的改綁仍 stale；未知／缺失 field 仍被 validator 拒絕。所有正例先確認 Source 與 Web 合成副本均 valid，再比對行為；真內容與 receipts 未寫入。

**局部 digest 相容性：** 用精確 c87 舊算法產生的 per-field receipt，在新算法即使同文同欄也會 stale，因舊 receipt 沒有證明欄位綁定。原 receipt 原樣保留，不重簽、不自動批准；摘要 targetDigest 相同、dependency digest 有意變動。重新具名人工審核才能取得有效新 receipt。

目前真 authoring 沒有 per-field targets，因此既有 fixture 41／W06 34／W07 38，共 113 個 targets 的定義、兩 digest 與狀態完全相同；以修前 digest 建立的記憶體合成 receipts 全相容。真 receipts 仍 0，publicationEligible=false。fixture、Source、pins、locks、raw cache、文字／mechanics／官方輸入完全未改。

## 驗證與沿用證據

- Luna Red→Green：新增 UnitT75 先 approved／stale 失敗，最小修補後通過；authoring 21／W06 22／W07 12／release 6 全過。
- Root 受影響回歸：`node --test --test-reporter=tap test/contract-authoring.test.mjs test/contract-w06.test.mjs test/contract-w07.test.mjs test/contract-release.test.mjs test/contract-w03-mods.test.mjs test/contract-w03-ledger.test.mjs test/w01-preview-deploy-scope.test.mjs`，99 Pass／0 Fail／0 Skip。
- Root 獨立六類變動與相容性 probe 通過，缺失／未知 field、whole collection、舊算法 receipt 局部失效均有實證。14 份 r1–r4 候選及 19 份歷史保護產物保持。
- Source 56 tracked 檔與 commit 不變，沿用 f551 的 Source-only clean clone／push／PR CI 各113／0／0。F12–F19、W01–W06 與無影響的 Google／UI／POC 證據沿用。
- 固定 Web commit 的 Web-only depth1/autocrlf clean clone、離線兩次重建、writer 保護、實際部署分類、遠端 CI logs 與既有15個 Skip 名稱，最終結果見 [SYP-339 本輪交付留言](https://syuantsai.atlassian.net/browse/SYP-339)，須核對其中完整 head SHA。

## 候選、驗收與只回復本輪

沿用 [W06 r4 候選](../w06/candidate-r4/review-candidate.md)／[矩陣](../w06/candidate-r4/review-matrix.json)、[W07 r4 候選](candidate-r4/review-candidate.md)／[矩陣](candidate-r4/review-matrix.json)。本次真資料與輸出內容未變，不建立重複 r5 候選。四 SHA-256 分別為：

- W06 MD：`163b955ddbfeff2b291fbb25a6facd5db786b20c8eacffb9cc0d9676014682cc`；JSON：`4aecf29e90d5677f21d51469848c96e013c0a728b5007c6ef0ee8f334d7a25e3`。
- W07 MD：`6705e22ae0db39ded17515e01831c76c943c7c957fa0f7e6528b1299233c8cf9`；JSON：`b6d23c0c9c9f1fc07a3e2acd44fd0b66f0317ef3f74cb49e13f5e3ddb6cbbb86`。

驗收重點是改綁／等文交換必須 stale、相鄰欄位隔離、舊 per-field receipts 保留但不沿用批准，以及目前113真目標與候選不變。工程驗收不代替內容批准；精確 Steam build、圖片／授權等原限制保留。

只回復 r5 時，在 Web revert「包含本報告的 r5 commit」回到 c87；Source f551 不動。完整新 Web SHA／命令見 Jira 本輪交付。不要套用 r4 的雙 repo 回復，不 reset／clean，回復尚未執行。既有 PR1／PR8保持待審與現行0.0.17 preview不變。SYP不記工時。
