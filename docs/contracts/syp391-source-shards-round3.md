# SYP-391 分片第 3 輪驗證紀錄

2026-11-08；pwsh 7.6.9、Node 24.19.0；起始 HEAD `60ec16bacb6180361a5dcc7efe2ae776bcfb83c2`。

## 修正與測試範圍

- 部署驗證原本只檢查 source_files 列出的檔案，漏掉超大舊單檔 URL。現在依通過驗證的 manifest，在 totalBytes 超過上限時發 HEAD 並要求 404；JSON 200、SPA HTML 200 均失敗。
- 監控原本已避免 GET 超大單檔；現在由共用部署驗證補上 HEAD 404 檢查。只有 manifest 404 才回退，403、500、格式、片 hash、總 hash 錯誤都不回退。
- transportOptions 從 buildSourceSite / buildSiteData 傳到靜態驗證、部署驗證、監控及本機 server；只有函式依賴注入，CLI 不新增參數。預設 20,971,520 / 26,214,400 bytes 不變。
- test/syp391-fixture.mjs：兩版本、4,096-byte 門檻、6,144-byte 上限，使用合法 JSON 尾端空白調整原始大小。
- test/wp5-build.test.mjs：single、雙份、僅分片；逐位元組原樣、manifest/part/legacy/closure、兩次建置 bytes 相同、未宣告檔/缺片/改片拒絕、完整舊 dist 不變、重新封裝後的錯總 hash 拒絕。
- test/wp5-deploy.test.mjs：分片成功、缺片、片 hash、總 hash、兩種 MIME 錯誤、HTML 200、超大舊 URL 200、CORS/方法/快取錯誤。hash 錯誤案例同步更新外層 source_files 雜湊，確保真正驗到 transport。
- test/operations-source.test.mjs：分片成功、manifest 404 回退及先後順序、403/500/格式/片 hash/總 hash 拒絕、失敗不回退、超大舊 URL 只 HEAD。
- test/syp391-transport.test.mjs：多一片零 bytes，其他欄位與總 bytes/hash 仍正確，專門驗片數。此檢查確實必要。
- 真實 HTTP：fixture 及真實 build 都用 scripts/serve.mjs，只 listen 127.0.0.1；GET/HEAD 驗 .bin octet-stream、manifest JSON、CORS GET/HEAD、immutable、current no-cache，以及缺 manifest/片/超大舊單檔真 404。

## 移除關鍵檢查的回歸實驗

每次只改一項，執行指定測試，再以 finally 還原原始 Buffer 並比對 SHA-256。所有失敗均為預期的測試斷言失敗；實驗後正常測試通過。fail 數含 Node test runner 的失敗父測試。

| 移除項目 | 是否抓到 | fail 數 |
| --- | --- | ---: |
| transport-count | 是 | 1 |
| deploy-legacy-404 | 是 | 1 |
| deploy-transport | 是 | 3 |
| deploy-mime | 是 | 4 |
| deploy-cors | 是 | 1 |
| deploy-cache | 是 | 1 |
| monitor-oversize-get | 是 | 7 |
| monitor-404-only | 是 | 3 |
| monitor-transport | 是 | 3 |
| static-output-limit | 是 | 2 |
| build-transport-manifest | 是 | 1 |
| build-output-closure | 是 | 1 |

## 本機測試結果

- 四個直接相關檔：55 通過、0 失敗、0 略過（新增 24 項，含子測試）。
- 所有可離線執行的 49 個 *.test.mjs：419 項，418 通過、0 失敗、1 略過。
- 略過項：w11-shared-client 的 InterT10_reads_fixed_candidate_skills_blessing_tiers_and_two_weapon_marks_without_byte_changes，因未設定 SYP_W11_APPROVED_PACKAGE_DIR。
- 執行時移除 TOKEN 類與 CLOUDFLARE_* / DARKTIDE_* 環境變數，GH_CONFIG_DIR 使用空暫存目錄；以預載 guard 禁止 Node 非 loopback 連線。未安裝或下載。

直接相關命令：

```powershell
node --test test/syp391-transport.test.mjs test/wp5-build.test.mjs test/wp5-deploy.test.mjs test/operations-source.test.mjs
```

完整可執行集使用 `Get-ChildItem test -File -Filter *.test.mjs`，排除下表 6 個缺依賴檔後傳給 `node --test --test-reporter=spec`。

本機未執行、留待 CI 安裝既定依賴後執行（6 檔、13 項，不計入上述 runner skip 數）：

| 檔案 | 缺依賴 | 項數 |
| --- | --- | ---: |
| test/operations-workflow.test.mjs | yaml | 2 |
| test/wp5-workflow.test.mjs | yaml | 1 |
| test/wp5-frozen-detail.test.mjs | Playwright | 1 |
| test/w13-ranged-web-render.integration.test.mjs | Playwright | 1 |
| test/shared-browser-smoke.test.mjs | 間接 import Playwright | 7 |
| test/wp5-smoke-tiers.test.mjs | 間接 import Playwright | 1 |

`scripts/browser-smoke.mjs`、`scripts/source-browser-smoke.mjs`、`scripts/shared-browser-smoke.mjs` 與 `scripts/verify-deploy-config.mjs` 同樣需要既定依賴，留待 CI。

## 指定真實資料重建

Source-Data commit：`06412cc92ee09d8666bbb073584180c11d004d50`。以本機 origin/codex/SYP-391-current-schema-version 的 git archive 匯出 data 到 ignored 的 .static-build-staging-round3-evidence/source-export。匯出目錄建立本機 Git metadata，以唯讀 alternates 取得既有 objects，HEAD 固定到指定 commit；未修改 Source-Data repo。

```powershell
node scripts/build.mjs --source-data .static-build-staging-round3-evidence/source-export --source-data-commit 06412cc92ee09d8666bbb073584180c11d004d50 --site-origin https://darktide.tw-syuan.com
node scripts/verify-static.mjs dist
```

build 與 verify-static 成功；785 檔；超過 26,214,400 bytes：0 檔。
build_id：`c53234564b534df50e34571ef51a166f35769d6a9e3650746752387419729769`。
data_revision：`7c7f44bdc32aff401596755dec518894fe73aa4bf6c7f2d20833619cf5f96fd8`。

四份 source transport manifest 與本輪開始時保留的上一輪 dist 逐位元組一致。weapons.json 未輸出。

真實產物另外以 loopback 執行 verifyOrigin 與 monitorOrigin，兩者均成功；對超大 weapons.json 的請求各只有一次 HEAD。真實產物的 12 組 GET/HEAD headers／404 檢查亦全數通過。

最大 10 檔：

| 路徑 | bytes |
| --- | ---: |
| source-data/1.13.4/weapons.part-0001.bin | 20971520 |
| source-data/1.13.4/weapons.part-0002.bin | 5609138 |
| data/7c7f44bdc32aff401596755dec518894fe73aa4bf6c7f2d20833619cf5f96fd8/domains/skills.json | 3163307 |
| source-data/1.13.4/skills.json | 2141291 |
| data/7c7f44bdc32aff401596755dec518894fe73aa4bf6c7f2d20833619cf5f96fd8/domains/weapons/transonic_sword_transonic_knife_p1-962c9084de090ef8.json | 1936282 |
| data/7c7f44bdc32aff401596755dec518894fe73aa4bf6c7f2d20833619cf5f96fd8/domains/weapons/powersword_p1-e7ef844a2bf07fb6.json | 1903058 |
| data/7c7f44bdc32aff401596755dec518894fe73aa4bf6c7f2d20833619cf5f96fd8/domains/weapons/thunderhammer_2h_p1-8a2df354a56678ed.json | 1808272 |
| source-data/1.13.4/blessings.json | 1597688 |
| data/7c7f44bdc32aff401596755dec518894fe73aa4bf6c7f2d20833619cf5f96fd8/domains/weapons/ogryn_powermaul_p1-68a870ae228876a2.json | 1552847 |
| data/7c7f44bdc32aff401596755dec518894fe73aa4bf6c7f2d20833619cf5f96fd8/domains/weapons/ogryn_heavystubber_p1-49198ec2a69593a3.json | 1223571 |

source-data/1.13.4 清單：

| 檔案 | bytes |
| --- | ---: |
| source-data/1.13.4/blessings.json | 1597688 |
| source-data/1.13.4/blessings.manifest.json | 444 |
| source-data/1.13.4/skills.json | 2141291 |
| source-data/1.13.4/skills.manifest.json | 438 |
| source-data/1.13.4/terms.json | 86485 |
| source-data/1.13.4/terms.manifest.json | 432 |
| source-data/1.13.4/weapons.manifest.json | 667 |
| source-data/1.13.4/weapons.part-0001.bin | 20971520 |
| source-data/1.13.4/weapons.part-0002.bin | 5609138 |

各 manifest 全文（SHA-256 與上一輪相同）：

### blessings.manifest.json

SHA-256：`e8fcb6afcb552052b28e92af46d071e66d17d9bc9c5af01fb31be31164f3213b`。

```json
{
  "transportSchemaVersion": "1.0.0",
  "representation": "single",
  "gameVersion": "1.13.4",
  "category": "blessings",
  "totalBytes": 1597688,
  "totalSha256": "205485b516bd60bfc0628a3db8195a11be37d3f4e45a690d8c941690e30debfc",
  "parts": [
    {
      "index": 1,
      "path": "blessings.json",
      "offset": 0,
      "sizeBytes": 1597688,
      "sha256": "205485b516bd60bfc0628a3db8195a11be37d3f4e45a690d8c941690e30debfc"
    }
  ]
}
```

### skills.manifest.json

SHA-256：`8515bed62aa83c6c640cd619266e1194097431e140cc4a8979ce5a5675ae8bfc`。

```json
{
  "transportSchemaVersion": "1.0.0",
  "representation": "single",
  "gameVersion": "1.13.4",
  "category": "skills",
  "totalBytes": 2141291,
  "totalSha256": "76378cc634a2206c24715eee330c692e656d0fd6e9f3124091be2909408d8cb1",
  "parts": [
    {
      "index": 1,
      "path": "skills.json",
      "offset": 0,
      "sizeBytes": 2141291,
      "sha256": "76378cc634a2206c24715eee330c692e656d0fd6e9f3124091be2909408d8cb1"
    }
  ]
}
```

### terms.manifest.json

SHA-256：`577b6fbcf622d5cb10fd41c438fb22d8d75762d0a5af51be4d0d95e8e8faae2a`。

```json
{
  "transportSchemaVersion": "1.0.0",
  "representation": "single",
  "gameVersion": "1.13.4",
  "category": "terms",
  "totalBytes": 86485,
  "totalSha256": "459a35e1976d858f885e63ac5270a256ae7b15d22c1254fdcf073382d0e9b626",
  "parts": [
    {
      "index": 1,
      "path": "terms.json",
      "offset": 0,
      "sizeBytes": 86485,
      "sha256": "459a35e1976d858f885e63ac5270a256ae7b15d22c1254fdcf073382d0e9b626"
    }
  ]
}
```

### weapons.manifest.json

SHA-256：`e5926b67c0187cdc97b92bcc72d21e8ae683b5a50bc3bd1ad1238e12a10855cc`。

```json
{
  "transportSchemaVersion": "1.0.0",
  "representation": "raw-byte-shards",
  "gameVersion": "1.13.4",
  "category": "weapons",
  "totalBytes": 26580658,
  "totalSha256": "861e83f6d117496a4d2461ec216ef24d55d1453719b6cc9c04e9d5e351258374",
  "parts": [
    {
      "index": 1,
      "path": "weapons.part-0001.bin",
      "offset": 0,
      "sizeBytes": 20971520,
      "sha256": "44a9fb98269593feedba97115d938674a852189481a5baab16af84f0f23c9a5c"
    },
    {
      "index": 2,
      "path": "weapons.part-0002.bin",
      "offset": 20971520,
      "sizeBytes": 5609138,
      "sha256": "de717c805af1b0873e41eb452aef744259cae22f4e11f3b66282341cc4dea66c"
    }
  ]
}
```

本輪沒有部署、push、外網驗證、重寫既有 commit，沒有略過 hook 或簽章。bootstrap 一次，回報 rate-limit / throttled，使用目前 runtime；未重試。
