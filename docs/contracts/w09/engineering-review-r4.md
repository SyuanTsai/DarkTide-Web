# W09 r4 修補交檢

本輪補完 r2 三項工程阻擋，另修正 Root 在 r3 找到的完整 archive 重試回歸；保留原 Red、r1/r2/r3 歷史候選與人工 receipts；停在 W09 等待重新驗收。Source 新 [草稿 PR #3](https://github.com/SyuanTsai/DarkTide-Source-Data/pull/3)；Web [草稿 PR #11](https://github.com/SyuanTsai/DarkTide-Web/pull/11)。原 Source PR2／Web PR10 已關閉未合併，完整保留歷史。W08 PR9 已由外部合併，Web 新 PR 以 main 55c0d002bd07109c34f15aa021074b16d81224f9 為 base（tree 等於既定 W08 4ce0）。本輪沒有執行合併。

固定 Source `55379ecf88bbb0777ed27b06a9e16d367f161a59`；Web code `1aadf6652838bcee4c282c884b5363be8d0ecb87`；Web compiler lock `f6a9acfd9794b9fc95da43e1a76031f8a45f1b96`。最終 metadata 完整 SHA 由交付報告／PR head 提供，避免自我引用。原 request provenance 仍 `9840a44cda9538b6e60c963e43e3838f0ccc7409`，沒有把程式碼更新當成資料更新。

[新候選](engineering-r4/candidate.json)、[逐項矩陣](engineering-r4/matrix.md)、[重現／實際測試／獨立覆核](engineering-r4/verification.json)、[檔案 hash](engineering-r4/hashes.json)。

固定 runtime 以已審 Source589f 的四檔大小與 SHA-256 allowlist 為信任根；先核全部 regular Git blobs 再 import 暫存副本。它採固定可信程式碼方案；不是 OS sandbox 或清除所有環境憑證。舊 approved pin 在目前 HEAD 改註解後仍可重播；新 pin 若其 runtime bytes 有變化（包括註解）須另行審核，不自動信任。

驗收：先核對兩個 PR 完整 HEAD 與 compiler／Source lock，依 hashes.json 核 raw Git bytes；檢查原三個 Red、專項 Green 和 Root 獨立 probe；確認完整 published archive 只讀、uploaded draft 僅完成既有 asset，H1 explicit baseline／H2 request 仍保 H0 header/hash；tag-only／空 draft 沿用原 commit、request 與 exact archive，衝突拒絕且不挪 tag；確認自然 CI 為最終 heads，沒有增加原 15 個 skip；真資料仍 869 pending、0 receipts、selected=false／allocationReserved=false／publicationEligible=false，contentVersion=null。四項 W07 已接受限制維持 unknown obtainable bounds、8 unresolved zones、Steam build UNVERIFIED、缺圖／授權 NOT_REVIEWED。

本輪精確工程回復：在 tracked clean 且 HEAD 等於交付 head 時，Web 依 `git rev-list 902f12dd5dd3a2fb20b3490be4104406f1dfc5e0..HEAD` 的逆時間順序 `git revert --no-commit` 全部新 commits，再核 write-tree 等於 r2 tree `aa7f67b4c14121e627ab06cf70008e7804edc37b`；Source 新 commits 依序 `55379ecf88bbb0777ed27b06a9e16d367f161a59 32b97040ba79c80ba31a0ff344681f604de7321c` revert，tree 須等於 r2 `7d2c65169aabf0553dd5c8fe8eeb7b376f9e9bfd`。交付報告會列出包含 metadata 的全部完整 SHA 與隔離演練結果。用一般 revert commit，不 reset／clean，不另行清除歷史候選或 receipts；r1/r2/r3 文件仍由歷史 commits 保留。此為工程回復，沒有真 production active／正式 rollback ID。回到 r2 會恢復三項已知缺口，只供停用本輪變更，不能據此發布。

尚未完成：Source WEB_HANDOFF_TOKEN、main 上真 workflow trigger／token PR provider policy／所需 CI approval、正式內容逐欄批准、正式 HTTPS promote 與 production rollback。這些項目維持未完成；不以本輪局部修補宣告 W09 全通。無正式發布、合併、Mods 清理或工時記錄。
