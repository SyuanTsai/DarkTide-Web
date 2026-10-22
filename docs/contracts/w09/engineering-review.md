# W09 engineering-r1 交檢

本輪已實作 R04／R09／R11 的版本、候選接線、持久狀態、整包保留與回復，完成受影響驗證並交待審 PR。W09 保持進行中，等人工工程驗收；真跨 repo trigger／正式來源內容批准／正式網站發布仍未完成，不將它們縮減為已驗收。

固定 Web code：`b6019e268001df9ee1a8c31d797739347c785ea6`；compiler lock commit：`196b74f0f8314840aa0f6185cb2b4278b4b8d1a3`。Source：`589f89ea880d33450552029a03f7893b3fb6cb6a`；request provenance：`9840a44cda9538b6e60c963e43e3838f0ccc7409`。最終 metadata commit 的完整 SHA 由交付 PR head 提供，避免候選自我引用未來 commit。

[候選](engineering-r1/candidate.json)、[需求／缺口矩陣](engineering-r1/matrix.md)、[實際測試與沿用範圍](engineering-r1/verification.json)、[檔案 hash](engineering-r1/hashes.json)、[Source 專項](source-handoff-review.md)。

## 驗收

1. 核對 PR head、code／compiler lock／Source 三個完整固定 SHA。Web 待審 PR 以 W08 修補分支為基底；Source [PR #2](https://github.com/SyuanTsai/DarkTide-Source-Data/pull/2) 與 W08 [PR #9](https://github.com/SyuanTsai/DarkTide-Web/pull/9) 均未合併。不要以 squash 丟失 compiler pin 所指 code ancestry；若日後選擇重寫歷史須重新固定並驗證。
2. 逐檔核對 hashes.json 的 sizeBytes／SHA256；compiler.lock 的四檔必須與 code commit raw Git blob 相同。候選正式 N／Web release ID 均為 null，selected=false／allocationReserved=false／publicationEligible=false。
3. 依矩陣檢查隔離 fixture 的 source replay、發號、候選重試、持久化中斷與 rollback 證據；新增／受影響專項另列，沒有把舊測試冒稱本輪全數重跑。自然 PR CI 可核對固定版完整 logs。
4. 確認實際 869 pending、0 正式內容 receipts、無 selected.json／release-state／prepared／runtime snapshot；W07 四項已接受來源限制仍在模型與候選中。原 W08 r2 四域的完整 bytes 保留。
5. 將外部未完成項逐項列為待決：Source WEB_HANDOFF_TOKEN、main workflow 可觸發、workflow token PR policy／CI approval、真端到端與正式 HTTPS promote／rollback。此輪不執行這些發布動作，也不以工程測試代替人工內容批准。

可在隔離 checkout 針對性複驗 `node --test test/contract-w09-state-branch.test.mjs test/contract-w09-candidate.test.mjs`；完整測試由自然 PR CI 留證。沒有新增依賴或更改 lockfile。

## 精確回復

本輪沒有部署或切換 active，因此目前回復的是待審工程變更。先確認 checkout 無無關變更，HEAD 等於交付 PR 的完整 head；在隔離分支一次逆序 `git revert --no-commit <交付 PR head> 196b74f0f8314840aa0f6185cb2b4278b4b8d1a3 b6019e268001df9ee1a8c31d797739347c785ea6`，核對 write-tree 等於 baseline `4ce0a7fe528f021f1312f53fdf6288d12d22ee70^{tree}`，再建立正常 revert commit。不可只停在 code-only 或無 lock 的中間 tree。Root 交付前會以真最終 SHA 在隔離 clone 演練，回傳精確三個 SHA 與 baseline tree。

Source 對 `589f89ea880d33450552029a03f7893b3fb6cb6a` 再 `9840a44cda9538b6e60c963e43e3838f0ccc7409` 做同樣一次逆序 revert，tree 必須為 `63b344300bee799c431da87d89950c8bf362dd32`，等於 baseline `8e48334619f448794aab666f1805cb2bd6adf11a`；已隔離實測。不得 reset／force push／清理 Mods 或刪歷史 receipts／requests。

未來正式發布若中斷，從 owner branch fresh restore 後重試原 transaction／build／reserved N，不刪 journal 或重新挪號；正式 rollback 必須明示整組 allocated Web IDs、approved runtime build SHA256 與完整 expected-current pointers+build CAS。當前沒有正式 state，沒有可誠實提供的 production rollback ID。

不進 W10、不合併、不正式發布、不清理 Mods、不記錄工時。
