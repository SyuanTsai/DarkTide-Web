# SYP-288 通用祝福 presentation 審閱包

產生 473；跳過 136；核准 variant 609。
Package digest: d268f3761ea966490f2bb57401be26ff17eed2b19971ead1217a0ddacafc61c2

## 跳過原因
- unresolved placeholder: 134
- unsupported unit: 0
- other: 2

繁中模板等同英文：3 筆（包含跳過項目；保留遊戲資料原文，詳見 JSON）。
Name key unknown 時使用 null 與 nameHash；description 使用 descriptionKey。既有 reviewReceipts 原樣保留，新增部分沒有 receipt。

## 驗證與大小
validateWebAuthoring issue counts: {}
validateWebAuthoring(w06) for additions against pinned w06 inputs plus in-memory candidates and releases, with active Source pin projection as in W09. No candidate Source validation or publication asserted.
完整 overlay 在舊 snapshot 的問題：{"dangling-ref":106,"unknown-release":14}；相對原 overlay 新增問題：0。
Legacy w06 snapshot lacks existing overlay dependencies for releases 1.13.3/1.13.4. Full overlay validation requires selected W09 Source packet; no handoff locks changed.
Authoring: 3840448 bytes；officialInputs: 8261717 bytes。
目前 1.13.4 最大單祝福 presentation: 9791 bytes；所有目前祝福 presentation（index 代理估計）: 3024585 bytes。
上述 presentation 代理估計低於 16/24 MiB；未含 Source、official inputs、weapons-index 與 manifest，實際完整路由限制須由 w08 build 確認。

## 十個範例

### 魔力彈藥 (darktide:blessing:arc_rifle:p1-ammo-from-reserve-on-crit)
- Tier 1: 暴擊後從預留彈藥中裝填1發子彈。
- Tier 2: 暴擊後從預留彈藥中裝填1發子彈。
- Tier 3: 暴擊後從預留彈藥中裝填1發子彈。
- Tier 4: 暴擊後從預留彈藥中裝填1發子彈。

### 達姆彈 (darktide:blessing:arc_rifle:p1-consecutive-hits-increases-close-damage)
- Tier 1: 連續命中後+1%近戰傷害，可疊加5次。
- Tier 2: 連續命中後+2%近戰傷害，可疊加5次。
- Tier 3: 連續命中後+3%近戰傷害，可疊加5次。
- Tier 4: 連續命中後+4%近戰傷害，可疊加5次。

### 壓倒性火力 (darktide:blessing:arc_rifle:p1-consecutive-hits-increases-ranged-power)
- Tier 1: 每擊中單體目標4次，威力提升+1.5%，持續2秒，可疊加5層。
- Tier 2: 每擊中單體目標4次，威力提升+2.5%，持續2秒，可疊加5層。
- Tier 3: 每擊中單體目標4次，威力提升+3%，持續2秒，可疊加5層。
- Tier 4: 每擊中單體目標4次，威力提升+4%，持續2秒，可疊加5層。

### 刻不容緩 (darktide:blessing:arc_rifle:p1-stagger-count-bonus-damage)
- Tier 1: 命中硬直敵人後，根據硬直程度提升+14%傷害。
- Tier 2: 命中硬直敵人後，根據硬直程度提升+16%傷害。
- Tier 3: 命中硬直敵人後，根據硬直程度提升+18%傷害。
- Tier 4: 命中硬直敵人後，根據硬直程度提升+20%傷害。

### 掃射 (darktide:blessing:autogun:p1-allow-flanking-and-increased-damage-when-flanking)
- Tier 1: 從背後射擊敵人時，增加+32.5%傷害。
- Tier 2: 從背後射擊敵人時，增加+35%傷害。
- Tier 3: 從背後射擊敵人時，增加+37.5%傷害。
- Tier 4: 從背後射擊敵人時，增加+40%傷害。

### 達姆彈 (darktide:blessing:autogun:p1-consecutive-hits-increases-close-damage)
- Tier 1: 連續命中後+4.5%近戰傷害，可疊加5次。
- Tier 2: 連續命中後+5%近戰傷害，可疊加5次。
- Tier 3: 連續命中後+5.5%近戰傷害，可疊加5次。
- Tier 4: 連續命中後+6%近戰傷害，可疊加5次。

### 遊擊 (darktide:blessing:autogun:p1-count-as-dodge-vs-ranged-on-close-kill)
- Tier 1: 近戰擊殺後免疫遠端攻擊0.7秒。
- Tier 2: 近戰擊殺後免疫遠端攻擊0.8秒。
- Tier 3: 近戰擊殺後免疫遠端攻擊0.9秒。
- Tier 4: 近戰擊殺後免疫遠端攻擊1秒。

### 持續射擊 (darktide:blessing:autogun:p1-followup-shots-ranged-damage)
- Tier 1: 齊射的第二、第三和第四發射擊增加+14%傷害。
- Tier 2: 齊射的第二、第三和第四發射擊增加+16%傷害。
- Tier 3: 齊射的第二、第三和第四發射擊增加+18%傷害。
- Tier 4: 齊射的第二、第三和第四發射擊增加+20%傷害。

### 懲罰齊射 (darktide:blessing:autogun:p1-followup-shots-ranged-weakspot-damage)
- Tier 1: 齊射的第二、第三和第四發射擊增加+35%弱點傷害。
- Tier 2: 齊射的第二、第三和第四發射擊增加+40%弱點傷害。
- Tier 3: 齊射的第二、第三和第四發射擊增加+45%弱點傷害。
- Tier 4: 齊射的第二、第三和第四發射擊增加+50%弱點傷害。

### 開溜 (darktide:blessing:autogun:p1-improved-sprint-dodge)
- Tier 1: 閃避遠端攻擊後衝刺速度+10%，持續1秒。
- Tier 2: 閃避遠端攻擊後衝刺速度+12.5%，持續1秒。
- Tier 3: 閃避遠端攻擊後衝刺速度+15%，持續1秒。
- Tier 4: 閃避遠端攻擊後衝刺速度+15%，持續1秒。
