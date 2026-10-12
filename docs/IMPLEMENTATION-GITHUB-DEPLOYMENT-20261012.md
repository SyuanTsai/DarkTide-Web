# GitHub 部署入口更正計畫

## 目標
將已驗收公開網站與部署設定交付至 GitHub；使用者只需在 Repo 設定 CLOUDFLARE_API_TOKEN，再由 Actions 建置與部署，不依賴個人電腦。

## 已核實與改動
遠端 main 原為初始 Repo，尚無完整網站／部署 workflow。因此從 origin/main 建立乾淨 codex/SYP-289-github-static-deploy 分支，選取完整網站程式、公開模型、必要回歸測試與精確公開測試證據。
不沿用恢復快照 commit 歷史，不發布本機復原紀錄、截圖、私人來源或絕對工作目錄。
保留既有 Actions main／workflow_dispatch 觸發、PR隔離 secrets、單產物跨job傳遞、序列化部署與SHA過期防護。README與操作說明改以GitHub UI為入口。

## 驗證
設定與文件更正免 TDD，採 YAML邊界驗證與全量回歸。乾淨安裝、288測試、prepare:deploy及完整瀏覽器smoke應通過。
推送分支、建立PR並觀察GitHub hosted CI。缺Cloudflare Secret時不得呼叫部署API。
發布前核對精確公開檔案清單、真實content.json strict schema與敏感資料邊界。

## 交付
提交與PR供審查；main合併後才能在Actions顯示手動部署入口。Token留在GitHub Secret；本輪不提供／設定Token、不部署Cloudflare，不擅自合併PR。
