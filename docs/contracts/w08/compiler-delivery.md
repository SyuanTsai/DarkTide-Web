# W08 共用編譯工程交付與驗收

W07 r6 已由使用者於 2026-10-20 明確接受四項來源限制並通過工程驗收（[SYP-339／11970](https://syuantsai.atlassian.net/browse/SYP-339?focusedCommentId=11970)）。本輪接續 [SYP-340／W08](https://syuantsai.atlassian.net/browse/SYP-340)，正式內容 field receipts 未補造；候選明確不可發布，沒有正式發布、合併或部署。

| 需求 | 實作／結果 | 驗證證據 | 剩餘事項 |
| --- | --- | --- | --- |
| pinned Source＋Web，單一 owner | Source 固定 f22、W06/W07 authoring 固定40c；Source-owned候選manifest/revision；W07唯一完整registry，W06 overlap精確比對 | `engineering-evidence.json` fixedInputAudit：21 檔與 authoring raw Git blobs 相同、Source 6 檔 pin／227 records 與固定 Source 相同。 | 不建立 Web mechanics authoring，也不產生Extension副本 |
| 四域與 Web-only 內容 | 四域實際產生；唯一 Source union 227 rows，全部 797 Source targets 與 72 Web targets 各計一次；原官方輸入、presentations／tiers／marks／terms payload 逐物件相等。 | `review-matrix-r1.json`／`engineering-evidence.json` domainFacts 與 rawWebAndSourceObjectsPreserved。 | 本輪真公告／gameChanges皆空；非空行為用明確synthetic測試，不捏造實際內容；W15/W12遷移另屬後續 |
| 同輸入同 bytes、兩端同URL/hash | 使用 W02 canonical dataRevision／manifest／consumer selection，候選無active version pointer | Root 真固定 compiler／inputs 兩次 API 建置與六檔 writer bytes 相同；兩個 consumer selection 同 path/hash；全歷史／shallow差異不得進輸出。 | 此處是編譯器與檔案選取驗證，W10/W11真loader／renderer整合未實作 |
| 審核／繁中／發布門檻 | 真 869 pending、0 approved／stale／rejected、0 receipts；三個 blocker：review-target-pending／source-build-identity-unverified／source-build-not-publication-eligible；CLI exit 2。 | T04／T13、Root F03／F07 反例與 fixed candidate gate；Source 正式 API 仍於建目錄前拒絕 UNVERIFIED。 | 工作包工程驗收不等於逐欄正式批准；pending/stale/rejected／漏覆蓋或繁中／未驗build都不能放行 |
| 不覆寫舊資料與安全寫出 | noargs 唯讀；明確新目錄才寫；既有完整／manual／partial 與 junction 路徑拒絕且原檔保留，未列檔／壞 hash 拒絕；有一致新hash的壞UTF-8仍拒絕。 | `engineering-evidence.json` independentActualCandidateAudit；T07／T09／T14。 | 保留舊版候選與active preview；W09才處理正式版本分配／CI接線與active pointer |

固定 Source：`f22b4ae2e1d3b4887f3741464e3c9bf507399db6`。Web authoring：`40c477835353bd9513f202d6b82609a580afeabd`。Compiler code：`cd0d9ab88e9014ce303312f8f0bb0b043be90e7e`。最後 Web 是首次新增本交付報告的 commit，可用 `git log --diff-filter=A -1 --format=%H -- docs/contracts/w08/compiler-delivery.md` 取得；完整最後 SHA 與實際 post-commit CI 以同輪 Jira 交付留言固定，避免把 commit 自身 SHA 寫入自身內容。

Source-owned輸入：revision `fa83649a220c3593d6bc9bda6c05b71fdb30f60783fb0b37c11298ab19ba0662`，manifest SHA-256 `41227789afd6dd00d9915040509f1e5be517e0d4fb23c9850c76d65e10e489b4`。來源由固定 Source 既有 build API 實際產生，兩次六檔逐 byte 相同；不是 Web lock hash。Source cache 與 Web input/compiler locks 詳見 `content/contracts/w08/`。

| 檔案 | bytes | SHA-256 |
| --- | ---: | --- |
| `docs/contracts/w08/candidate-r1/candidate.json` | 317557 | `4741599ce3b5744a5d9a8d154fbff58f3d1761ce0477592a3ddd001de997bdf2` |
| `docs/contracts/w08/candidate-r1/data/1493857439164a9d8b7421b344d75733a59409cb496030e59bb661a3e218ab4b/domains/blessings.json` | 81429 | `d844ce7431ca96366b97fad27cb428b495b290b93deeeaf646b6f1332d759588` |
| `docs/contracts/w08/candidate-r1/data/1493857439164a9d8b7421b344d75733a59409cb496030e59bb661a3e218ab4b/domains/skills.json` | 125986 | `9cefb6ccc4de5ef609b41237324ceedca6e0a49cf0857ef93a82951af3b5bb4d` |
| `docs/contracts/w08/candidate-r1/data/1493857439164a9d8b7421b344d75733a59409cb496030e59bb661a3e218ab4b/domains/terms.json` | 96300 | `cdc0873c70bbf0a1e04a92205507c2d459de7aa879de3708e8e41d109faa011a` |
| `docs/contracts/w08/candidate-r1/data/1493857439164a9d8b7421b344d75733a59409cb496030e59bb661a3e218ab4b/domains/weapons.json` | 6195771 | `2ec969988b7a7840b6900dce160f2447f8326d5b9f5859e4a5d46a9369c9ac29` |
| `docs/contracts/w08/candidate-r1/data/1493857439164a9d8b7421b344d75733a59409cb496030e59bb661a3e218ab4b/manifest.json` | 1991 | `e5d5d2e4a6900495dbc8768068b2b93f62eed7c0741a53bc5cb7eda97fa17541` |
| `docs/contracts/w08/review-matrix-r1.json` | 315937 | `b131b40f51288c08013d196e69cc34d916c12a40b10408381fb7adac6eede913` |

已接受的 W07 限制在本輪輸出與規則保持：

- 實際玩家可取得上下限為 `unknown`／`NOT_EXPOSED_BY_SOURCE`；已查 12 個 client/backend paths 不提供相符 server roll/catalog/entitlement 界限。60%／80%比較點、client preview cap與理論區間不當作掉落範圍。
- beast_of_nurgle 的 8 筆 zone 引用保留原文、locator 與未解析狀態，不捏造 zone／actors／multiplier。
- 公開 code snapshot `ba6c148f3c2768ca3ce20d846a12e56e2f433f3e` 固定，與精確 Steam build 的對照維持 `UNVERIFIED`。
- 武器圖片維持缺圖與 `NOT_REVIEWED`，不引用未核實授權素材。圖片實作、renderer、最終傷害與 Lua／override 執行器仍排除。

這些接受限制是工作包工程出口，不把數值、版本或授權變成已證實，也不解除正式內容審核／Source build gate。

本輪實際測試：110 Pass／0 Fail／0 Skip（`node --test test/contract*.test.mjs`，包含新增14項）；真固定四域投影／完整來源閉包／限制／writer／gate 逐項核對通過。Root 獨立覆核：F01–F08 按實際觸發修正後覆核；Luna 寫 production／tests，Root 獨立讀碼、公開 API 反例、真資料與檔案驗證。固定 commit 後的新 Web-only clone、實際遠端 CI／Skip／部署略過由同輪 Jira 留言列實測結果，本報告不預填尚未發生的結果。

沿用範圍：Source f22 未改，兩CI各129／0／0；Web r6既有482／0／0／static467／0／15及契約96／0／0，只沿用不受本輪影響的部分。W01–W07已驗官方文字／mechanics／歷史候選／Google還原／UI／POC不重做；Root逐項核對固定輸入與真receipts保全。本輪synthetic tests不能冒稱真內容批准或真runtime整合。

驗收：

1. 在固定 checkout 依 README 執行 noargs readonly 檢查，開啟新候選 envelope／manifest／四域，確認 Source／Web／compiler 全SHA、domain counts／原官方文字／variant tiers／兩mark完整facts／terms context與四項限制。
2. 執行發布 readiness 檢查，真資料必須因未批准／未驗build而拒絕且不寫出正式 pointer；工程驗收不應改動任何真 receipts 或 publicationEligible。
3. 在新目錄重建兩次，比對檔案 bytes／dataRevision／manifest/file hash；檢查兩個 consumer 對共同域取得同一 URL/hash，Web-only資料不當成官方game change。
4. 核對 Jira 新增與沿用證據；W08仍待人類工程驗收，不進W09。

只回復 W08（未實際執行）：

```powershell
$artifactCommit = (git log --diff-filter=A -1 --format=%H -- docs/contracts/w08/compiler-delivery.md).Trim()
if ((git rev-parse HEAD).Trim() -ne $artifactCommit) { throw 'HEAD 已變更，先重新核對回復範圍' }
if (git status --porcelain --untracked-files=no) { throw '有 tracked 修改，先保留並核對' }
git revert --no-edit $artifactCommit
if ($LASTEXITCODE -ne 0) { throw '停止，保留衝突現場' }
git revert --no-edit cd0d9ab88e9014ce303312f8f0bb0b043be90e7e
if ($LASTEXITCODE -ne 0) { throw '停止，保留衝突現場' }
git diff --exit-code 40c477835353bd9513f202d6b82609a580afeabd HEAD -- .
if ($LASTEXITCODE -ne 0) { throw '回復 tree 與 r6 不同，停止核對' }
```

回復前檢查 HEAD 與 tracked tree；後續提交／使用者變更／衝突即停。先還原最末 artifact／pin／報告提交，再按逆序還原本輪 compiler／fix commits。最終 Web tree 應等於40c，Source仍f22；保留W07人類接受限制的Jira歷史。無reset/clean、不動untracked、Mods或active preview。不正式發布、不合併、不清理Mods、不記工時。
