# W07 r2 審核契約修補驗證

本輪修補 SYP-339 的 F12／F13／F14。W06 已驗收；W07 保持待人類驗收，所有真資料 0 人類 receipts、publicationEligible=false。沒有執行 W08、正式發布、合併或 Mods 清理。

## 固定範圍與候選

- Source 修補固定 `b9d6eb3d2f067772aee4613daecba0414cb11c0d`，基準 `6af376bbbfebf5d4a0535cf7922959241c08ccbd`。
- Web 本輪基準 `285ad617e87eb6628e1e4ea44f80441ac8344286`；交付固定 SHA 見 PR 8 與 SYP-339 最新 r2 驗證留言。
- 新候選使用 `docs/contracts/w06/candidate-r2/` 與 `docs/contracts/w07/candidate-r2/`。各含可讀 Markdown 與完整 review-matrix.json；所有 r1 檔案與歷史 commit 保留。

## 缺漏、修補與獨立驗證

| Finding | 修補前 Root 獨立重現 | 修補後 |
| --- | --- | --- |
| F12/P1 | W07 valid=true，但 662 targets 中 57 條無法解析，來自 19 profiles 的三條點式 pointer | 改為正確 JSON Pointer；每個 pending/draft/tombstone target 亦檢查 fieldPath。37／80／662 targets 全可解析。 |
| F13/P2 | W06 只留 23 detail targets、刪除其他 11 仍 valid；清空 34 仍 valid。W07 刪除 official/name 四個 targets 後 builder 仍成功 | 從實際非空內容推導必要 coverage；完整 owner／path／dimension 比對，拒絕遺漏、重複、錯 owner 或維度。既有合法整節、逐項、parts 與 tier 粒度保持等價。 |
| F14/P2 | 一致替換 public-code commit 與 permalink，內容／artifact／snapshot 不變卻使 dependency digest 改變 | 只正規化精確核對 repository／path／commit 的已知 public-code permalink commit 段。新演算法下一致換位 37／80／662 targets 均不變；未知 URL、來源路徑、fragment、artifact 和真父表數值仍保留相依。 |

合成 commit 換位與 receipts 僅存在記憶體測試副本；不主張合成 commit 實際存在，不產生人工批准。

## digest 演算法遷移

以下比較 Source r1 舊演算法與 r2；這是演算法遷移差異，不能稱為 commit-only 內容變更。對 57 個錯 pointer 使用修正後同一實值作比較。

| 資料 | targets | 修正 pointer | target 值 digest 改變 | dependency digest 改變 | 完全不變 |
| --- | ---: | ---: | ---: | ---: | ---: |
| W05 | 37 | 0 | 0 | 34 | 3 |
| W06 | 80 | 0 | 0 | 77 | 3 |
| W07 | 662 | 57 | 0 | 659 | 3 |
| 合成 fixture | 36 | 0 | 0 | 0 | 36 |

新演算法下 W06→W07 的既有 80 targets，其 target／dependency digests 全部相同。真 W05／W06／W07 原本及現在 receipts 均為 0；沒有自動重簽批准。歷史 receipt 必須保留其來源與批准紀錄，不以刪除 provenance 或相依來消除 stale。

## 內容、pin 與證據保護

Source 164 筆 record payload、19 damage profiles、76 claims、所有機制實值及 coverage 完全不變。只有 57 條 review pointer 與 20 個 mapper tool hash 更新；W05／W06 authoring 及 W07 source-import.md/json bytes 不變。

Web 現行 W06／W07 的 schema、data、validator raw cache 從固定 Source b9d6eb3 的 Git blob 取得，lock hash 逐 byte 對照。W06／W07 authoring 除 sourcePin 外全文／references／targets 不變；W06 14 官方輸入與 23 句、W07 4 官方輸入與 20 文案欄位保持。Source 原始數值／來源／claim／profile 逐筆核對，沒有以產生器輸出相互比對代替原值查核。

W02 representative fixture 僅追加 31 個實際缺漏的 reviewTargets（6→37），保留既有 targets、文案、數字、官方輸入與來源 pin；不以 fixtureOnly 或 mode 跳過 coverage。default synthetic owner cache 仍固定 Source `15f285ec3ad9314435141a18125cabfc1b3d1d19`。Extension `5a09f3628208550cca8696655f3012c23c53d5e5` 的 W02 capability 仍 runtimeIntegration=false，保留原 Source／Web owner snapshot；不把歷史合成相容性證據當作真內容 runtime 整合。

未受影響的 Google 104 檔還原、既有 UI／POC、Private、Extension 與 Mods 證據沿用。active preview 0.0.17 保持；本輪只補受影響的契約、來源鎖定、候選產生與部署分類檢查。Steam gameBuild 仍 UNVERIFIED、素材授權仍 NOT_REVIEWED；沒有新增 UI、傷害計算或 shared compiler。

## 測試與交付檢查

Source-only 全新 shallow clone、autocrlf=true：106 Pass／0 Fail／0 Skip；三個 CLI 產物離線重建 byte 相同且 Git clean。固定 b9d6eb3 的 push CI 39150134038 與 PR CI 39150138159 實際日誌均 106／0／0。

Root 對全部受影響 contract suites（authoring／W03 ledger／W03 Mods／release／W06／W07）與部署分類 tests：90 Pass／0 Fail／0 Skip。命令：

```powershell
node --test test/contract-authoring.test.mjs test/contract-w03-ledger.test.mjs test/contract-w03-mods.test.mjs test/contract-release.test.mjs test/contract-w06.test.mjs test/contract-w07.test.mjs test/w01-preview-deploy-scope.test.mjs
```

Root 另獨立逐一刪除 W06 34／W07 38 targets，72 個必要目標都被拒絕；清空、重複與新增未覆蓋文字拒絕，合法 tier whole-option／details／section-items 通過。原始 F13 兩個缺漏案例均由 valid=true 轉為 false，W07 builder 也拒絕。W06 完整矩陣除 sourcePin 外與 r1 精確相同；W07 2 weapons／76 claims／4 definitions／4 curves／16 action profiles／19 damage profiles／12 evidence 逐筆對照 Source。

兩個 CLI 無參數時不寫檔；各自兩次輸出 byte 相同，手改檔與部分輸出集均拒絕覆寫且原 bytes 保留。固定 Web SHA 的 Web-only clean-clone／CI 與實際部署分類結果記錄於 SYP-339 最新 r2 留言；Skip 不計 Pass。

| 候選檔案 | Bytes | SHA-256 |
| --- | ---: | --- |
| w06/candidate-r2/review-candidate.md | 30910 | `0ec2f27e4e952d58f4c37c42207346dc4fb29a8f35a18f295889023bdfad0bc6` |
| w06/candidate-r2/review-matrix.json | 130346 | `a5aa2289a1fe17fd590be64acc88a334e3596ea7ff61693c60bbc816c8695390` |
| w07/candidate-r2/review-candidate.md | 157020 | `97edd25aae5e29ba37d7ad165f089a45c64c2e9fed06888c8b62b2841e013572` |
| w07/candidate-r2/review-matrix.json | 3162012 | `50a92ce1284f329152b1efba061270312b1a3e4a94706bb81427213555c4e4ea` |

## 人工驗收與只回復 r2

檢查 W07 candidate-r2 的兩型號、各 stat／action 與完整 Source facts，對照候選的 source pin／hash／pending 狀態；W06 candidate-r2 供核對來源與 digest 修補影響，既有 23 句不變。驗收不代表已發布，也不自動批准內容 receipts。

若只回復本輪 r2：先在 Web revert 本輪交付 commit，再在 Source 執行 `git revert b9d6eb3d2f067772aee4613daecba0414cb11c0d`，回到 Web 285ad617／Source 6af376b。不可套用 r1 整包 W07 撤回步驟而誤撤已保留的 r1；不執行 reset/clean。以上為回復說明，尚未執行。
