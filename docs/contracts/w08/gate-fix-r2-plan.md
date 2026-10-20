# W08 P2 公告與變更內容門檻修補（2026-10-20）

基準 Web 1688dbfab89531e9a522377c6c0d94df1cd0086c，Source 8e48334619f448794aab666f1805cb2bd6adf11a。Source 輸入 pin f22b4ae2e1d3b4887f3741464e3c9bf507399db6 不變。新分支 codex/SYP-340-w08-content-gate-fix；不改 main、不合併、不發布、不進 W09、不清理 Mods、不記工時。

Root SOL/high Find／獨立 Review；Luna/max 僅 production/tests。Root 已核對本輪 agent session_meta 的 agent_path 與 turn_context：gpt-6-luna/max，2026-10-20T07:21:15.937Z，rollout-2026-10-20T15-21-13-01a1582f-8c9e-7761-8abc-04d11d930b01.jsonl。

1. Red：以既有通過 schema 與語義驗證之 representative authoring 為正式形狀來源，公開 compile API 重現公告／技術變更／官方文字變更缺 zh-TW 假陽性，記錄失敗。
2. 最小 Green：只改 scripts/content/contract-w08-build.mjs 的 required-content collector；依七類公告 blocks 逐層走訪 text、items、cells、alt、label 和 spoiler children。公告本身沒有 locale，不能捏造頂層文字；兩類變更讀 summary.locale/text。技術逐欄摘要及 asset alt 不得漏檢。缺漏、空白、空必需集合與未知種類 fail closed，不用漢字比例判定。
3. 回歸：test/contract-w08-build.test.mjs 正式非空事件資料取代錯誤簡化形狀；三類正例及所有巢狀文字／locale／空集合負例。fixture 先驗 schema+語義；API projection/gate/validator 一致。先 Red 再 Green，Root 另作獨立公開 API probe。
4. Root 固定 code commit，再以真 SHA 更新 compiler.lock，新產 candidate-r2／matrix-r2／hashes-r2 與補件報告。inputs lock、Source cache、authoring、人工 receipts、歷史 r1 保留。四域 bytes、869 pending／0 receipts、四項 W07 限制核對；只補新增／受影響驗證，不重做完整 writer／full regression／已有效 CI。
5. 新 PR 供複驗，記錄實際自動 PR CI，更新 Jira 缺口與處理結果；W08 仍進行中。交付完整 Web/Source/compiler SHA、新候選／矩陣／hash、實測與沿用範圍、驗收及精確回復。回復新 artifact commit 再 code commit 可回基準 tree；不 reset/clean，不改 Source。

Luna 可寫兩個檔案，其他路徑需 Root 先確認；Git/index/commit/push/Jira/locks/候選與文件皆由 Root 負責。若 fixture 適配需要新 helper 先回報。不得將測試 synthetic pins 或 receipts 寫入真候選。
