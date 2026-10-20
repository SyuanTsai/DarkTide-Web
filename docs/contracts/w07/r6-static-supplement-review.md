# W07 r6 靜態資料補件與重新驗收

W07／R07 保持未完成，等待使用者重新驗收。可由固定來源證明的靜態補件已完成工程驗證；G02 的伺服器生成／玩家可取得範圍仍未證實，不自行縮減原驗收條件。

接續基準：Web `00488b307936ee22fd019b50be2787fad2229469`、Source `f5514e4361d09361d9621e885082b7b5c51d1c95`、W07 candidate-r4。需求依據為 SYP-339、SYP-311 v17 W07/R07 與 W03 凍結清單。W03 指定鏈斧 `chainaxe_p1_m1`／`chainaxe_p1_m2`；125 份代表記錄、57 groups／203 templates 的盤點不等於全遊戲可取得性證據。

| 需求／責任 | 原缺口 | 處理結果 | 固定證據 | 剩餘事項／完成條件 |
| --- | --- | --- | --- | --- |
| G01／Source 模型與匯入；Web 綁定與候選 | 缺敵人部位、護甲、crit／weakspot 關係；16 actions 的 target refs 為空 | 匯入 52 minion schemas、624 zones、1,232 actors、8 armor enum identities（敵人實際引用 7 種）、58 weakspot mappings、111 armor overrides、502 multiplier rows（含 55 筆 local decimal 常數證據）、10 Havoc overrides、3 種靜態關係；16 actions 完整綁定 typed refs | Source 固定 Git 與 103 檔 snapshot；獨立逐原文查核 2,304 rows／83 files，另逐 breed／zone／actor 與 raw metadata 核對 | 固定 beast_of_nurgle 原碼另有 8 筆指向未宣告 zone 的 mapping；完整保留原值與 locator，不捏造 zone／actors／joint multiplier。保留此來源缺口供驗收 |
| G02／Source 曲線、語義與範圍；Web 呈現 | array ordinal 被當輸入軸；缺插值、單位、client 可證範圍；部分 trait 綁定依舊文案而遺漏 profile | 四曲線改用 normalized 0／1 並保留 ordinal／raw endpoints；補 linear／extrapolate 的函數範圍、selected tweak clamp／fallback、三層座標、五組語義、全部 66 damage-trait rows／266 concrete bindings；五個 boost projections 保留五點 piecewise-linear 與 caller `(0,1]`；訂正 sprint／dodge／stagger 單位。162 個既有已知 value／displayValue 數字均保留 | math.lua、damage_profile.lua、weapon_tweak_templates.lua、Items／WeaponStats／UI、dodge／sprint／stagger consumers 與固定 parent/profile paths | client panel comparison `[0,1]`、預覽 80%／380／500／100 與條件／rounding 已匯入。玩家實際可取得範圍仍未完成：已查 client／backend 來源不提供 server roll／entitlement 界限；不得以 `NOT_IMPORTED` 當完成或猜值 |
| G03／Source 靜態閉包；Web 逐型號呈現 | 兩型號缺 actionProfileResolution；靜態 inputs／fallback／generators／branches／接續不完整 | local actions 20／13、fallback 各 3、merged inputs 各 21；literal edges 58／32、generated edges 53／32、generated action settings 各 3；4 種 generator／5 份有序定義（inspect 最後一份生效）、19／12 mark callsites 加各 1 個 base callsite；16 attacks、19 damage profiles 的靜態 coverage 完整。每列 profile／trait 綁定含特殊啟動分支，claim joins 使用精確 identity | 逐 callsite owner span、raw arguments、incoming full conditions、outgoing inputs、parent closure 與 profile-property 原文獨立集合比對 | 靜態完整不代表已執行條件或證明 runtime 可達性。未執行項另列 execution boundary，沒有放進資料缺漏冒稱 partial |

36／24 是 literal profile assignment rows，包含各型號 8 筆 local sticky-table rows；direct action profile bindings 為 28／16，兩者分別核對。16 個 profile-bound 動作沒有直接 `start_input`，保持 null，入口由完整 incoming continuation rows 表示。

固定版本：Source **`f22b4ae2e1d3b4887f3741464e3c9bf507399db6`**；Public Code **`ba6c148f3c2768ca3ce20d846a12e56e2f433f3e`**。Web 為新增本報告的 commit，可用 `git log --diff-filter=A -1 --format=%H -- docs/contracts/w07/r6-static-supplement-review.md` 取得完整 SHA；同一 SHA、實際 Web CI logs 與結果固定於本輪 Jira 交付留言。沒有合併、正式發布或更新 active preview。

| 新產物 | SHA-256（Git raw bytes） |
| --- | --- |
| [docs/contracts/w06/candidate-r6/review-candidate.md](../w06/candidate-r6/review-candidate.md) | `9ebf03f6b2135e6f386d6502464c19d1971cc60442799c79ce65b4bb6bccc66c` |
| [docs/contracts/w06/candidate-r6/review-matrix.json](../w06/candidate-r6/review-matrix.json) | `b07e55a6ef30f9ee98fd6b7f477620c4b377c6ba837165f3886639f02de0021a` |
| [docs/contracts/w07/candidate-r6/review-candidate.md](candidate-r6/review-candidate.md) | `a0bfd1c5fc9ff358992f940548c8d94855f99494b683ea07ee4295f3ef903a02` |
| [docs/contracts/w07/candidate-r6/review-matrix.json](candidate-r6/review-matrix.json) | `f58ac3488c7bdef54f9cb7844c80201be6407e48c5a2781a98b6855cf3200a94` |

W06 r6 因共用 Source pin／schema／validator 更新而重建；W06 任務仍為 Done，原文案驗收與有效歷史證據沿用，不補造內容批准。

本輪測試與沿用範圍：

- Source push [39260094738](https://github.com/SyuanTsai/DarkTide-Source-Data/actions/runs/39260094738) 與 PR [39260104575](https://github.com/SyuanTsai/DarkTide-Source-Data/actions/runs/39260104575) 均由實際 logs 核對 **129 passed／0 failed／0 skipped**，pending preview receipt checks 通過。
- Source-only depth-1／autocrlf clone 完整 run 為 128 pass／1 個 QA `file://` origin 身分檢查失敗；僅將 QA clone origin 還原固定公開倉庫後，該 UnitT50 實際補驗 1／0／0。所有 129 個測例均已驗證。三產物各重建兩次與固定 Git raw bytes 相同；no-args readonly、手改／partial 拒寫保留、clone clean 均通過。
- Root 獨立執行全部六份 `test/contract-*.test.mjs`：96 passed／0 failed／0 skipped；Luna 的 authoring／W06／W07 與 release 受影響檔案 run：126／0／0。F17 以真 Source pin 先重現再修正，完整四個 outgoing branches 保留、輸入角色依 key 為三個。Root 獨立核對 180 份矩陣 Source facts、六份 raw caches 與官方／baseline／文案保全。
- 本報告在 Web 固定 commit 前寫入；固定 commit 後的 Web-only／depth-1／autocrlf 離線重建、必要契約測試、部署範圍分類與實際 CI logs，由同輪 Jira 交付留言提供實測結果，不在此預填通過。
- Source W05 37、W06 80 個原 review digests 不變；W07 原 662 個 targets 中 582 個 dependency digests 受模型／provenance 影響、80 不變，另新增 135（共 797），未移除 target。只有 24 個 target values 本身改變，其餘變更屬 dependency binding。
- Web fixture 41 與 W06 34 targets 的 digests 保持；W07 38 targets 中 26 個 dependency digests 受影響、12 個不變，無新增／移除。逐筆以記憶體 synthetic 舊 approved receipt 驗證受影響成為 stale、未影響保持 approved；沒有把 synthetic receipts 寫入真資料。
- 沿用 W01–W06、既有 r4／r5 與有效 Google／UI／POC／還原證據；不把本輪 synthetic receipt 測試寫成人工批准。14 份歷史候選、19 份受保護證據、7 項 Source 凍結輸入原樣保留。所有真實 receipts 原樣保留，現行受查資料的 receipt arrays 仍為 0、`publicationEligible: false`。
- 不沿用本輪已訂正的錯誤單位／array-axis 解讀；保留其歷史檔案供追溯。兩型號 Web presentations、官方輸入及 W07 W01 baseline bytes 不變。

已查核的可取得範圍來源（全部固定於 Public Code SHA）：

| client 來源 | 已查範圍／結果 |
| --- | --- |
| `scripts/backend/master_data.lua` | 183–194；master-data request 邊界 |
| `scripts/backend/master_items.lua` | 91–149、419–467；override validation、cache／gear override merge、backend item cache，沒有 server roll bounds |
| `scripts/backend/gear.lua` | 36–57、92–112；gear request／response |
| `scripts/backend/crafting.lua` | 10–29、37–58；crafting request／response |
| `scripts/backend/store.lua` | 185–208；storefront server response |
| `scripts/managers/data_service/services/crafting_service.lua` | 262–281；server-provided crafting metadata |
| `scripts/managers/data_service/services/store_service.lua` | 103–120；server-backed store request |
| `scripts/settings/equipment/local_items_loader.lua` | 34–60；local RMD item loading，沒有本版本 server roll 生成規則 |
| `scripts/settings/item/crafting_settings.lua` | 129–169；client crafting configuration |
| `scripts/settings/item/rank_settings.lua` | 1–87；item rank configuration |
| `scripts/settings/item/rarity_settings.lua` | 1–85；item rarity configuration |
| `scripts/utilities/offer.lua` | 38–83；offer item extraction |

原文與逐段 locator 見固定 Source 的 [source-static-facts.json](https://github.com/SyuanTsai/DarkTide-Source-Data/blob/f22b4ae2e1d3b4887f3741464e3c9bf507399db6/content/imports/w07/source-static-facts.json) 與 [source-import.json](https://github.com/SyuanTsai/DarkTide-Source-Data/blob/f22b4ae2e1d3b4887f3741464e3c9bf507399db6/docs/contracts/w07/source-import.json)。這些查核證明 client 使用 server 資料的邊界，未證明實際可取得 interval。

具體待決：需補與本來源版本相符的 server 物品生成／catalog／entitlement 規則及 build 對照，才能證實玩家可取得上下限；或由使用者明確決定是否接受這項已查明的未知。決定前此完成條件保持未完成。Steam build 未建立精確對照，仍為 `UNVERIFIED`。武器圖實作排除，具體可復用圖片與授權尚未核實，沒有套用技能／祝福圖片的授權推論。

驗收步驟：

1. 開啟 [W07 r6 中文候選](candidate-r6/review-candidate.md) 與 [完整矩陣](candidate-r6/review-matrix.json)，按 Mk IV／Mk XII 分別核對五組素質、一般／特殊啟動 profile、全部 literal／generated 接續與 Source refs；抽查 executor 頭甲、void_shield、55 筆有 local 常數證據的倍率與 8 筆來源未宣告 zone。
2. 比對 raw ordinal／normalized profile t／trait t／outer item-stat／client preview／obtainable 的分層，確認 60%／80% 是比較輸入；boost 參考軸 `[0,1]` 與實際 finesse caller `(0,1]` 分開。不得將模式威力／護甲參數當最終 HP 傷害。
3. 在固定 Web checkout 執行 `node scripts/content/contract-w07.mjs` 與 `node scripts/content/contract-w06.mjs`；readonly 驗證不會建立 receipt。檢查 [W06 r6](../w06/candidate-r6/review-candidate.md) 的 pin 更新與受影響契約，沿用未變文案與官方資料。
4. 核對 review-impact 證據：受影響 synthetic 舊批准為 stale、未影響保持，真 receipts 未改；所有內容仍待正式人工審核。確認 Jira 的 G02 待決與 Steam／圖片限制符合原完成條件，再決定是否驗收 W07。

精確回復方式（只回復本輪 r6，未實際執行）：先 Web，再 Source。以下先驗證目前 HEAD／tracked tree；有後續提交、使用者 tracked 變更或衝突就停止，不 reset／clean、不動 untracked 或 Mods。

```powershell
$webRepo = 'C:/Users/carsu/AppData/Local/Temp/syp-311-sol-w01/DarkTide-Web'
$sourceRepo = 'C:/Users/carsu/AppData/Local/Temp/syp-311-sol-w01/DarkTide-Source-Data'
$webR6 = git -C $webRepo log --diff-filter=A -1 --format=%H -- docs/contracts/w07/r6-static-supplement-review.md
$sourceR6 = 'f22b4ae2e1d3b4887f3741464e3c9bf507399db6'
if ($webR6 -notmatch '^[0-9a-f]{40}$') { throw '找不到本輪 Web 固定 commit' }
if ((git -C $webRepo rev-parse HEAD) -ne $webR6) { throw 'Web HEAD 已變更，停止回復' }
if ((git -C $sourceRepo rev-parse HEAD) -ne $sourceR6) { throw 'Source HEAD 已變更，停止回復' }
if (git -C $webRepo diff --name-only HEAD) { throw 'Web 有 tracked 變更，停止回復' }
if (git -C $sourceRepo diff --name-only HEAD) { throw 'Source 有 tracked 變更，停止回復' }
git -C $webRepo revert --no-commit $webR6
if ($LASTEXITCODE -ne 0) { throw 'Web revert 未完成，停止' }
git -C $webRepo commit -m 'SYP-311' -m 'revert(w07): restore the pre-r6 Web tree' -m 'zh-TW:' -m '回復(w07)：還原 r6 前的 Web tree'
if ($LASTEXITCODE -ne 0) { throw 'Web 回復提交未完成，停止' }
git -C $sourceRepo revert --no-commit $sourceR6
if ($LASTEXITCODE -ne 0) { throw 'Source revert 未完成，停止' }
git -C $sourceRepo commit -m 'SYP-311' -m 'revert(w07): restore the pre-r6 Source tree' -m 'zh-TW:' -m '回復(w07)：還原 r6 前的 Source tree'
if ($LASTEXITCODE -ne 0) { throw 'Source 回復提交未完成，停止' }
git -C $webRepo diff --exit-code 00488b307936ee22fd019b50be2787fad2229469 HEAD
if ($LASTEXITCODE -ne 0) { throw 'Web 未回到接續基準 tree' }
git -C $sourceRepo diff --exit-code f5514e4361d09361d9621e885082b7b5c51d1c95 HEAD
if ($LASTEXITCODE -ne 0) { throw 'Source 未回到接續基準 tree' }
```

回復產生的新提交仍須檢查與 CI；此處不自動 push 或部署。停 W07，不進 W08、不合併或正式發布、不清理 Mods、不記錄工時。最終傷害、Lua／override 執行器、renderer 與武器圖片實作維持原排除。
