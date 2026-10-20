# W06 技能與祝福文案審閱候選

此文件由固定 W06 輸入產生，供人工檢查；不是人工核准、遊戲版本相容結論或正式發布文件。

## 驗證結果與界線

- Web contract validation：通過。
- publicationEligible：false；Source build：UNVERIFIED。
- Review receipts：0；目標狀態：pending 34。
- 範圍：顱腦崩裂技能、鏈斧「提速」祝福四階；未匯入武器資料。
- 祝福 nameKey：NOT_VERIFIED；variant weaponRefs：空清單，coverage 為 partial / NOT_IMPORTED。

## 固定來源與差異

- W01 accepted wording baseline：b0c52e2f62cc7b08bec275ebc8e8a9d6fbffec30，content/w01/web-authoring.json，SHA-256 038cecd27f151943b54b9cd8487de05cf293011e701580f87a9bd62b061d1513。
- Source：https://github.com/SyuanTsai/DarkTide-Source-Data，commit f22b4ae2e1d3b4887f3741464e3c9bf507399db6；schema/data/validator SHA-256：0ad2f64ecfb6a7d542e7f502d8d7ba776ee525f24fceb878209a8162b50d24f5 / b04521a6202a15db1acef9430803d7a2bc0e2aa2b392bd875f5ccba010280ab2 / 48511a378ff00019a09a098ef466e43f4964c79a5b9509fd4d0d925d798e7b54。
- Official input snapshot：content/contracts/w06/official-inputs.json，SHA-256 b203b465123ef48b92187afc753de5014f379c84226dd8f7bf7e7a02ce6886e8；14 個固定 EN/zh-TW 輸入。
- 逐句比較：23 個 stable detail rows；23 句逐字沿用、0 項新增或差異。差異會逐列顯示；不製造勘誤。

## 已核實官方原文與解析

### English — official:ui:c3b5cefd:loc_talent_psyker_brain_burst_improved:en:1

- Locator：resource ui；key loc_talent_psyker_brain_burst_improved；sourceHash c3b5cefd；occurrence 1。
- 原文 SHA-256：48b11daef4a67532a1799c41e8ffe1267094b5cc59f76f69811060af26eb6f0f。
- 官方原文：

  Brain Rupture

- 固定參數解析：Brain Rupture

### 繁體中文 — official:ui:c3b5cefd:loc_talent_psyker_brain_burst_improved:zh-tw:1

- Locator：resource ui；key loc_talent_psyker_brain_burst_improved；sourceHash c3b5cefd；occurrence 1。
- 原文 SHA-256：3b696743acdcaf487ba4f9c1e02f379a82189a32b74983eabd5f1eadc0f3d0ee。
- 官方原文：

  顱腦崩裂

- 固定參數解析：顱腦崩裂

### English — official:items:5d0fe023:key-unknown:en:1

- Locator：resource items；key 未解析；sourceHash 5d0fe023；occurrence 1。
- 原文 SHA-256：e90277aaf6113e9dc42ab801264a0b4ab1945eac75794636e73ed93ebbf89fa1。
- 官方原文：

  Rev it Up

- 固定參數解析：Rev it Up

### 繁體中文 — official:items:5d0fe023:key-unknown:zh-tw:1

- Locator：resource items；key 未解析；sourceHash 5d0fe023；occurrence 1。
- 原文 SHA-256：e250174b67bd1691c61a74c5d5ed5253e0a42fbed4c475b00919d57b557a48cc。
- 官方原文：

  提速

- 固定參數解析：提速

### English — official:ui:681e4980:loc_talent_psyker_brain_burst_improved_description:en:1

- Locator：resource ui；key loc_talent_psyker_brain_burst_improved_description；sourceHash 681e4980；occurrence 1。
- 原文 SHA-256：dcdd0219e870c7b177e4db1d434582d4ace1678a7304c116c705ad2165e6015b。
- 官方原文：

  Charge up your Psychic Power and release it to deal immense Damage to a Single Enemy.

  This is an augmented version of {talent_old:%s} dealing {damage:%s} Damage.

- 固定參數解析：Charge up your Psychic Power and release it to deal immense Damage to a Single Enemy.

This is an augmented version of Brain Burst dealing +50% Damage.

### 繁體中文 — official:ui:681e4980:loc_talent_psyker_brain_burst_improved_description:zh-tw:1

- Locator：resource ui；key loc_talent_psyker_brain_burst_improved_description；sourceHash 681e4980；occurrence 1。
- 原文 SHA-256：3c2c9776162b4a5b5e88615acdb3fb8d8a64f976c17a733fa6ae681d6392da27。
- 官方原文：

  積蓄靈能力量，釋放時可對單個敵人造成巨大傷害。

  該天賦是可造成{damage:%s}傷害的{talent_old:%s}的加強版。

- 固定參數解析：積蓄靈能力量，釋放時可對單個敵人造成巨大傷害。

該天賦是可造成+50%傷害的顱腦爆裂的加強版。

### English；tier 1 — official:items:863b83e4:key-unknown:en:1:tier-1

- Locator：resource items；key 未解析；sourceHash 863b83e4；occurrence 1。
- 原文 SHA-256：0b9996580a4b90df38fc200551c45c6b21f0a58819793b9e228df8b598d88518。
- 官方原文：

  {movement_speed:%s} Movement Speed for {time:%s}s on Weapon Special Activation.

- 固定參數解析：+17% Movement Speed for 2s on Weapon Special Activation.

### 繁體中文；tier 1 — official:items:863b83e4:key-unknown:zh-tw:1:tier-1

- Locator：resource items；key 未解析；sourceHash 863b83e4；occurrence 1。
- 原文 SHA-256：f8979997fa65c7effa8d0abb7ec69e2eefecc53e057caaab104174dce131a887。
- 官方原文：

  武器特殊啟動後{movement_speed:%s}移動速度，持續{time:%s}秒。

- 固定參數解析：武器特殊啟動後+17%移動速度，持續2秒。

### English；tier 2 — official:items:863b83e4:key-unknown:en:1:tier-2

- Locator：resource items；key 未解析；sourceHash 863b83e4；occurrence 1。
- 原文 SHA-256：0b9996580a4b90df38fc200551c45c6b21f0a58819793b9e228df8b598d88518。
- 官方原文：

  {movement_speed:%s} Movement Speed for {time:%s}s on Weapon Special Activation.

- 固定參數解析：+18% Movement Speed for 2s on Weapon Special Activation.

### 繁體中文；tier 2 — official:items:863b83e4:key-unknown:zh-tw:1:tier-2

- Locator：resource items；key 未解析；sourceHash 863b83e4；occurrence 1。
- 原文 SHA-256：f8979997fa65c7effa8d0abb7ec69e2eefecc53e057caaab104174dce131a887。
- 官方原文：

  武器特殊啟動後{movement_speed:%s}移動速度，持續{time:%s}秒。

- 固定參數解析：武器特殊啟動後+18%移動速度，持續2秒。

### English；tier 3 — official:items:863b83e4:key-unknown:en:1:tier-3

- Locator：resource items；key 未解析；sourceHash 863b83e4；occurrence 1。
- 原文 SHA-256：0b9996580a4b90df38fc200551c45c6b21f0a58819793b9e228df8b598d88518。
- 官方原文：

  {movement_speed:%s} Movement Speed for {time:%s}s on Weapon Special Activation.

- 固定參數解析：+19% Movement Speed for 2s on Weapon Special Activation.

### 繁體中文；tier 3 — official:items:863b83e4:key-unknown:zh-tw:1:tier-3

- Locator：resource items；key 未解析；sourceHash 863b83e4；occurrence 1。
- 原文 SHA-256：f8979997fa65c7effa8d0abb7ec69e2eefecc53e057caaab104174dce131a887。
- 官方原文：

  武器特殊啟動後{movement_speed:%s}移動速度，持續{time:%s}秒。

- 固定參數解析：武器特殊啟動後+19%移動速度，持續2秒。

### English；tier 4 — official:items:863b83e4:key-unknown:en:1:tier-4

- Locator：resource items；key 未解析；sourceHash 863b83e4；occurrence 1。
- 原文 SHA-256：0b9996580a4b90df38fc200551c45c6b21f0a58819793b9e228df8b598d88518。
- 官方原文：

  {movement_speed:%s} Movement Speed for {time:%s}s on Weapon Special Activation.

- 固定參數解析：+20% Movement Speed for 2s on Weapon Special Activation.

### 繁體中文；tier 4 — official:items:863b83e4:key-unknown:zh-tw:1:tier-4

- Locator：resource items；key 未解析；sourceHash 863b83e4；occurrence 1。
- 原文 SHA-256：f8979997fa65c7effa8d0abb7ec69e2eefecc53e057caaab104174dce131a887。
- 官方原文：

  武器特殊啟動後{movement_speed:%s}移動速度，持續{time:%s}秒。

- 固定參數解析：武器特殊啟動後+20%移動速度，持續2秒。

## W01 → W06 逐句清稿與差異

完整欄位、Source claim 值與 evidence、上下文、詞規則、所有 review target ID/路徑/維度/逐項狀態、前後文與狀態見同目錄的 review-matrix.json；單一 target 時保留原 reviewTargetId，多 target 時以 reviewTargetIds 為準，reviewTargetId 為 null。stage/actor/property/target 只按固定 Source 欄位列示；Source 沒有提供的內容保留為空，不另行推定。條件、例外與否定依原句及既有 W01 分析文件檢查。

### web:presentation:psyker-brain-burst-improved/effects/psyker-numerical-assumptions

- Section：效果；Review targets：review:w06:brain-burst:content:tier-base:effects:psyker-numerical-assumptions (/detailSections/0/items/0; content; pending)；彙總狀態：pending；W01 對照：unchanged。
- W01 原句：以下數值不含其他加成或減免。
- W06 候選：以下數值不含其他加成或減免。
- Source claims：無；沿用既有 W01 分析定位。
- 條件／例外／否定：依上列完整句子逐字保留；既有分析：docs/w01/editorial-copy-review-0.0.13.md。
- 詞規則：無。

### web:presentation:psyker-brain-burst-improved/effects/psyker-description-damage-parameter

- Section：效果；Review targets：review:w06:brain-burst:content:tier-base:effects:psyker-description-damage-parameter (/detailSections/0/items/1; content; pending)；彙總狀態：pending；W01 對照：unchanged。
- W01 原句：相較於顱腦爆裂，顱腦崩裂傷害提高 50%（1.5 倍）；這項加成不適用於所有靈能攻擊。
- W06 候選：相較於顱腦爆裂，顱腦崩裂傷害提高 50%（1.5 倍）；這項加成不適用於所有靈能攻擊。
- Source claims：darktide:claim:psyker:brain-burst-improved-description-display-percent (description.format_values.damage.display_percent = {"status":"known","decimal":"50","unit":"percent"}; target darktide:skill:psyker:brain-burst-improved; context {})；darktide:claim:psyker:brain-burst-improved-smite-damage-multiplier (template.stat_buffs.smite_damage_multiplier = {"status":"known","decimal":"1.5","unit":"ratio"}; target darktide:skill:psyker:brain-burst-improved; context {})
- 條件／例外／否定：依上列完整句子逐字保留；既有分析：docs/w01/editorial-copy-review-0.0.13.md。
- 詞規則：brain-burst「Brain Burst → 顱腦爆裂」(Referneces/Translation.md:665)；brain-rupture「Brain Rupture → 顱腦崩裂」(Referneces/Translation.md:666)

### web:presentation:psyker-brain-burst-improved/effects/psyker-base-hit-peril-cost

- Section：效果；Review targets：review:w06:brain-burst:content:tier-base:effects:psyker-base-hit-peril-cost (/detailSections/0/items/2; content; pending)；彙總狀態：pending；W01 對照：unchanged。
- W01 原句：顱腦崩裂蓄力時，你會累積反噬；造成傷害後再增加 25%。
- W06 候選：顱腦崩裂蓄力時，你會累積反噬；造成傷害後再增加 25%。
- Source claims：darktide:claim:psyker:brain-burst-improved-normal-charge-base-time (action.psyker_smite.action_charge_target.default_charge_time = {"status":"known","decimal":"3","unit":"s"}; target darktide:skill:psyker:brain-burst-improved; context {})；darktide:claim:psyker:brain-burst-improved-sticky-charge-base-time (action.psyker_smite.action_charge_target_sticky.charge_time = {"status":"known","decimal":"2","unit":"s"}; target darktide:skill:psyker:brain-burst-improved; context {})；darktide:claim:psyker:brain-burst-improved-successful-hit-base-peril-ratio (charge_template.psyker_smite_use_power.warp_charge_percent = {"status":"known","decimal":"0.25","unit":"ratio"}; target darktide:skill:psyker:brain-burst-improved; context {})
- 條件／例外／否定：依上列完整句子逐字保留；既有分析：docs/w01/editorial-copy-review-0.0.13.md。
- 詞規則：brain-rupture「Brain Rupture → 顱腦崩裂」(Referneces/Translation.md:666)；peril-general「Peril → 反噬」(Referneces/Translation.md:9)

### web:presentation:psyker-brain-burst-improved/conditions/psyker-normal-charge-condition

- Section：條件；Review targets：review:w06:brain-burst:content:tier-base:conditions:psyker-normal-charge-condition (/detailSections/1/items/0; content; pending)；彙總狀態：pending；W01 對照：unchanged。
- W01 原句：先蓄力再鎖定：未鎖定敵人也能蓄力；鎖定後接續蓄力進度。
- W06 候選：先蓄力再鎖定：未鎖定敵人也能蓄力；鎖定後接續蓄力進度。
- Source claims：darktide:claim:psyker:brain-burst-improved-normal-charge-base-time (action.psyker_smite.action_charge_target.default_charge_time = {"status":"known","decimal":"3","unit":"s"}; target darktide:skill:psyker:brain-burst-improved; context {})
- 條件／例外／否定：依上列完整句子逐字保留；既有分析：docs/w01/editorial-copy-review-0.0.13.md。
- 詞規則：無。

### web:presentation:psyker-brain-burst-improved/conditions/psyker-sticky-charge-condition

- Section：條件；Review targets：review:w06:brain-burst:content:tier-base:conditions:psyker-sticky-charge-condition (/detailSections/1/items/1; content; pending)；彙總狀態：pending；W01 對照：unchanged。
- W01 原句：直接鎖定蓄力：先鎖定敵人，再蓄力。
- W06 候選：直接鎖定蓄力：先鎖定敵人，再蓄力。
- Source claims：darktide:claim:psyker:brain-burst-improved-normal-charge-base-time (action.psyker_smite.action_charge_target.default_charge_time = {"status":"known","decimal":"3","unit":"s"}; target darktide:skill:psyker:brain-burst-improved; context {})；darktide:claim:psyker:brain-burst-improved-sticky-charge-base-time (action.psyker_smite.action_charge_target_sticky.charge_time = {"status":"known","decimal":"2","unit":"s"}; target darktide:skill:psyker:brain-burst-improved; context {})
- 條件／例外／否定：依上列完整句子逐字保留；既有分析：docs/w01/editorial-copy-review-0.0.13.md。
- 詞規則：無。

### web:presentation:psyker-brain-burst-improved/conditions/psyker-lock-on-charge-condition

- Section：條件；Review targets：review:w06:brain-burst:content:tier-base:conditions:psyker-lock-on-charge-condition (/detailSections/1/items/2; content; pending)；彙總狀態：pending；W01 對照：unchanged。
- W01 原句：鎖定後，移開準星也不會更換目標。
- W06 候選：鎖定後，移開準星也不會更換目標。
- Source claims：darktide:claim:psyker:brain-burst-improved-normal-charge-base-time (action.psyker_smite.action_charge_target.default_charge_time = {"status":"known","decimal":"3","unit":"s"}; target darktide:skill:psyker:brain-burst-improved; context {})；darktide:claim:psyker:brain-burst-improved-sticky-charge-base-time (action.psyker_smite.action_charge_target_sticky.charge_time = {"status":"known","decimal":"2","unit":"s"}; target darktide:skill:psyker:brain-burst-improved; context {})
- 條件／例外／否定：依上列完整句子逐字保留；既有分析：docs/w01/editorial-copy-review-0.0.13.md。
- 詞規則：無。

### web:presentation:psyker-brain-burst-improved/calculation/psyker-estimate-assumptions

- Section：計算；Review targets：review:w06:brain-burst:content:tier-base:calculation:psyker-estimate-assumptions (/detailSections/2/items/0; content; pending)；彙總狀態：pending；W01 對照：unchanged。
- W01 原句：你的反噬從 0% 起算，且蓄力不中斷：
- W06 候選：你的反噬從 0% 起算，且蓄力不中斷：
- Source claims：無；沿用既有 W01 分析定位。
- 條件／例外／否定：依上列完整句子逐字保留；既有分析：docs/w01/editorial-copy-review-0.0.13.md。
- 詞規則：peril-general「Peril → 反噬」(Referneces/Translation.md:9)

### web:presentation:psyker-brain-burst-improved/calculation/psyker-normal-charge-peril-estimate

- Section：計算；Review targets：review:w06:brain-burst:content:tier-base:calculation:psyker-normal-charge-peril-estimate (/detailSections/2/items/1; content; pending)；彙總狀態：pending；W01 對照：unchanged。
- W01 原句：先蓄力再鎖定：約 3 秒蓄滿；1／2／3 秒時，你的反噬約 6.67%／13.33%／20%。
- W06 候選：先蓄力再鎖定：約 3 秒蓄滿；1／2／3 秒時，你的反噬約 6.67%／13.33%／20%。
- Source claims：darktide:claim:psyker:brain-burst-improved-normal-charge-base-time (action.psyker_smite.action_charge_target.default_charge_time = {"status":"known","decimal":"3","unit":"s"}; target darktide:skill:psyker:brain-burst-improved; context {})
- 條件／例外／否定：依上列完整句子逐字保留；既有分析：docs/w01/editorial-copy-review-0.0.13.md。
- 詞規則：peril-general「Peril → 反噬」(Referneces/Translation.md:9)

### web:presentation:psyker-brain-burst-improved/calculation/psyker-sticky-charge-peril-estimate

- Section：計算；Review targets：review:w06:brain-burst:content:tier-base:calculation:psyker-sticky-charge-peril-estimate (/detailSections/2/items/2; content; pending)；彙總狀態：pending；W01 對照：unchanged。
- W01 原句：直接鎖定蓄力：約 2 秒蓄滿；1／2 秒時，你的反噬約 10%／20%。
- W06 候選：直接鎖定蓄力：約 2 秒蓄滿；1／2 秒時，你的反噬約 10%／20%。
- Source claims：darktide:claim:psyker:brain-burst-improved-sticky-charge-base-time (action.psyker_smite.action_charge_target_sticky.charge_time = {"status":"known","decimal":"2","unit":"s"}; target darktide:skill:psyker:brain-burst-improved; context {})
- 條件／例外／否定：依上列完整句子逐字保留；既有分析：docs/w01/editorial-copy-review-0.0.13.md。
- 詞規則：peril-general「Peril → 反噬」(Referneces/Translation.md:9)

### web:presentation:psyker-brain-burst-improved/calculation/psyker-full-charge-peril-rate-estimate

- Section：計算；Review targets：review:w06:brain-burst:content:tier-base:calculation:psyker-full-charge-peril-rate-estimate (/detailSections/2/items/3; content; pending)；彙總狀態：pending；W01 對照：unchanged。
- W01 原句：滿蓄後繼續蓄力，你的反噬每秒約增加 9%。
- W06 候選：滿蓄後繼續蓄力，你的反噬每秒約增加 9%。
- Source claims：darktide:claim:psyker:brain-burst-improved-normal-charge-base-time (action.psyker_smite.action_charge_target.default_charge_time = {"status":"known","decimal":"3","unit":"s"}; target darktide:skill:psyker:brain-burst-improved; context {})；darktide:claim:psyker:brain-burst-improved-sticky-charge-base-time (action.psyker_smite.action_charge_target_sticky.charge_time = {"status":"known","decimal":"2","unit":"s"}; target darktide:skill:psyker:brain-burst-improved; context {})
- 條件／例外／否定：依上列完整句子逐字保留；既有分析：docs/w01/editorial-copy-review-0.0.13.md。
- 詞規則：peril-general「Peril → 反噬」(Referneces/Translation.md:9)

### web:presentation:psyker-brain-burst-improved/calculation/psyker-full-charge-hit-peril-estimate

- Section：計算；Review targets：review:w06:brain-burst:content:tier-base:calculation:psyker-full-charge-hit-peril-estimate (/detailSections/2/items/4; content; pending)；彙總狀態：pending；W01 對照：unchanged。
- W01 原句：顱腦崩裂蓄滿後立即造成傷害，你的反噬約 45%；多維持 1 秒則約 54%。
- W06 候選：顱腦崩裂蓄滿後立即造成傷害，你的反噬約 45%；多維持 1 秒則約 54%。
- Source claims：darktide:claim:psyker:brain-burst-improved-normal-charge-base-time (action.psyker_smite.action_charge_target.default_charge_time = {"status":"known","decimal":"3","unit":"s"}; target darktide:skill:psyker:brain-burst-improved; context {})；darktide:claim:psyker:brain-burst-improved-sticky-charge-base-time (action.psyker_smite.action_charge_target_sticky.charge_time = {"status":"known","decimal":"2","unit":"s"}; target darktide:skill:psyker:brain-burst-improved; context {})；darktide:claim:psyker:brain-burst-improved-successful-hit-base-peril-ratio (charge_template.psyker_smite_use_power.warp_charge_percent = {"status":"known","decimal":"0.25","unit":"ratio"}; target darktide:skill:psyker:brain-burst-improved; context {})
- 條件／例外／否定：依上列完整句子逐字保留；既有分析：docs/w01/editorial-copy-review-0.0.13.md。
- 詞規則：brain-rupture「Brain Rupture → 顱腦崩裂」(Referneces/Translation.md:666)；peril-general「Peril → 反噬」(Referneces/Translation.md:9)

### web:presentation:psyker-brain-burst-improved/notes/psyker-empty-cast-peril-cost

- Section：注意事項；Review targets：review:w06:brain-burst:content:tier-base:notes:psyker-empty-cast-peril-cost (/detailSections/3/items/0; content; pending)；彙總狀態：pending；W01 對照：unchanged。
- W01 原句：顱腦崩裂未造成傷害時，你不會再累積 25% 反噬；蓄力時累積的反噬仍保留。
- W06 候選：顱腦崩裂未造成傷害時，你不會再累積 25% 反噬；蓄力時累積的反噬仍保留。
- Source claims：darktide:claim:psyker:brain-burst-improved-successful-hit-base-peril-ratio (charge_template.psyker_smite_use_power.warp_charge_percent = {"status":"known","decimal":"0.25","unit":"ratio"}; target darktide:skill:psyker:brain-burst-improved; context {})
- 條件／例外／否定：依上列完整句子逐字保留；既有分析：docs/w01/editorial-copy-review-0.0.13.md。
- 詞規則：brain-rupture「Brain Rupture → 顱腦崩裂」(Referneces/Translation.md:666)；peril-general「Peril → 反噬」(Referneces/Translation.md:9)

### web:presentation:psyker-brain-burst-improved/extra/psyker-stagger-eligible-target-condition

- Section：補充；Review targets：review:w06:brain-burst:content:tier-base:extra:psyker-stagger-eligible-target-condition (/detailSections/4/items/0; content; pending)；彙總狀態：pending；W01 對照：unchanged。
- W01 原句：以下僅適用於會被顱腦崩裂打出踉蹌的敵人：
- W06 候選：以下僅適用於會被顱腦崩裂打出踉蹌的敵人：
- Source claims：darktide:claim:psyker:brain-burst-improved-normal-charge-base-time (action.psyker_smite.action_charge_target.default_charge_time = {"status":"known","decimal":"3","unit":"s"}; target darktide:skill:psyker:brain-burst-improved; context {})；darktide:claim:psyker:brain-burst-improved-sticky-charge-base-time (action.psyker_smite.action_charge_target_sticky.charge_time = {"status":"known","decimal":"2","unit":"s"}; target darktide:skill:psyker:brain-burst-improved; context {})
- 條件／例外／否定：依上列完整句子逐字保留；既有分析：docs/w01/editorial-copy-review-0.0.13.md、docs/w01/editorial-copy-review-0.0.10.md。
- 詞規則：brain-rupture「Brain Rupture → 顱腦崩裂」(Referneces/Translation.md:666)；staggering「Staggering → 踉蹌」(Referneces/Translation.md:55)

### web:presentation:psyker-brain-burst-improved/extra/psyker-lock-on-direct-stagger-condition

- Section：補充；Review targets：review:w06:brain-burst:content:tier-base:extra:psyker-lock-on-direct-stagger-condition (/detailSections/4/items/1; content; pending)；彙總狀態：pending；W01 對照：unchanged。
- W01 原句：直接鎖定：鎖定同一敵人超過 1 秒，顱腦崩裂使其輕微踉蹌一次。
- W06 候選：直接鎖定：鎖定同一敵人超過 1 秒，顱腦崩裂使其輕微踉蹌一次。
- Source claims：darktide:claim:psyker:brain-burst-improved-normal-charge-base-time (action.psyker_smite.action_charge_target.default_charge_time = {"status":"known","decimal":"3","unit":"s"}; target darktide:skill:psyker:brain-burst-improved; context {})；darktide:claim:psyker:brain-burst-improved-sticky-charge-base-time (action.psyker_smite.action_charge_target_sticky.charge_time = {"status":"known","decimal":"2","unit":"s"}; target darktide:skill:psyker:brain-burst-improved; context {})
- 條件／例外／否定：依上列完整句子逐字保留；既有分析：docs/w01/editorial-copy-review-0.0.13.md、docs/w01/editorial-copy-review-0.0.10.md。
- 詞規則：brain-rupture「Brain Rupture → 顱腦崩裂」(Referneces/Translation.md:666)；stagger「Stagger → 踉蹌」(Referneces/Translation.md:107)

### web:presentation:psyker-brain-burst-improved/extra/psyker-lock-on-transition-stagger-condition

- Section：補充；Review targets：review:w06:brain-burst:content:tier-base:extra:psyker-lock-on-transition-stagger-condition (/detailSections/4/items/2; content; pending)；彙總狀態：pending；W01 對照：unchanged。
- W01 原句：先蓄力再鎖定：鎖定敵人超過 0.25 秒，顱腦崩裂使其輕微踉蹌一次。
- W06 候選：先蓄力再鎖定：鎖定敵人超過 0.25 秒，顱腦崩裂使其輕微踉蹌一次。
- Source claims：darktide:claim:psyker:brain-burst-improved-normal-charge-base-time (action.psyker_smite.action_charge_target.default_charge_time = {"status":"known","decimal":"3","unit":"s"}; target darktide:skill:psyker:brain-burst-improved; context {})；darktide:claim:psyker:brain-burst-improved-sticky-charge-base-time (action.psyker_smite.action_charge_target_sticky.charge_time = {"status":"known","decimal":"2","unit":"s"}; target darktide:skill:psyker:brain-burst-improved; context {})
- 條件／例外／否定：依上列完整句子逐字保留；既有分析：docs/w01/editorial-copy-review-0.0.13.md、docs/w01/editorial-copy-review-0.0.10.md。
- 詞規則：brain-rupture「Brain Rupture → 顱腦崩裂」(Referneces/Translation.md:666)；stagger「Stagger → 踉蹌」(Referneces/Translation.md:107)

### web:presentation:chainaxe-p1-movement-speed/tier-1/effects/chainaxe-tier-display-parameter

- Section：效果；Review targets：review:w06:chainaxe:content:tier-0:effects:chainaxe-tier-display-parameter (/tierPresentations/options/0/detailSections/0/items/0; content; pending)；彙總狀態：pending；W01 對照：unchanged。
- 綁定階級：1。
- W01 原句：你的移動速度提高 17%。
- W06 候選：你的移動速度提高 17%。
- Source claims：darktide:claim:chainaxe:p1-movement-speed-on-activation-tier1-display-percent (description.format_values.movement_speed.defined_tier_1_display_percent = {"status":"known","decimal":"17","unit":"percent"}; target darktide:blessing-variant:chainaxe:p1-movement-speed-on-activation; context {})
- 條件／例外／否定：依上列完整句子逐字保留；既有分析：docs/w01/editorial-copy-review-0.0.13.md。
- 詞規則：無。

### web:presentation:chainaxe-p1-movement-speed/tier-1/conditions/chainaxe-special-activation-condition

- Section：條件；Review targets：review:w06:chainaxe:content:tier-0:conditions:chainaxe-special-activation-condition (/tierPresentations/options/0/detailSections/1/items/0; content; pending)；彙總狀態：pending；W01 對照：unchanged。
- 綁定階級：1。
- W01 原句：使用武器特殊動作後生效，持續 2 秒。
- W06 候選：使用武器特殊動作後生效，持續 2 秒。
- Source claims：無；沿用既有 W01 分析定位。
- 條件／例外／否定：依上列完整句子逐字保留；既有分析：docs/w01/editorial-copy-review-0.0.13.md。
- 詞規則：無。

### web:presentation:chainaxe-p1-movement-speed/tier-2/effects/chainaxe-tier-display-parameter

- Section：效果；Review targets：review:w06:chainaxe:content:tier-1:effects:chainaxe-tier-display-parameter (/tierPresentations/options/1/detailSections/0/items/0; content; pending)；彙總狀態：pending；W01 對照：unchanged。
- 綁定階級：2。
- W01 原句：你的移動速度提高 18%。
- W06 候選：你的移動速度提高 18%。
- Source claims：darktide:claim:chainaxe:p1-movement-speed-on-activation-tier2-display-percent (description.format_values.movement_speed.defined_tier_2_display_percent = {"status":"known","decimal":"18","unit":"percent"}; target darktide:blessing-variant:chainaxe:p1-movement-speed-on-activation; context {})
- 條件／例外／否定：依上列完整句子逐字保留；既有分析：docs/w01/editorial-copy-review-0.0.13.md。
- 詞規則：無。

### web:presentation:chainaxe-p1-movement-speed/tier-2/conditions/chainaxe-special-activation-condition

- Section：條件；Review targets：review:w06:chainaxe:content:tier-1:conditions:chainaxe-special-activation-condition (/tierPresentations/options/1/detailSections/1/items/0; content; pending)；彙總狀態：pending；W01 對照：unchanged。
- 綁定階級：2。
- W01 原句：使用武器特殊動作後生效，持續 2 秒。
- W06 候選：使用武器特殊動作後生效，持續 2 秒。
- Source claims：無；沿用既有 W01 分析定位。
- 條件／例外／否定：依上列完整句子逐字保留；既有分析：docs/w01/editorial-copy-review-0.0.13.md。
- 詞規則：無。

### web:presentation:chainaxe-p1-movement-speed/tier-3/effects/chainaxe-tier-display-parameter

- Section：效果；Review targets：review:w06:chainaxe:content:tier-2:effects:chainaxe-tier-display-parameter (/tierPresentations/options/2/detailSections/0/items/0; content; pending)；彙總狀態：pending；W01 對照：unchanged。
- 綁定階級：3。
- W01 原句：你的移動速度提高 19%。
- W06 候選：你的移動速度提高 19%。
- Source claims：darktide:claim:chainaxe:p1-movement-speed-on-activation-tier3-display-percent (description.format_values.movement_speed.defined_tier_3_display_percent = {"status":"known","decimal":"19","unit":"percent"}; target darktide:blessing-variant:chainaxe:p1-movement-speed-on-activation; context {})
- 條件／例外／否定：依上列完整句子逐字保留；既有分析：docs/w01/editorial-copy-review-0.0.13.md。
- 詞規則：無。

### web:presentation:chainaxe-p1-movement-speed/tier-3/conditions/chainaxe-special-activation-condition

- Section：條件；Review targets：review:w06:chainaxe:content:tier-2:conditions:chainaxe-special-activation-condition (/tierPresentations/options/2/detailSections/1/items/0; content; pending)；彙總狀態：pending；W01 對照：unchanged。
- 綁定階級：3。
- W01 原句：使用武器特殊動作後生效，持續 2 秒。
- W06 候選：使用武器特殊動作後生效，持續 2 秒。
- Source claims：無；沿用既有 W01 分析定位。
- 條件／例外／否定：依上列完整句子逐字保留；既有分析：docs/w01/editorial-copy-review-0.0.13.md。
- 詞規則：無。

### web:presentation:chainaxe-p1-movement-speed/tier-4/effects/chainaxe-tier-display-parameter

- Section：效果；Review targets：review:w06:chainaxe:content:tier-3:effects:chainaxe-tier-display-parameter (/tierPresentations/options/3/detailSections/0/items/0; content; pending)；彙總狀態：pending；W01 對照：unchanged。
- 綁定階級：4。
- W01 原句：你的移動速度提高 20%。
- W06 候選：你的移動速度提高 20%。
- Source claims：darktide:claim:chainaxe:p1-movement-speed-on-activation-tier4-display-percent (description.format_values.movement_speed.defined_tier_4_display_percent = {"status":"known","decimal":"20","unit":"percent"}; target darktide:blessing-variant:chainaxe:p1-movement-speed-on-activation; context {})
- 條件／例外／否定：依上列完整句子逐字保留；既有分析：docs/w01/editorial-copy-review-0.0.13.md。
- 詞規則：無。

### web:presentation:chainaxe-p1-movement-speed/tier-4/conditions/chainaxe-special-activation-condition

- Section：條件；Review targets：review:w06:chainaxe:content:tier-3:conditions:chainaxe-special-activation-condition (/tierPresentations/options/3/detailSections/1/items/0; content; pending)；彙總狀態：pending；W01 對照：unchanged。
- 綁定階級：4。
- W01 原句：使用武器特殊動作後生效，持續 2 秒。
- W06 候選：使用武器特殊動作後生效，持續 2 秒。
- Source claims：無；沿用既有 W01 分析定位。
- 條件／例外／否定：依上列完整句子逐字保留；既有分析：docs/w01/editorial-copy-review-0.0.13.md。
- 詞規則：無。

## 詞規則來源

規則只供明確引用該 ruleId 的文字審閱；不是 mechanics evidence，也不會全域改寫官方字串。固定 Mods 檔案：commit 241ad76ce62330472aa423055a5b85db59bb6c0d，Referneces/Translation.md，SHA-256 fb60e9e8b7beb81765ca50acb3483b9a10e3148e82f630bdf43878a8e45543a0。

- peril-general：- Peril - 反噬（line 9）。
- staggering：- Staggering - 踉蹌（line 55）。
- stagger：- Stagger - 踉蹌（line 107）。
- rev-it-up：- Rev it Up - 提速（line 420）。
- peril-psyker：- Peril - 靈能反噬、反噬（line 653）。
- brain-burst：- Brain Burst - 顱腦爆裂（line 665）。
- brain-rupture：- Brain Rupture - 顱腦崩裂（line 666）。

## 人工審閱

此候選沒有新增或代填 receipt。所有未核准目標保留 pending；輸入變更依既有 review digest 僅使實際相依的目標 stale。
