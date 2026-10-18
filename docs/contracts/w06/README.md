# W06 review candidate

目前入口為 [candidate-r2/review-candidate.md](candidate-r2/review-candidate.md) 與 [完整矩陣](candidate-r2/review-matrix.json)。W06 已由使用者驗收（SYP-338 Done）；r2 只反映 W07 審核契約修補所影響的來源鎖定、validator 與 digest，原 23 句及 14 份官方輸入保持。r1 候選與歷史證據保留。內容仍無人類 receipts、publicationEligible=false；任務驗收不代替內容批准。

Source 固定 `b9d6eb3d2f067772aee4613daecba0414cb11c0d`。變動、相容性、驗證與回復見 [W07 r2 修補報告](../w07/review-contract-repair.md)。

Run `npm run contract:w06:validate` to validate the pinned W06 inputs without writing files. To generate a local review candidate, pass `--out-root <new-directory>` to `node scripts/content/contract-w06.mjs`; the directory must not already exist. Outputs remain review-only and do not change shared release or deployment inputs.
