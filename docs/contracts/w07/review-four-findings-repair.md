# W07 r4：四項 Review 缺漏修補與驗收

本報告所在 Web commit 與固定 Source `f5514e4361d09361d9621e885082b7b5c51d1c95` 為本輪版本。修前 Web `b5fe616a2b37b5c76753864c89db778c1239a88e`／Source `b9d6eb3d2f067772aee4613daecba0414cb11c0d`。四項先由 Root 獨立重現，再由 Luna 實作 Red → Green，最後由 Root 獨立覆核。W07 待人類驗收；SYP-338 的 W06 Done 不變。

## 四項修補與新增驗證

| Finding | 修前實證 | 修補與獨立覆核 |
| --- | --- | --- |
| F16 審核時間排序 | `00Z` approved／較晚 `.1Z` rejected 卻得到 approved；`.1Z` 與 `.100Z` 同瞬間衝突亦錯 | 按實際 UTC 秒與任意精度小數比較，最新同瞬間衝突採 rejected。Root 9 組時間案例，含超過毫秒精度、跨秒、等價小數與排列。獨立 Review 再抓到 validator 接受的 `24:00:00Z`／次日 `00:00:00Z` 等價邊界，補 Red／Green 後確認兩種排列皆 rejected。原 receipts 不變。 |
| F17 公告／變更紀錄覆蓋 | fixture 有公告、遊戲變更摘要、官方文字變更摘要與欄位摘要，沒有對應 targets 仍 valid | 由實際內容要求 exact ownerKind／ownerId／path／dimension；欄位摘要可 whole collection 或完整 per-field。刪除任一類、全部刪除、錯 owner／dimension、duplicate、新增公告與新增欄位漏審皆拒絕；補真 target 後通過。fixture 只 append 4 targets，原 37 targets 與其他內容不變。 |
| F18 sourceSnapshots 三方合併與修訂紀錄 | 兩側各自合法新增不同 snapshot 卻整陣列衝突；單側新增 technical 有資料但修訂紀錄漏列 | 全域 `snapshot.snapshotId` 做 registry identity，保留 gameReleaseId 為可合併欄位。獨立新增／不同欄位編輯可合併；同欄位分歧、刪除對編輯保持真衝突；duplicate／malformed 拒絕。Root 實際 builder 驗證新增／修改／移除的 JSON 和 Markdown、精確 field paths、失敗不寫出、重排六檔相同。 |
| F19 非階級技能 parts 集合 | resolver covered=true，但合法非 tier `/detailSections/0/items/0/parts` 被 validator／builder 拒絕 | 只補 allowed path 的 parts collection。Root 從 validator 到公開 W06 builder 驗證 collection／per-part／literal text 三種粒度，完整 IDs／狀態／Markdown；漏 part 與任意尾端路徑拒絕。沿用 F15 shared resolver 與空內容 declared-target 追溯測試。 |

## 相容性、版本與沿用證據

- `sourceSnapshots` 全缺省仍保留 legacy omission；部分文件缺省當空 registry，null 不當空。含快照修訂使用 `w05-source-revision/2`，格式版本納入地址，避免同地址不同修訂 bytes；全缺省仍 `/1`。Root 用精確 b9 builder 比對 legacy sourceRevision `ad154311289c8b881fe88f82af8435f401b8c9ea84e1a21c9b863cdbb517df2a` 與全部六檔，逐位元組相同；快照 v2 地址與舊 v1 不同，technical bytes 相同。
- Source 只改 merge／build／W05 測試／pipeline 四檔；既有 schema、validator、mappers、真資料、Source ownership 與所有 mechanics 不變。Web W06／W07 sourcePin 與 source locks 指向新 Source commit，own authoring hash 正確重算，raw cache 不重寫。default fixture 與 Extension owner snapshots 的既有 pins 沿用。
- Root 比對原 fixture 37、W06 34、W07 38，共 109 targets 的 target／dependency digests 與狀態完全相同；以原 digest 建立的記憶體合成 receipt 全相容。fixture 新 4 targets pending；真資料 receipts 仍 0，publicationEligible=false。合成測試從未寫入 authoring。
- 新 W06 r4 矩陣與原 r3 完全相同，僅 `/sourcePin/commit` 更新；23 句、14 官方輸入、所有 target IDs／狀態不變。新 W07 r4 與原 r2 矩陣僅 `/sourcePin/commit` 和 `/authoringInput/sha256` 更新，Source facts、官方原文、比較與 provenance 均相同。
- r1／r2／r3 共 10 份舊候選與 19 份既有保護產物保留且相同。F12–F15、已驗收 W01–W06 的有效資料與驗證繼續沿用，未重跑人工 Google／UI／整套 POC。

## 測試與固定候選

Source-only depth 1、autocrlf=true 乾淨 clone：`node --test --test-reporter=tap`，113 pass／0 fail／0 skip，Git clean。最初 dirty checkout 與 file-origin clone 被既有 provenance guard 正確拒絕；QA clone origin 設回官方 Source URL 後全數通過，未修改 production 以繞過 guard。固定 SHA 的 [push CI](https://github.com/SyuanTsai/DarkTide-Source-Data/actions/runs/39204386184) 與 [PR CI](https://github.com/SyuanTsai/DarkTide-Source-Data/actions/runs/39204390331) 實際 job logs 各 113／0／0。

Web 受影響 suites：`node --test --test-reporter=tap test/contract-authoring.test.mjs test/contract-w06.test.mjs test/contract-w07.test.mjs test/contract-release.test.mjs test/contract-w03-mods.test.mjs test/contract-w03-ledger.test.mjs test/w01-preview-deploy-scope.test.mjs`，98 pass／0 fail／0 skip。固定 Web commit 的乾淨 clone、離線兩次候選重建、writer 保留手改／partial，以及遠端 CI 的最終結果，在 [SYP-339 本輪交付留言](https://syuantsai.atlassian.net/browse/SYP-339) 核對完整 head SHA；測試綠燈不代表內容批准。

| 候選 | Bytes | SHA-256 |
| --- | ---: | --- |
| [W06 r4 review](../w06/candidate-r4/review-candidate.md) | 32507 | `163b955ddbfeff2b291fbb25a6facd5db786b20c8eacffb9cc0d9676014682cc` |
| [W06 r4 matrix](../w06/candidate-r4/review-matrix.json) | 140046 | `4aecf29e90d5677f21d51469848c96e013c0a728b5007c6ef0ee8f334d7a25e3` |
| [W07 r4 review](candidate-r4/review-candidate.md) | 157020 | `6705e22ae0db39ded17515e01831c76c943c7c957fa0f7e6528b1299233c8cf9` |
| [W07 r4 matrix](candidate-r4/review-matrix.json) | 3162012 | `b6d23c0c9c9f1fc07a3e2acd44fd0b66f0317ef3f74cb49e13f5e3ddb6cbbb86` |

## 人類驗收與回復

1. 以 Jira 本輪交付的完整 Web／Source SHA 檢查這四項修補、上述候選 hash、原有內容與 pending 狀態。
2. 特別檢查同瞬間衝突保守 rejected、新聞四類覆蓋、snapshot 修訂新增／修改／移除與非 tier parts collection 三種合法粒度。既有 W07 武器圖片／授權、精確 Steam build 等未核實限制不因本次修補消失。
3. 僅回復本 r4 時，先在 Web revert「包含本報告的 r4 commit」，再在 Source revert `f5514e4361d09361d9621e885082b7b5c51d1c95`，回到 Web b5fe616／Source b9d6eb3；不用前次 r2 整包回復。實際命令與完整 Web SHA 見 Jira 本輪交付。尚未執行回復。

既有 PR1／PR8 維持待審，不 merge。停 W07，不進 W08、不正式發布、不清理 Mods；既有 0.0.17 preview 不動。本輪部署分類及 CI deploy／receipt skipped 證據隨固定 Web 版本交付。
