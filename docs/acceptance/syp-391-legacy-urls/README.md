# SYP-391 舊網址驗收

已完成四個指定網址的離線 fixture 測試，以及所有對應的 Source-Data 身分查核。實際建置產物另外透過 `createSourceClient` 的 manifest／domain 雜湊驗證，逐一載入 **2,094 個 id／詳情網址與 68 個 family 網址**；所有選定目標均存在。

## 自動化測試

以下 16 個相關、無第三方依賴的測試檔共 **122 個測試通過，0 失敗**。沒有執行整套 `npm test` 或整個 test 目錄。新增測試先確認缺少解析器及找不到處理、武器 id 分檔等行為造成失敗，再完成實作。

```powershell
node --test `
  test/legacy-urls.test.mjs `
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

新增的 `legacy-urls.test.mjs` 共 11 個情境：四個舊網址的改寫與精確 item 呈現、全量 round-trip、645 筆索引與額外 canonical path、全部 155 個 unmapped、未知／空 id 與未知路徑、跨版本、目標缺失、武器分檔與 mark、產生器衝突／鏈、class/nameKey 與模糊名稱拒絕、缺失目標、不相容 variant 與參數保留。祝福範例在固定來源的 `name.zh` 為 null，測試驗證該正確 id 與「名稱待確認」，沒有從舊資料猜補譯名。

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

產生器 `--check` 通過，五份產物與本機快照離線重跑的 bytes 完全一致；更新指令見[契約](../../contracts/legacy-urls.md)。沒有未對應的 migration map query id；28 個無對應技能路徑由索引內 27 筆與額外 canonical 1 筆構成。其餘缺失／歧義路徑見[逐筆清單](../../contracts/legacy-url-unmapped.md)。

```powershell
node scripts/build.mjs `
  --source-data '../SYP-391-source-93185bf' `
  --source-data-commit 93185bf9c070da578701fa398e85da9a08b8d4c4 `
  --site-origin https://darktide.tw-syuan.com
node scripts/verify-static.mjs
git diff --check
```

build 與 verify-static 均通過，共 **787 個檔案**。最大檔為 `source-data/1.13.4/weapons.part-0001.bin`，20,971,520 bytes；所有檔案（含 artifact manifest）均不超過 26,214,400 bytes。對應表已打包為 `assets/1f7f19cd83279fa12eb219f613ecf7cc03644f96ac230897046afa77a7220225.mjs`，305,651 bytes，與產生模組逐 byte 相同，而且由 app 直接 import。rewrite 維持 8 條。

固定來源、build id／data revision、最大的 10 個檔案、`source-data/1.13.4/` 清單及四份 transport manifest 全文見 [build-report.json](build-report.json)。線上僅以 GET 調查；HTML 200 不視為身分成立證據，另查 manifest、domain、canonical routes 及具 hash 檔名的 app/client/renderer，摘要見 [online-get-evidence.json](online-get-evidence.json)。

Source-Data detached worktree 保留且 Git 狀態乾淨；沒有修改 Pipeline、Extension 或遊戲資料，沒有下載套件、呼叫 gh/wrangler、部署或 push。

## 變更檔案

- `README.md`：相容契約入口。
- `.gitattributes`：固定產生檔 LF，確保 Windows checkout 後仍可逐 byte 重跑。
- `scripts/generate-legacy-urls.mjs`：離線產生器與來源驗證。
- `content/compatibility/legacy-urls.json`、`web/legacy-url-map.mjs`：精簡對應表與瀏覽器投影。
- `web/legacy-urls.mjs`、`web/app.mjs`：純解析器、replaceState 與載入前處理。
- `web/source-client.mjs`、`web/shared-render.mjs`：武器 id 分檔、精確選擇與找不到畫面。
- `test/legacy-urls.test.mjs`、`test/fixtures/legacy-url-targets.json`、`test/fixtures/legacy-url-details.json`：離線測試及固定來源 fixture。
- `docs/contracts/legacy-urls.md`、`docs/contracts/legacy-url-unmapped.md`：來源、版本策略、重跑方法與逐筆原因。
- `docs/plans/syp-391-legacy-urls.md`：實作計畫。
- 本目錄的 `README.md`、`build-report.json`、`online-get-evidence.json`：驗證證據。
