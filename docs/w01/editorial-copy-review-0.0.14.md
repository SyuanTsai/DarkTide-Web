# W01 Chainaxe comparison copy review: 0.0.14

This record documents the Web-owned Chainaxe comparison copy introduced in pending preview 0.0.14. The Source claims supply every displayed number and comparison stat; Web authoring supplies only the labels, wording, and typed bindings. This package remains pending human review and publication-ineligible.

The Source pin is commit `7f88a1368a29a79c0de654ee5cd17886dd360a47`, source revision `f9917e5f8c14e1fd768f502b9c0cafa59602cae1ac5e9bf8372e467268de38e2`, and manifest SHA-256 `e8ec9697ce5b15d3e9e040a2c023f18db23e2fa7ab41ea25c28f75eb75e85835`. The composed technical artifact SHA-256 is `4f8b565127c4ec23f6440501b4e130a57bbc8ac83b452478b3aef17ebf05a8a7`. All four Source claims and this Web presentation remain pending review.

## Copy change

| Before in 0.0.13 | Proposed 0.0.14 copy |
| --- | --- |
| `已收錄的攻擊數值：80、140。` | `輕攻擊威力：60%（本次比較下限）為 113；80%（本次比較上限）為 119。` |
| `已收錄的護甲修正值：1.035、1.965。` | `對防彈護甲傷害修正：60%（本次比較下限）為 160.23%；80%（本次比較上限）為 176.04%。` |
| `其他攻擊資料尚未補齊。` | Removed; the preview no longer presents this placeholder. |

The shared scope note is: `表列 60%／80% 是本頁比較上下限，不代表武器可取得、掉落或全域範圍；數值是預設輕攻擊第一個命中目標的來源參數，不是最終傷害。` The official weapon name remains byte-exact: `突擊鏈斧`.

## Source bindings and display

| Player row | 60% Source claim | 80% Source claim | Source property and target | Display rule |
| --- | --- | --- | --- | --- |
| 輕攻擊威力 | `darktide:claim:chainaxe:p1-m1-default-light-attack-power-comparison-60` = 113 point | `darktide:claim:chainaxe:p1-m1-default-light-attack-power-comparison-80` = 119 point | `damage_templates.default_light_chainaxe.targets[1].power_distribution.attack`; target `darktide:stat-definition:chainaxe-p1-m1-default-light-attack-power-table`; weapon stat `chainaxe_dps_stat` | Show Source point values as supplied. |
| 對防彈護甲傷害修正 | `darktide:claim:chainaxe:p1-m1-default-light-armored-modifier-comparison-60` = 1.6023 ratio | `darktide:claim:chainaxe:p1-m1-default-light-armored-modifier-comparison-80` = 1.7604 ratio | `damage_templates.default_light_chainaxe.targets[1].armor_damage_modifier.attack[armor_types.armored]`; target `darktide:stat-definition:chainaxe-p1-m1-default-light-armored-parameter-table`; weapon stat `chainaxe_armor_pierce_stat` | Multiply Source ratio by 100 and round to two decimal places for player display. |

Each claim context identifies its `weaponStat` and known decimal `comparisonStat` (60 or 80 percent). The first row is the `power_distribution.attack` power parameter for the default light chainaxe's first target. The second row is the `armor_types.armored` modifier, labeled 防彈護甲 according to the fixed terminology reference. Neither row states final damage. The selected 60% and 80% values are comparison inputs for this page only; they do not establish obtainable, drop, or global stat ranges.

## Retention and review state

The exact prior 0.0.13 candidate remains at Web commit `58487ee15c16e398b091c9ad2c29322f3bf5548e`. The preview workflow rebuilds and retains that package and its immutable data URLs before building 0.0.14. The 0.14 candidate remains `pending-preview`, publication-ineligible, and pending human content review; formal publication still requires the applicable human review receipts.
