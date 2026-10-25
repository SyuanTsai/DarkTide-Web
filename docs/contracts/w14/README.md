# W14 遷移索引

本頁索引 W14 的固定來源、完整 W03 列對帳、歷史閱讀入口與可重建輸出。W14 outcome bundle 是已驗證的遷移清冊；它不會選取或發布 W09 owner candidate，也不會改寫目前網站內容。

## 目前網站與現版對帳

正式網站的 `1.13.2.2` shared package 由 Source 技術資料與 Web 文案組成，對應遊戲版本 `1.13.2`、`SteamBuild_25681127`、data revision `82b79e47e88717b4237655fe4909f0754bac18238c3a23530b985effd60f3130`。可由[版本資訊](https://darktide.tw-syuan.com/version.json)查看，其指向[現版 manifest](https://darktide.tw-syuan.com/data/82b79e47e88717b4237655fe4909f0754bac18238c3a23530b985effd60f3130/manifest.json)。[`content/published/content.json`](../../../content/published/content.json) 是保留的 `1.13.1` legacy baseline，不是現版唯一資料來源。W14 清冊以固定 W13 owner candidate 作 digest-bound review basis；該 candidate 標示 `candidateOnly=true`、`publicationEligible=false`，W14 不執行選取或發布。

- [Domain 與歷史來源矩陣](domain-matrix.md)列出現版必要領域、歷史輸入、26+9 個 Extension inputs、631 篇舊 player guides、260 筆 weapon registry membership 及各自的證據邊界。
- [Source 現版逐列對帳](source-current-row-reconciliation.json)及 [Web 現版逐列對帳](web-current-row-reconciliation.json)包含原 W03 row hash、精確 target、owner、selector 與 review/dependency 證據。完整工具輸出另綁定這兩份固定檔案的 SHA-256。
- [Weapon registry 對帳](weapon-registry-current-reconciliation.md)記錄 260 筆既有 registry membership 和精確的現版 join；它不代表遊戲內可用性或完整武器目錄。

固定的 7,408 筆 current-snapshot-candidate rows 為 6,840 Source、559 Web presentation、9 Web source-lock rows。對帳輸出 7,391 筆 `migrated`（其中 5,673 筆使用已核准的直接內容／技術 target，1,718 筆為有固定欄位依據的 metadata、身份或 schema 轉換）及 17 筆明確的 W15 announcement deferrals，沒有未解 current gap。`migrated` 的 metadata 子類不是新的 gameplay approval。W03 ledger 保持原始 `planned/not-started` 狀態；本清冊記錄逐列 outcome，不回寫原 ledger。

## 可重建的完整 outcome bundle

固定輸出位於 [`outcomes/final-20261025/`](outcomes/final-20261025/)；bundle manifest SHA-256 為 `11ff6e3aa0203ca6f96893e89a947b2549b4c8bd102acf9c5cdea6ab49a866d2`（7,933 bytes）。A overlay manifest SHA-256 為 `4bce102cb853ba3cc79e84b69c0f547fb83c5ebbea159a91ddc55edbed3e1322`；Mods overlay manifest SHA-256 為 `b213b785a7cca4dfb70d6795c778a51066d54fb1143ebf29887ff76fc2d762e5`。完整輸出共 441 個檔案、119,148,489 bytes。

| 輸出 | 固定列數 | 結果 | 說明 |
| --- | ---: | --- | --- |
| A | 1,315,656（393 shards、17 groups） | 1,236,300 archived-readable；70,937 kept；1,011 excluded；7,391 migrated；17 deferred-w15 | 包含全部 393 個 W03 A shards；current 7,408 列已按上節分類。 |
| Mods | 191,861（45 shards、10 groups） | 107,060 archived-readable；79,014 private-restorable；1,094 kept；4,693 deferred-w15 | M01 是公開歷史封存；M02/M03/M04 使用 private preservation 摘要；M05/M06/M07/M08 明確延後至 W15。 |

### 重建與驗證

需要 Node.js 24 和一份含固定公開 Source Git objects 的 Source repository clone。從 Web repo 根目錄執行：

```sh
node scripts/content/build-w14-outcomes.mjs --source-root <Source-repository-clone> --output-root <new-output-directory> --mode all
node scripts/content/build-w14-outcomes.mjs --source-root <Source-repository-clone> --output-root <existing-output-directory> --mode verify
```

建置命令要求輸出目錄尚不存在。預設會透過既有 W09 Source resolver 取得並驗證固定公開 archive；離線重建可提供從該 archive 經既有 Source archive verifier 驗出的 `technical.json`：

```sh
node scripts/content/build-w14-outcomes.mjs --source-root <Source-repository-clone> --source-technical <verified-technical.json> --output-root <new-output-directory> --mode all
node scripts/content/build-w14-outcomes.mjs --source-root <Source-repository-clone> --source-technical <verified-technical.json> --output-root <existing-output-directory> --mode verify
```

程式會核對固定 `technical.json` bytes/hash、Source archive identity、W03 ledgers、候選與 reconciliation pins。`verify` 會重開每個 overlay shard，核對來源 row/descriptor、壓縮與解壓 bytes/hash，並用共用 completion verifier 重新檢查每筆 outcome 的 destination、owner、selector、review/dependency 證據及私有保存摘要。它不會把候選設為 selected 或執行發布。

固定輸入可追溯至 [W09 Source release archive](https://github.com/SyuanTsai/DarkTide-Source-Data/releases/tag/w09-source-w09-810d0f41e9904265b7c53f4d2c610eab)：release ID 為 `w09-810d0f41e9904265b7c53f4d2c610eab`，archive SHA-256 為 `ae6137c70e9ea197f8f077a141511ac321f1179b1a18554870f2539ea72ef03c`。該 release asset 是 JSON archive，不是 ZIP；其中 `technical.json` 固定為 6,639,711 bytes、SHA-256 `052514ee1a1dc8d4754189f3ca1c3dbc626b1e7577b282b3de001f03ed459dd2`。W13 owner candidate、來源 domains 及其 review receipts 以 manifest 中固定的 Git commit/path/blob/SHA 描述；[candidate 檔](https://github.com/SyuanTsai/DarkTide-Web/blob/100e3c0339078b5ed985e103d0ead818c361feb9/content/contracts/w09/prepared/w09-1a09e5ffcc1daf5358d2692b9234c9db/candidate.json)是 review basis，不是 selected package。

## 歷史輸入與玩家閱讀

- [1.13.1 歷史摘要頁](https://darktide.tw-syuan.com/history/1.13.1/)是獨立唯讀入口，不改變 current data revision。
- [歷史 manifest](../../../content/history/1.13.1/manifest.json)及 [player index](../../../content/history/1.13.1/player-index.json)綁定原始來源與明確投影。來源 inventory 為 646 skills、70 weapons、167 blessings、135 marks、605 variants；玩家投影為 645 skills、68 weapons、167 blessings、132 marks、605 variants（共 1,617 筆）。另排除 1 skill、2 weapons、3 marks，原因是缺少已核准的繁體名稱；沒有以英文或 ID fallback。
- [M01 歷史封存 manifest](https://github.com/SyuanTsai/DarkTide-Source-Data/blob/805fa5ea3df2482419c967b4e82d019b65338065/content/legacy/mods/241ad76/m01-manifest.json)描述 241ad76 snapshot 的 3,071 個原始檔與 107,060 個 W03 rows，保留原路徑及原始 bytes。這是來源保存證據，不是 1.13.2 current approval。
- W03 固定 Extension inputs 另以兩份 Source-owned manifest 封存： [26-file archive](https://github.com/SyuanTsai/DarkTide-Source-Data/blob/805fa5ea3df2482419c967b4e82d019b65338065/content/legacy/w14/extension-inputs/manifest.json)及 [additional 9-file archive](https://github.com/SyuanTsai/DarkTide-Source-Data/blob/805fa5ea3df2482419c967b4e82d019b65338065/content/legacy/w14/extension-additional-inputs/manifest.json)。這 35 份輸入依原固定 commit/path/hash 保存；本次不將舊輸入直接宣稱為 current-approved。
- 631 篇歷史 player guides 依各自已固定的舊版 source approval hashes 保留其來源身份：618 篇 ability guides 綁定 `reviewed-abilities.json` SHA-256 `0627d999…`，13 篇 blessing guides 綁定 `blessing-mechanics.json` SHA-256 `4b06b82c…`；兩者都源自 `SteamBuild_25606770_1.13.1`。舊版依賴不會轉成 `1.13.2` 的新核准。
- [Private preservation public summary](private-preservation-public-summary.json)僅提供可公開的範圍與驗證摘要。M02/M03/M04 的 79,014 筆範圍有遠端封包驗證與 11 個樣本 restore；沒有聲稱完整 restore，也不在此索引公開私人 locator、原始內容或本機路徑。

## Outcome 邊界

- `archived-readable`、`kept`、`private-restorable`、`excluded` 與 `deferred-w15` 分別表示來源保存、固定來源保留、私有保存摘要、固定排除及延後工作；它們不等同 gameplay review approval。
- 17 筆 Web announcements 及 Mods M05/M06/M07/M08 的 4,693 筆 rows 明確 deferred，沒有計入 W14 已完成遷移。
- 260 筆 weapon registry 是既有 Source membership 和現版精確 join 的清冊，不宣稱完整 availability、掉落範圍或全遊戲 catalog。
- W14 未使用受保護的原 Extension working-tree review bodies 作遷移輸入；對該等 bodies 沒有新的完整 hash readback 收據，因此本索引不聲稱它們已重新核驗。
- W15 公告與 prompt/tool 全量、W16 商店資料、W17 刪除/退役仍屬後續範圍；W14 不宣稱這些工作已完成。
