# W11 Web 顯示工程交付｜SYP-343

**2026-10-23 最新驗收範圍與授權：** 使用者要求只完成 W11 主要目標，外部 Games Lantern 快照與 Source 精確版本對應不再作為本包收尾阻擋項，停止延伸調查。使用者已授權必要 PR／main 合併、此單一既有批准候選 selected、必要配號與正式網站部署供驗收。以下隔離交付時的操作限制作歷史記錄，以上述最新授權為準；測試結果與真站未通過項不改寫。外掛 unknown 保留原站；W12–W17／全量遷移／商店發行不在本輪。正式 shared artifact 的部署檢查另補本輪實測收據，不能以舊 legacy CI 取代。

本輪發布前修復：原 `scripts/browser-smoke.mjs` 只認 legacy 目錄與 DOM，對真批准 shared artifact 重現「技能與天賦 !== 技能」的語意失敗。現於 `verifyStaticPackage` 成功後按 shared metadata 執行新的 shared smoke，legacy 全部檢查保留。真原始 manifest／四域、技能官方與五節、LV1–4、兩型號 Source 數值／連段、直接刷新、390px 與資料中斷不退 legacy 均通過；同名型號以已選 mark 標籤等待，避免舊 DOM 造成錯判。既有 InterT10 加入同一 CLI 後 1/1 通過，Root 另獨立執行 CLI 通過；私有 legacy artifact 的 2,269 entries／646 skills／7 trees 亦通過。Windows Node／Playwright／Chromium 版本沿前述收據，不新增依賴。

單一批准候選的 `selected.json` 經既有 validator 驗證，與固定提案逐 bytes 相同（SHA-256 `10581f7c753f6a0147897841f603d4b5191b00aa6726cdad45d49bedbfdd9bf2`），納入本次發布提交；Source archive、批准四域及人類收據不改。此 commit 尚未分配正式 contentVersion 或宣稱部署成功，實際 main CI／配號／HTTPS 與使用者驗收另記收據。本機本輪證據在 `.tmp/w11-acceptance-deploy-20261023/`，保留原失敗與後續成功收據，不回造 Red。

Web 工程切片已完成；W11 整體仍在進行中。Extension 的可逆 DOM／MV3 接線另由[草稿 PR3](https://github.com/SyuanTsai/Darktide-GamesLantern-Assisted-Translation/pull/3)記錄，Games Lantern 原站與 W08 `1.13.2` 完整身分的可靠對應仍缺。受控瀏覽器成功不能取代真站正向適配。

## 固定範圍

- 基準：PR15 `b4b11ec055adad42bb6732f833946886446e89cd`；W10 Extension `fbb11f526ea31c4d238fe843fb1e4ecdabbabb69`。
- Web 程式 commit：`87315a748b61d1bac1347ab7529cd4fc8ace4b0b`；[草稿 PR17](https://github.com/SyuanTsai/DarkTide-Web/pull/17) 以 PR15 分支為 base，只呈現 W11 差異。較早程式基準為 `1960fc207194cebfc8e895e4046c93c88beb18c9`。
- 同一位實作者：實際 session 核實 `gpt-6-luna/max`；Root `gpt-6.1-sol/xhigh` 負責計畫、覆核、Git 與 Jira。
- 不合併任何 main／PR15／PR2、不 selected、不保留或分配正式 contentVersion、不正式發布／production rollback／新增公開 Source archive。不新增 token、審核門檻、依賴或資料 owner；武器圖片未實作，Private／Mods 未變更。

## 使用者可見行為與需求

| 對應 | 已完成的 Web 行為 | 直接程式／測試 |
| --- | --- | --- |
| R04／W08–W11 | 從既有可信 `shared_game_version/shared_data_revision/game_releases/shared_files` 選精確版本，驗 manifest 原始 SHA 後只取同 origin 四核心資料域；無 shared context 沿用 legacy，有但不合法則繁中失敗，不混版 | `web/shared-client.mjs`、client tests |
| R05／R06 | 名稱、同版官方原文及解析文字、獨立錨定勘誤、可鍵盤展開的「詳細說明」五節與共用術語；空節省略，不用英文補缺譯 | `web/shared-view.mjs`、`web/shared-render.mjs`、view／Chromium tests |
| R06 | 精確 blessing／variant／tier；已確認四階的 Web 初始閱讀保留 LV4，LV1–4 整組切換。明確未知 tier 拒絕；weapon context 未提供時只讀祝福，適用關係列未知；限定武器查詢仍要求 Source 明確 refs | view／Chromium tests |
| R07 | 每 family 一入口，mark 頁籤切換各自的 claims／units／curve 原節點、stat tables／semantics、攻擊段用途、連段 from→to／條件及 profile／branch 對應。不計算傷害或掉落上下限 | view／Chromium tests |
| R07／未知保真 | 60/80 是比較點；理論範圍與實際可取得範圍分開。Source 未提供的取得範圍保留未知，護甲類別無已確認繁中顯示名時保留必要 classKey 定位，不混成敵種類別或猜譯 | armor／source-link Red→Green 及逐列 browser 斷言 |
| Web 閱讀 | 繁中主導航、搜尋、aria／metadata，內容身分保留於 canonical，純搜尋 query 排除；既有 noindex 保留。完整引擎欄位路徑收在「來源定位」，其他技術關聯由使用者展開 | 同一 `web/app.mjs`／hash module graph、desktop/mobile／keyboard |

尚無可靠的原站 game version／snapshot 證據時，不能因同名 patch、相同官方句子、opaque ID、URL 或頁面自填 version 就授權 `1.13.2` 注入。這是資料證據缺口，不是 token 或設定缺口；不新增人工閘門。

## 固定輸入與原始 bytes

manifest SHA：`bf655afeda2d183e4788860efca23740131b697830bd1d88b0d866b27d5278c7`。

dataRevision：`808c815b78f71adaefe2c29095e9bafbeb8c69415d50f6de50a41093664dbd62`。

| 域 | bytes | SHA-256 |
| --- | ---: | --- |
| skills | 165051 | `108628d9c9262541bd95741fcc0ef52b08ff874d02ce11eb0684bb52ef6da449` |
| blessings | 113990 | `3e72d21be03b7beb966558665b7a4eb3fb389ea23fab8cf7c1cf722a409b22b5` |
| weapons | 6662191 | `17a554bfc2a4a444b8e4cf89de64e698182deb1936ccebebd10f37f64c4f617a` |
| terms | 124557 | `602cb6aca68e6add34aaa8eb0552efbba66324a97e7c4fbc406f03c0932b78f6` |

合計 `7,065,789` bytes。`1.13.2.1` 只是隔離提案；actualContentVersion=null、selected=false、allocationReserved=false。測試使用既有 `buildStaticSite({sharedRelease})`、同一 app 與同源本機靜態伺服器，沒有部署。測試故障包在獨立記憶體重新封存；原批准檔案的大小／hash 前後一致，未變更 authoring 或收據。

## 驗證結果

既有 Windows Node `24.19.0`、Playwright `1.64.0`、Chromium `156.0.8078.4`；未安裝或更新套件。需要真瀏覽器及 IndexedDB／本機網路時，僅以既有 sandbox escalation 執行隔離驗證，不調整產品行為繞過沙箱。

1. W11 共 **30 項**，涵蓋實際批准四域、精確 shared tuple、HTTP／MIME／redirect／final URL／UTF-8／大小／hash／schema／patch／feature／dependency／逾時取消，以及同 app desktop/mobile／keyboard、LV/mark 切換、逐列來源關聯、獨立勘誤、搜尋與 metadata。武器的 canonical 官方描述、typed-context 術語與有效／失配勘誤由新增最小 fixture 驗證；批准真資料沒有新增空區塊。
2. Root working clone 的非 browser 定向連同既有 client／static-build／shared-static-release **45 項**回歸，合計 **74 pass／0 fail／0 skip**。較早 default sandbox 嘗試有12項 TEMP rename EPERM及1項讀到仍修改中的 fixture，保留失敗紀錄，不作通過或語意 Red 收據；固定檔案後的既有隔離執行通過。
3. 固定 `87315a7…` 的獨立 Windows clean clone，加入完整同 app browser 後為 **75 pass／0 fail／0 skip**；只連到既有 node_modules，沒有安裝，Git 狀態乾淨。桌面與手機截圖均與先前已覆核畫面逐 SHA 相同，原 W11 證據未覆寫。
4. 既有 `scripts/browser-smoke.mjs` 對隔離 legacy build 通過：2,269 目錄 entries、646 技能、7 天賦樹、祝福階級、關聯導航、直接 refresh、更新時保留列表狀態、320/390px 版面。內部 package_kind=published 只描述既有輸入格式；此次完全離線建置，未部署。

固定程式 `87315a7…` 的 GitHub [CI run 39868715805](https://github.com/SyuanTsai/DarkTide-Web/actions/runs/39868715805) 已成功：563 pass／0 fail／17 skip（既有15項及兩個W11本機輸入opt-in），驗證2290個靜態檔案並通過既有browser smoke；deploy與backup均skipped。CI build ID為 `81cd76f52a5b1aa3e5c57558852109c861a38c30594f87aca04d9b114c595e32`，資料revision維持既有 `0ae547d7…`。較早 `1960fc2…` 的CI收據亦保留。這些都是 PR 驗證，沒有 main 合併或正式站點發布。

實際定向命令（`node` 使用上述既有執行檔）：

```powershell
# 指向已驗的本機固定候選及既有 Chromium，不安裝工具。
$env:SYP_W11_APPROVED_PACKAGE_DIR = '<fixed-candidate-directory>'
$env:SYP_W10_CHROMIUM_EXE = '<existing-chrome.exe>'
node --test test/w11-shared-client.test.mjs test/w11-shared-view.test.mjs test/w11-shared-app.integration.test.mjs test/client.test.mjs test/static-build.test.mjs test/shared-static-release.test.mjs
```

一般 CI 沒有提供本機固定候選／既有 Chromium 時，兩個 opt-in 真資料／browser 測試會明示 skip；不得計入 pass。本機上述收據均有提供兩者且零跳過。GitHub 的既有工作流程結果另記，不以候選 CI 取代 Windows 真候選收據；PR 事件不符合 main 正式部署條件。

本機證據保存在本次 task 的 `.tmp/w11-startup-20261023/`：`phase3b-root-web-final-targeted.log`、`phase3b-root-web-clean-clone.log`、`phase3b-web-clean-clone-receipt.json`、`phase3b-web-root-review-result.json`、本次 desktop/mobile PNG，以及原 `phase2-root-*` 紀錄。初始 client Red 是缺少模組的最小測試；後續 browser selector／sandbox 失敗與真正語意 Red 分開保存，未把基礎設施失敗冒稱功能 Red。armor、來源關聯、折疊定位及武器註記的行為 Red／Green 均保留可用原始紀錄。

沒有另為可逆文件／樣式變動建立重複單元測試；新增邏輯以必要 unit 加同 app 真 browser 驗證。

## 後續與回復

Web 此切片沒有未解阻擋 finding。Extension 工程及其接線驗收以草稿 PR3 的獨立收據為準；W11 整體仍需可靠 native identity 正向證據。W13 完整近／遠程及跨端代表集、W12 官方變更、W15 全量移交及 W16 商店／正式部署不在此結果冒稱通過。

停止使用此隔離候選或只 revert 本分支的 W11 commits 即可回復；沒有正式站點切換或 production rollback。原使用者 checkout、五份 dirty review 檔、41 份 W09 與 22 份 W10 凍結證據均另以 hash 核對保持。
