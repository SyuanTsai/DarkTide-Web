# W09 engineering-r3

| 需求 | 缺口 | 處理結果 | 證據 | 剩餘事項 |
| --- | --- | --- | --- | --- |
| P1 憑證隔離／固定 runtime | Source builder、Web validator 曾 import working tree | Source 單一 pinned API 核四檔已審 raw Git size/SHA/mode，全部通過才載入獨占暫存 runtime；Web 使用同一 helper | Red canary；Source InterT04；Root fake-canary probe；Web 公開 proposal／projection 回歸 | 新 runtime bytes 必須另審再更新 allowlist；本輪未建立 OS sandbox，也未宣稱移除所有程序憑證 |
| P2 歷史 pin | 目前 HEAD 註解可阻斷舊 request | 從舊 request commit 取固定已審 blobs 重播，與目前 HEAD 分離；完整六檔/hash/review gates 保留 | 原 Red；InterT05；Root old approved pin + malicious working validator；真歷史 request replay | 未核准新 pinned runtime 拒絕；不猜測相容性 |
| P2 中斷重試 | tag-only／空 draft 遇新 metadata commit mismatch | 解析原 tag commit，重建原三角色輸入與 request，證明六檔及 identity 相同後沿用原 archive provenance；不挪 tag、不覆寫 asset | 原 Red；InterT06；Root 四 checkpoint（tag-only／空 draft／已上傳 draft／published）與衝突負例 | 真 provider 寫入未執行；provider policy 與正式流程仍待原定外部驗證 |
| 歷史／內容限制 | 有效證據須保留、審核不得補造 | r1/r2 原候選不改；固定 Source 原 request／六檔與四域內容沿用；869 pending、0 receipts，四項 W07 限制保留 | 53 個 raw Git protected files；原 r1 19 檔／r2 18 檔 hash 按其原 commit 核對；本輪真 pending replay | 未取得內容批准、不正式發布、不進 W10 |

完整可重播證據及本輪實際測試見 verification.json；歷史 compiler.lock hash 依原 commit 驗證，current lock 更新不覆寫歷史記錄。
