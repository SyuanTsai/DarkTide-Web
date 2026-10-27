# Term Candidates

此檔用來暫存翻譯與校正過程中發現的特殊名詞、新固定譯法、UI 慣用語。使用者可依此判讀是否要加入 `Referneces/Translation.md`。

## 記錄規則

- 每次讀取或翻譯 `*localization.lua` 時，若看到 `Referneces/Translation.md` 沒有收錄的特殊名詞、專有名詞、職業/敵人/武器/系統詞、UI 固定用語，必須記錄到本檔。
- 本檔是候選詞彙表，不是正式翻譯表。
- 代理不得自行把候選詞彙加入 `Referneces/Translation.md`，除非使用者明確要求。
- 若候選詞彙與 `Referneces/Translation.md` 衝突，以 `Referneces/Translation.md` 為準，並在 `Status` 標記 `conflict`.
- 若同一詞彙在不同 MOD 重複出現，更新既有列並補充來源，不要新增重複列。

## Status 欄位

| Status | 用途 | 下一步 |
| --- | --- | --- |
| candidate | 新增候選詞，尚未由使用者確認 | 保留於本檔供後續判讀 |
| accepted | 使用者已確認可加入正式詞彙表 | 等待使用者明確要求後才可更新 `Referneces/Translation.md` |
| rejected | 使用者已拒絕此譯法 | 不再使用此譯法；如需重提，新增 Notes 說明原因 |
| conflict | 與 `Referneces/Translation.md` 衝突 | 以 `Referneces/Translation.md` 為準，等待使用者決策 |
| superseded | 已被另一個候選或正式譯法取代 | Notes 寫明取代詞條 |

## 新詞彙候選表

| Term / English | Proposed zh-tw | Source MOD | File | Localization key | Reason | Status | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Enhanced Descriptions | 強化描述 | Enhanced_descriptions | `<translation-repo>/Enhanced_descriptions_localization.lua` | `mod_name` | MOD display name is not defined in `Referneces/Translation.md`; previous `描述改善` was unnatural Traditional Chinese. | candidate | Added during ED2-ROOT-REV-001. |
| Auric | 奧里克 | Enhanced_descriptions | `<translation-repo>/Enhanced_descriptions_localization.lua`; `<translation-repo>/Colors_Keywords_Numbers/COLORS_KWords_tw.lua` | `auric_colour`; `auric` | Formal glossary has no standalone Auric entry; keyword file and other local mods consistently use `奧里克`, while root localization previously used `奧瑞克`. | candidate | Added during ED2-ROOT-REV-007. |
| Mind in Motion | 動中之心 | Enhanced_descriptions | `<translation-repo>/Main_Modules/NAMES_Talents_Blessings.lua` | `loc_talent_psyker_venting_doesnt_slow` | This historical proposal now conflicts with the formal `Mind in Motion／思維活躍` entry. | conflict | Added during ED-NAMES-TW-008; formal glossary and current translation require `思維活躍`, confirmed during ED3-NAMES-RECHECK-008. |
| Solidity | 堅實 | Enhanced_descriptions | `<translation-repo>/Main_Modules/NAMES_Talents_Blessings.lua` | `loc_talent_psyker_increased_vent_speed` | This historical proposal now conflicts with the formal `Solidity／穩固` entry. | conflict | Added during ED-NAMES-TW-009; formal glossary and current translation require `穩固`, confirmed during ED3-NAMES-RECHECK-009. |
| Surety of Arms | 武器確信 | Enhanced_descriptions | `<translation-repo>/Main_Modules/NAMES_Talents_Blessings.lua` | `loc_talent_psyker_reload_speed_warp` | This historical proposal now conflicts with the formal `Surety of Arms／武器在手，信心我有。` entry. | conflict | Added during ED-NAMES-TW-009; formal glossary and current translation require `武器在手，信心我有。`, confirmed during ED3-NAMES-RECHECK-009. |
| Unlucky for Some | 倒楣蛋 | Enhanced_descriptions | `<translation-repo>/Main_Modules/NAMES_Talents_Blessings.lua` | `loc_talent_psyker_restore_toughness_to_allies_when_ally_down` | Exact Psyker passive name is absent from the formal glossary; current concise title preserves the unlucky-person sense. | candidate | Added during ED3-NAMES-RECHECK-009. |
| Fury Rising | 怒火升騰 | Enhanced_descriptions | `<translation-repo>/Main_Modules/NAMES_Talents_Blessings.lua` | `loc_talent_zealot_fanatic_rage_crits` | Exact Zealot Keystone modifier name is absent from the formal glossary; current title directly preserves the rising-fury sense. | candidate | Added during ED3-NAMES-RECHECK-010. |
| Fortitude in Fellowship | 合抱成林 | Enhanced_descriptions | `<translation-repo>/Main_Modules/NAMES_Talents_Blessings.lua` | `loc_talent_zealot_increased_coherency_regen` | Exact Zealot passive name is absent from the formal glossary; current idiomatic title conveys strength formed through fellowship. | candidate | Added during ED3-NAMES-RECHECK-010. |
| Sainted Gunslinger | 封聖神射手 | Enhanced_descriptions | `<translation-repo>/Main_Modules/NAMES_Talents_Blessings.lua` | `loc_talent_zealot_increased_reload_speed_on_melee_kills` | Exact Zealot passive name is absent from the formal glossary; current title preserves both the sainted and gunslinger senses. | candidate | Added during ED3-NAMES-RECHECK-011. |
| Swift Certainty | 堅定迅捷 | Enhanced_descriptions | `<translation-repo>/Main_Modules/NAMES_Talents_Blessings.lua` | `loc_talent_zealot_improved_sprint` | Exact Zealot passive name is absent from the formal glossary; current compact title preserves certainty and swiftness. | candidate | Added during ED3-NAMES-RECHECK-011. |
| Conditioning | 身體調節 | Enhanced_descriptions | `<translation-repo>/Main_Modules/NAMES_Talents_Blessings.lua` | `loc_talent_veteran_weapon_switch_stamina_reduction` | Exact Veteran Keystone modifier name is absent from the formal glossary; current title conveys physical conditioning. | candidate | Added during ED3-NAMES-RECHECK-012. |
| Charismatic | 超凡魅力 | Enhanced_descriptions | `<translation-repo>/Main_Modules/NAMES_Talents_Blessings.lua` | `loc_talent_veteran_increased_aura_radius` | Exact Veteran passive name is absent from the formal glossary; current title preserves the charismatic quality. | candidate | Added during ED3-NAMES-RECHECK-012. |
| Get Back in the Fight! | 重投戰鬥！ | Enhanced_descriptions | `<translation-repo>/Main_Modules/NAMES_Talents_Blessings.lua` | `loc_talent_veteran_movement_speed_on_toughness_broken` | Exact Veteran passive name is absent from the formal glossary; current imperative title preserves returning to combat. | candidate | Added during ED3-NAMES-RECHECK-012. |
| Twinned Blast | 雙響炮 | Enhanced_descriptions | `<translation-repo>/Main_Modules/NAMES_Talents_Blessings.lua` | `loc_talent_veteran_extra_grenade_throw_chance` | Exact Veteran passive name is absent from the formal glossary; current compact title preserves a doubled blast and works as a talent name. | candidate | Added during ED3-NAMES-RECHECK-013. |
| Brutish Momentum | 兇蠻打擊 | Enhanced_descriptions | `<translation-repo>/Main_Modules/NAMES_Talents_Blessings.lua` | `loc_talent_ogryn_heavy_hitter_light_attacks_refresh` | Exact Ogryn Keystone modifier name is absent from the formal glossary; current title retains the brutish attack character in the light-attack refresh context. | candidate | Added during ED3-NAMES-RECHECK-015. |
| More Burst Limiter Overrides! | 爆限大超載！ | Enhanced_descriptions | `<translation-repo>/Main_Modules/NAMES_Talents_Blessings.lua` | `loc_talent_ogryn_increased_leadbelcher_chance` | Exact Ogryn Keystone modifier name is absent from the formal glossary; current emphatic title conveys an increased Burst Limiter Override. | candidate | Added during ED3-NAMES-RECHECK-015. |
| Voltaic Shock Mine | 電能地雷 | Enhanced_descriptions | `<translation-repo>/Main_Modules/NAMES_Talents_Blessings.lua` | `loc_talent_ability_shock_mine` | `Referneces/Translation.md` now includes this fixed zh-tw value after the user glossary update. | accepted | Added during ED-NAMES-TW-016; resolved before ED-NAMES-TW-017. |
| Dispense Justice | 伸張正義 | Enhanced_descriptions | `<translation-repo>/Main_Modules/NAMES_Talents_Blessings.lua` | `loc_talent_adamant_bullet_rain_fire_rate` | Updated `Referneces/Translation.md` does not include this talent name; local table had no active zh-tw. | candidate | Added during ED-NAMES-TW-017. |
| Empyric Recovery | 亞空間恢復 | Enhanced_descriptions | `<translation-repo>/Main_Modules/PENANCES.lua` | `loc_achievement_psyker_team_cooldown_reduced_name` | `Referneces/Translation.md` has related `Empyric` terms as `亞空間...` but does not include this penance name. | candidate | Added during ED-PENANCES-TW-011. |
| Cartel Special Stimm | 卡特爾特製興奮劑 | Enhanced_descriptions | `<translation-repo>/Main_Modules/PENANCES.lua` | `loc_achievement_broker_stimm_celerity_potency_description` | Updated `Referneces/Translation.md` includes related Scum/Stimm terms but does not include this fixed term. | candidate | Added during ED-PENANCES-TW-019. |
| Viscosity | 黏稠度 | Enhanced_descriptions | `<translation-repo>/Main_Modules/PENANCES.lua` | `loc_achievement_broker_stimm_celerity_potency_description` | Updated `Referneces/Translation.md` does not include this Cartel Special Stimm allocation stat. | candidate | Added during ED-PENANCES-TW-019. |
| Adapted Medicae Syringes | 適應型醫療注射器 | Enhanced_descriptions | `<translation-repo>/Main_Modules/TALENTS/TALENTS_Skitarii.lua` | `loc_talent_cryptic_servo_skull_inject_ally_revive_desc` | Formal glossary includes Medicae Station but not this Skitarii equipment term. | accepted | Added during ED-SKITARII-TW-001; exact value is now present in the formal glossary, confirmed during ED3-COLORS-RECHECK-016. |
| Arc Grenade | 電弧手榴彈 | Enhanced_descriptions | `<translation-repo>/Main_Modules/TALENTS/TALENTS_Skitarii.lua` | `loc_talent_cryptic_arc_grenades_desc` | New Skitarii Blitz term missing from the formal glossary. | accepted | Added during ED-SKITARII-TW-001; formal `Arc Grenades／電弧手榴彈` now covers the same fixed term, confirmed during ED3-COLORS-RECHECK-016. |
| Capacitance | 電容量 | Enhanced_descriptions | `<translation-repo>/Main_Modules/TALENTS/TALENTS_Skitarii.lua` | `loc_talent_cryptic_servo_skull_improved_tagging_fire_rate_cost_desc` | Skitarii resource term missing from the formal glossary. | accepted | Added during ED-SKITARII-TW-001; exact value is now present in the formal glossary, confirmed during ED3-COLORS-RECHECK-016. |
| Refraction Emitter | 折射力場發射器 | Enhanced_descriptions | `<translation-repo>/Main_Modules/TALENTS/TALENTS_Skitarii.lua` | `loc_talent_cryptic_force_field_arcs_desc` | Skitarii equipment/ability term missing from the formal glossary. | candidate | Added during ED-SKITARII-TW-001. |
| Electric Discharge | 電能放電 | Enhanced_descriptions | `<translation-repo>/Main_Modules/TALENTS/TALENTS_Skitarii.lua` | `loc_talent_cryptic_discharge_base_desc` | Skitarii ability effect term missing from the formal glossary. | accepted | Added during ED-SKITARII-TW-002; exact value is now present in the formal glossary, confirmed during ED3-COLORS-RECHECK-016. |
| Voltaic Expander | 電能擴展器 | Enhanced_descriptions | `<translation-repo>/Main_Modules/TALENTS/TALENTS_Skitarii.lua` | `loc_talent_cryptic_discharge_desc` | Skitarii ability name missing from the formal glossary. | conflict | Added during ED-SKITARII-TW-002; formal glossary now requires `電能擴張器`, which the current translation follows (ED3-COLORS-RECHECK-016). |
| Chordclaw | 弦爪 | Enhanced_descriptions | `<translation-repo>/Main_Modules/TALENTS/TALENTS_Skitarii.lua` | `loc_talent_cryptic_chordclaw_desc` | Related glossary entry `Chordclaw Bleed` supports `弦爪`, but the standalone equipment term is not listed. | accepted | Added during ED-SKITARII-TW-002; exact value is now present in the formal glossary, confirmed during ED3-COLORS-RECHECK-016. |
| Power Overload | 威力超載 | Enhanced_descriptions | `<translation-repo>/Main_Modules/TALENTS/TALENTS_Skitarii.lua` | `loc_talent_cryptic_overload_keystone_abilities_desc` | Skitarii keystone stack term missing from the formal glossary. | conflict | Added during ED-SKITARII-TW-004; formal glossary now requires `能量超載`, which the current translation follows (ED3-COLORS-RECHECK-016). |
| Wound / Wounds | 傷痕 | Enhanced_descriptions | `<translation-repo>/Colors_Keywords_Numbers/COLORS_KWords_tw.lua`; multiple localization tables | `Wound`; `Wounds` | Core health-segment term is absent from the formal glossary; current keyword definitions and active zh-tw uses consistently use `傷痕`. | candidate | Added during ED3-COLORS-RECHECK-006. |
| Taunt | 嘲諷 | Enhanced_descriptions | `<translation-repo>/Main_Modules/TALENTS/TALENTS_Ogryn.lua` | `loc_ability_ogryn_taunt_shout_new_desc` | Core Ogryn control mechanic is absent from the formal glossary; the keyword definition and all active descriptions consistently use `嘲諷`. | candidate | Added during ED3-COLORS-RECHECK-012 after full reverse-use review in batch 011. |
| Adrenaline | 腎上腺素 | Enhanced_descriptions | `<translation-repo>/Main_Modules/TALENTS/TALENTS_Scum.lua` | `loc_talent_broker_keystone_adrenaline_junkie_desc` | Hive Scum keystone stack resource is absent from the formal glossary; all active descriptions consistently use `腎上腺素`. | candidate | Added during ED3-COLORS-RECHECK-012 after full reverse-use review in batch 011. |
| Marked Enemy | 標記敵人 | Enhanced_descriptions | `<translation-repo>/Main_Modules/TALENTS/TALENTS_Arbites.lua` | `loc_talent_execution_order_description` | Fixed Arbites keystone target term is absent from the formal glossary; all active descriptions consistently use `標記敵人`. | candidate | Added during ED3-COLORS-RECHECK-012. |
| Melee Justice | 近戰正義 | Enhanced_descriptions | `<translation-repo>/Main_Modules/TALENTS/TALENTS_Arbites.lua` | `loc_talent_adamant_terminus_warrant_new_desc` | Paired Arbites keystone stack term is absent from the formal glossary; the definition and active description use `近戰正義`. | candidate | Added during ED3-COLORS-RECHECK-012. |
| Ranged Justice | 遠程正義 | Enhanced_descriptions | `<translation-repo>/Main_Modules/TALENTS/TALENTS_Arbites.lua` | `loc_talent_adamant_terminus_warrant_new_desc` | Paired Arbites keystone stack term is absent from the formal glossary; the definition and active description use `遠程正義`. | candidate | Added during ED3-COLORS-RECHECK-012. |
| Fire Rate | 射速 | Enhanced_descriptions | `<translation-repo>/Main_Modules/TALENTS/TALENTS_Skitarii.lua` | `loc_talent_cryptic_precision_stance_fire_rate_increased_desc` | Fixed weapon-stat label is absent from the formal glossary; the source-less zh-tw keyword is resolved by complete English uses and consistently displays `射速`. | candidate | Added during ED3-COLORS-RECHECK-012. |
| Loner | 孤狼 | Enhanced_descriptions | `<translation-repo>/Colors_Keywords_Numbers/COLORS_KWords_tw.lua` | `loner` | Exact Zealot talent term is absent from the formal glossary; the related formal `Lone Wolf／孤狼` entry supports the current fixed translation. | candidate | Added during ED3-COLORS-RECHECK-014. |
| Ranged Stance | 遠程姿態 | Enhanced_descriptions | `<translation-repo>/Main_Modules/TALENTS/TALENTS_Veteran.lua` | `loc_ability_veteran_base_ability_desc` | Repeated Veteran combat-state term is absent from the formal glossary; the keyword definition and all active descriptions consistently use `遠程姿態`. | candidate | Added during ED3-COLORS-RECHECK-019. |
| Basic Training | 基礎訓練 | Enhanced_descriptions | `<translation-repo>/Colors_Keywords_Numbers/COLORS_KWords_tw.lua`; `<translation-repo>/Main_Modules/PENANCES.lua` | `Base_tut_p` | Fixed Penance/tutorial UI name is absent from the formal glossary; the definition and active display consistently use `基礎訓練`. | candidate | Added during ED3-COLORS-RECHECK-020. |
| Shrine of the Omnissiah | 歐姆尼賽亞的神龕 | Enhanced_descriptions | `<translation-repo>/Colors_Keywords_Numbers/COLORS_KWords_tw.lua`; `<translation-repo>/Main_Modules/PENANCES.lua` | `Omnissia_p` | Fixed location/UI name is absent from the formal glossary; the definition and active display consistently use `歐姆尼賽亞的神龕`. | candidate | Added during ED3-COLORS-RECHECK-020. |
| Prologue | 序章 | Enhanced_descriptions | `<translation-repo>/Colors_Keywords_Numbers/COLORS_KWords_tw.lua`; `<translation-repo>/Main_Modules/PENANCES.lua` | `Prologue_p` | Fixed campaign/UI name is absent from the formal glossary; the definition and active display consistently use `序章`. | candidate | Added during ED3-COLORS-RECHECK-020. |
| Path of Trust | 信任之路 | Enhanced_descriptions | `<translation-repo>/Colors_Keywords_Numbers/COLORS_KWords_tw.lua`; `<translation-repo>/Main_Modules/PENANCES.lua` | `PthOTrst_p` | Fixed campaign/Penance progression name is absent from the formal glossary; the definition and active display consistently use `信任之路`. | candidate | Added during ED3-COLORS-RECHECK-021. |
| Sire Melk's Requisitorium | 梅爾克領主的必備品店 | Enhanced_descriptions | `<translation-repo>/Colors_Keywords_Numbers/COLORS_KWords_tw.lua`; `<translation-repo>/Main_Modules/PENANCES.lua` | `Sir_melk_p` | Fixed hub vendor/location name is absent from the formal glossary; the definition and active display consistently use `梅爾克領主的必備品店`. | candidate | Added during ED3-COLORS-RECHECK-021. |
| Melee Damage | 近戰傷害 | Enhanced_descriptions | `<translation-repo>/Colors_Keywords_Numbers/COLORS_KWords_tw.lua`; `<translation-repo>/Main_Modules/MENUS.lua` | `Melee_dmg` | Fixed weapon/stat label is absent from the formal glossary; current keyword and active menu display consistently use `近戰傷害`. | candidate | Added during ED3-COLORS-RECHECK-021. |
| Ammo | 彈藥 | Enhanced_descriptions | `<translation-repo>/Colors_Keywords_Numbers/COLORS_KWords_tw.lua`; `<translation-repo>/Main_Modules/MENUS.lua` | `Ammo` | Fixed menu/category label is absent as a standalone formal term; the definition and active menu display consistently use `彈藥`. | candidate | Added during ED3-COLORS-RECHECK-022. |
| Defences | 防禦 | Enhanced_descriptions | `<translation-repo>/Colors_Keywords_Numbers/COLORS_KWords_tw.lua`; `<translation-repo>/Main_Modules/MENUS.lua` | `Defences` | Fixed menu/category label is absent as a standalone formal term; the definition and active menu display consistently use `防禦`. | candidate | Added during ED3-COLORS-RECHECK-022. |
| Ordo Dockets | 審判庭代幣 | Enhanced_descriptions | `<translation-repo>/Main_Modules/CURIOS_Blessings_Perks.lua`; `<workspace>/Warhammer 40,000 DARKTIDE/mods/LoadoutMonitor/scripts/mods/LoadoutMonitor/LoadoutMonitor_localization.lua` | `loc_trait_gadget_mission_credits_increase_desc` | Fixed game currency name is absent from the formal glossary; Enhanced_descriptions and LoadoutMonitor use `審判庭代幣`, while the active Curio display retains the Review clarification `（錢）`. | candidate | Added during ED3-CURIOS-RECHECK-001 after cross-module usage review. |
| Trust Level | 信任等級 | Enhanced_descriptions | `<translation-repo>/Main_Modules/PENANCES.lua` | `loc_achievement_multi_class_x_description`; class Trust Level descriptions | Fixed character-progression term is absent from the formal glossary; all active PENANCES descriptions consistently use `信任等級`. | candidate | Added during ED3-PENANCES-RECHECK-001. |
| Vantage Point | 有利位置 | Enhanced_descriptions | `<translation-repo>/Main_Modules/PENANCES.lua` | `loc_achievement_missions_veteran_2_objective_1_name`; `loc_achievement_missions_veteran_2_objective_2_name`; `loc_achievement_missions_veteran_2_objective_3_name` | Repeated Veteran Penance title is absent from the formal glossary; `有利位置` preserves the point/location sense that the previous `有利地形` lost. | candidate | Added during ED3-PENANCES-RECHECK-002. |
| Threat Level | 威脅等級 | Enhanced_descriptions | `<translation-repo>/Main_Modules/PENANCES.lua` | mission-completion difficulty descriptions | Fixed difficulty-scale label is absent from the formal glossary; generic and comparative PENANCES descriptions repeatedly use `威脅等級`, while named tiers follow the locked difficulty entries. | candidate | Added during ED3-PENANCES-RECHECK-003. |
| Promotion Material | 晉升之材 | Enhanced_descriptions | `<translation-repo>/Main_Modules/PENANCES.lua` | `loc_achievement_group_rank_4_difficulty_3_name`; `loc_achievement_group_rank_5_difficulty_4_name` | Repeated Veteran Penance title is absent from the formal glossary; `晉升之材` preserves the source's sense of someone fit for promotion, unlike the previous unrelated `樹立榜樣`. | candidate | Added during ED3-PENANCES-RECHECK-003. |
| Master of War | 戰爭大師 | Enhanced_descriptions | `<translation-repo>/Main_Modules/PENANCES.lua` | `loc_achievement_class_meta_name` | Shared class-meta title template is absent from the formal glossary; the source and zh-tw retain the same `{class_name}` placeholder and consistently use `戰爭大師`. | candidate | Added during ED3-PENANCES-RECHECK-004. |

## 1.13 技能名稱文本對照（2026-10-04）

[翻譯表](../Referneces/Translation.md)｜[1.13 技能盤點](../Game%20Info/releases/1.13.X/skills/README.md)｜[官方 1.13.0 公告](https://forums.fatsharkgames.com/t/patch-1-13-0-patch-notes/125866)

依 1.13.1 固定來源 `7e662fcda16219d775b84af50322be2e9cd9d62e` 與 Steam Build 25606770 的英文／zh-tw ui 文本，以相同名稱鍵及 hash 配對。55 項繁中對應全部已從文本補齊，其中 13 項為本版新增，42 項為既有盤點補缺。此節為已寫入翻譯表的對照紀錄；採用文本名稱，不需要使用者逐項確認。[文本配對紀錄](../AI-LOGS/Game%20Info/releases/1.13.X/skills/2026-10-04-TRANSLATION_TABLE_ZH_TW_PAIRING.json)。

### 1.13 新增名稱

| 編號 | 職業 | 英文名稱 | 識別依據 | 繁中對應 |
|---|---|---|---|---|
| 01 | 靈能者 | Focused Warp | `psyker_increased_warp_damage` | 聚焦次元 |
| 02 | 靈能者 | Peril Equilibrium | `psyker_weapon_attacks_peril_equilibrium` | 危險平衡 |
| 03 | 靈能者 | Psykinetic Grip | `psyker_increased_blitz_damage` | 念力之握 |
| 04 | 狂信徒 | Wait in Line | `zealot_reduced_damage_from_ranged` | 排隊等候 |
| 05 | 狂信徒 | Holy Tools | `zealot_weapon_special_damage` | 神聖工具 |
| 06 | 狂信徒 | Got Your Back | `zealot_melee_kills_restore_toughness_to_target` | 為您撐腰 |
| 07 | 狂信徒 | Purifying Hatred | `zealot_dmg_vs_burning_electrocuted` | 淨化仇恨 |
| 08 | 狂信徒 | Zealous Pilgrim | `zealot_resist_death_ability` | 狂熱朝聖者 |
| 09 | 狂信徒 | Risen | `zealot_resist_death_golden_toughness` | 復活 |
| 10 | 狂信徒 | Fire and Fury | `zealot_resist_death_fire` | 烈焰與怒火 |
| 11 | 歐格林 | Found Some More | `ogryn_free_reload_after_ability` | 發現更多 |
| 12 | 老兵 | Guardsman | `veteran_base_ranged_damage` | 衛兵 |
| 13 | 老兵 | Practiced Efficiency | `veteran_survivalist_passive` | 實踐效率 |

### 既有盤點補缺

含職業基礎效果、小型節點及興奮劑配方；這些項目不宣稱為 1.13 才新增。

| 編號 | 職業 | 英文名稱 | 識別依據 | 繁中對應 |
|---|---|---|---|---|
| 14 | 法務官 | Ranged Damage Boost | `base_ranged_damage_node_buff_medium_1` | 遠程傷害增幅 |
| 15 | 法務官 | Cleave Boost | `base_cleave_node_buff_medium_1` | 順劈加成 |
| 16 | 法務官 | Impact Boost | `base_impact_node_buff_medium_1` | 衝擊加成 |
| 17 | 巢都渣滓 | Critical Chance Boost | `base_crit_chance_node_buff_low_1` | 暴擊幾率增幅 |
| 18 | 巢都渣滓 | Potent Tox | `base_toxin_power_boost_1` | 強效毒藥 |
| 19 | 巢都渣滓 | Equip Cartel Special | `broker_stimm_activation_talent` | 裝備財閥特殊裝備 |
| 20 | 巢都渣滓 | Spur I | `broker_stimm_celerity_1` | 激勵I |
| 21 | 巢都渣滓 | Spur II | `broker_stimm_celerity_2` | 激勵II |
| 22 | 巢都渣滓 | Spur III | `broker_stimm_celerity_3` | 激勵III |
| 23 | 巢都渣滓 | Spur IV | `broker_stimm_celerity_4` | 激勵IV |
| 24 | 巢都渣滓 | Reflex | `broker_stimm_celerity_5b` | 反射 |
| 25 | 巢都渣滓 | Fervor | `broker_stimm_celerity_5c` | 狂熱 |
| 26 | 巢都渣滓 | Vultoprene I | `broker_stimm_combat_4c` | 獵鷹蕈劑I |
| 27 | 巢都渣滓 | Vultoprene II | `broker_stimm_combat_5c` | 獵鷹蕈劑II |
| 28 | 巢都渣滓 | Kalma I | `broker_stimm_concentration_1` | 抗焦慮藥I |
| 29 | 巢都渣滓 | Kalma II | `broker_stimm_concentration_2` | 抗焦慮藥II |
| 30 | 巢都渣滓 | Kalma III | `broker_stimm_concentration_3` | 抗焦慮藥III |
| 31 | 巢都渣滓 | Kalma IV | `broker_stimm_concentration_4` | 抗焦慮藥IV |
| 32 | 巢都渣滓 | Kalma V | `broker_stimm_concentration_5a` | 抗焦慮藥V |
| 33 | 巢都渣滓 | Like the Wind | `broker_passive_improved_sprint_dodge` | 迅如疾風 |
| 34 | 巢都渣滓 | Cartel Special | `broker_stimm_description_talent` | 財閥專員 |
| 35 | 巢都渣滓 | Barrage I | `broker_stimm_durability_1` | 彈幕I |
| 36 | 巢都渣滓 | Barrage II | `broker_stimm_durability_2` | 彈幕II |
| 37 | 巢都渣滓 | Barrage III | `broker_stimm_durability_3` | 彈幕III |
| 38 | 巢都渣滓 | Barrage IV | `broker_stimm_durability_4` | 彈幕IV |
| 39 | 巢都渣滓 | Tank | `broker_stimm_durability_5a` | 坦克 |
| 40 | 巢都渣滓 | Regain | `broker_stimm_durability_5b` | 恢復 |
| 41 | 巢都渣滓 | Spur V | `broker_stimm_celerity_5a` | 激勵V |
| 42 | 巢都渣滓 | Hypex | `broker_stimm_concentration_5b` | 狂熱 |
| 43 | 巢都渣滓 | Klay | `broker_stimm_concentration_5c` | 集中藥 |
| 44 | 護教軍 | Motive Engine | `cryptic_passive_cooldown_regen` | 動力引擎 |
| 45 | 靈能者 | Perils of the Warp | `psyker_peril_passive` | 次元危險 |
| 46 | 歐格林 | Thick Skin | `ogryn_base_tank_passive` | 厚實表皮 |
| 47 | 歐格林 | Outta My Way! | `ogryn_dodge_stagger` | 滾吧你！ |
| 48 | 老兵 | Determined | `veteran_supression_immunity` | 堅定不移 |
| 49 | 巢都渣滓 | Wildfire I | `broker_stimm_combat_1` | 野火I |
| 50 | 巢都渣滓 | Wildfire II | `broker_stimm_combat_2` | 野火II |
| 51 | 巢都渣滓 | Wildfire III | `broker_stimm_combat_3` | 野火III |
| 52 | 巢都渣滓 | Wildfire IV | `broker_stimm_combat_4a` | 野火IV |
| 53 | 巢都渣滓 | Wildfire V | `broker_stimm_combat_5a` | 野火V |
| 54 | 巢都渣滓 | Fury I | `broker_stimm_combat_4b` | 狂怒I |
| 55 | 巢都渣滓 | Fury II | `broker_stimm_combat_5b` | 狂怒II |

### 已標記過時的具名技能

| 職業 | 英文名稱 | 原有繁中對應 | 1.13 狀態 |
|---|---|---|---|
| 靈能者 | Tranquility Through Slaughter | 殺無赦，心祥和 | 可選天賦移除 |
| 狂信徒 | Punishment | 懲罰 | 可選天賦移除 |
| 狂信徒 | Impassible | 不可逾越 | 可選天賦移除 |
| 狂信徒 | Grievous Wounds | 重傷 | 可選天賦移除 |
| 護教軍 | Readiness Doctrines | 備戰教條 | 獨立子節點移除；效果併入進階戰鬥教範 |

### 小型節點與名稱核對備註

- 翻譯表另有 7 項小型節點名稱在目前七職業技能樹均未使用，已標記過時並保留歷史譯名：Peril Resistance, Movement Speed Boost, Reload Boost, Rending Boost, Stamina Boost, Stamina Regeneration Boost, Suppression Boost。此標記限獨立小型節點，不表示相關屬性或其他技能效果被移除。
- 鮮血救贖（Blood Redemption）與卓越氣場（Towering Presence）改為職業內建被動，保留既有對應。
- The Emperor's Will 與 Kinetic Energy Distributors 修正英文拼寫，保留原有繁中對應；後者已沿用既有對應。
- 老兵基礎效果使用同版正式英文名稱：Guardsman、Practiced Efficiency、Determined、Low Profile。舊盤點的 Increased Ranged Damage、Survivalist Passive、Suppression Immunity、Cover Peeking 是功能標題；Low Profile 的 zh-tw 文本仍標記 `[Not Translated]`，保留原始英文，不重複列入 55 項繁中配對。
- 正式名稱只按相同名稱鍵配對；不將舊天賦定義、重用圖示或更換程式識別碼直接判成技能移除。

- 本批名稱直接取自同版 zh-tw 文本。例如 Focused Warp／聚焦次元、Peril Equilibrium／危險平衡、Guardsman／衛兵、Practiced Efficiency／實踐效率；保留文本中的實際用字。
