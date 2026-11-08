# SYP-391 舊網址驗收

已完成原 spec 四個網址與 family 重組四個武器網址的實際 app 啟動測試，以及所有對應的 Source-Data 身分查核。實際建置產物另外透過 `createSourceClient` 的 manifest／domain 雜湊驗證，逐一載入 **2,098 個 id／詳情網址與 68 個 family 網址**；所有選定目標均存在。

## 自動化測試

以下 17 個相關、無第三方依賴的測試檔共 **129 個測試通過，0 失敗**。沒有執行整套 `npm test` 或整個 test 目錄。新增測試先確認 family 重組與未知 id 的版本交叉案例失敗，再完成實作。

```powershell
node --test `
  test/legacy-urls.test.mjs `
  test/legacy-app.test.mjs `
  test/wp5-client.test.mjs `
  test/wp8b-render.test.mjs `
  test/wp5-build.test.mjs `
  test/wp5-display.test.mjs `
  test/wp5-site-data.test.mjs `
  test/static-build.test.mjs `
  test/static-verify.test.mjs `
  test/cloudflare-routing.test.mjs `
  test/client.test.mjs `
  test/weapon-browsing.test.mjs `
  test/blessing-presentation.test.mjs `
  test/blessing-crosswalk.test.mjs `
  test/retained-skill-tree.test.mjs `
  test/w14-skill-search.test.mjs `
  test/syp391-transport.test.mjs
```

`legacy-urls.test.mjs` 共 14 個情境，包含四個舊網址、全量 round-trip、645 筆索引與額外 canonical path、全部 151 個 unmapped、未知／空 id、未知路徑、跨版本、目標缺失、武器分檔與 mark、產生器衝突／鏈、class/nameKey、缺失目標及不相容 variant。本輪新增 family 重組的四條網址、完整／缺失／歧義 mark 集合與 canonical 來源驗證、未知舊 id 搭配歷史／未知版本；也逐筆驗證全部 1,540 個合法新 id 的版本參數不變。祝福範例的 `name.zh` 為 null，仍驗證正確 id 與「名稱待確認」。

`legacy-app.test.mjs` 新增 4 個整合情境。由獨立 Node 程序載入實際 `web/app.mjs`，使用 DOM stub 與本機 fetch fixture，透過 Node 24 內建的 module mock 觀察 app 傳給真實 client 的 load 參數，所有資料載入與呈現皆執行原實作。原 spec 四個網址同時驗證 replaceState、新 id／1.13.4、唯一 item 與名稱；另驗證重組武器四條網址、未知舊 id 的兩個版本交叉案例，以及合法新 id 選到實際歷史資料／未知版本維持原錯誤。

回歸實驗暫時將 app 中 `applyLegacyUrl` 呼叫換成原 URL，單獨執行入口測試得到 **0 通過、1 失敗，exit 1**，失敗原因為沒有執行 replaceState。之後逐 byte 還原 app，129 個相關測試全部通過。真實資料建置後又以相同 app 入口驗證 8 個成功網址與 2 個未知 id／版本案例；未知 id 在兩種版本均直接顯示「找不到」，資料請求為 0。

本機確認 `yaml`、`playwright` 均缺少，遵守不安裝依賴的限制；以下 6 檔未執行，留給有依賴的 CI：

| 測試檔 | 缺少依賴 |
|---|---|
| `test/operations-workflow.test.mjs` | yaml |
| `test/wp5-workflow.test.mjs` | yaml |
| `test/w13-ranged-web-render.integration.test.mjs` | playwright |
| `test/wp5-frozen-detail.test.mjs` | playwright |
| `test/shared-browser-smoke.test.mjs` | playwright（間接 import） |
| `test/wp5-smoke-tiers.test.mjs` | playwright（間接 import） |

## 重現與真實資料建置

產生器 `--check` 通過，五份產物與保存快照離線重跑的 bytes 完全一致；更新指令見[契約](../../contracts/legacy-urls.md)。unmapped **155 → 151**，移除兩個可還原的武器 mark 與兩個 family 路徑；剩餘 28 個技能、122 個祝福群組、1 個武器 mark。沒有未對應的 migration map query id。逐筆原因見[清單](../../contracts/legacy-url-unmapped.md)。

```powershell
node scripts/build.mjs `
  --source-data '../SYP-391-source-93185bf' `
  --source-data-commit 93185bf9c070da578701fa398e85da9a08b8d4c4 `
  --site-origin https://darktide.tw-syuan.com
node scripts/verify-static.mjs
git diff --check
```

build 與 verify-static 均通過，共 **787 個檔案**。最大檔為 `source-data/1.13.4/weapons.part-0001.bin`，20,971,520 bytes；所有檔案（含 artifact manifest）均不超過 26,214,400 bytes。對應表已打包為 `assets/cc3490a33d8626ec9689efb490026d6f54d9c3a690969f44bb64fa112e5a3cf6.mjs`，316,663 bytes，與產生模組逐 byte 相同，而且由 app 直接 import。rewrite 維持 8 條。

固定來源、build id／data revision、最大的 10 個檔案、`source-data/1.13.4/` 清單及四份 transport manifest 全文見 [build-report.json](build-report.json)。線上僅以 GET 調查；HTML 200 不視為身分成立證據，另查 manifest、domain、canonical routes 及具 hash 檔名的 app/client/renderer，摘要見 [online-get-evidence.json](online-get-evidence.json)。

Source-Data detached worktree 保留且 Git 狀態乾淨；沒有修改 Pipeline、Extension 或遊戲資料，沒有下載套件、呼叫 gh/wrangler、部署或 push。

本目錄與實作計畫已檢查，沒有本機絕對路徑或暫存目錄；契約的產生器指令改用由執行者指定的輸入變數。驗收文件保留可重跑指令、固定來源、測試結果與建置雜湊，不記錄本機執行位置或暫存 log 路徑。

## 變更檔案

- `README.md`：相容契約入口。
- `.gitattributes`：固定產生檔 LF，確保 Windows checkout 後仍可逐 byte 重跑。
- `scripts/generate-legacy-urls.mjs`：離線產生器與來源驗證。
- `content/compatibility/legacy-urls.json`、`web/legacy-url-map.mjs`：精簡對應表與瀏覽器投影。
- `web/legacy-urls.mjs`、`web/app.mjs`：純解析器、replaceState 與載入前處理。
- `web/source-client.mjs`、`web/shared-render.mjs`：武器 id 分檔、精確選擇與找不到畫面。
- `test/legacy-urls.test.mjs`、`test/legacy-app.test.mjs`、`test/fixtures/legacy-app-harness.mjs`、`test/fixtures/legacy-url-targets.json`、`test/fixtures/legacy-url-details.json`：離線測試、實際 app 啟動 harness 及固定來源 fixture。
- `docs/contracts/legacy-urls.md`、`docs/contracts/legacy-url-unmapped.md`：來源、版本策略、重跑方法與逐筆原因。
- `docs/plans/syp-391-legacy-urls.md`：實作計畫。
- 本目錄的 `README.md`、`build-report.json`、`online-get-evidence.json`：驗證證據。
