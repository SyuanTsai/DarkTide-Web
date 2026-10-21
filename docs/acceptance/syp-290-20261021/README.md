# SYP-290 整體驗收與證據索引（2026-10-21）

本輪結果：**尚待使用者決策及最終驗收，未結案。** 已完成可獨立執行的來源、公開成品、正式 HTTPS 與操作檢查，並準備資料限制揭露修正。自動測試與結構對帳不代表所有遊戲語義或臺灣用語已經人工逐項簽核。

## 固定版本與證據

- main：`55c0d002bd07109c34f15aa021074b16d81224f9`。其 `content/published/content.json` 與已部署基準 `8a4b3db2b1e835f0757f387ca89a19b9092b35ee` 位元組完全相同，SHA-256：`3f3c24874004d67aa7e03b045ca5f9a7409a0bea3e9136247852c26ec2c34bcc`。
- 正式／預覽：build `98034cf0847d344da1d43e9b08e8059fdbad1527a4cfd347b263c3a4958ed013`，data `0ae547d78d49c5d5c46b991df3736f9d868eebd98e902b1a62426dc075d3884b`，遊戲基線 **1.13.1**。
- 本 PR 候選：build `75a9a5bbb34153ef8d891a56401d3c457819b32482b54adf288419b7e51efff8`，資料版本相同。**未合併、未正式部署**；版本以本 PR 建置結果為準。
- [機械對帳摘要](summary.json)、[82 筆公開 HTTPS 觀測](http-audit.json)、[候選畫面](availability-desktop.png)。完整 ID／效果／數值／引用／適用關係仍以固定 `content/published/content.json` 為唯一內容基準，沒有建立另一份可修改的內容來源。
- 既有完整資料保全：`test/published-effects.test.mjs`，以及 `docs/acceptance/player-wording-20261012/` 的逐欄 before／after 審校。既有來源／功能驗收：[SYP-283](https://syuantsai.atlassian.net/browse/SYP-283)、[SYP-286](https://syuantsai.atlassian.net/browse/SYP-286)、[SYP-287](https://syuantsai.atlassian.net/browse/SYP-287)、[SYP-288](https://syuantsai.atlassian.net/browse/SYP-288)。

## 驗收判定

| 項目 | 判定與實際證據 |
|---|---|
| 技能／天賦 ID 與路由 | 通過機械對帳：646 技能、646 機制畫面、7 天賦樹；每個引用及固定 JSON 由公開契約與嚴格成品驗證核對。來源語義沿用已完成的 SYP-283／286 審校，沒有以測試數替代新的遊戲內驗證。 |
| 武器／祝福共同關係 | 通過機械對帳：70 主武器、135 型號、167 祝福、605 變體、1,185 關聯、2,269 catalog entries。70 類主武器 UI、去重關係、共用／差異效果與選單通過既有 smoke；167 祝福及 605 變體效果皆非空。 |
| 效果／條件／數值保全 | 通過變更保全：2240 筆變體等級 claim 皆保留既有 known 狀態與數值，無新增未知值填零；45 筆效果補正、276 筆不適用占位移除、Holy Tools 單筆查核及 767 欄位文字審校均由既有逐欄紀錄與完整相等比較保護。這是來源證據，不是全站遊戲內實測。 |
| 26 項未另附機制 | 已知來源限制，待最終接受：保留效果，機制頁明示「技能效果（來源未另提供機制說明）」，沒有虛構段落。精確 ID 見 summary.json。 |
| 名稱未知 | 待內容驗收：`veteran/veteran_cover_peeking`、`transonic_knife_p1`、`transonic_sword_p1`、`laspistol_p1_m2`、`transonic_knife_p1_m1`、`transonic_sword_p1_m1` 共 6 筆保留 null，介面顯示名稱待確認。不得宣稱全站名稱均已核實。 |
| 遊戲內等級可取得性 | 未證實：605 變體及 1,185 關聯的 available_tiers 皆為 null；本 PR 補上可見說明，區分來源定義與實際可取得性，不猜填等級。 |
| localization／SteamBuild | 通過可追溯關聯核對：固定來源提交的 source/README.md 與本機批次 README 均記錄 1.13.1／Steam Build 25606770、擷取時間 2026-10-02 10:10:42 +08:00。封存包 12 個檔案的大小及 SHA-256 全部吻合，繁中 176,792 筆，名稱字典來源為 7e662fc…；字典 SHA 與遊戲 Build 各自記錄。未做新的遊戲安裝／畫面驗證，沒有將原始封存包上傳至本網站 Repo。 |
| 臺灣用語 | 待最終內容驗收：沿用 767 欄位審校與術語測試，資料位元組未變；沒有新的全站逐詞人工總審校完成宣告。 |
| 範圍及獨立性 | 通過本期檢查：實際 tracked 與發布檔未發現英文入口、對話／字幕／語音、Lua／ZIP／原始資源；公開 HTTPS clone 在無私人來源與舊 IO 路徑下完成測試、建置及完整 smoke。歷史 Worker／R2 程式檔存在不等於執行相依；現行 wrangler 入口為 Static Assets。 |
| 正式／預覽 HTTPS | 82 個唯讀請求中，80 個符合預期；版本、代表性七職業／各內容類型 JSON 的 bytes、MIME、署名與快取相符。另 2 個不存在技能網址回 200，見下方缺口，不將整輪稱為全通過。 |
| 導覽／重新載入／返回／搜尋／鍵盤 | 正式瀏覽器實查恐怖阻擊搜尋 → Enter 開啟 → reload → 返回，保留查詢及頁碼。完整 smoke 覆蓋七職業、646 技能條列、直接深層導覽、前端更新保持狀態；本 PR 增加等級限制的 DOM 可見性檢查。 |
| 320／390px | 既有及本 PR 的完整 browser smoke 通過；包含天賦樹、技能清單與祝福共用／選擇內容。 |
| JSON 故障／重試／版本競態 | 既有 client 與 fault-server 測試通過：錯誤 MIME／schema、缺檔、損壞 JSON、重試、舊版 404、前端更新，以及過期導覽不覆蓋目前位置。針對性 82 Pass／0 Fail／0 Skip；初次 sandbox loopback EACCES 不算產品失敗，未改測試後以相同套件重跑通過。 |
| 素材授權／follow 署名 | 沿用 SYP-283 中使用者已確認的 Games Lantern 中文站圖示許可；代表性頁面初始 HTML 均有可見、直接 follow 連結，無 nofollow／ugc／sponsored；robots Allow: /。不擴張為原創文字翻譯或整包原始資源授權。 |
| CI 無部署 Secret | 通過已調整範圍的 SYP-289：自身 Repo 的 PR CI 建置、deploy skipped。**未要求或宣稱真正 fork 實跑**，也沒有修改或合併 PR #11。 |
| 回復演練 | 沿用 SYP-289 已核實的歷史真實雲端回復／部署結果；舊 Token／403 阻擋已解除，本輪無需重複正式部署。歷史首次部署不能回復的敘述不再代表現況。 |

## 缺圖判定的證據界線

使用者已接受「確認 Games Lantern 缺少則放行」。現有 28 項空白技能映射全屬基礎效果；另有 `hit-and-run-activated` 與 `quickloader`。發布模型有 779 個 asset 定義，與歷史取得 783 個精確網址屬不同度量，不能當作本輪新增下載結果。

本輪以 Games Lantern 已載入的[技能目錄](https://darktide.gameslantern.com/abilities)核對全部 28 個精確 ID 圖檔名，未找到對應；另核對英文名與實際效果。同名的天鷹使節、手榴彈與 Resurgence 等為強化版，不能直接套圖；Resurgence 顯示的是 50% 恢復，本站基礎效果是 25%。巢都渣滓的 Desperado 也不能套用老兵同名被動。

在[祝福目錄](https://darktide.gameslantern.com/weapon-blessing-traits)搜尋 Quickloader 沒有資料列；Hit & Run 僅找到近距離擊殺後遠程免疫的普通版本，未找到本站特殊攻擊命中移速效果。這支持目前來源目錄未提供精確項目；仍不把目錄搜尋或精確檔名缺席當成 Games Lantern 全站絕對不存在的證明。

以下 4 項沒有英文顯示名，僅完成精確 ID 圖檔名核對，仍待精確來源確認：`adamant_command_dog_with_tag`、`ogryn_helping_hand`、`broker_syringe`、`veteran_cover_peeking`。不能僅憑 asset_ids 為空套用放行例外。本 PR 將通用圖示提示改成「尚無對應的專屬圖示」，避免未核實前宣稱原來源缺圖；來源已提供卻漏對應或載入失敗仍須修正。

## 搜尋、分享與 HTTP 狀態缺口

1. 正式及預覽 `/skills/veteran/not-a-real-skill/` 回 **HTTP 200**。客戶端可顯示找不到資料並加入 noindex；HTTP 狀態仍是 200。原因是 `/skills/*` 等廣泛的 Static Assets rewrite。缺失 JSON、圖片及一般未知頂層路徑是真實 404，兩者不能混稱。
2. 首頁與深層網址的初始 HTML 都只有載入文字、共用 title／description，canonical 為 `/`；沒有逐頁 Open Graph／Twitter 卡，也沒有免 JavaScript 的正文。JavaScript 執行後會改寫 title／canonical，robots 與 sitemap 可讀取，但不保證搜尋引擎已收錄或分享平台可呈現單筆內容。
3. 以上需要使用者決定接受為本期 SPA 限制，或另行確定修正需求及架構。這次沒有自行新增 SSR、每頁預產 HTML、自寫 Worker 或私人 R2。

## 驗證與容量

- 新增單元測試先失敗（缺少可取得性呈現判斷），再通過；未知／已知／混合／空集合與輸入保全均涵蓋。
- 完整既有測試：485 Pass、0 Fail、15 Skip。Skip 是需要外部歷史 W01 套件的測試，不算通過。
- `node scripts/prepare-deploy.mjs`：CI／設定邊界、建置、嚴格 2,287 檔驗證、兩環境 dry-run、Cloudflare 本機 runtime、完整 browser smoke 通過。最後的圖示提示文字修正後重跑相同發布前流程；未使用部署 Token、未建立雲端資源。
- 基準發布容量：技能 JSON 1,663,714 B；機制 JSON 1,657,254 B；7 天賦樹 1,840,769 B；武器 347,196 B；型號 635,103 B；祝福 805,000 B；變體 1,833,186 B；catalog 927,320 B；共用／中繼資料 370,492 B；artifact manifest 625,234 B；合計 **10,705,268 raw bytes**。遠端圖片 bytes 不在此總數內，不能當作總託管素材容量，也不與舊全站 520.23 MB 混算。候選 JS 改動會使候選總量略有不同。
- 本期無私人 R2 reads 或自寫 Worker CPU gate；沒有取得帳務或當作雲端成本實測。本輪公開 HTTP 的耗時只作單次技術觀測，不推算人工工時或費用。

## 最終確認前不能宣告完成

仍需決定 HTTP 200 找不到資料頁與搜尋／分享限制的處置；精確來源缺圖處置及內容限制（26 項未另附機制、6 個名稱、實際可取得等級、全站逐詞用語）需明確驗收或接受。若接受候選揭露修正，仍須完成其審查、合併、正式發布後驗證，才能聲稱線上修正完成。SYP-290 保持進行中；不一併結案其他工單，SYP-291／292 的交接／清理不在本輪啟動。
