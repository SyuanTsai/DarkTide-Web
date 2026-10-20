# W08／R04 共用編譯實作計畫（2026-10-20）

## 1. 目標與範圍

- 使用者已明確接受 W07 r6 四項來源限制，工程驗收 SYP-339 Done／11970，並授權接續 W08／SYP-340；SYP-311 保持 InProgress。
- 基準 Web `40c477835353bd9513f202d6b82609a580afeabd`／Source `f22b4ae2e1d3b4887f3741464e3c9bf507399db6`；既有隔離 C checkout 與 PR8／PR1，Source 本輪凍結。Root 實際 gpt-6.1-sol/high，既有 Implementer w06_luna 自己的精確 session turn_context 已由 Root 核實 gpt-6-luna/max。
- 按 v17 W08 將固定 Source 及 Web 輸入一次編譯為 skills／blessings／weapons／terms，以及有資料時的 announcements／game-changes。兩端以同一份 manifest/file paths/hash 選取，不產生 Extension 副本。正式內容尚無 receipts，實際輸出必為不可發布候選。
- 同輸入同 bytes、完整保留前版、必需繁中缺漏與未批准不得通過發布門檻；固定四項未知不因 W07 任務驗收變為 known。技術資料仍唯一由 Source 擁有，Web 只投影。
- 本輪不進 W09：不新增正式版本分配／Source→Web CI 接線／active pointer，不實作 loader、renderer、最終傷害／Lua、圖片，不部署／合併／正式發布、不動 Mods／Private／Extension、不記工時。

## 2. 已驗證事實與改動

### 2.1 唯一固定輸入

- `loadWebAuthoringInputs` 現有 w06／w07 modes 提供 Source／Web／official/rules 的 offline 鎖定驗證，`validateWebAuthoring` 驗證語義與審核覆蓋；不能直接改 W01 mapper。Root 逐 record 深比對 W06 31 rows 均完全等於 W07 227 rows 中相同 tuple，gameReleases 相同。
- Root 以 Source 固定既有 `buildContractCandidate` API（baseline=authoring=candidate=完整 W07 document；candidate mode）實際建立 Source-owned artifact；revision `fa83649a220c3593d6bc9bda6c05b71fdb30f60783fb0b37c11298ab19ba0662`／manifest SHA `41227789afd6dd00d9915040509f1e5be517e0d4fb23c9850c76d65e10e489b4`；technical hash `f464b28fdabda20f70a9e425667e67acce35ad47bd8f1d00a2a1516d7e339f30`。Build identity 與 publicationEligible 都 false。Root 負責 cache 六檔／inputs lock，不以 Web lock digest冒充 Source manifest。
- 新 loader 以 W07 superset 為唯一 Source registry，對 W06 overlap／gameReleases／來源metadata做精確比對，衝突必拒絕，無 last-writer-wins。固定 Source candidate technical 與 pinned W07 資料按 registry identities 比對，驗 Source manifest 列檔 bytes／hash／receipt／mode，不信任孤立 claimed hash。

### 2.2 編譯、候選與門檻

- Luna 唯一改動 production/tests：新增 `scripts/content/contract-w08-build.mjs`、`content/schema/v2/shared-candidate.schema.json`、`test/contract-w08-build.test.mjs`。現有 `contract-authoring`、`contract-release`／schema、W01/runtime 不改；若真 finding 需要擴路徑先交 Root 更新計畫。
- 重用 W02 `computeDataRevision`／`validateManifest`／`buildManifestPath`／`selectConsumerFiles`。每 domain 以同一 Source registry 解析 typed closure，保留原 Source-owned payload/provenance/coverage、Web 官方 ordered segments、翻譯／五節、variant/tier、mark/family、terms/context、review states。Source registry arrays 可按 identity canonicalize，曲線、ordered segments、tiers、分支／接續等有語義順序不可排序重寫。重複投影只可為相同 immutable Source facts，不建立第二份可編輯 mechanics owner。
- Domain file dependencies 為明確 acyclic consumer dependencies；typed closure 可 inline immutable facts，避免 term technical claim 與 skill 互參造成 file cycle。各 domain 只一份文件，所有消費者都使用同 manifest 元資料，無 consumer-specific shape/prefix。
- 有實際資料才輸出 announcements／game-changes。目前真輸入兩者均空；以獨立 synthetic 測試保護非空 Web-only blocks／scope/occurrence 與 Source change IDs，不為實際候選捏造公告或遊戲更新。
- 保持 W02 published version schema 原樣。新增 strict candidate envelope／validator，`candidateOnly:true`、`fixtureOnly:false`、`publicationEligible:false`，列 immutable manifest 路徑/hash、審核狀態及已接受限制；不寫 `version.json`／active pointer、不使用 synthetic fixture marker冒充真候選。Manifest 用現行 schema shape；contentVersion 只明示 proposed candidate identifier，非正式 allocation／reservation。
- 發布 readiness/gate 由完整 Source 和 Web coverage、全部適用有效 approved receipts、必需 zh-TW 內容及 verified Source build identity 推導，不以手寫 boolean 或 Jira Done 代替。真輸入 Source/Web receipts0，必須拒絕 approved/publish path，且拒絕前不得寫輸出；保留 candidate API 以供工程驗收。不提供部署功能。
- Writer 只寫明確指定新目錄；no-args readonly，舊目錄、partial、手改、symlink／非普通父路徑一律拒絕且原資料不變；write failure 不留下可誤認完整的半包。Candidate directory validator 檢查 strict schema／列檔集合／所有實際 UTF-8 JSON bytes、size/hash、manifest dataRevision、refs、coverage/review metadata、無 version pointer，不能只信 envelope。

### 2.3 編譯器身分與固定產物

- 不把未提交程式假標為 r6 commit。先完成純 API／synthetic 必要 Red→Green、Root code review，Root 固定 compiler code commit；再寫 Root compiler provenance lock（真 code SHA 與實際 raw module hashes）及完整 Source cache/inputs lock，對真資料產生 candidate-r1，實際整合後固定 artifact/report commit。最終 Web commit 可不同於 manifest.compilerCommit，兩者須完整列出且可追溯；loader 驗 code hash。若整合發現 bug，修正後重新固定 compiler SHA／pin／全部受影響產物，不能沿用錯誤 code pin。
- Root docs／locks／generated paths：`content/contracts/w08/**`、`docs/contracts/w08/**`；Luna 不寫這些、不碰 Git index。Root 是唯一 Git/commit/push/Jira actor。

## 3. 最小驗收與 Red→Green

1. 四域、兩型號、blessing variants/tiers、term/context與完整 Source closure生成；same tuple 衝突、錯／缺 typed ref、無效官方／zh-TW 或 coverage拒絕。先缺 API 真 Red，再最小 projector Green。
2. Source manifest/hash/pin/technical mismatch與 Web authoring／compiler hash mismatch拒絕；不能以重算局部 hash換掉固定來源。
3. pending／stale／rejected／漏 target／未核實 build 不能通過發布 gate；candidate 輸出仍明確不可發布，沒有 active pointer。測試用 synthetic receipts 只存在記憶體，不寫真資料。
4. 同固定輸入重建兩次同 bytes/dataRevision；輸出不含絕對路徑、時戳、動態 HEAD、隨機值；一域變更不重寫未受影響域，舊候選保留。
5. 兩 consumer selections 對共同 domain 得到相同 URL／hash；未知 feature／cycle／缺file／額外file／bad JSON／壞hash／manifest revision不符拒絕，不能只有metadata綠。
6. Web-only announcement occurrence/order保真，不生成 game-change；現有 change IDs／summaries對應，無資料時不造記錄。
7. 四個接受限制逐值保持：obtainable unknown、8 unresolved zones、Steam UNVERIFIED、weapon無assetRef且缺圖／NOT_REVIEWED；Gate不能將 W07驗收當作正式內容批准。
8. noargs readonly、explicit new-dir writer、手改/partial/symlink拒絕保留、failure原子性。必要 unit優先，只對 filesystem/offline/package驗真 integration。

## 4. 交付、驗證與回復

- Root 獨立 diff review、直接 API、真輸入Source cache校對／發布 gate failure／四限制／官方與文案保全，補測新增與受影響項目；W01–W07有效CI／POC／Google還原沿用。
- 正式候選固定於 docs/contracts/w08/candidate-r1；列每檔SHA-256、Source／authoring／compiler完整SHA、Source manifest/revision、domain/refs/review計數、實際測試與沿用範圍。
- 新 Web-only depth1/autocrlf clone 無 Source／Private／Mods siblings，真候選離線兩次重建等於 committed raw bytes；錯hash／拒寫保留驗證。
- Push 前實際從r6 Web40c→最終commit deployment classifier必須contract-only／should_deploy=false；只更新既有PR8，核對CI實際logs／既有Skip與所有deploy/receipt/upload略過，Source commit與PR1不改。
- 以當輪最終固定 commits 更新 SYP-340／SYP-311，W08待使用者工程驗收，不進W09。驗收不產生正式field receipts。
- 回復只回W08：先revert artifact/report/pin commit，再逆序revert本輪compiler/fix commits；先檢HEAD與tracked tree，最後Web tree應等於40c；Source仍f22，W07已接受限制的Jira歷史保留。無reset/clean、不動untracked/Mods，未實際回復。

## 5. 風險／未決

- 真資料正式內容review仍pending、Steam build未對照：不阻擋候選工程驗證，但正式發布路徑必拒絕；本輪不為了跑通而造批准或取消guard。
- 新 domain shape 必須 strict validate，不直接輸出整個 authoring草稿當成正式已批准內容；candidate 標記與review states不能遺失。
- W09才處理正式版本分配與active pointer；W10/W11才處理實際loader/renderer，本輪consumer selection證據不冒充真runtime整合。
