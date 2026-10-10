# 暗潮繁體資料庫

目前是可在本機建置的網站底座，使用**完全虛構**的技能、武器與祝福資料。頁面與內容關係可以驗證；真實遊戲內容及圖示尚未加入，也尚未部署。

需要 Node.js 24 以上。在專案目錄執行：

```powershell
npm test
npm run build
python -m http.server 8000 -d dist
```

開啟 `http://localhost:8000/` 預覽。建置結果位於本機 `dist/`，其中 `build-manifest.json` 明確標示 `release_ready: false`。沒有套件安裝步驟或遠端抓取。

內容由 `fixtures/site.mjs` 輸入，`src/content/validate.mjs` 檢查 ID、武器／型號／祝福關係與 canonical route，`src/site/render.mjs` 產生繁體中文靜態頁面。若日後在某頁使用 Games Lantern 授權的祝福或天賦圖示，該圖示記錄需帶來源連結資訊，產生器會在使用頁放上可見的直接連結。本站不複製或翻譯 Games Lantern 的原創文字，也不以程式爬取其圖示。

`src/content/publication.mjs` 提供逐 record 的發布候選檢查：核對公開欄位的來源 selector、原始 byte hash、三種獨立權利決策與使用頁路由；使用圖示時另核對重新託管、素材路徑與必要署名。測試涵蓋符合條件的 Games Lantern 圖示可通過。這是候選 record 的驗證元件，尚未組成完整 release 匯入與發布流程；真實來源 byte 與權利證據不存於此 Repo。

Git JSON 來源的欄位證據使用 `json:/...` selector，從已核對的原始來源位元組逐欄比較候選值。技能 Markdown 可用 `md:anchor:<id>:title-zh|body-text` 或 `md:detail:<id>:title-zh|body-text` 從唯一的 HTML anchor 或詳細資料連結選取繁中標題與主要條列文字；次級小節、圖片及導覽連結不會混入效果欄位。固定 Mods 來源中的 618 個 README 區塊與 28 個 BASE_EFFECTS 區塊均已完成 selector 語法覆蓋檢查。這只證明能從已核對的檔案定位與轉換文字；分類、機制主張、翻譯品質與發布權仍須分別驗證。

`renderReleaseSite(data, context)` 會在產生正式頁面前，核對三類內容的關係、taxonomy／欄位規則 hash、每個實際使用頁面的來源與權利，並把已驗證的圖示 byte 放入輸出。`renderSite(data)` 仍只接受虛構 fixture。`createGitVerifiedReleaseDraft(data, context, { gitCheckouts, workerBytes, toolCommitSha })` 先從本機 checkout 讀取指定 commit／path 的 Git blob，核對遠端身分、物件型別與原始位元組 SHA-256，再把已驗候選頁面、使用到的來源與權利快照、Worker 位元組組成固定草稿清單。圖示仍由受控呼叫端提供原始位元組並核對 hash；此流程不下載或爬取素材。草稿的 `validation.complete` 固定為 `false`，Worker 會拒絕部署。正式匯入器、來源 selector 的正文語義驗證、數值 claim、完整發布驗證與部署尚未接上，因此沒有可發布的真實內容包。

`importSkillCandidate({ row, playerSource, indexSource, sourceBytes })` 可將一筆技能 TSV 身分與已鎖定 hash 的 Mods 玩家說明／索引位元組對帳，產生記有欄位、身分與分類來源座標的記憶體候選。呼叫端須先用固定 Git commit 的來源讀取流程驗證來源身分；匯入器核對傳入的原始位元組 hash、名稱、分類和技能類型。結果固定為 `review_status: 'pending'`，沒有發布權決策或數值主張，也不會寫檔或進入正式頁面。實際技能內容、翻譯品質及權利仍需審核。

`worker/index.mjs` 是私有 R2 讀取層：以 `ACTIVE_RELEASE` 指向 `CONTENT_BUCKET` 中 `releases/<id>/` 的固定版本，只服務正式 manifest 列出的檔案。正式 manifest 必須有依契約計算的 `sha256:<64hex>` release ID、排序的檔案清單、來源／權利快照摘要、Worker bundle 摘要與完成的驗證紀錄；每次 GET 還會核對 R2 物件的實際位元組數與 SHA-256。虛構建置的 `release_ready: false` 會被拒絕。因目前資產網址未帶版本號，Worker 對頁面和資產都使用短期快取，避免切換版本後沿用舊 CSS。現階段沒有正式內容包、Cloudflare 資源或部署設定；此模組以模擬 R2 的單元測試驗證。
