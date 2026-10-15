# W01 Psyker wording review — 0.0.10

Status: pending human content review. These proposed Web-owned condition strings are for the isolated preview only; this record does not approve formal publication.

## Scope and evidence references

This copy pass changes only the `text` values for the five listed condition records in `content/w01/web-authoring.json`. Record IDs, `claimRefs`, official text and localization, Source records and values, and all other wording stay unchanged. The edits preserve the inherited analysis; they do not add mechanics, re-evaluate a game-version match, or claim in-game testing.

- Fixed Source input: public commit `5d16c70a828d4bd6293a12430cd4ebea36c6ed1c`, source revision `8e2996286df1875eb55d4e1ecd1650443ca9bd9b1a45a364c9c3f6de4f76048d`, manifest SHA-256 `625725aa628f55bc484dd6fd267170b9991bb16b1d46c975a87193733c6418bc`.
- Inherited Mods analysis: commit `241ad76ce62330472aa423055a5b85db59bb6c0d`; English file `Game Info/releases/1.13.X/skills/talents/Psyker/en/psyker_brain_burst_improved.md` (Git blob SHA-256 `0865a4c7c71e2fc21ed2c1c8d19c87e5cfbea3523a7ae957684ba5ce7d420403`) and zh-TW file `Game Info/releases/1.13.X/skills/talents/Psyker/psyker_brain_burst_improved.md` (Git blob SHA-256 `cedc22b9acc3f69d0ef1906ce254b60ad5782d42699b636c2348ca80841acbef`). These locators preserve the source of the existing analysis; this record does not reproduce it.
- Terminology reference: the same Mods commit, `Referneces/Translation.md` (Git blob SHA-256 `fb60e9e8b7beb81765ca50acb3483b9a10e3148e82f630bdf43878a8e45543a0`). It maps `Peril` to `反噬` / `靈能反噬`, `Stagger` / `Staggering` to `踉蹌`, `Brain Burst` to `顱腦爆裂`, `Brain Rupture` to `顱腦崩裂`, and `Smite` to `懲戒`. These are terminology references, not mechanics evidence. The code symbol `Smite` does not by itself mean that the player-facing skill label should be `懲戒`.

## Before and proposed after

1. **`psyker-normal-charge-condition`**

   Before: “一般模式不必先取得目標即可開始蓄力，也會開始累積反噬；瞄準會跟隨系統選定的目標更新。”

   Proposed after: “一般模式不用先鎖定目標就能開始蓄力，蓄力期間也會累積反噬；瞄準方向改變時，目標也會跟著更新。”

   `claimRefs`: `darktide:claim:psyker:brain-burst-improved-normal-charge-base-time`.

2. **`psyker-sticky-charge-condition`**

   Before: “鎖定目標模式需先取得有效目標；尚未鎖定時不會預先蓄力，鎖定後也不會隨瞄準切換目標。目標改變會重新計算這次蓄力時間。”

   Proposed after: “鎖定目標模式要先找到可鎖定的目標才會開始蓄力；開始蓄力後，移動準星不會改變鎖定目標。若鎖定目標改變，這次蓄力會重新計時。”

   `claimRefs`: `darktide:claim:psyker:brain-burst-improved-normal-charge-base-time`, `darktide:claim:psyker:brain-burst-improved-sticky-charge-base-time`.

3. **`psyker-lock-on-charge-condition`**

   Before: “開始鎖定蓄力需要有效目標。從一般蓄力切換成鎖定時，可接續已累積的蓄力；重新開始蓄力則採一般模式的基本時間。”

   Proposed after: “蓄力途中找到可鎖定的目標後，就能切換成鎖定，並接續原本的蓄力進度。這種鎖定方式若從頭開始蓄力，基本時間和一般蓄力相同。”

   `claimRefs`: `darktide:claim:psyker:brain-burst-improved-normal-charge-base-time`.

4. **`psyker-lock-on-stagger-condition`**

   Before: “可受此攻擊僵直的目標：直接鎖定維持 1 秒會造成一次小幅僵直；從一般蓄力切換鎖定後，超過 0.25 秒也會造成一次小幅僵直。”

   Proposed after: “若目標能被此攻擊打出踉蹌，直接鎖定維持 1 秒會造成一次輕微踉蹌；從一般蓄力切換到鎖定後，若持續鎖定超過 0.25 秒，也會造成一次輕微踉蹌。”

   `claimRefs`: `darktide:claim:psyker:brain-burst-improved-normal-charge-base-time`, `darktide:claim:psyker:brain-burst-improved-sticky-charge-base-time`. The `0.25` threshold starts after switching to lock-on and is strictly greater than 0.25 seconds; the prior normal-charge duration is not its start point. “輕微” preserves the existing stagger intensity, and each condition still describes one stagger event.

5. **`psyker-smite-damage-type-condition`**

   Before: “這項倍率只套用於顱腦崩裂使用的傷害類型，不代表所有靈能攻擊都會套用。”

   Proposed after: “這項傷害倍率只作用在顱腦崩裂使用的傷害類型，不代表所有靈能攻擊都會套用。”

   `claimRefs`: `darktide:claim:psyker:brain-burst-improved-smite-damage-multiplier`. `Smite` remains a code-side damage-type term here; the text does not rename the skill or claim that no other effect can use that damage type.

## Review gates

SOL checks the five proposed strings against these existing references, ensuring the conditions, timing origins, strict threshold, event count, intensity, scope, and negation have not shifted. No IDs or claim references are changed. The official English and zh-TW source strings stay byte-exact; any established correction remains a separate visible erratum. The preview remains pending human review. Formal publication requires the reviewed before/after diff and a human content decision.
