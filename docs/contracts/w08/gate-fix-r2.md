# W08 r2：公告／變更內容門檻 P2 補件

本輪修正正式 authoring 合法非空內容被誤判缺少繁中的缺口，供 W08 重新工程驗收。未合併、未正式發布，正式內容仍待人工審核。最新 Web 交付完整 SHA 由同輪 Jira／PR 固定；在本分支以 `git log --diff-filter=A -1 --format=%H -- docs/contracts/w08/gate-fix-r2.md` 取得交付 commit。

## 固定基準與版本

- 基準 Web `1688dbfab89531e9a522377c6c0d94df1cd0086c`；Source main `8e48334619f448794aab666f1805cb2bd6adf11a`。
- 新 compiler `6184cd7c45770d48fe938d2002e6c6322a415e63`；authoring `40c477835353bd9513f202d6b82609a580afeabd`。
- Source artifact pin 保持 `f22b4ae2e1d3b4887f3741464e3c9bf507399db6`（已合併的 main tree 相同）；不把 merge SHA 偷換為原始 artifact 身分。
- 輸入 lock SHA-256 `e520f2313ff4fa90db3288db92a6d1dd83022f437e7066e7b83f28f06dd421d6` 不變。
- 新候選 `candidate-r2/`，dataRevision `46a3914a733b632e717fef158e9fc7137f887800b81118a71ad2ec892cbab034`；候選仍只含原四域，真公告／變更保持空。
- candidate.json SHA-256 `71e0254a58e08e22fb37a25ffce370b682e9734d7dca7236094f602dbe5760f4`；review-matrix-r2.json SHA-256 `31c3bc5d3ff5277fdc467f9d6ac2d77410be5e902cea7535da9761138696b829`。完整路徑、bytes、每檔 SHA-256 見 `artifact-hashes-r2.json`，該清單本身 hash 由固定交付 SHA／Jira 提供。

## 缺口與結果

| 需求／缺口 | 處理結果 | 證據 | 剩餘事項 |
| --- | --- | --- | --- |
| 公告沒有頂層 locale/title/text；不同 blocks 錯讀 text | 七類 blocks 依正式欄位遞迴檢查，含清單項目、表格儲存格、圖片 alt、asset alt、spoiler label 與子 blocks | 正式代表資料先通過 schema＋語義驗證；Root 實際 W07 加合法公告的公開 API Red→Green；新增正式形狀測試 | 無此 P2 工程缺口；正式公告內容仍須人工審核 |
| 技術變更 localized summary 被誤讀 | 讀 summary.locale/text，逐欄 fieldSummaries 必需文字一併檢查 | Root 未改動三類 donor rows 的公開 compiler／candidate validator Red→Green | 正式資料仍空，不捏造技術更新 |
| 官方文字變更 localized summary 被誤讀 | 讀 summary.locale/text，保留正式來源／版本對應 | 同上與錯 locale／空白摘要反例 | 不補造人工批准 |
| 真缺漏應繼續阻擋 | 空白文字、必需集合與未知 blocks 由內容門檻拒絕；不使用漢字比例 | 新增負例及 Root 17 個獨立缺漏 probe | 來源 build 與人工審核 blocker 保留 |
| 既有四域與歷史證據保全 | 四域 bytes 完全等於 r1，869 pending、0 receipts、四項 W07 限制均相同；歷史 r1／既有文件不改 | `gate-fix-r2-evidence.json` actualCandidate；基準 14 檔 hash 以基準 Git blobs 核對 | 新 compiler 身分使 manifest／candidate metadata 產生新 revision |

測試 adapter 明確只在記憶體使用 synthetic compiler 身分並選取 fixture 的 Source closure；未改動的完整 donor authoring 先通過正式 schema 與語義驗證。它不冒充真固定來源候選，亦未寫入 receipts。交付候選另以真 input／compiler lock 產生並驗證。

## 本輪驗證與沿用

- 本輪唯讀 W08 測試：16 Pass／0 Fail／0 Skip；完整命令 `node --test --test-name-pattern='^(UnitT0[1-689]|UnitT1[0-9]|InterT14)_' test/contract-w08-build.test.mjs`。排除原有寫檔測試，沿用其證據。
- Root 獨立三類正例與 17 個缺漏反例，公開 compile／validate API 通過；真固定輸入兩次記憶體重建 bytes 相同、兩端選取 path/hash 相同。
- 新 r2 實際寫出及完整候選驗證屬本輪產物整合檢查；初次負向名稱 filter 也匹配父層測試，意外重跑一次原有 writer smoke（17/0/0）；已以正向名稱 filter 核對 16 項唯讀。沒有重跑 writer 故障整套。
- 沿用 W01–W07、基準完整 contract 110／0／0、既有 writer／完整回歸及已核實歷史 CI；本輪新增自動 PR CI 的實際結果以最終 SHA 的 Jira 留言為準，不將歷史 CI 冒稱本次結果。
- 869 pending／0 receipts；gate 仍是 `review-target-pending`、`source-build-identity-unverified`、`source-build-not-publication-eligible`。四項 W07 限制：可取得上下限 unknown／NOT_EXPOSED_BY_SOURCE；8 筆 zone 未解析；Steam UNVERIFIED；武器圖片缺圖／NOT_REVIEWED。上述項目未變為已證實。

## 驗收

在新 PR 的固定完整 Web SHA、Node 24+ checkout 執行：

```powershell
node --test --test-name-pattern='^(UnitT0[1-689]|UnitT1[0-9]|InterT14)_' test/contract-w08-build.test.mjs
node scripts/content/contract-w08-build.mjs
node scripts/content/contract-w08-build.mjs --check-gate docs/contracts/w08/candidate-r2
```

前兩個 exit 0；最後一個應 exit 2，因正式內容／來源 build 尚未滿足發布條件。核對新 candidate／matrix／hash 清單，四域與 r1 相同。`candidate-r1` 及舊 README 的命令屬基準歷史 compiler；不可用新 compiler pin 宣稱舊 r1 是新候選。

重新驗收非空內容時，測試的三類正例不得出現 `required-zh-tw-content-missing`；清空每類必需文字或錯 summary locale 則必須出現。整體 gate 仍可因 pending／build 而 blocked，這不代表內容正例失敗。

## 精確回復

尚未合併時可直接以基準 `1688dbfab89531e9a522377c6c0d94df1cd0086c` 檢查 r1，不需執行回復。若需在本修補分支建立可追溯的回復 commit，先保留 tracked 修改，再執行以下命令；不使用 reset/clean、不觸碰 Source／Mods。

```powershell
$artifactCommit = (git log --diff-filter=A -1 --format=%H -- docs/contracts/w08/gate-fix-r2.md).Trim()
if ((git rev-parse HEAD).Trim() -ne $artifactCommit) { throw 'HEAD 已變更，先核對回復範圍' }
if (git status --porcelain --untracked-files=no) { throw '有 tracked 修改，先保留並核對' }
git revert --no-edit $artifactCommit
if ($LASTEXITCODE -ne 0) { throw '停止，保留衝突現場' }
git revert --no-edit 6184cd7c45770d48fe938d2002e6c6322a415e63
if ($LASTEXITCODE -ne 0) { throw '停止，保留衝突現場' }
git diff --exit-code 1688dbfab89531e9a522377c6c0d94df1cd0086c HEAD -- .
if ($LASTEXITCODE -ne 0) { throw '回復 tree 與基準不同，停止核對' }
```

回復命令只提供操作方式，本輪未執行。補件完成後停 W08 待重新驗收，不進 W09、不合併／正式發布、不清理 Mods、不記工時。
