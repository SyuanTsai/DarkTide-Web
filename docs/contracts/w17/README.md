# W17 退役準備與保留狀態

本頁是 W17 的只讀交接索引。它把固定 W03 Mods selector 對到 W14 保存結果與 W15 最終移交收據，供後續驗收與人工檢視。此報告沒有刪除、移動、清理或重設任何來源；`deletionReady` 一律為 `false`。

## 已核對的範圍

固定的 W03 Mods ledger 有 191,861 selectors、45 shards、83,260 個來源路徑。W14 outcome 有 191,861 筆且沒有 gap：107,060 筆由 Source 歷史 archive 保存、79,014 筆對到私人 archive 保存證據、1,094 筆明確留在 Mods、4,693 筆交由 W15。W17 再逐列核對固定 W15 最終收據，沒有把 pending proposal 當成最終結果。

W15 的實際交接如下：

- M05 的 1,291 筆是已部署公告內容。
- M06 的 771 筆是 Web、Source、Private 的工作流程 owner handoff；它們沒有遊戲內容 review digests。
- M07 的 8 筆是既有工具／工作流程移交，不是遊戲內容批准。
- M08 的 2,545 筆是供 authoring 使用的參考，不代表現版 gameplay facts 已批准；78 筆 selector 明確仍留在 Mods。
- A17 的 17 筆是原 W01 pending candidate 狀態，未被當成 W15 公告或選入發布。

完整 aggregate 為 82,105 個「W16 驗收後才可再評估」的路徑、1,155 個目前必須保留的路徑，以及 1 個混合 selector 路徑。混合路徑是 `Referneces/Translation.md`：2,428 個 selector 已有固定新 owner，18 個仍屬 Mods，因此整份來源檔仍須保留。這些數字是準備分類，不是刪除清單或刪除授權。

## 保存依據與限制

M01 在固定 Source commit `805fa5ea3df2482419c967b4e82d019b65338065` 的 manifest 中列出 3,071 個原始檔、共 25,070,107 bytes。Git tree 同一前綴還有 4 個既有 Psyker sibling entries；它們不屬於 M01 manifest，工具只檢視其 Git tree metadata，未讀其內容。

M02/M03/M04 私人保存沿用 W14 固定 public-safe proof：79,014 個 member 的 CRC/SHA/Git blob 驗證及 11 個抽樣 restore。W17 CLI 只讀此安全摘要，沒有新讀私人 archive bytes，也沒有聲稱整份 archive 已還原。完整私人 manifest、archive、Drive locator 不在本 repository。

W16 最終驗收尚未完成：Extension 0.2.33（採用 1.13.2.3 資料）的祝福閱讀器真站檢查通過，但新版技能列表遇到 403，明細／武器沒有完成真站驗證，也沒有商店上傳或審核結果。因此 82,105 只能標為 W16 驗收後候選；所有 83,260 個來源路徑仍保留。獨立 managed Mods worktree 的本次檢查為 clean，固定 241ad76 到其 HEAD 的 tracked delta 是新增 `.hash/readme-acquisition-records.json` 及修改 `README.md`。受保護的原始 Mods checkout 與既有 untracked 文件未讀取正文，也未用作遷移輸入。

## 可重跑的只讀 preflight

使用 Node 24，並提供 Web、Source、Mods 三個明確的 repository root，以及 W15 的最終 completion receipt。Source checkout 必須含固定 M01 archive commit `805fa5ea3df2482419c967b4e82d019b65338065`；Mods checkout 必須是該 Mods repository 的精確 worktree root，且固定 source commit 是目前 HEAD 的 ancestor。W15 receipt 必須是 SHA-256 `e226eea711b46141e5d42c9836b76b8a0a2a7babc78038c3ddca2c6e0171552a` 的固定最終收據。

先建立輸出父目錄，再以一個尚不存在、且在三個 repository 以外的目錄作 `--output-root`：

```powershell
$outputParent = 'C:\w17-evidence'
New-Item -ItemType Directory -Path $outputParent -Force | Out-Null
node scripts/content/contract-w17-retirement-cli.mjs `
  --web-root '<Web repository root>' `
  --source-root '<Source repository root>' `
  --mods-root '<isolated Mods worktree root>' `
  --w15-receipt '<fixed final W15 completion-receipt.json>' `
  --output-root "$outputParent\run-001"
```

The parent directory must already exist; the output directory itself must be new and outside all three roots. The command verifies fixed W03/W14/W15 inputs, reads the pinned public Source M01 archive blobs needed to verify its manifest, and inspects Git tree/status metadata for the supplied worktrees. It has no apply, delete, move, clean, or reset option. It does not read protected original Mods working-tree bodies or the private archive bytes. It writes `manifest.json` and a compressed newline-delimited per-path report in the chosen output directory.

The checked full report was generated twice with identical fixed inputs. Both runs produced manifest SHA-256 `73391ecb6137d5e4a618126b00dd408689fd0041e817c659820c1f5446d6b495` and `paths.jsonl.gz` SHA-256 `d40968c3c09d3ca7ff7056a7495b593ebf4de4c91c5fb8e5df5b9a3dc32f5e7a`. The full per-path file is retained in task evidence outside the repository; this repository contains only its aggregate and hashes. See [aggregate.json](aggregate.json) for the fixed input pins and counts.

## Owner references

- [W14 preservation inventory](../w14/README.md)
- [W15 owner migration index](../w15/migration-index.md) is the source-row candidate-stage snapshot; its M05/M08 pending labels describe that stage. For the deployed/current W15 dispositions, use this W17 summary and the fixed final completion receipt SHA-256 `e226eea711b46141e5d42c9836b76b8a0a2a7babc78038c3ddca2c6e0171552a` recorded in [aggregate.json](aggregate.json).
- [W15 M07 tool ownership map](../w15/m07-tool-map.json)
- [Current official announcements](https://darktide.tw-syuan.com/announcements/) and the Web-owned [announcement workflow](../../workflows/announcements.md) and [presentation workflow](../../workflows/presentation.md)
- Source-owned [content workflow](https://github.com/SyuanTsai/DarkTide-Source-Data/blob/main/docs/workflows/content.md), [skill workflow](https://github.com/SyuanTsai/DarkTide-Source-Data/blob/main/docs/workflows/skills.md), [blessing workflow](https://github.com/SyuanTsai/DarkTide-Source-Data/blob/main/docs/workflows/blessings.md), and [W15 term reference](https://github.com/SyuanTsai/DarkTide-Source-Data/blob/main/docs/references/w15/term-candidates.json)
- Private remains the owner for restricted dialogue-processing storage responsibility and the M07 string-tool handoff. In the Private repository, see `docs/workflows/dialogue-text.md` and `tools/game-data/README.md`; the public [M07 map](../w15/m07-tool-map.json) records its W15 handoff. No private storage URL or locator is included here.
- [Source M01 archive manifest](https://github.com/SyuanTsai/DarkTide-Source-Data/blob/805fa5ea3df2482419c967b4e82d019b65338065/content/legacy/mods/241ad76/m01-manifest.json)
- [Source archive scope and evidence notes](https://github.com/SyuanTsai/DarkTide-Source-Data/blob/b735c4a164ced09e6c0fb31a2518e7633f2728ff/docs/legacy/w14/README.md)

No W16 acceptance, W17 deletion, or source cleanup is claimed by this index.
