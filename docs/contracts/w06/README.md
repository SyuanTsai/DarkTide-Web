# W06 review candidate

目前 r4 入口為 [review candidate](candidate-r4/review-candidate.md) 與 [完整矩陣](candidate-r4/review-matrix.json)。四項 Review 修補：審核時間排序、公告／變更紀錄覆蓋、sourceSnapshots 三方合併與修訂紀錄、非階級技能 parts 集合路徑。固定 Source `f5514e4361d09361d9621e885082b7b5c51d1c95`；文案、mechanics、原審核 digests 保留，候選只更新固定來源 metadata。新增驗證、相容性、驗收與只回復本輪方式見 [r4 報告](../w07/review-four-findings-repair.md)。W06 已驗收／W07 待人類驗收；停 W07。

前次入口為 [candidate-r3/review-candidate.md](candidate-r3/review-candidate.md) 與 [完整矩陣](candidate-r3/review-matrix.json)。r3 修補 F15：合法整節／tier／parts 審核覆蓋通過驗證後，也能產生候選；逐列列出全部真實 targets 與各自狀態，保守彙整。格式 1.1.0 新增 reviewTargetIds／reviewTargets；單一 reviewTargetId 保持原值，多目標為 null。既有 23 句、14 官方輸入與所有舊欄位不變，原 r1／r2 候選保留。

W06 已由使用者驗收（SYP-338 Done）。真內容仍 34 targets pending、0 人類 receipts、publicationEligible=false；任務驗收不代替內容批准。修補、相容性與只回復 r3 方式見 [F15 驗證報告](../w07/review-coverage-builder-repair.md)。

Source 固定 `b9d6eb3d2f067772aee4613daecba0414cb11c0d`。變動、相容性、驗證與回復見 [W07 r2 修補報告](../w07/review-contract-repair.md)。

Run `npm run contract:w06:validate` to validate the pinned W06 inputs without writing files. To generate a local review candidate, pass `--out-root <new-directory>` to `node scripts/content/contract-w06.mjs`; the directory must not already exist. Outputs remain review-only and do not change shared release or deployment inputs.
