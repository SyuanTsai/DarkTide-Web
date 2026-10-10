# 暗潮繁體資料庫

目前是可在本機建置的網站底座，使用**完全虛構**的技能、武器與祝福資料。頁面與內容關係可以驗證；真實遊戲內容及圖示尚未加入，也尚未部署。

需要 Node.js 24 以上。在專案目錄執行：

```powershell
npm test
npm run build
python -m http.server 8000 -d dist
```

開啟 `http://localhost:8000/` 預覽。建置結果位於本機 `dist/`，其中 `build-manifest.json` 明確標示 `release_ready: false`。沒有套件安裝步驟或遠端抓取。

一般 PR（包含 fork）與 `main` push 會執行 `Fixture CI`：使用 Node.js 24 跑測試與虛構資料建置，並確認輸出仍是不可部署的 fixture manifest。此 workflow 只給 GitHub token 讀取權限、不保留 checkout 憑證，也不取用部署密鑰、上傳產物或執行正式資料匯入；正式來源驗收與部署須另走受控流程。

內容由 `fixtures/site.mjs` 輸入，`src/content/validate.mjs` 檢查 ID、武器／型號／祝福關係、數值宣稱格式與 canonical route，`src/site/render.mjs` 產生繁體中文靜態頁面。每個型號使用 `/weapons/{weapon_id}/marks/{mark_id}/` 獨立路由，可從武器頁進入並返回所屬武器、查看關聯祝福；正式候選需核對型號頁上使用的各欄來源與發布決策。虛構頁面可將技能、武器、型號與祝福階級的固定數值分層顯示；未知值顯示「尚未確認」。若日後在某頁使用 Games Lantern 授權的祝福或天賦圖示，該圖示記錄需帶來源連結資訊，產生器會在使用頁放上可見的直接連結。本站不複製或翻譯 Games Lantern 的原創文字，也不以程式爬取其圖示。

`src/content/publication.mjs` 提供逐 record 的發布候選檢查：核對公開欄位的來源 selector、原始 byte hash、三種獨立權利決策與使用頁路由；使用圖示時另核對重新託管、素材路徑與必要署名。測試涵蓋符合條件的 Games Lantern 圖示可通過。這是候選 record 的驗證元件，尚未組成完整 release 匯入與發布流程；真實來源 byte 與權利證據不存於此 Repo。

公開欄位的 Git 來源必須使用能逐值核對的 `json:/...`、受支援的 `md:`，或固定 `docs/darktide-skills/<職業>.tsv` 的 `tsv:archetype`／`tsv:row:<id>:<欄>` selector。TSV 解析會處理引用欄位並拒絕重複 ID；已用固定歷史 Git blob 核對七職業 646 筆 selector 與既有技能匯入名稱 hash。任意字串 selector、無解析器的 Git 檔案及外部圖示素材均不能替文字欄位背書。整合測試以已提交的完全虛構 JSON Git blob 核對來源 byte 與欄位值。

正式候選的版本化 `fieldRequirements.source_kinds` 另為每個必備欄位列出非空來源類型集合（目前支援 `git_json`、`git_markdown`、`git_tsv`）；每種指定類型都須有逐值相等且權利通過的證據。規則缺漏或只由其他類型來源支持時拒絕產生正式頁面。

正式候選若含數值宣稱，另需由 hash 鎖定的 `taxonomy.numeric_claims[record 類型][claim_id]` 指定相同層級、`fixed`、單位及十進位上下界，並由 `fieldRequirements.numeric_claims` 指定各數值欄的來源類型。顯示的 claim ID、狀態、已知值、單位及祝福階級都逐欄核對來源 selector、原始 byte hash 與使用頁權利；已知值的 `source_ref` 必須指向該值的證據來源。規則缺漏、個別物品浮動值、越界值或未核准欄位會被拒收。此機制只驗技術證據與核准紀錄，不自行判斷遊戲機制是否正確；目前沒有真實數值通過逐項審核。

Git JSON 來源的欄位證據使用 `json:/...` selector，從已核對的原始來源位元組逐欄比較候選值。技能 Markdown 可用 `md:anchor:<id>:title-zh|body-text` 或 `md:detail:<id>:title-zh|body-text` 從唯一的 HTML anchor 或詳細資料連結選取繁中標題與主要條列文字；次級小節、圖片及導覽連結不會混入效果欄位。固定 Mods 來源中的 618 個 README 區塊與 28 個 BASE_EFFECTS 區塊均已完成 selector 語法覆蓋檢查。這只證明能從已核對的檔案定位與轉換文字；分類、機制主張、翻譯品質與發布權仍須分別驗證。

`renderReleaseSite(data, context)` 會在產生正式頁面前，核對三類內容的關係、taxonomy／欄位規則 hash、每個實際使用頁面的來源與權利，並把已驗證的圖示 byte 放入輸出。`renderSite(data)` 仍只接受虛構 fixture。`createGitVerifiedReleaseDraft(data, context, { gitCheckouts, workerBytes, toolCommitSha })` 先從本機 checkout 讀取指定 commit／path 的 Git blob，核對遠端身分、物件型別與原始位元組 SHA-256，再把已驗候選頁面、使用到的來源與權利快照、Worker 位元組組成固定草稿清單。圖示仍由受控呼叫端提供原始位元組並核對 hash；此流程不下載或爬取素材。草稿的 `validation.complete` 固定為 `false`，Worker 會拒絕部署。正式匯入器、來源 selector 的正文語義驗證、真實數值 claim 的逐項核准、完整發布驗證與部署尚未接上，因此沒有可發布的真實內容包。

`importSkillCandidate({ row, playerSource, indexSource, sourceBytes })` 可將一筆技能 TSV 身分與已鎖定 hash 的 Mods 玩家說明／索引位元組對帳，產生記有欄位、身分與分類來源座標的記憶體候選。呼叫端須先用固定 Git commit 的來源讀取流程驗證來源身分；匯入器核對傳入的原始位元組 hash、名稱、分類和技能類型。結果固定為 `review_status: 'pending'`，沒有發布權決策或數值主張，也不會寫檔或進入正式頁面。實際技能內容、翻譯品質及權利仍需審核。

`importSkillCandidates({ entries, sourceBytes })` 以 `(archetype, skill_id)` 排序並拒絕重複主鍵；任一筆對帳失敗時不回傳部分批次。以固定歷史 IO Git commit 的七份 TSV、固定現行 Mods Git commit 的玩家說明與索引跑過 646 筆，全部產生待審候選（28 基礎效果、587 一般技能、29 配方及兩種零點節點各一）。這是來源欄位對帳，不代表 646 筆已通過遊戲語義、翻譯品質或發布權審核；網站仍只建置虛構資料。

`importBlessingMapCandidates({ sourceLock, sourceBytes })` 從已鎖定 hash 的祝福 map 位元組，產生祝福、關聯武器、mark、variant 與 binding 的記憶體待審候選；驗重複 ID、來源欄位座標、tier 範圍與關係引用。已用固定 Mods Git blob 實跑 167／67／131／605／1,185 筆；數值僅列待審欄名，不建立已驗 claim，`available_tiers` 未證者維持 `null`。此 map 的 67 個武器只是祝福關聯集合，不能當完整玩家武器清單；文字、效果、數值與發布權仍待逐項審核。

`importWeaponReviewCandidates({ queueBytes, queueSha256, sourceCommit, blessingMap })` 將受控本機產生的 UI 武器技術清冊與上述祝福 map 候選在記憶體中對帳。它驗清冊 byte hash、來源 commit、武器與 mark 歸屬、模板路徑及摘要計數；map 以外的名稱維持 `null`，所有輸出固定為待審且 `publication_ready=false`。固定清冊實跑得到 70 個武器 family／135 個 mark，其中 67 個 family 與 map 對應、3 個只見於 UI。清冊、真實文字與數值未寫入 Repo 或正式內容包；UI 出現仍不證明目前玩家可取得或可公開發布。

`snapshotReviewCandidates` 與 `diffReviewSnapshots` 可將待審技能、祝福 map 與 UI 武器候選轉為依複合 ID 排序的逐欄 hash 快照，再列新增、移除及變更的 ID／欄位／hash。提供 UI 武器候選時，武器／mark 以已對帳的完整 UI 候選取代 map 中重疊的候選，並拒絕漏掉 map 既有 ID 的清冊；祝福、變體與 binding 仍取自 map。祝福 map 數值只在記憶體候選保留各待審欄的 hash，不輸出未審數值；差異結果也不含名稱或效果原文。這是來源更新的審核隊列，不會自動批准或發布變更。

`worker/index.mjs` 是私有 R2 讀取層：以 `ACTIVE_RELEASE` 指向 `CONTENT_BUCKET` 中 `releases/<id>/` 的固定版本，只服務正式 manifest 列出的檔案。正式 manifest 必須有依契約計算的 `sha256:<64hex>` release ID、排序的檔案清單、來源／權利快照摘要、Worker bundle 摘要與完成的驗證紀錄；每次 GET 還會核對 R2 物件的實際位元組數與 SHA-256。虛構建置的 `release_ready: false` 會被拒絕。因目前資產網址未帶版本號，Worker 對頁面和資產都使用短期快取，避免切換版本後沿用舊 CSS。現階段沒有正式內容包、Cloudflare 資源或部署設定；此模組以模擬 R2 的單元測試驗證。

`verifyReleaseArtifactBytes({ manifestBytes, files, workerBytes, expectedReleaseId })` 可在未來受控上傳前，核對完整 release manifest 與全部靜態檔、Worker bundle 的實際位元組；缺檔、額外檔或 hash／長度不符會拒收。輸入須先取得已完成的內容驗收 manifest；此函式只核對 artifact 完整性，不授予來源或權利核准，也不會設定 `validation.complete`、上傳或切換正式版本。

`uploadVerifiedRelease({ manifestBytes, files, workerBytes, expectedReleaseId, bucket })` 接受受控環境提供的 R2 Workers API 相容 bucket：本機核對完整產物後，以僅限不存在物件的條件寫入 `releases/<release_id>/` 靜態檔，讀回全部檔案驗證，再最後寫入並讀回 `build-manifest.json`。同版本重試會核對既有位元組，遇到同名不同內容即拒絕覆寫；靜態檔上傳或讀回失敗時不寫完成 manifest。此模組沒有對外上傳端點，也不變更 `ACTIVE_RELEASE`。目前尚無正式 R2 資源、受控上傳入口或 staging／production 部署。
