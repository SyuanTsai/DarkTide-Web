# W09 engineering-r2 重新交檢

Web [PR #10](https://github.com/SyuanTsai/DarkTide-Web/pull/10) 的 r1 自然 CI 發現三項失敗，原 run／候選完整保留；本輪按已查核原因修補，沒有改成 skip 或放寬正式契約。Source [PR #2](https://github.com/SyuanTsai/DarkTide-Source-Data/pull/2) 不變。

固定修補 commit：`e0f829603bfb2b12c56a9cf2bfc452b6f05a87ed`。compiler code `b6019e268001df9ee1a8c31d797739347c785ea6` 與 lock `196b74f0f8314840aa0f6185cb2b4278b4b8d1a3` 的四檔 bytes 不變，Source `589f89ea880d33450552029a03f7893b3fb6cb6a` 不變。最終交付 metadata commit 由 PR head 給出，避免自我引用。

[新候選](engineering-r2/candidate.json)、[新矩陣](engineering-r2/matrix.md)、[實際測試／r1 失敗與修補](engineering-r2/verification.json)、[檔案 hash](engineering-r2/hashes.json)。原 [r1 驗收與流程](engineering-review.md) 作歷史保留；本次驗收以 r2 與最新 PR CI 為準。

驗收先核對 PR head、固定 patch／compiler／Source SHA 與 hashes，再檢查三項原失敗測試於最新自然 CI 通過、沒有增加 baseline 15 個 skip；候選仍 selected=false／allocationReserved=false／publicationEligible=false／正式 contentVersion=null。真資料 869 pending、0 receipts、W07 四項限制保留；來源 code snapshot 不當精確 Steam build，unknown bounds／8 unresolved zones／缺圖與未核實授權皆維持。

本次沒有改 web runtime/assets／四域資料 bytes，固定 Git runtime local HTTP／browser 及舊整包回復證據按影響範圍沿用；只補 verifier 正負例、fixture setup、W01 精確 attrs 正負例及最後 pin／pending／hash／回復核對。正式 Source→Web workflow trigger、workflow-token PR policy／CI approval、Source WEB_HANDOFF_TOKEN、正式 HTTPS 發布／回復仍未完成，不據此結案。

精確工程回復需先核對 HEAD 等於交付 PR head 且工作樹無無關變更，一次 `git revert --no-commit <交付 PR head> e0f829603bfb2b12c56a9cf2bfc452b6f05a87ed e33df26ff1b96b45b3f440d41b9cabae49b0aca0 196b74f0f8314840aa0f6185cb2b4278b4b8d1a3 b6019e268001df9ee1a8c31d797739347c785ea6`，write-tree 必須等於 `1b003f233f33c1a7a181eae5aab0ad5bce672ffb`（W08 baseline4ce0）再建立正常 revert commit。交付前另以真五個完整 SHA 在隔離 clone 演練；Source 回復仍為原589f／9840至8e48的已驗證逆序。沒有真 production active／正式 rollback ID。

停 W09 等待重新工程驗收；不進 W10、不合併、不正式發布、不清理 Mods、不記錄工時。
