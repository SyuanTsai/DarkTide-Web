# W09 engineering-r2 需求／缺口對照

工程實作候選；尚待人工驗收。外部接線及真發布未完成，不將隔離合成批准當正式 receipts。

| 需求 | 缺口 | 處理結果 | 證據 | 剩餘事項 |
| --- | --- | --- | --- | --- |
| R04 固定來源與可重建 compiler | 舊 W08 pin 無法辨識 W09 adapter | Source 589f89ea880d33450552029a03f7893b3fb6cb6a；Web code b6019e268001df9ee1a8c31d797739347c785ea6，四檔 raw Git pin；metadata-only retry 沿用身份，變動 code 拒絕 | compiler.lock.json；compiler pin 5、fresh Windows checkout 1、prepared code pin 6 | 新 code 必須重審及更新 pin；保留 commit ancestry |
| R04 每遊戲版發號 | 同 digest 重試／並行／失敗 slot | 每 gameVersion 單調 N；同輸入重用，不挪 failed 號碼；gate 前不發號 | allocator 4 process probe；Unit/InterT13 | 真資料未批准，正式 N 未配置 |
| R09 Source→Web packet | 手填 eligibility／delta／URL 不可信 | 固定 Source Git replay、六檔 hash、tag/archive/request、typed overlays；保留人工 receipts 且按實際相依 stale | Source 自然 CI 143；prepared／proposal Root probes；InterT14 | 實際 797 Source +72 Web 仍 pending，0 正式 receipts |
| R09 同 revision 候選 PR | 多 game 重複 PR／重試覆寫人工修改 | 同 full sourceRevision 分支與 PR，保留 ancestry／人工文字與 proposal，正常 merge 最新 main；衝突 pending，普通 push | candidate 2；compose PR retry 1；Root proposal 5 | 真 workflow-token PR 尚未執行，provider policy／CI approval 待核實 |
| R09 真跨 repo trigger | Source 缺 credential | payload 僅 release_id；缺 WEB_HANDOFF_TOKEN 保留 pending；未擅改 secrets／設定 | 實際唯讀 secrets 名稱查核；Source formal-handoff PR guard skipped | 配置對 Web Contents write 的跨 repo token；workflow 入 main 後再獨立授權端到端實測 |
| R11 durable owner ledger | runner 中斷可能遺失 reserve／journal | owner branch 普通 non-FF CAS，closed 路徑、ephemeral index；reserve/prepared/journal/active checkpoints | owner state 7；Root durable hook 5、checkpoint receipt 4 | 實際 owner publication state 尚未建立；沒有真部署 |
| R11 unsafe state roots | junction 可把 repo 外檔案帶入 branch；缺 ledger 可能重置 | root／ancestor link 拒絕；已有 branch 缺 ledger 失敗，不能當空白序列 | Root 各項 Red→Green；owner state 7 | 無未關閉 finding |
| R11 verified publication receipts | origin 成功後保存失敗／receipt 欄位可失配 | active 保存失敗不回報成功並回 journal；安全封閉投影永久保存；dataRevision 綁最高數值 gameVersion | InterT14；Root checkpoint 4；UnitT26 1.9/1.10 與原 probe Red→Green | 合成測試 receipts 僅隔離 fixture，真內容 receipts 仍 0 |
| R11 完整 runtime 回復與保留 | 只改 pointer 或用新 checkout assets 不能還原舊版 | whole artifact snapshot 保存舊 runtime/assets/legacy；保留每 game 最近3與明示引用；完整 pointers+build CAS，舊 Source 不能隱式降版 | Root controller 8，舊 runtime 2280 files byte-equal；archive fresh clone 6 | 真 production rollback 未執行；不能提供不存在的正式 rollback release ID |
| R04/R11 四域供兩端選取 | legacy client 可能把 shared revision 當 catalog root | 四域及 manifest/source-lock closure 同 path/hash；唯一 version.json；legacy revision 分流及 client 更新相容 | Root 四域 4、CF adapter 3；固定 Git runtime local HTTP／browser | renderer／新資料 loader 為後續範圍；本輪不實作 |
| R11 唯一 publisher | 同 SHA 雙路發布／移除 marker 可退回 legacy | main exact-CI/freshness/shared concurrency；valid selected 停 legacy；owner active/pending 阻擋缺 marker fallback | InterT25 workflow contract、owner state reader；Root 獨立完整 diff review | 本輪未執行正式 workflow／Cloudflare deploy |
| 已驗證來源限制 | 把未知當證實或偷偷放寬 gate | 四項 W07 限制保留；869 pending／0 receipts；原 W08 r2 四域 bytes 與歷史不改 | 真 pending dry-run 0 write；16 protected raw Git files | 未證實數值／Steam／授權均維持原限制 |

固定矩陣及候選的 bytes 見 hashes.json。自然 Web PR CI 於固定交付 commit 後執行，結果以該 PR／Jira 的固定 run 為準。

| CI 新確認缺口 | 原因 | 處理結果 | 證據 | 剩餘事項 |
| --- | --- | --- | --- | --- |
| InterT14 真 tracked inputs 初始化 | 原本 exclusive create 遇已存在 Source cache／lock | 隔離 fixture 內驗 regular 後替換 current code bytes，不放寬 production immutable writer | r1 CI Red；受影響 setup／自然 r2 CI | 等自然完整 CI 結果，不新增 skip |
| 既有 published 圖片邊界錯誤 | 新 runtime hash 提早遮蔽原 JSON-only contract | 先內容／圖片邊界再核 runtime hash；原 test 期待保持 | r1 UnitT70 Red；static verifier regression | 不引入下載圖片／授權素材 |
| W01 contract-only attrs 範圍 | 精確 binary 例外未列 bounded safe-rule | 僅允許原 W09 subtree 例外；較廣 binary／wildcard 仍 runtime-change | r1 InterT70 Red；W01 直接正負例 | 不重跑或重做 W01 真 POC／部署 |

r1 的 candidate／matrix／verification／19 檔 hash scope 均保留原 bytes。r2 固定 patch e0f829603bfb2b12c56a9cf2bfc452b6f05a87ed，四檔 compiler pin 仍為原 A/B。
