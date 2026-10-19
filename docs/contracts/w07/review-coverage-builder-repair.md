# W07 r3｜F15 候選產生與審核覆蓋一致性

本輪只修 W06 候選產生器與既有 validator 支援粒度的不一致。W06 已驗收；W07 維持待人類驗收。r1／r2、既有有效 Source／UI／Google 還原／POC 證據保留；停在 W07。

## 固定範圍與入口

Source 保持 `b9d6eb3d2f067772aee4613daecba0414cb11c0d`；Web 本輪基準 `330324f05e381cf07d09f9db5fdb6983adb724c5`，新交付固定 SHA 與 CI 見 SYP-339 最新 r3 留言。

- 受影響的新候選：[W06 candidate-r3 清稿](../w06/candidate-r3/review-candidate.md)／[矩陣](../w06/candidate-r3/review-matrix.json)。
- 持續有效：[W07 candidate-r2 清稿](candidate-r2/review-candidate.md)／[矩陣](candidate-r2/review-matrix.json)。
- 前次 [r2 審核契約修補報告](review-contract-repair.md) 保留歷史；F12／F13／F14 的有效證據沿用。

## F15／P2 重現與修補

Root 在原固定 Web 330324f 的唯讀記憶體副本獨立重現：原始候選 valid=true、23 rows 可產生；將審核粒度換成 whole skill detailSections、whole tier option、tier item parts 集合或完整逐 parts 後，四者仍 valid=true，但 matrix 全部拋出 `Review target is missing for W06 detail row`。沒有修改原 authoring 來重現。

問題來自 matrix 只按 ownerId 與精確 item fieldPath 找單一 target。現在 validator 與公開 `buildW06Candidate` 共用 `resolveDetailReviewTargets`，以實際 ownerKind、ownerId、content 維度與合法 path 找完整覆蓋集合。whole details／tier option／tier details／section items／item／text／parts 集合與完整逐 parts 都保持合法；official target 不會冒充 content coverage。

resolver 列出所有已宣告且適用的 targets。即使粗粒度已批准，也不能掩蓋同列細粒度的 pending／stale／rejected。漏一個非空 part、錯 owner／維度與重複 scope 都遭拒絕，builder 先驗證再產生 bytes。

## 候選格式 1.1.0 與批准追溯

每列新增：

- `reviewTargetIds`：完整實際 IDs，為多目標列的權威欄位。
- `reviewTargets`：每個實際 target 的 ID、fieldPath、dimension、reviewState；owner 由該列 presentationId 表明。
- `reviewState`：依 `rejected > stale > pending > approved` 保守彙整，所有相關 targets 均 approved 才 approved。

既有單目標 `reviewTargetId` 保留原 ID；多目標為 null，不能任取第一筆。Markdown 同樣列出全部 ID／path／維度／逐項 state。receipt 仍逐 target 保留既有原始證據，沒有產生聚合 receipt、補填批准、刪除舊 receipt 或重算後冒充原批准。

合法空白文字／全空 literal parts 不新增審核義務。沒有已宣告 target 時，列出空 ID／metadata 陣列、reviewTargetId=null、reviewState=not-required；若已宣告 target，仍保留其原 ID 與實際狀態。Root 獨立驗證文字改空白後的原 stale receipt 仍列出，混合 parts 中已宣告空 literal 的 pending 不被其他 approved targets 掩蓋。

## 獨立驗證與沿用證據

Root 公開 builder 驗證七種合法粒度均成功，確認每個實際 target ID 與 Markdown 完整；五個負例（漏 part、錯維度、錯 ownerId、錯 ownerKind、重複 scope）validator／builder 均拒絕。合成記憶體 receipts 驗證：

- 三個 parts 全批准 → approved。
- 一個未審 → pending。
- 改變一個 literal，該 part 實際 stale → stale，其他兩個保持 approved。
- 一個 rejected → rejected。
- 粗粒度已批准、三個細粒度未審 → pending。

以上 receipts 只存在測試副本，沒有寫入真候選。真 W06 34／W07 38 targets 仍 pending、0 人類 receipts、publicationEligible=false。

Root 將修前固定 330324f API 的 fixture 37／W06 34／W07 38 共 109 targets 與修後逐筆比較：target、targetDigest、dependenciesDigest、review state 全部相同。Source 56 個 tracked 檔、Web authoring／targets／schema／locks／raw caches／官方原文／詞規則均不變；8 份 r1／r2 候選及 19 份受保護歷史產物 bytes 不變。W06 23 rows 的所有既有欄位（包含原 ID／state／文案／Source facts）保留，只新增 coverage metadata 與格式版號。

Root 受影響 contract suites（authoring／W03 ledger／W03 Mods／release／W06／W07）與部署分類 tests：95 Pass／0 Fail／0 Skip。命令：

```powershell
node --test test/contract-authoring.test.mjs test/contract-w03-ledger.test.mjs test/contract-w03-mods.test.mjs test/contract-release.test.mjs test/contract-w06.test.mjs test/contract-w07.test.mjs test/w01-preview-deploy-scope.test.mjs
```

另以修前 109 個 digests 在合成記憶體副本建立測試 receipt，修後 API 均維持 matching approved，未寫入真 authoring 或候選。Source b9 的既有 106／0／0 clean-clone 與 CI 證據沿用，沒有改 Source 或重跑未受影響的整包驗證。

固定 Web SHA 的 Web-only depth1／autocrlf=true clean-clone、離線重建、CI 日誌、既有 skip 名稱及部署分類結果見 SYP-339 最新 r3 交付留言。Skip 不計 Pass。W07 r2 以同一 CLI 重建確認 bytes 相同，沿用原有效候選；未為相同內容複製另一套候選。

| W06 candidate-r3 檔案 | Bytes | SHA-256 |
| --- | ---: | --- |
| review-candidate.md | 32507 | `1bee811647fa001a769f3dd205e8df2fa43c84ecf19812b69fc170dc8b81b30d` |
| review-matrix.json | 140046 | `3b47973cf73c782527eaf451e57eaaeeb391dbdb3e3972a368c67fce73014ee2` |

## 驗收、限制與只回復 r3

請檢查 W06 r3 的 23 句及 Source facts 與 r2 一致，單目標 ID／state 不變，新增 metadata 能列出實際全部 targets。合法粗粒度與逐 parts 的假設案例、批准彙整及負例由回歸測試／Root 獨立證據保護；真內容仍採既有逐項粒度，沒有擅自改審核範圍。W07 兩型號沿用 r2 候選。

只回復本輪 r3：在 Web revert 本輪固定交付 commit，回到 `330324f05e381cf07d09f9db5fdb6983adb724c5`；Source 保持 b9d6eb3。不要套用 r2 的 Source revert 指令。尚未執行回復，不 reset／clean。

原有 Steam build UNVERIFIED、未匯入的命中區域／暴擊弱點聯合關係、素材授權 NOT_REVIEWED 與 Extension runtimeIntegration=false 限制維持；沒有新增 renderer、shared compiler 或傷害計算。active preview 0.0.17 保持，不進 W08、不合併或正式發布、不清理 Mods。SYP 不記工時。
