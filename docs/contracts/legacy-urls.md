# 舊網址相容契約

本契約只作用於 Source-Data 網站。`content/compatibility/legacy-urls.json` 是權威對應表；`web/legacy-url-map.mjs` 是同一產生器輸出的瀏覽器投影。測試逐欄比對兩者，建置沿用既有 hashed ESM import graph，無額外線上對應表請求，也不修改資料原檔。

## 解析與版本

- 已知舊 query id 使用一次查表，以 `history.replaceState` 改成新 id；已知舊詳情路徑改為該類別的 `/?id=<新 id>`。仍存在的武器 family 路徑改為 `/weapons/?family=<原 family>`；已改名的舊 family 若完整 `mark_ids` 唯一對到一筆新 item，則改為 `/weapons/?id=<新 id>`，不擴大成整個新 family。
- 所有會遷移的舊 id／路徑一律設定 `version=1.13.4`，即使原 URL 指定 1.13.2、1.13.3 或未知版本。只在舊版本存在、且 1.13.4 無精確對應的項目顯示「找不到」，不改用歷史列表。
- 新 id 與既有 `/weapons/?family=...&mark=...` 仍依 `version` 選資料；這種 family/mark 格式的新舊網站相同，無須遷移。武器 mark 接受完整內部 key（例如 `autogun_p1_m1`）、資料中的短 mark（`m1`）或新 id，必須精確選中項目。舊 query 武器 id 也能經 index 載入所屬 family shard。
- migration map 的 1 筆術語 id 前後相同，保留在表中作為已核對的終點，不觸發 replaceState，也不改其版本。
- 能繼續使用的其他參數與 hash 保留。舊祝福的 variant 已由 Source-Data 合併為新 blessing item；當 variant 等於該舊 id 對應的 `darktide:blessing-variant:...` 或新 item 的內部 key 時移除，保留 `tier=4` 等其他參數。不相容的 variant 顯示「找不到」。
- 空 id、不存在的 id、未知詳情路徑、unmapped 路徑，以及對應後目標不在該版資料中，均明確顯示「找不到」與返回列表連結，不呈現未篩選的列表。返回連結是使用者主動操作。
- 未知 query id 在資料載入與版本驗證前直接判為 not-found，即使帶歷史或未知 `version` 也不顯示可重試的驗證錯誤。產生器以全部對應目標加上 `additionalIds` 補集保存固定來源的完整新 id 身分集合，不以字串外觀猜測新舊；這些合法新 id 仍交由原 client 選版，未知版本維持原驗證錯誤。
- 靜態部署沿用 `/skills/*`、`/blessings/*`、`/weapons/*` 的 SPA 200 rewrite；client 保留原 pathname 解析。總共仍為 8 條 rewrite，沒有新增逐筆規則，低於 `src/static/routing-policy.mjs` 的 2,000 條上限。`/data/` 與 `/assets/` 缺檔規則不變。

## 可重現的身分依據

| 來源／類別 | 精確對應方式 | 結果 |
|---|---|---:|
| migration map 祝福 | `items[].onlineId → id`，檢查新 id 在 blessings | 610 ids |
| migration map 武器 | 同上，檢查 weapons | 82 ids |
| migration map 技能 | 同上，並由線上 skills 的 nameKey 再核對 | 1 id |
| migration map 術語 | 同上，前後 id 相同 | 1 id |
| 1.13.1 技能索引 | `class + 內部 key` 對到 `values.archetype + key` | 618 paths |
| 留存祝福 variant | canonical route 的 `content_key` 是 Source-Data 的 `key` | 605 paths |
| 留存祝福群組 | 全部 `variant_ids` 必須存在，而且只指向一個 item | 45 paths |
| 留存武器 mark | canonical route 與留存 `weapon_id/mark_id` 相符，以完整 `mark_id` 精確唯一對到 `key`，允許 family 重組 | 134 paths |
| 留存武器 family | canonical route 與留存 weapon 相符；原 family 仍存在，或完整 `mark_ids` 可證明唯一 item | 68 family paths、2 id paths |

共 **694 ids、1,404 個詳情路徑、68 個 family 路徑**。`additionalIds` 僅保存未出現在 alias 目標中的 175 個新 id，與所有 alias 目標合起來等於固定來源全部 1,540 個 id。只有精確且唯一的結果才會導向，沒有名稱相似度、slug 猜測或任選第一筆。

family 重組的四條網址：`/weapons/ogryn_thumper_p2/` 與其 `/marks/ogryn_thumper_p1_m2/` 詳情都指向 `darktide:weapon:ogryn_thumper_p1_m2`；`/weapons/ogryn_thumper_p3/` 與其 `/marks/ogryn_thumper_p1_m3/` 詳情都指向 `darktide:weapon:ogryn_thumper_p1_m3`。兩個舊 family 的完整 `mark_ids` 各只有該型號；不導向含其他型號的 `ogryn_thumper_p1` family。

技能 class 對照為 `arbites→adamant`、`scum→broker`、`skitarii→cryptic`；`veteran`、`zealot`、`psyker`、`ogryn` 不變。這些對照由留存技能的 class/key 與指定 Source-Data 的 `values.archetype/key` 逐筆核對，包含 `base_*` 跨職業共用 key。

線上目前 skills domain 只有 `darktide:skill:psyker:brain-burst-improved` 一筆技能。其 `payload.nameKey=loc_talent_psyker_brain_burst_improved` 加上 class `psyker`，唯一對到 Source-Data `source.text.keys.name` 相同的 `darktide:skill:psyker:psyker_brain_burst_improved`；這與 migration map 的結果相同。

舊詳情路徑是 `/skills/<網站 class>/<內部 key>/`，例如 `/skills/arbites/adamant_ammo_belt/` 與 `/skills/arbites/adamant_area_buff_drone_improved/`。省略最後的 `/` 也可解析。留存 canonical route 同時證明祝福格式為 `/blessings/<blessing_id>/variants/<內部 key>/`、武器為 `/weapons/<family>/marks/<完整 mark key>/`；沒有唯一 item 的祝福群組不會任選變體。

## 線上 GET 查證與跨版本

調查由 [version.json](https://darktide.tw-syuan.com/version.json) 選擇當前 1.13.4 manifest，data revision 為 `3688cf214c4498d88dd8b1be42c423cb363f9602e7031b9d7a556abacddb2ea7`。manifest 與 skills bytes 已核對 pointer 的 SHA-256 與 descriptor 的 SHA-256／size；各來源完整雜湊寫在對應表 `sources`，不保存本機絕對路徑或時間戳。

GET 上述兩個技能路徑、祝福群組與 variant 路徑、武器 mark 路徑及帶 `version=1.13.2` 的技能網址均回傳 200 HTML；200 本身只證明 SPA shell。另 GET 該 shell 的 app、shared client 與 renderer，確認舊路徑由留存 catalog 處理、family/mark 是既有查詢參數。線上 shared client 從 build 的 `shared_game_version` 選 pointer，route search 不用來切換資料版本，因此舊 query 的 `version` 並未選到另一份 release。1.13.2 與 1.13.3 skills domain 的 GET 也各只有相同舊 id／nameKey。新版 Source-Data client 則讀 `version`；上面的固定 1.13.4 規則消除這項差異。

## unmapped

完整的 **151 個路徑及逐筆原因**見[自動產生清單](legacy-url-unmapped.md)，JSON 同時保存候選 id 供核對。修正 family 重組的兩個 mark 與兩個 family 路徑後，由 155 降為 151：

- 27 筆索引內技能：都是 `base-effect`／「基礎效果」，在 1.13.4 沒有相同 class/key。
- 1 筆額外 canonical 技能：`/skills/veteran/veteran_cover_peeking/`，不在 645 筆 player-index 中，但仍存在於 source-content routes；在目標資料也沒有相同 class/key。
- 122 個祝福群組：每組對到多個新 blessing items，沒有唯一目標；其具體 variant 路徑仍可精確導向。
- 1 個武器 mark 路徑：`laspistol_p1_m2` 在目標資料沒有相同 key。

上一輪 35 筆初步未命中中，8 筆是全域 key 重複：`base_melee_damage_node_buff_medium_1` 出現在 arbites/scum/zealot，`base_toughness_damage_reduction_node_buff_medium_1` 出現在 arbites/ogryn/psyker/veteran/zealot。加入 class 後這 8 筆各有唯一結果；其餘 27 筆才是索引的正式 unmapped。額外 canonical 技能另列，不混入這 645 筆統計。

## 更新與離線重跑

`scripts/generate-legacy-urls.mjs@1.1.0` 只讀本機檔案，不連網。使用者先以 GET 保存 `version.json`、該版 `manifest.json` 和 manifest 中 `kind=skills` 的 domain，檔名依序為 `version.json`、`manifest.json`、`skills.json`。可在 ignored 目錄保存整份線上快照；不要 commit 大型 migration map 或原始線上 domain。

```powershell
# 三個變數由執行者指定為輸入檔／目錄；可使用相對於 repository 的路徑。
node scripts/generate-legacy-urls.mjs `
  --migration-map $migrationMap `
  --online-snapshot $onlineSnapshot `
  --source-data $sourceDataRoot

# 不寫入檔案，檢查所有產物的 bytes 完全相同。
node scripts/generate-legacy-urls.mjs `
  --migration-map $migrationMap `
  --online-snapshot $onlineSnapshot `
  --source-data $sourceDataRoot --check
```

來源 checkout 必須有 Git HEAD，且等於 `93185bf9c070da578701fa398e85da9a08b8d4c4`。產生器同時輸出精簡 Source-Data id／class/key 與武器 key/family 身分 fixture、原 spec 四個網址與重組武器的詳情 fixture。武器 fixture 保留同 family 的三筆身分與呈現欄位，省略與網址無關的戰鬥曲線。測試完全離線。新增支援版本或替換來源時，必須同步更新新 id 身分集合、腳本版本、固定 commit／目標版本、測試預期與本契約；重跑並審查 unmapped 增減。來源衝突或非終點映射使產生失敗；唯一但缺失的目標列為 unmapped。

回復本次相容變更只需還原 Web commit 並重建；無持久資料遷移。建置與驗證證據、最大檔案及原始資料 manifest 全文見[驗證報告](../acceptance/syp-391-legacy-urls/build-report.json)。
