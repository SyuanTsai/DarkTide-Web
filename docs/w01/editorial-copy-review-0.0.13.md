# W01 compact player-copy review: 0.0.13

This record maps the 0.0.12 player copy to the exact compact copy selected for the 0.0.13 preview. The input wording is recorded in [SYP-333 comment 11812](https://syuantsai.atlassian.net/browse/SYP-333?focusedCommentId=11812). This is a preview-copy change only; the content remains pending formal human review.

The source contract remains Source commit `5d16c70a828d4bd6293a12430cd4ebea36c6ed1c`, revision `8e2996286df1875eb55d4e1ecd1650443ca9bd9b1a45a364c9c3f6de4f76048d`, and manifest `625725aa628f55bc484dd6fd267170b9991bb16b1d46c975a87193733c6418bc`. The inherited MOD analysis reference remains commit `241ad76ce62330472aa423055a5b85db59bb6c0d`. This update changes Web-owned detail text, the package version, and the bounded compiler formatting for tier detail values. The unsigned-percent detail part removes only a leading plus sign from the already validated selected-tier claim; official signed-percent bindings remain unchanged. Official strings, official source identities or hashes, Source records or claims, claimRefs, term references, images, announcements, and weapon data are unchanged.

## Skill detail copy

| Item ID | 0.0.12 copy | 0.0.13 copy |
| --- | --- | --- |
| `psyker-numerical-assumptions` | 以下數值以未受其他加成或減免影響為前提。 | 以下數值不含其他加成或減免。 |
| `psyker-description-damage-parameter` | 顱腦崩裂的傷害提高 50%（1.5 倍）；這項增傷不會套用到所有靈能攻擊。 | 相較於顱腦爆裂，顱腦崩裂傷害提高 50%（1.5 倍）；這項加成不適用於所有靈能攻擊。 |
| `psyker-base-hit-peril-cost` | 蓄力期間會累積反噬；攻擊造成傷害時，還會額外增加 25% 反噬。 | 顱腦崩裂蓄力時，你會累積反噬；造成傷害後再增加 25%。 |
| `psyker-normal-charge-condition` | 先蓄力再鎖定：可以先蓄力，之後再鎖定敵人；鎖定時會接續先前的蓄力進度。 | 先蓄力再鎖定：未鎖定敵人也能蓄力；鎖定後接續蓄力進度。 |
| `psyker-sticky-charge-condition` | 直接鎖定蓄力：鎖定敵人後開始蓄力。 | 直接鎖定蓄力：先鎖定敵人，再蓄力。 |
| `psyker-lock-on-charge-condition` | 鎖定後，即使移開準星，也不會更換目標。 | 鎖定後，移開準星也不會更換目標。 |
| `psyker-estimate-assumptions` | 以下從 0% 反噬開始，連續完成下列其中一種蓄力方式： | 你的反噬從 0% 起算，且蓄力不中斷： |
| `psyker-normal-charge-peril-estimate` | 先完成蓄力再鎖定：蓄力約 3 秒完成；蓄力 1、2、3 秒時，反噬約為 6.67%、13.33%、20%。 | 先蓄力再鎖定：約 3 秒蓄滿；1／2／3 秒時，你的反噬約 6.67%／13.33%／20%。 |
| `psyker-sticky-charge-peril-estimate` | 直接鎖定蓄力：蓄力約 2 秒完成；蓄力 1、2 秒時，反噬約為 10%、20%。 | 直接鎖定蓄力：約 2 秒蓄滿；1／2 秒時，你的反噬約 10%／20%。 |
| `psyker-full-charge-peril-rate-estimate` | 完成蓄力後若繼續維持，每秒約再增加 9% 反噬。 | 滿蓄後繼續蓄力，你的反噬每秒約增加 9%。 |
| `psyker-full-charge-hit-peril-estimate` | 以上兩種方式完成蓄力後，立刻施放並造成傷害，反噬合計約 45%；若再維持蓄力 1 秒才施放並造成傷害，合計約 54%。 | 顱腦崩裂蓄滿後立即造成傷害，你的反噬約 45%；多維持 1 秒則約 54%。 |
| `psyker-empty-cast-peril-cost` | 攻擊沒有造成傷害時，不會增加額外的 25% 反噬；蓄力期間累積的反噬仍會保留。 | 顱腦崩裂未造成傷害時，你不會再累積 25% 反噬；蓄力時累積的反噬仍保留。 |
| `psyker-stagger-eligible-target-condition` | 以下情形只適用於可被這次攻擊打出踉蹌的敵人： | 以下僅適用於會被顱腦崩裂打出踉蹌的敵人： |
| `psyker-lock-on-direct-stagger-condition` | 直接鎖定蓄力：鎖定同一敵人並持續超過 1 秒，可造成一次輕微踉蹌。 | 直接鎖定：鎖定同一敵人超過 1 秒，顱腦崩裂使其輕微踉蹌一次。 |
| `psyker-lock-on-transition-stagger-condition` | 先蓄力再鎖定：轉為鎖定後持續超過 0.25 秒，可造成一次輕微踉蹌。 | 先蓄力再鎖定：鎖定敵人超過 0.25 秒，顱腦崩裂使其輕微踉蹌一次。 |

The five detail sections remain lists. Their item IDs and reference mappings are retained; no new mechanics claims were authored. The source and official-text identity are unchanged. The official Traditional Chinese string, including its two-paragraph line break, remains byte-exact: `積蓄靈能力量，釋放時可對單個敵人造成巨大傷害。\n\n該天賦是可造成{damage:%s}傷害的{talent_old:%s}的加強版。`

## Blessing detail copy

The four-tier selector remains defaulted to tier 4. Each option keeps its matching Source-bound percent claim. Official EN/zh-TW parameters remain signed-percent; the Web-owned detail uses a typed unsigned-percent part that removes only the leading display plus sign, preserving the same tier claim and numeric value.

| Tier | 0.0.12 effect | 0.0.13 effect | Condition |
| --- | --- | --- | --- |
| 1 | 移動速度加成：+17%。 | 你的移動速度提高 17%。 | 使用武器特殊動作後生效，持續 2 秒。 |
| 2 | 移動速度加成：+18%。 | 你的移動速度提高 18%。 | 使用武器特殊動作後生效，持續 2 秒。 |
| 3 | 移動速度加成：+19%。 | 你的移動速度提高 19%。 | 使用武器特殊動作後生效，持續 2 秒。 |
| 4 | 移動速度加成：+20%。 | 你的移動速度提高 20%。 | 使用武器特殊動作後生效，持續 2 秒。 |

The blessing's four official source strings, default tier, option order, Source bindings, and tier values remain unchanged. Its calculation, notes, and extra sections remain empty. The wording describes the tier display value and does not assert obtainable-tier status or additional stacking behavior.

## Package and retention

The package version advances from `0.0.12` to `0.0.13`. The preview workflow rebuilds exact published `0.0.12` Web commit `869f03f829b377ed4779ec73f55baf8a7507d6c4`, retains and verifies its immutable data, then builds `0.0.13` in the same output. The candidate remains `pending-preview`, publication-ineligible, and pending human content review.
