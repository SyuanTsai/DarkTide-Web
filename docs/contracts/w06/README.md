# W06 review candidate

目前入口為 [candidate-r3/review-candidate.md](candidate-r3/review-candidate.md) 與 [完整矩陣](candidate-r3/review-matrix.json)。r3 修補 F15：合法整節／tier／parts 審核覆蓋通過驗證後，也能產生候選；逐列列出全部真實 targets 與各自狀態，保守彙整。格式 1.1.0 新增 reviewTargetIds／reviewTargets；單一 reviewTargetId 保持原值，多目標為 null。既有 23 句、14 官方輸入與所有舊欄位不變，原 r1／r2 候選保留。

W06 已由使用者驗收（SYP-338 Done）。真內容仍 34 targets pending、0 人類 receipts、publicationEligible=false；任務驗收不代替內容批准。修補、相容性與只回復 r3 方式見 [F15 驗證報告](../w07/review-coverage-builder-repair.md)。

Source 固定 `b9d6eb3d2f067772aee4613daecba0414cb11c0d`。變動、相容性、驗證與回復見 [W07 r2 修補報告](../w07/review-contract-repair.md)。

Run `npm run contract:w06:validate` to validate the pinned W06 inputs without writing files. To generate a local review candidate, pass `--out-root <new-directory>` to `node scripts/content/contract-w06.mjs`; the directory must not already exist. Outputs remain review-only and do not change shared release or deployment inputs.
