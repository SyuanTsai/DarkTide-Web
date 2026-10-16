# W01 editorial copy review: pending candidate 0.0.12

Status: engineering copy review for an isolated preview. This record is not approval for formal publication.

Approved preview-copy baseline: [SYP-333 comment 11800](https://syuantsai.atlassian.net/browse/SYP-333?focusedCommentId=11800). The user subsequently confirmed that draft and its preview-only scope in [SYP-333 comment 11801](https://syuantsai.atlassian.net/browse/SYP-333?focusedCommentId=11801). This is not approval for formal content publication or current-game compatibility. The F50 mechanical cross-check was resolved by keeping the shared numerical premise as its own effect item, preserving the charge claims on the combined Peril sentence, and carrying both normal and sticky claims on the common lock/stagger scope items.

This change updates only Web-owned player wording for the Psyker skill and Chainaxe blessing. Source records, official strings, evidence values, Source pins, and review states remain unchanged.

## Fixed inputs

- Published Web baseline: exact .11 commit 3cf93b2e8c9acdcdc7ea5695c24e57a49c04b9b1, content version 0.0.11.
- Source: SyuanTsai/DarkTide-Source-Data, commit 5d16c70a828d4bd6293a12430cd4ebea36c6ed1c, revision 8e2996286df1875eb55d4e1ecd1650443ca9bd9b1a45a364c9c3f6de4f76048d, manifest SHA-256 625725aa628f55bc484dd6fd267170b9991bb16b1d46c975a87193733c6418bc.
- Inherited analysis: Mods commit 241ad76ce62330472aa423055a5b85db59bb6c0d, Game Info/releases/1.13.X/skills/talents/Psyker/psyker_brain_burst_improved.md and its English sibling. This preserves existing historical analysis provenance; it does not prove current-version compatibility or in-game testing.
- Terminology: the same Mods commit, Referneces/Translation.md, Git blob SHA-256 fb60e9e8b7beb81765ca50acb3483b9a10e3148e82f630bdf43878a8e45543a0. The glossary is a terminology aid, not mechanics evidence.

Only web:presentation:psyker-brain-burst-improved and web:presentation:chainaxe-p1-movement-speed player details change. Two explanatory item IDs are added for the shared numerical assumption and stagger-target scope. Existing skill and blessing entity references, Source claims, tier selector, and official-text bindings are retained.

## Psyker skill

Official English source text remains byte-for-byte:

> Charge up your Psychic Power and release it to deal immense Damage to a Single Enemy.
>
> This is an augmented version of {talent_old:%s} dealing {damage:%s} Damage.

Official zh-TW source text remains byte-for-byte, including its paragraph break:

> 積蓄靈能力量，釋放時可對單個敵人造成巨大傷害。
>
> 該天賦是可造成{damage:%s}傷害的{talent_old:%s}的加強版。

The English text SHA-256 remains dcdd0219e870c7b177e4db1d434582d4ace1678a7304c116c705ad2165e6015b. The zh-TW text SHA-256 remains 3c2c9776162b4a5b5e88615acdb3fb8d8a64f976c17a733fa6ae681d6392da27. Ordered segments, source identities, parameters, generated official output, and errata are unchanged. No correction to official wording is asserted.

### Player-detail before/after

| Section and item ID | Published .11 | Candidate .12 | Claim-reference treatment |
| --- | --- | --- | --- |
| Effects — new psyker-numerical-assumptions | No separate item; qualifier was embedded in the damage sentence. | 以下數值以未受其他加成或減免影響為前提。 | Context only; no claim added. |
| Effects — psyker-description-damage-parameter | 其他條件相同時，顱腦崩裂傷害提高 50%（1.5 倍）；這項加成不適用於所有靈能攻擊。 | 顱腦崩裂的傷害提高 50%（1.5 倍）；這項增傷不會套用到所有靈能攻擊。 | Same description-display and matching-damage-multiplier claims. |
| Effects — psyker-base-hit-peril-cost | 成功造成傷害時，基本增加 25% 反噬，不隨蓄力程度改變。 | 蓄力期間會累積反噬；攻擊造成傷害時，還會額外增加 25% 反噬。 | Adds existing normal-charge and sticky-charge claims to the successful-hit claim so both clauses are traceable. |
| Conditions — psyker-normal-charge-condition | 一般蓄力不必先取得目標，期間會累積反噬；選定目標會隨瞄準方向改變。 | 先蓄力再鎖定：可以先蓄力，之後再鎖定敵人；鎖定時會接續先前的蓄力進度。 | Same normal-charge claim. Removes candidate-selection wording that could imply a player can switch a locked target. |
| Conditions — psyker-sticky-charge-condition | 先鎖定再蓄力時，需要可鎖定的目標；鎖定後，移動準星不會更換目標。 | 直接鎖定蓄力：鎖定敵人後開始蓄力。 | Same normal-charge and sticky-charge claims. |
| Conditions — psyker-lock-on-charge-condition | 從一般蓄力轉為鎖定時，可保留已累積的蓄力進度。 | 鎖定後，即使移開準星，也不會更換目標。 | Keeps the normal-charge claim and adds the sticky-charge claim for the shared lock constraint. Progress preservation moves to the first condition above. |
| Calculation — psyker-estimate-assumptions | 以下假設從 0% 反噬開始，沒有蓄力速度或反噬相關加成，且蓄力不中斷。 | 以下從 0% 反噬開始，連續完成下列其中一種蓄力方式： | No claim change. |
| Calculation — psyker-normal-charge-peril-estimate | 一般蓄力約 3 秒滿蓄；蓄力 1、2、3 秒時，反噬約為 6.67%、13.33%、20%。 | 先完成蓄力再鎖定：蓄力約 3 秒完成；蓄力 1、2、3 秒時，反噬約為 6.67%、13.33%、20%。 | Same normal-charge claim. |
| Calculation — psyker-sticky-charge-peril-estimate | 先鎖定再蓄力約 2 秒滿蓄；蓄力 1、2 秒時，反噬約為 10%、20%。 | 直接鎖定蓄力：蓄力約 2 秒完成；蓄力 1、2 秒時，反噬約為 10%、20%。 | Same sticky-charge claim. |
| Calculation — psyker-full-charge-peril-rate-estimate | 滿蓄後每多維持 1 秒，反噬約再增加 9%。 | 完成蓄力後若繼續維持，每秒約再增加 9% 反噬。 | Same normal-charge and sticky-charge claims. |
| Calculation — psyker-full-charge-hit-peril-estimate | 滿蓄後立即成功造成傷害，反噬合計約 45%；再維持 1 秒才成功造成傷害，合計約 54%。 | 以上兩種方式完成蓄力後，立刻施放並造成傷害，反噬合計約 45%；若再維持蓄力 1 秒才施放並造成傷害，合計約 54%。 | Same normal-charge, sticky-charge, and successful-hit claims. |
| Notes — psyker-empty-cast-peril-cost | 空放或未造成傷害時，不增加上述 25% 反噬；蓄力期間已累積的反噬仍會保留。 | 攻擊沒有造成傷害時，不會增加額外的 25% 反噬；蓄力期間累積的反噬仍會保留。 | Same successful-hit claim. |
| Extra — new psyker-stagger-eligible-target-condition | Eligibility was repeated in each sentence. | 以下情形只適用於可被這次攻擊打出踉蹌的敵人： | Existing normal-charge and sticky-charge references; no Source record added. |
| Extra — psyker-lock-on-direct-stagger-condition | 若目標能被此攻擊打出踉蹌，直接鎖定超過 1 秒會造成一次輕微踉蹌。 | 直接鎖定蓄力：鎖定同一敵人並持續超過 1 秒，可造成一次輕微踉蹌。 | Same normal-charge and sticky-charge claims. |
| Extra — psyker-lock-on-transition-stagger-condition | 若目標能被此攻擊打出踉蹌，從一般蓄力轉為鎖定後，從切換起持續鎖定超過 0.25 秒會造成一次輕微踉蹌。 | 先蓄力再鎖定：轉為鎖定後持續超過 0.25 秒，可造成一次輕微踉蹌。 | Same normal-charge and sticky-charge claims. |

The estimates distinguish two complete paths: finish charging before locking, or charge while directly locked. They do not estimate a mixed path. The 45% and 54% totals apply to those two listed paths. No target-change reset rule or fresh-lock timing is added.

## Chainaxe blessing

Official English source text remains {movement_speed:%s} Movement Speed for {time:%s}s on Weapon Special Activation. Its SHA-256 remains 0b9996580a4b90df38fc200551c45c6b21f0a58819793b9e228df8b598d88518.

Official zh-TW source text remains 武器特殊啟動後{movement_speed:%s}移動速度，持續{time:%s}秒。 Its SHA-256 remains f8979997fa65c7effa8d0abb7ec69e2eefecc53e057caaab104174dce131a887. Ordered segments, source identities, the two-second binding, tier claims, and values are unchanged.

| Item | Published .11 | Candidate .12 |
| --- | --- | --- |
| Effects — chainaxe-tier-display-parameter | Tier 1–4 respectively display 「本階級標示的移動速度加成為 +17%。」「本階級標示的移動速度加成為 +18%。」「本階級標示的移動速度加成為 +19%。」「本階級標示的移動速度加成為 +20%。」; tier 4 is selected by default. | Tier 1–4 respectively display 「移動速度加成：+17%。」「移動速度加成：+18%。」「移動速度加成：+19%。」「移動速度加成：+20%。」; tier 4 is selected by default. |
| Conditions — chainaxe-special-activation-condition | 啟動武器特殊動作後生效。 | 使用武器特殊動作後生效。 |

The selector remains defaulted to tier 4. Its existing Source-bound display values remain +17%, +18%, +19%, and +20% for tiers 1–4. These are official description values, not a claim about measured final movement speed. Calculation, notes, and extra remain empty because this input has no supported additional text.

## Review state

Source pins, Source records and claims, Web term localization, weapon records, announcement, and images are unchanged. Official source strings, hashes, ordered segments, parameters, bindings, and errata are unchanged. The candidate remains pending-preview, fixtureOnly false, candidatePreviewOnly true, publicationEligible false, and formalPublishAllowed false. This record is an engineering copy review, not human content approval or a game-version compatibility decision.