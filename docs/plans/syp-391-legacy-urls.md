# SYP-391 舊網址相容實作計畫

## 1. 目標與範圍

- 將已知舊 query id 與舊詳情路徑改寫為 Source-Data 的網址，使用 `history.replaceState`，並顯示正確項目。
- 所有已知舊網址固定使用 1.13.4；不明網址、無唯一對應或目標缺失顯示「找不到」，不得退回整份列表。新 id 的版本選擇維持原行為。
- 來源為 migration map、GET 保存的線上 skills domain、Web 留存的 1.13.1 索引與 canonical routes，以及 Source-Data `93185bf9c070da578701fa398e85da9a08b8d4c4`。
- 不修改其他 repository、不安裝依賴、不部署、不 push；最後建立指定的新 commit。

## 2. 證據與預定修改

- `scripts/generate-legacy-urls.mjs`：離線產生精簡 JSON 和瀏覽器模組，保存來源 SHA-256、腳本版本、逐筆 unmapped 原因。重複來源可同結果；衝突、鏈、循環必須失敗。
- `.gitattributes` 固定產生檔為 LF，避免 Windows autocrlf 使離線重跑與已提交產物 bytes 不同。
- 技能 query 以線上 `payload.nameKey` 加 class 對到 Source-Data `source.text.keys.name`；技能詳情以留存索引的 class 和內部 key 精確比對。class 別名為 arbites→adamant、scum→broker、skitarii→cryptic。645 筆索引中 618 筆可對應，27 筆基礎效果沒有相同 class/key；原先 35 筆中有 8 筆可由 class 消除歧義。
- 補查 canonical routes 另有一筆未納入 player-index 的 `veteran_cover_peeking`，同樣列為 unmapped；與 645 筆索引統計分開驗證。
- 其他留存詳情只使用 canonical route、variant 內部 key、武器 mark key；多個不同目標不得任選。武器 family 路徑使用既有 family 查詢契約。
- `web/legacy-urls.mjs`、`web/app.mjs`：在 Source-Data 載入前解析與改寫，保留可用的 tier 等參數；舊 blessing variant 已合併進新 blessing item，移除已無實體的 variant 參數。
- `web/source-client.mjs`、`web/shared-render.mjs`：武器 id 透過 index 載入正確 family shard；詳情查詢必須精確選定項目；未知路徑與空 id 顯示找不到。沿用 wildcard SPA rewrites，不新增逐筆規則。

## 3. 測試情境與 TDD

- Red：先新增四個指定舊網址、未知 id/path、版本改寫、資料缺失及武器 id 的離線測試，確認因行為尚未實作而失敗。
- Green：實作最小解析與呈現；使用 fixture 驗證四個網址的實際項目名稱和 id。
- Refactor：保持純解析器、離線產生器和 DOM 呈現分工，重跑相關測試。
- 全量 round-trip：每筆 id/path 必須終止在存在的新 id；驗證衝突、鏈、循環、所有 unmapped 原因與數量。commit 精簡 Source-Data 身分 fixture，另對真實來源重驗。
- 回歸：現有 Source-Data client/render/build、靜態路由與無外部依賴的相關測試。缺 yaml/playwright 的測試留給已安裝依賴的 CI。

## 4. 交付與驗證

- 從保留的線上快照重跑產生器並比對 bytes；測試不連網。
- 用指定 Source-Data Git HEAD 建置並執行 `verify-static`，確認對應表模組可從 app import graph 抵達、規則數未增加、沒有超限檔案。
- 文件列出相容與版本策略、來源及更新指令、全部 unmapped。
- 回復方式：還原本次 Web commit 並以原來源重建；不改來源資料、不遷移持久狀態。本輪只建立本機 commit。

## 5. 風險

- 不同職業共用 key 必須加入 class；不使用名稱相似度。
- 舊群組可能包含多個新實體，沒有唯一目標時明確顯示找不到。
- 網路只用於 GET 調查與保存快照，正式測試與產生器使用檔案輸入。

## 6. R5 review 修正計畫

- L1-001：保留留存 canonical route 與實體的來源驗證，mark 以精確 key 判斷唯一性。family 重組時，以完整 mark_ids 證明所有成員均存在且唯一指向同一 item 才改成 id；不得擴大成包含其他型號的新 family。先加入兩個 mark、兩個 family 路徑及歧義／缺失成員／未驗證來源的失敗測試，再修產生器並重產五份輸出；預期 unmapped 由 155 降到 151。
- L1-002：以 DOM stub、本機 fetch fixture 載入實際 `web/app.mjs`，從啟動入口驗證四個原 spec 網址的 replaceState、載入參數的新 id／版本，以及唯一呈現項目。測試不得自行呼叫解析器代替 app。暫時移除 app 解析器呼叫，確認此測試失敗，再逐 byte 還原。
- L1-003：未知舊 query id 在版本驗證前進入 not-found。用固定來源的精簡新 id 身分清單辨別合法新 id，保留新 id 的既有版本選擇。先測未知舊 id 搭配歷史／未知版本，再測合法新 id 的歷史版選擇與未知版本錯誤維持原狀。
- 驗證：只跑明列且無第三方依賴的相關測試；離線產生器 `--check`；以 Source-Data `93185bf` 建置及執行 verify-static。同步更新契約、驗收統計與固定建置證據，檢查驗收目錄與本計畫不含本機絕對路徑或暫存目錄。
- 邊界與回復：只修改本 worktree、不安裝或下載、不部署或 push；暫時變更用備份 bytes 還原，完成所有 finding 後建立指定的新 commit。沒有持久資料遷移；若需回復產品行為，可還原本次 commit 並重建。
