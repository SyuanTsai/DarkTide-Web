# W09 Source 接線獨立覆核

本頁保留 Source A 的獨立工程驗證；完整 W09 交檢與未完成事項見 [engineering-review.md](engineering-review.md)。這些證據不代表正式發布或整包已獲人工驗收。

固定 Source code：`589f89ea880d33450552029a03f7893b3fb6cb6a`，基準 `8e48334619f448794aab666f1805cb2bd6adf11a`。第一版工程 code `9840a44cda9538b6e60c963e43e3838f0ccc7409` 與其候選來源定位保留。Root 實際 SOL/high 負責獨立覆核與 Git；唯一 Luna/max 負責實作及測試，可信 session metadata 已核對。

## 結果與證據

目前沒有未關閉的 Source A finding。初版缺口經具體重現後修正，歷史 Red 證據保留；有效舊證據依影響範圍沿用，各次修補另列新增驗證，不將舊 Green 冒稱新版本重跑結果。

| 項目 | 結果 | 證據範圍 |
| --- | --- | --- |
| Source 專項 | 14 passed，沿用 | code9840 的 request、packet、Git replay、archive、dispatch、workflow；origin 修正後只重跑受影響項目 |
| Source 完整回歸 | 143 passed，0 failed，0 skipped，沿用 | code9840 精確四檔複製至隔離 clean clone、fixture commit、官方 origin 後執行；沒有冒稱在589f重跑全套 |
| Root 獨立整合 | 7 passed，沿用 | 兩個全新 output roots／metadata commit、實際 Git replay、lightweight／annotated tags、錯 tag commit、偽造 delta、41 字元 SHA |
| origin 修正專項 | 1 passed | 更新原有 InterT02，驗官方無.git origin／尾slash、錯 owner／host、重建與 archive retry |
| origin 獨立複驗 | 6 passed | 四種精確官方 HTTPS origin 寫法實際 Git replay、兩個錯 owner／host 拒絕；六檔 bytes 與 W08 相同 |
| 語法與格式 | passed | 兩個 JS 的 `node --check`、staged `git diff --check`；兩個 YAML 用鎖定 yaml 2.9.1 解析，0 errors |
| 真固定候選重建 | passed | code9840、acceptedW07 refs，六檔 raw bytes 全等於 W08 原快取 |
| Source PR 自然 CI | 143 passed，0 failed，0 skipped | PR head589f；W09 run39410860723以PR merge checkout c1baffde6defbeee8db2c364ea2756d6374b86f5執行全套58.1秒，pending request prepare成功；既有W01 source-preview run39410860547亦SUCCESS；formal-handoff按PR條件SKIPPED |
| 歷史保全 | passed | 16 份 W08 固定檔與原 Git bytes 相同；既有 Source 實作／資料不變；既有 W01 CI 只加 full-history fetch；使用者 F checkout 與 Mods HEAD 保留 |

重建得到 Source revision `fa83649a220c3593d6bc9bda6c05b71fdb30f60783fb0b37c11298ab19ba0662`、manifest SHA256 `41227789afd6dd00d9915040509f1e5be517e0d4fb23c9850c76d65e10e489b4`。兩個 gameRelease 的 changedRecords／changedClaims 均為 0；Source code metadata 變更沒有被誤當成技術資料變更。完整 request 與六檔定位在 `content/contracts/w09/source-handoff/evidence.json`；大型 packet 沿用 W08 既有快取。

Web 唯一 Source 協定快取直接取589f commit 的 raw Git blob，74914 bytes，SHA256 `4f0b8e21df772e725438778858f79ff81de269e13913ed6e5ca64262b6ae9206`；來源定位與驗證值見 `content/contracts/w09/source-request.lock.json`。metadata-only code 修正沒有改動技術候選的原9840來源定位；evidence.json 分別記錄 sourceCodeCommit 與原 request sourceCommit。

## 已修正的具體行為

- 固定官方 repository／完整 Git SHA、三角色輸入 blob 及 W05 runtime bytes，從固定 Git 重播六檔並比對 delta；不能信任手填 eligibility 或 changed claims。
- Source archive 依內容識別並驗既有 bytes；缺 Web credential 時 Source archive 可獨立保留，dispatch 回報 pending。
- release ID 可解析固定公有 archive，並核實實際 Git tag 對應 request commit。支援有界 annotated tag 解參照。
- GitHub asset 200／302 皆可處理；跳轉限 HTTPS GitHub asset host、次數受限、不轉送 Authorization、不輸出 signed URL。
- 全新 runner 的 metadata-only retry 取回既有 archive 原 request，重新核對其原始 Git provenance 與六檔內容，再 dispatch 同一個 release ID。
- 固定版 checkout 會產生無 `.git` 的 HTTPS origin，已先重現拒絕再精確接受兩個官方 URL 與尾 slash，沒有放寬其他 host／owner。[固定 action 原始碼](https://raw.githubusercontent.com/actions/checkout/d23441a48e516b6c34aea4fa41551a30e30af803/src/url-helper.ts)

## 尚未執行與保留限制

成功 formal 測試只使用隔離、明示 test-only 的代表資料與 stub HTTP；沒有加入真實人工內容批准、沒有實際發布 Source archive 或觸發 Web dispatch。實際候選仍 pending／publicationEligible=false／buildIdentityVerified=false；869 pending、0 正式 receipts 與四項 W07 限制不變。

實際 GitHub 查核：Source Actions secrets=0，跨 repo credential 未配置；Source provider immutable releases `enabled:false`、`enforced_by_owner:false`。工程不可變契約以固定 Git／hash、內容定址及拒絕覆寫建立，沒有聲稱 provider 已鎖定，也沒有修改設定或增加管理權限。自動 workflow 必須先存在 default branch；feature branch 測試不能當成真觸發已驗。

Source push 本輪曾被 automatic approval review 以外傳程式碼授權不足拒絕；使用者後續明確授權推送兩個 repository 並建立待審 PR。Source589f已推送並建立 [PR #2](https://github.com/SyuanTsai/DarkTide-Source-Data/pull/2)，OPEN、autoMerge=null。PR 的 [source-preview CI](https://github.com/SyuanTsai/DarkTide-Source-Data/actions/runs/39410860547)／[source-validation CI](https://github.com/SyuanTsai/DarkTide-Source-Data/actions/runs/39410860723)均SUCCESS；formal-handoff按PR條件SKIPPED。新自然CI另列，原本機143測試仍保留其9840範圍；沒有正式發布或觸發證據。

不合併 main、不正式發布、不切換 active、不進 W10、不清理 Mods、不記錄工時。
