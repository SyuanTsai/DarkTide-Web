# W09 r5 最小剩餘矩陣

本補件承接已驗 r4，內容候選不變。

| 需求／接點 | 本輪結果／證據 | 最小剩餘與下一步 |
| --- | --- | --- |
| r4可信runtime／歷史pin／archive四checkpoint | 獨立21/0/0及原三CI沿用；固定hash已核18項；不是OS sandbox | 新runtime bytes仍須另審；無archive且原三角色不可重建需原request+matching packet+expectedCommit |
| 最新main相容 | PR11原dirty；唯一static-ci衝突修復，保留selected/legacy/state guard及main verified backup；5項workflow/state tests | 最終自然PR CI及合成tree核對另見Jira交付收據 |
| legacy備份還原與整組回復 | 新直接finding先Red(缺gate)再Green；publish-only真inline gate拒selected/active/pending/lookup failure；獨立review關閉 | 預設隔離驗證保留；W09已啟用時只能走shared-release完整CAS rollback |
| Source→Web真trigger | Source handoff及Web candidate/release在固定main的contents API均404；feature/PR註冊不等於main啟用 | 未取得main合併授權，本輪不合併；須先裁定上線次序與main啟用，再驗真release ID dispatch |
| credential／token PR policy／CI approval | Source secret名稱空；Web僅CF token；workflow PR policy=false；action_required runs目前空 | owner配置最小跨repocredential與PR policy；不借CF token、不新增或擴權；空待批清單不代表新真通路免批 |
| request/retry／immutable packet | Source原17項/自然CI146與r4獨立probe沿用；同revision同request/PR、四checkpoint保原bytes、錯tag拒絕 | 真GitHub provider成功通路未驗；provider immutable兩庫false，不能冒稱provider鎖定 |
| version／並行／保留集合／static整包 | 沿用UnitT13/InterT13/InterT14與r4完整build/verify；同digest同號、不回收異內容、舊新完整依賴與明示引用 | r5自然CI驗最新main整合；正式HTTPS新舊URL與保留cache尚未驗 |
| 整組rollback | 沿用r4 runtime+source.lock+shared/version/change index/CAS工程；本輪另封legacy restore旁路 | 沒有正式W09 active/release ID；production rollback未驗，不以工程revert代替 |
| 正式內容／發布 | 869pending、0receipts、contentVersion=null；selected/allocationReserved/publicationEligible=false；W07四限制保留 | 原審核者逐欄內容批准；其後另取得正式promote/HTTPS/rollback授權。停W09，不進W10 |

完整固定輸入、沿用/新增驗證與provider查核見candidate.json及verification.json；hashes.json排除自身。
