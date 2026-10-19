# W07 weapon authoring review

目前入口為 [candidate-r2/review-candidate.md](candidate-r2/review-candidate.md) 與 [完整矩陣](candidate-r2/review-matrix.json)。r2 修補 F12 無法解析 pointer、F13 缺少必需審核覆蓋、F14 commit／permalink 無謂失效；r1 候選與歷史 commit 保留。固定 Source `b9d6eb3d2f067772aee4613daecba0414cb11c0d`；W07 仍待人類驗收。完整差異、沿用證據、限制與回復見 [修補驗證報告](review-contract-repair.md)。

最新 r3 補上 F15 的 W06 候選 coverage resolver／完整逐 target 狀態；[W06 r3 候選](../w06/candidate-r3/review-candidate.md) 與 [本輪驗證／回復報告](review-coverage-builder-repair.md)。W07 r2 的兩份候選 bytes 經同 CLI 重建確認相同，繼續沿用。

Run `npm run contract:w07:validate` to validate the pinned W07 inputs. The command is read-only and does not write a review candidate. To create the two review files, pass a new output directory explicitly:

```powershell
node scripts/content/contract-w07.mjs --out-root .tmp/w07-review-draft
```

The parent directory must already exist and the output directory must not. The writer refuses existing paths and symbolic-link parents. It writes `review-candidate.md` for the readable Chinese review and `review-matrix.json` for complete Source facts, official locators, review digests, coverage, and provenance. Re-running against the same inputs produces the same bytes.

The candidate has no human receipts and `publicationEligible` remains `false`. Source owns mechanics; the Web presentation only owns labels, notes, and typed references. This work does not execute damage overrides, calculate final damage, implement a renderer, or establish an exact Steam build. Weapon image references and licensing remain unverified for both selected marks.
