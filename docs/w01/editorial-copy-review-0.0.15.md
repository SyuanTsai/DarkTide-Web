# W01 Chainaxe player-copy review: 0.0.15

This record documents the Web-owned Chainaxe copy proposed for pending preview 0.0.15. All comparison inputs and output values come from the four Source claims; Web authoring contains only the player wording and typed claim bindings. The official weapon name remains byte-exact: `突擊鏈斧`.

## Player-facing copy

| Section | Exact 0.0.15 text |
| --- | --- |
| 效果 | `傷害素質 60% → 80%：輕攻擊對第一個目標的威力 113 → 119。` |
| 效果 | `護甲穿透素質 60% → 80%：輕攻擊對防彈護甲的傷害倍率約 1.60 → 1.76 倍。` |
| 補充說明 | `這些是傷害計算值，不是實際扣血量。` |

The standalone lines identify each stat, comparison inputs, attack, target, and output. Neither line calls 60% and 80% obtainable, drop, global, or game-wide bounds. The note distinguishes calculation parameters from actual damage dealt. Raw profile endpoints and the former incomplete-data placeholder are absent.

## Source bindings and display

| Output | Source claims | Source target/property | Display |
| --- | --- | --- | --- |
| `113 → 119` attack power | `darktide:claim:chainaxe:p1-m1-default-light-attack-power-comparison-60` and `...-comparison-80` | `darktide:stat-definition:chainaxe-p1-m1-default-light-attack-power-table`; `damage_templates.default_light_chainaxe.targets[1].power_distribution.attack`; `chainaxe_dps_stat` | Source point values; the target is the first target in the default light-attack profile. |
| `1.60 → 1.76` armor multiplier | `darktide:claim:chainaxe:p1-m1-default-light-armored-modifier-comparison-60` and `...-comparison-80` | `darktide:stat-definition:chainaxe-p1-m1-default-light-armored-parameter-table`; `damage_templates.default_light_chainaxe.targets[1].armor_damage_modifier.attack[armor_types.armored]`; `chainaxe_armor_pierce_stat` | Source ratios 1.6023 and 1.7604 rounded half-up to two decimal places as multipliers. |

Each Source claim context supplies its known comparison stat (60 or 80 percent); each claim value supplies the point or ratio. The formatter reads both from the pinned Source artifact, so Web authoring does not duplicate those numeric values. The `armor_types.armored` value is presented as 防彈護甲 under the fixed terminology reference. These are parameters in the default light-attack profile, not final damage or actual health loss.

The pinned Source package remains commit `7f88a1368a29a79c0de654ee5cd17886dd360a47`, revision `f9917e5f8c14e1fd768f502b9c0cafa59602cae1ac5e9bf8372e467268de38e2`, manifest SHA-256 `e8ec9697ce5b15d3e9e040a2c023f18db23e2fa7ab41ea25c28f75eb75e85835`. Source technical JSON, its four claims, and the lock remain unchanged from 0.0.14.

## Version and review state

The current candidate is `0.0.15`. The exact 0.0.14 package is reconstructed from Web commit `b57d6268a470009a560eb03a8a3da4ba6748f106`, with build ID `6591d2c886a7bb1bb41f8dc9cb7e261dea570ebd0d8e7e956ee5e4d3d536daa4`, data revision `9bd96c5e5dead2999ef76ce9b86d0568724b761050ea3ec40b66e47ff815778d`, manifest SHA-256 `58c326e0777cda314bb9016e0d8f3cb748cc59de1ceb33bd0ac4b92fcd717492`, and version.json SHA-256 `86f853ffc0b38c17e31b7c224dcacaa9344c9fa4e8f9f2bee3ae1dbdf7fe5b2d`. The workflow retains its immutable data URLs before building 0.0.15. The new candidate remains `pending-preview`, publication-ineligible, and pending human review; formal publication is still blocked by the missing human review receipts.
