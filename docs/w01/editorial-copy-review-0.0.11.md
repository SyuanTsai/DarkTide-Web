# W01 Web-owned copy review — 0.0.11

Status: pending human content review. These Web-owned details are only for the isolated pending preview. This record does not approve formal publication or claim current-version compatibility or in-game testing.

## Scope and fixed references

This pass changes the Psyker skill and Chainaxe blessing presentation details and carries forward the approved visible image-credit caption. It does not change Source records or pins, the Extension, skill/blessing identity, review state, official EN or zh-TW strings, official source identities, ordered segments, hashes, or bound parameters. The skill remains pending and the existing page-level notice remains in place.

- Fixed Source input: public commit `5d16c70a828d4bd6293a12430cd4ebea36c6ed1c`, source revision `8e2996286df1875eb55d4e1ecd1650443ca9bd9b1a45a364c9c3f6de4f76048d`, manifest SHA-256 `625725aa628f55bc484dd6fd267170b9991bb16b1d46c975a87193733c6418bc`.
- Inherited analysis archive: Mods commit `241ad76ce62330472aa423055a5b85db59bb6c0d`; English analysis `Game Info/releases/1.13.X/skills/talents/Psyker/en/psyker_brain_burst_improved.md` (Git blob SHA-256 `0865a4c7c71e2fc21ed2c1c8d19c87e5cfbea3523a7ae957684ba5ce7d420403`) and zh-TW analysis `Game Info/releases/1.13.X/skills/talents/Psyker/psyker_brain_burst_improved.md` (Git blob SHA-256 `cedc22b9acc3f69d0ef1906ce254b60ad5782d42699b636c2348ca80841acbef`). These are locators for inherited analysis; the wording pass does not reproduce or re-derive it.
- Terminology reference: the same Mods commit, `Referneces/Translation.md` (Git blob SHA-256 `fb60e9e8b7beb81765ca50acb3483b9a10e3148e82f630bdf43878a8e45543a0`). It maps Peril to 反噬／靈能反噬, Stagger/Staggering to 踉蹌, Brain Burst to 顱腦爆裂, Brain Rupture to 顱腦崩裂, and Smite to 懲戒. These are term references, not mechanics evidence; a code-side damage-type symbol does not automatically rename the player-facing skill.

## Psyker skill

Presentation: `web:presentation:psyker-brain-burst-improved`. The exact official zh-TW text remains two paragraphs, with its original blank line:

> 積蓄靈能力量，釋放時可對單個敵人造成巨大傷害。
>
> 該天賦是可造成{damage:%s}傷害的{talent_old:%s}的加強版。

The English original, both ordered segment lists, source identities and hashes, +50% and official-name bindings, and empty errata are unchanged.

| Item | Before in .10 | .11 wording or disposition | Existing claim references |
|---|---|---|---|
| `psyker-description-damage-parameter` | 選用此天賦後，顱腦崩裂相關傷害會套用 1.5 倍倍率；在其他條件相同時，相當於增加 50%。這是乘算，不是額外固定傷害。 | 其他條件相同時，顱腦崩裂傷害提高 50%（1.5 倍）；這項加成不適用於所有靈能攻擊。 | `darktide:claim:psyker:brain-burst-improved-description-display-percent`; `darktide:claim:psyker:brain-burst-improved-smite-damage-multiplier` |
| `psyker-base-hit-peril-cost` | 成功造成傷害才會額外增加反噬；沒有其他加成時，基本增加量為 25%，不隨蓄力程度改變。 | 成功造成傷害時，基本增加 25% 反噬，不隨蓄力程度改變。 | `darktide:claim:psyker:brain-burst-improved-successful-hit-base-peril-ratio` |
| `psyker-normal-charge-condition` | 一般模式不用先鎖定目標就能開始蓄力，蓄力期間也會累積反噬；瞄準方向改變時，目標也會跟著更新。 | 一般蓄力不必先取得目標，期間會累積反噬；選定目標會隨瞄準方向改變。 | `darktide:claim:psyker:brain-burst-improved-normal-charge-base-time` |
| `psyker-sticky-charge-condition` | 鎖定目標模式要先找到可鎖定的目標才會開始蓄力；開始蓄力後，移動準星不會改變鎖定目標。若鎖定目標改變，這次蓄力會重新計時。 | 先鎖定再蓄力時，需要可鎖定的目標；鎖定後，移動準星不會更換目標。 | `darktide:claim:psyker:brain-burst-improved-normal-charge-base-time`; `darktide:claim:psyker:brain-burst-improved-sticky-charge-base-time` |
| `psyker-lock-on-charge-condition` | 蓄力途中找到可鎖定的目標後，就能切換成鎖定，並接續原本的蓄力進度。這種鎖定方式若從頭開始蓄力，基本時間和一般蓄力相同。 | 從一般蓄力轉為鎖定時，可保留已累積的蓄力進度。 | `darktide:claim:psyker:brain-burst-improved-normal-charge-base-time` |
| `psyker-lock-on-stagger-condition` | 若目標能被此攻擊打出踉蹌，直接鎖定維持 1 秒會造成一次輕微踉蹌；從一般蓄力切換到鎖定後，若持續鎖定超過 0.25 秒，也會造成一次輕微踉蹌。 | 移至兩筆額外說明；依既有分析將直接鎖定條件精確寫為「超過 1 秒」，並保留切換後「超過 0.25 秒」、一次及輕微強度。 | `darktide:claim:psyker:brain-burst-improved-normal-charge-base-time`; `darktide:claim:psyker:brain-burst-improved-sticky-charge-base-time` |
| `psyker-smite-damage-type-condition` | 這項傷害倍率只作用在顱腦崩裂使用的傷害類型，不代表所有靈能攻擊都會套用。 | Removed as a separate condition; its scope is stated once in `psyker-description-damage-parameter`. The multiplier claim remains on that effect. | `darktide:claim:psyker:brain-burst-improved-smite-damage-multiplier` |
| `psyker-estimate-assumptions` | 以下是既有分析的估算，假設蓄力速度沒有修正、沒有其他角色加成，並在滿蓄後立即成功造成傷害；尚未經遊戲內實測。 | 以下假設從 0% 反噬開始，沒有蓄力速度或反噬相關加成，且蓄力不中斷。 | No claim reference; this is the shared estimate precondition. |
| `psyker-damage-multiplier-example` | 同一次攻擊、同一目標與部位、同一蓄力程度，且其他倍率不變時，假設傷害值為 100，乘上 1.5 後為 150；100 只是比較基準，不是固定實際傷害。 | Removed; the supported damage scope is stated once in Effects instead. | `darktide:claim:psyker:brain-burst-improved-smite-damage-multiplier` remains on the effect. |
| `psyker-normal-charge-peril-estimate` | 一般模式約 3 秒滿蓄；蓄力 1、2、3 秒時，反噬約為 6.67%、13.33%、20%。滿蓄後每多持續 1 秒，約再增加 9%。 | 一般蓄力約 3 秒滿蓄；蓄力 1、2、3 秒時，反噬約為 6.67%、13.33%、20%。 | `darktide:claim:psyker:brain-burst-improved-normal-charge-base-time` |
| `psyker-normal-charge-total-peril-estimate` | 在上述條件下，3 秒滿蓄約累積 20%，成功造成傷害再加基本 25% 命中成本，合計約 45%；滿蓄後多持續 1 秒再命中，合計約 54%。 | 與 sticky 模式的總量合併至 `psyker-full-charge-hit-peril-estimate`，並明確標出滿蓄後立即命中及多維持 1 秒再命中的條件。 | `darktide:claim:psyker:brain-burst-improved-normal-charge-base-time`; `darktide:claim:psyker:brain-burst-improved-successful-hit-base-peril-ratio` |
| `psyker-sticky-charge-peril-estimate` | 鎖定目標模式需先取得有效目標；蓄力 1、2 秒時，反噬約為 10%、20%，約 2 秒滿蓄。滿蓄後每多持續 1 秒，反噬約再增加 9%；滿蓄後立即成功造成傷害，合計約為 45%。 | 先鎖定再蓄力約 2 秒滿蓄；蓄力 1、2 秒時，反噬約為 10%、20%。 | `darktide:claim:psyker:brain-burst-improved-sticky-charge-base-time` |
| `psyker-full-charge-peril-rate-estimate` | 合併自 `psyker-normal-charge-peril-estimate` 的「一般模式約 3 秒滿蓄；蓄力 1、2、3 秒時，反噬約為 6.67%、13.33%、20%。滿蓄後每多持續 1 秒，約再增加 9%。」以及 `psyker-sticky-charge-peril-estimate` 的「鎖定目標模式需先取得有效目標；蓄力 1、2 秒時，反噬約為 10%、20%，約 2 秒滿蓄。滿蓄後每多持續 1 秒，反噬約再增加 9%；滿蓄後立即成功造成傷害，合計約為 45%。」 | 滿蓄後每多維持 1 秒，反噬約再增加 9%。 | `darktide:claim:psyker:brain-burst-improved-normal-charge-base-time`; `darktide:claim:psyker:brain-burst-improved-sticky-charge-base-time` |
| `psyker-full-charge-hit-peril-estimate` | .10 沒有此共用項目。`psyker-normal-charge-total-peril-estimate` 原文為「在上述條件下，3 秒滿蓄約累積 20%，成功造成傷害再加基本 25% 命中成本，合計約 45%；滿蓄後多持續 1 秒再命中，合計約 54%。」；`psyker-sticky-charge-peril-estimate` 另列「滿蓄後立即成功造成傷害，合計約為 45%」。`psyker-estimate-assumptions` 已明寫「並在滿蓄後立即成功造成傷害」。 | 滿蓄後立即成功造成傷害，反噬合計約 45%；再維持 1 秒才成功造成傷害，合計約 54%。 | `darktide:claim:psyker:brain-burst-improved-normal-charge-base-time`; `darktide:claim:psyker:brain-burst-improved-sticky-charge-base-time`; `darktide:claim:psyker:brain-burst-improved-successful-hit-base-peril-ratio` |
| `psyker-empty-cast-peril-cost` | 空放或未實際造成傷害時，不會支付基本命中成本；但蓄力期間已累積的反噬仍會保留。 | 空放或未造成傷害時，不增加上述 25% 反噬；蓄力期間已累積的反噬仍會保留。 | `darktide:claim:psyker:brain-burst-improved-successful-hit-base-peril-ratio` |
| `psyker-peril-estimate-limits`, `psyker-final-damage-limits`, `psyker-runtime-flow-limits`, and `psyker-smite-term` | The .10 notes stated: `psyker-peril-estimate-limits`:「蓄力速度與角色加成會改變實際蓄力時間或反噬；其他屬性與能力加成也會影響實際數字，以上假設不適用於所有配裝。」；`psyker-final-damage-limits`:「攻擊資料中的基礎數值不能直接當成最終傷害；護甲、部位、蓄力與其他加成都會影響結果。」；`psyker-runtime-flow-limits`:「移動、目標消失或改變、受到僵直及連線同步都可能影響實際流程。」；`psyker-smite-term` was a term reference, not a player-text item. | Removed repeated caveats and the repeated term card; the calculation precondition and the supported scope remain in the relevant sections. | Existing claim references remain attached to the relevant Effects, Conditions, Calculation and Notes items. |

F45 concerned an unpublished intermediate draft in this .11 work, not the published .10 baseline. The .10 assumption already said success occurs immediately after full charge, and the sticky estimate also stated that condition. This revision consolidates the shared 9% rate and the 45%/54% totals rather than correcting .10. For stagger, the .10 wording said “直接鎖定維持 1 秒”; this wording pass uses “超過 1 秒” to reflect the strict threshold in the inherited analysis.

Calculation keeps one shared estimate assumption, one row for each charge mode, one shared per-second increment, and one shared hit-total row. Values are estimates from inherited analysis; the copy does not infer reset-on-target-change behavior or describe an operation sequence for the lock-on branch.

## Chainaxe blessing

Presentation: `web:presentation:chainaxe-p1-movement-speed`. The default remains tier 4, and all four options keep their matching Source bindings and values (17%, 18%, 19%, 20%). The existing official description and its 2-second parameter remain unchanged at every tier.

| Item | Before in .10 | .11 wording or disposition | Existing source reference |
|---|---|---|---|
| `chainaxe-tier-display-parameter` | `此階級的說明數值為 ` + the selected signed-percent value + `。` | `本階級標示的移動速度加成為 ` + the same selected signed-percent value + `。` This remains a description value, not a claim about final movement speed, stacking or refresh behavior. | Each option keeps its exact matching `darktide:claim:chainaxe:p1-movement-speed-on-activation-tierN-display-percent` binding and claim reference. |
| `chainaxe-special-activation-condition` | 啟動武器的特殊動作。 | 啟動武器特殊動作後生效。 | No new claim reference. |
| `chainaxe-template-duration-parameter` | 說明中的持續時間為 2 秒。 | Removed as duplicate player detail. The unchanged official EN/zh-TW strings and their `time` parameter continue to show 2 seconds; the duration claim remains bound by the official parameter for the root and all four options. | `darktide:claim:chainaxe:p1-movement-speed-on-activation-duration` remains in the official parameter binding. |
| `chainaxe-tier-coverage` | 說明列出 4 個階級；可取得的階級尚未確認。 | Removed from player copy. Source continues to distinguish defined tiers from unknown obtainable tiers. Calculation, Notes and Extra remain empty. | Variant Source metadata unchanged. |

## Image credit and review gates

The two permitted images and their URLs are unchanged. The visible caption is “圖示來源：Games Lantern”; its link remains a do-follow link to `https://darktide.gameslantern.com`. No weapon image is added.

SOL checks that the wording remains within the fixed claims and inherited analysis. Human content review is pending; neither this record nor engineering verification approves formal publication.
