# Technical claim analysis

This generated English analysis summarizes structured Source claim records and their linked safe evidence summaries. It states only the supplied contract data.

## Claim `darktide:claim:chainaxe:p1-m1-armor-penetration-heavy-armored-60`

- Game release: `darktide:1.13.2`
- Property: `damage_templates.heavy_chainaxe.targets[1].armor_damage_modifier.attack[armor_types.armored]`
- Target: `darktide:1.13.2:darktide:weapon:chainaxe:p1-m1`
- Known value: `0.8094` `ratio`
- Basis: `code-derived`
- Review state: `approved`
- Context (JSON): `{"armorClass":"armored","attackMode":"heavy","comparisonStat":{"decimal":"60","status":"known","unit":"percent"},"damageProfileRef":{"gameReleaseId":"darktide:1.13.2","recordId":"darktide:damage-profile:chainaxe-p1:heavy_chainaxe"},"profile":"heavy_chainaxe","weaponRef":{"gameReleaseId":"darktide:1.13.2","recordId":"darktide:weapon:chainaxe:p1-m1"},"weaponStat":"chainaxe_armor_pierce_stat"}`
- Evidence:
  - `darktide:1.13.2:darktide:evidence:chainaxe:p1-m1-armor-penetration-comparison-code`: At commit ba6c148, chainaxe_armor_pierce_stat applies default_armor_pierce_stat endpoints 0.1 and 0.95; inputs 60% and 80% give t=0.61 and 0.78. The light default_light_chainaxe profile exposes armored/resistant via lerp_1_5 [1.035,1.965] -&gt; 1.6023/1.7604 and super_armor via lerp_0_75 [0.48,1.02] -&gt; 0.8094/0.9012. The heavy_chainaxe profile exposes armored via lerp_0_75 -&gt; 0.8094/0.9012 and super_armor via lerp_0_3 [0.174,0.426] -&gt; 0.32772/0.37056. UI display_type percentage multiplies each raw ratio by 100 and prints two decimals. Only explicit profile armor keys are claimed; values are not final damage.

## Claim `darktide:claim:chainaxe:p1-m1-armor-penetration-heavy-armored-80`

- Game release: `darktide:1.13.2`
- Property: `damage_templates.heavy_chainaxe.targets[1].armor_damage_modifier.attack[armor_types.armored]`
- Target: `darktide:1.13.2:darktide:weapon:chainaxe:p1-m1`
- Known value: `0.9012` `ratio`
- Basis: `code-derived`
- Review state: `approved`
- Context (JSON): `{"armorClass":"armored","attackMode":"heavy","comparisonStat":{"decimal":"80","status":"known","unit":"percent"},"damageProfileRef":{"gameReleaseId":"darktide:1.13.2","recordId":"darktide:damage-profile:chainaxe-p1:heavy_chainaxe"},"profile":"heavy_chainaxe","weaponRef":{"gameReleaseId":"darktide:1.13.2","recordId":"darktide:weapon:chainaxe:p1-m1"},"weaponStat":"chainaxe_armor_pierce_stat"}`
- Evidence:
  - `darktide:1.13.2:darktide:evidence:chainaxe:p1-m1-armor-penetration-comparison-code`: At commit ba6c148, chainaxe_armor_pierce_stat applies default_armor_pierce_stat endpoints 0.1 and 0.95; inputs 60% and 80% give t=0.61 and 0.78. The light default_light_chainaxe profile exposes armored/resistant via lerp_1_5 [1.035,1.965] -&gt; 1.6023/1.7604 and super_armor via lerp_0_75 [0.48,1.02] -&gt; 0.8094/0.9012. The heavy_chainaxe profile exposes armored via lerp_0_75 -&gt; 0.8094/0.9012 and super_armor via lerp_0_3 [0.174,0.426] -&gt; 0.32772/0.37056. UI display_type percentage multiplies each raw ratio by 100 and prints two decimals. Only explicit profile armor keys are claimed; values are not final damage.

## Claim `darktide:claim:chainaxe:p1-m1-armor-penetration-heavy-super_armor-60`

- Game release: `darktide:1.13.2`
- Property: `damage_templates.heavy_chainaxe.targets[1].armor_damage_modifier.attack[armor_types.super_armor]`
- Target: `darktide:1.13.2:darktide:weapon:chainaxe:p1-m1`
- Known value: `0.32772` `ratio`
- Basis: `code-derived`
- Review state: `approved`
- Context (JSON): `{"armorClass":"super_armor","attackMode":"heavy","comparisonStat":{"decimal":"60","status":"known","unit":"percent"},"damageProfileRef":{"gameReleaseId":"darktide:1.13.2","recordId":"darktide:damage-profile:chainaxe-p1:heavy_chainaxe"},"profile":"heavy_chainaxe","weaponRef":{"gameReleaseId":"darktide:1.13.2","recordId":"darktide:weapon:chainaxe:p1-m1"},"weaponStat":"chainaxe_armor_pierce_stat"}`
- Evidence:
  - `darktide:1.13.2:darktide:evidence:chainaxe:p1-m1-armor-penetration-comparison-code`: At commit ba6c148, chainaxe_armor_pierce_stat applies default_armor_pierce_stat endpoints 0.1 and 0.95; inputs 60% and 80% give t=0.61 and 0.78. The light default_light_chainaxe profile exposes armored/resistant via lerp_1_5 [1.035,1.965] -&gt; 1.6023/1.7604 and super_armor via lerp_0_75 [0.48,1.02] -&gt; 0.8094/0.9012. The heavy_chainaxe profile exposes armored via lerp_0_75 -&gt; 0.8094/0.9012 and super_armor via lerp_0_3 [0.174,0.426] -&gt; 0.32772/0.37056. UI display_type percentage multiplies each raw ratio by 100 and prints two decimals. Only explicit profile armor keys are claimed; values are not final damage.

## Claim `darktide:claim:chainaxe:p1-m1-armor-penetration-heavy-super_armor-80`

- Game release: `darktide:1.13.2`
- Property: `damage_templates.heavy_chainaxe.targets[1].armor_damage_modifier.attack[armor_types.super_armor]`
- Target: `darktide:1.13.2:darktide:weapon:chainaxe:p1-m1`
- Known value: `0.37056` `ratio`
- Basis: `code-derived`
- Review state: `approved`
- Context (JSON): `{"armorClass":"super_armor","attackMode":"heavy","comparisonStat":{"decimal":"80","status":"known","unit":"percent"},"damageProfileRef":{"gameReleaseId":"darktide:1.13.2","recordId":"darktide:damage-profile:chainaxe-p1:heavy_chainaxe"},"profile":"heavy_chainaxe","weaponRef":{"gameReleaseId":"darktide:1.13.2","recordId":"darktide:weapon:chainaxe:p1-m1"},"weaponStat":"chainaxe_armor_pierce_stat"}`
- Evidence:
  - `darktide:1.13.2:darktide:evidence:chainaxe:p1-m1-armor-penetration-comparison-code`: At commit ba6c148, chainaxe_armor_pierce_stat applies default_armor_pierce_stat endpoints 0.1 and 0.95; inputs 60% and 80% give t=0.61 and 0.78. The light default_light_chainaxe profile exposes armored/resistant via lerp_1_5 [1.035,1.965] -&gt; 1.6023/1.7604 and super_armor via lerp_0_75 [0.48,1.02] -&gt; 0.8094/0.9012. The heavy_chainaxe profile exposes armored via lerp_0_75 -&gt; 0.8094/0.9012 and super_armor via lerp_0_3 [0.174,0.426] -&gt; 0.32772/0.37056. UI display_type percentage multiplies each raw ratio by 100 and prints two decimals. Only explicit profile armor keys are claimed; values are not final damage.

## Claim `darktide:claim:chainaxe:p1-m1-armor-penetration-light-resistant-60`

- Game release: `darktide:1.13.2`
- Property: `damage_templates.default_light_chainaxe.targets[1].armor_damage_modifier.attack[armor_types.resistant]`
- Target: `darktide:1.13.2:darktide:weapon:chainaxe:p1-m1`
- Known value: `1.6023` `ratio`
- Basis: `code-derived`
- Review state: `approved`
- Context (JSON): `{"armorClass":"resistant","attackMode":"light","comparisonStat":{"decimal":"60","status":"known","unit":"percent"},"damageProfileRef":{"gameReleaseId":"darktide:1.13.2","recordId":"darktide:damage-profile:chainaxe-p1:default_light_chainaxe"},"profile":"default_light_chainaxe","weaponRef":{"gameReleaseId":"darktide:1.13.2","recordId":"darktide:weapon:chainaxe:p1-m1"},"weaponStat":"chainaxe_armor_pierce_stat"}`
- Evidence:
  - `darktide:1.13.2:darktide:evidence:chainaxe:p1-m1-armor-penetration-comparison-code`: At commit ba6c148, chainaxe_armor_pierce_stat applies default_armor_pierce_stat endpoints 0.1 and 0.95; inputs 60% and 80% give t=0.61 and 0.78. The light default_light_chainaxe profile exposes armored/resistant via lerp_1_5 [1.035,1.965] -&gt; 1.6023/1.7604 and super_armor via lerp_0_75 [0.48,1.02] -&gt; 0.8094/0.9012. The heavy_chainaxe profile exposes armored via lerp_0_75 -&gt; 0.8094/0.9012 and super_armor via lerp_0_3 [0.174,0.426] -&gt; 0.32772/0.37056. UI display_type percentage multiplies each raw ratio by 100 and prints two decimals. Only explicit profile armor keys are claimed; values are not final damage.

## Claim `darktide:claim:chainaxe:p1-m1-armor-penetration-light-resistant-80`

- Game release: `darktide:1.13.2`
- Property: `damage_templates.default_light_chainaxe.targets[1].armor_damage_modifier.attack[armor_types.resistant]`
- Target: `darktide:1.13.2:darktide:weapon:chainaxe:p1-m1`
- Known value: `1.7604` `ratio`
- Basis: `code-derived`
- Review state: `approved`
- Context (JSON): `{"armorClass":"resistant","attackMode":"light","comparisonStat":{"decimal":"80","status":"known","unit":"percent"},"damageProfileRef":{"gameReleaseId":"darktide:1.13.2","recordId":"darktide:damage-profile:chainaxe-p1:default_light_chainaxe"},"profile":"default_light_chainaxe","weaponRef":{"gameReleaseId":"darktide:1.13.2","recordId":"darktide:weapon:chainaxe:p1-m1"},"weaponStat":"chainaxe_armor_pierce_stat"}`
- Evidence:
  - `darktide:1.13.2:darktide:evidence:chainaxe:p1-m1-armor-penetration-comparison-code`: At commit ba6c148, chainaxe_armor_pierce_stat applies default_armor_pierce_stat endpoints 0.1 and 0.95; inputs 60% and 80% give t=0.61 and 0.78. The light default_light_chainaxe profile exposes armored/resistant via lerp_1_5 [1.035,1.965] -&gt; 1.6023/1.7604 and super_armor via lerp_0_75 [0.48,1.02] -&gt; 0.8094/0.9012. The heavy_chainaxe profile exposes armored via lerp_0_75 -&gt; 0.8094/0.9012 and super_armor via lerp_0_3 [0.174,0.426] -&gt; 0.32772/0.37056. UI display_type percentage multiplies each raw ratio by 100 and prints two decimals. Only explicit profile armor keys are claimed; values are not final damage.

## Claim `darktide:claim:chainaxe:p1-m1-armor-penetration-light-super_armor-60`

- Game release: `darktide:1.13.2`
- Property: `damage_templates.default_light_chainaxe.targets[1].armor_damage_modifier.attack[armor_types.super_armor]`
- Target: `darktide:1.13.2:darktide:weapon:chainaxe:p1-m1`
- Known value: `0.8094` `ratio`
- Basis: `code-derived`
- Review state: `approved`
- Context (JSON): `{"armorClass":"super_armor","attackMode":"light","comparisonStat":{"decimal":"60","status":"known","unit":"percent"},"damageProfileRef":{"gameReleaseId":"darktide:1.13.2","recordId":"darktide:damage-profile:chainaxe-p1:default_light_chainaxe"},"profile":"default_light_chainaxe","weaponRef":{"gameReleaseId":"darktide:1.13.2","recordId":"darktide:weapon:chainaxe:p1-m1"},"weaponStat":"chainaxe_armor_pierce_stat"}`
- Evidence:
  - `darktide:1.13.2:darktide:evidence:chainaxe:p1-m1-armor-penetration-comparison-code`: At commit ba6c148, chainaxe_armor_pierce_stat applies default_armor_pierce_stat endpoints 0.1 and 0.95; inputs 60% and 80% give t=0.61 and 0.78. The light default_light_chainaxe profile exposes armored/resistant via lerp_1_5 [1.035,1.965] -&gt; 1.6023/1.7604 and super_armor via lerp_0_75 [0.48,1.02] -&gt; 0.8094/0.9012. The heavy_chainaxe profile exposes armored via lerp_0_75 -&gt; 0.8094/0.9012 and super_armor via lerp_0_3 [0.174,0.426] -&gt; 0.32772/0.37056. UI display_type percentage multiplies each raw ratio by 100 and prints two decimals. Only explicit profile armor keys are claimed; values are not final damage.

## Claim `darktide:claim:chainaxe:p1-m1-armor-penetration-light-super_armor-80`

- Game release: `darktide:1.13.2`
- Property: `damage_templates.default_light_chainaxe.targets[1].armor_damage_modifier.attack[armor_types.super_armor]`
- Target: `darktide:1.13.2:darktide:weapon:chainaxe:p1-m1`
- Known value: `0.9012` `ratio`
- Basis: `code-derived`
- Review state: `approved`
- Context (JSON): `{"armorClass":"super_armor","attackMode":"light","comparisonStat":{"decimal":"80","status":"known","unit":"percent"},"damageProfileRef":{"gameReleaseId":"darktide:1.13.2","recordId":"darktide:damage-profile:chainaxe-p1:default_light_chainaxe"},"profile":"default_light_chainaxe","weaponRef":{"gameReleaseId":"darktide:1.13.2","recordId":"darktide:weapon:chainaxe:p1-m1"},"weaponStat":"chainaxe_armor_pierce_stat"}`
- Evidence:
  - `darktide:1.13.2:darktide:evidence:chainaxe:p1-m1-armor-penetration-comparison-code`: At commit ba6c148, chainaxe_armor_pierce_stat applies default_armor_pierce_stat endpoints 0.1 and 0.95; inputs 60% and 80% give t=0.61 and 0.78. The light default_light_chainaxe profile exposes armored/resistant via lerp_1_5 [1.035,1.965] -&gt; 1.6023/1.7604 and super_armor via lerp_0_75 [0.48,1.02] -&gt; 0.8094/0.9012. The heavy_chainaxe profile exposes armored via lerp_0_75 -&gt; 0.8094/0.9012 and super_armor via lerp_0_3 [0.174,0.426] -&gt; 0.32772/0.37056. UI display_type percentage multiplies each raw ratio by 100 and prints two decimals. Only explicit profile armor keys are claimed; values are not final damage.

## Claim `darktide:claim:chainaxe:p1-m1-damage-heavy-attack-power-60`

- Game release: `darktide:1.13.2`
- Property: `damage_templates.heavy_chainaxe.targets[1].power_distribution.attack`
- Target: `darktide:1.13.2:darktide:weapon:chainaxe:p1-m1`
- Known value: `232.5` `attack-power-point`
- Basis: `code-derived`
- Review state: `approved`
- Context (JSON): `{"attackMode":"heavy","comparisonStat":{"decimal":"60","status":"known","unit":"percent"},"damageProfileRef":{"gameReleaseId":"darktide:1.13.2","recordId":"darktide:damage-profile:chainaxe-p1:heavy_chainaxe"},"profile":"heavy_chainaxe","weaponRef":{"gameReleaseId":"darktide:1.13.2","recordId":"darktide:weapon:chainaxe:p1-m1"},"weaponStat":"chainaxe_dps_stat"}`
- Evidence:
  - `darktide:1.13.2:darktide:evidence:chainaxe:p1-m1-damage-comparison-code`: At commit ba6c148, chainaxe_p1_m1 displays action_left_down_light as the light attack-power row and action_left_heavy as the heavy row. The mapped profiles are default_light_chainaxe with raw target-1 attack endpoints 80 and 140, and heavy_chainaxe with endpoints 150 and 300. default_melee_dps_stat interpolates 0.25 to 0.75: inputs 60% and 80% give t=0.55 and 0.65. The resulting source parameters are light 113 and 119; heavy 232.5 and 247.5 attack-power points. These are profile/mode-scoped parameters, not final HP damage and not values for every displayed segment. The player-facing weapon-info panel exposes the raw power_distribution.attack value through a default display row, with no scalar conversion, and formats it to two decimals; this is a source parameter, not health damage.

## Claim `darktide:claim:chainaxe:p1-m1-damage-heavy-attack-power-80`

- Game release: `darktide:1.13.2`
- Property: `damage_templates.heavy_chainaxe.targets[1].power_distribution.attack`
- Target: `darktide:1.13.2:darktide:weapon:chainaxe:p1-m1`
- Known value: `247.5` `attack-power-point`
- Basis: `code-derived`
- Review state: `approved`
- Context (JSON): `{"attackMode":"heavy","comparisonStat":{"decimal":"80","status":"known","unit":"percent"},"damageProfileRef":{"gameReleaseId":"darktide:1.13.2","recordId":"darktide:damage-profile:chainaxe-p1:heavy_chainaxe"},"profile":"heavy_chainaxe","weaponRef":{"gameReleaseId":"darktide:1.13.2","recordId":"darktide:weapon:chainaxe:p1-m1"},"weaponStat":"chainaxe_dps_stat"}`
- Evidence:
  - `darktide:1.13.2:darktide:evidence:chainaxe:p1-m1-damage-comparison-code`: At commit ba6c148, chainaxe_p1_m1 displays action_left_down_light as the light attack-power row and action_left_heavy as the heavy row. The mapped profiles are default_light_chainaxe with raw target-1 attack endpoints 80 and 140, and heavy_chainaxe with endpoints 150 and 300. default_melee_dps_stat interpolates 0.25 to 0.75: inputs 60% and 80% give t=0.55 and 0.65. The resulting source parameters are light 113 and 119; heavy 232.5 and 247.5 attack-power points. These are profile/mode-scoped parameters, not final HP damage and not values for every displayed segment. The player-facing weapon-info panel exposes the raw power_distribution.attack value through a default display row, with no scalar conversion, and formats it to two decimals; this is a source parameter, not health damage.

## Claim `darktide:claim:chainaxe:p1-m1-default-light-armored-modifier-comparison-60`

- Game release: `darktide:1.13.2`
- Property: `damage_templates.default_light_chainaxe.targets[1].armor_damage_modifier.attack[armor_types.armored]`
- Target: `darktide:1.13.2:darktide:stat-definition:chainaxe-p1-m1-default-light-armored-parameter-table`
- Known value: `1.6023` `ratio`
- Basis: `code-derived`
- Review state: `approved`
- Context (JSON): `{"armorClass":"armored","attackMode":"light","comparisonStat":{"decimal":"60","status":"known","unit":"percent"},"damageProfileRef":{"gameReleaseId":"darktide:1.13.2","recordId":"darktide:damage-profile:chainaxe-p1:default_light_chainaxe"},"profile":"default_light_chainaxe","weaponRef":{"gameReleaseId":"darktide:1.13.2","recordId":"darktide:weapon:chainaxe:p1-m1"},"weaponStat":"chainaxe_armor_pierce_stat"}`
- Evidence:
  - `darktide:1.13.2:darktide:evidence:chainaxe:p1-m1-armor-penetration-comparison-code`: At commit ba6c148, chainaxe_armor_pierce_stat applies default_armor_pierce_stat endpoints 0.1 and 0.95; inputs 60% and 80% give t=0.61 and 0.78. The light default_light_chainaxe profile exposes armored/resistant via lerp_1_5 [1.035,1.965] -&gt; 1.6023/1.7604 and super_armor via lerp_0_75 [0.48,1.02] -&gt; 0.8094/0.9012. The heavy_chainaxe profile exposes armored via lerp_0_75 -&gt; 0.8094/0.9012 and super_armor via lerp_0_3 [0.174,0.426] -&gt; 0.32772/0.37056. UI display_type percentage multiplies each raw ratio by 100 and prints two decimals. Only explicit profile armor keys are claimed; values are not final damage.

## Claim `darktide:claim:chainaxe:p1-m1-default-light-armored-modifier-comparison-80`

- Game release: `darktide:1.13.2`
- Property: `damage_templates.default_light_chainaxe.targets[1].armor_damage_modifier.attack[armor_types.armored]`
- Target: `darktide:1.13.2:darktide:stat-definition:chainaxe-p1-m1-default-light-armored-parameter-table`
- Known value: `1.7604` `ratio`
- Basis: `code-derived`
- Review state: `approved`
- Context (JSON): `{"armorClass":"armored","attackMode":"light","comparisonStat":{"decimal":"80","status":"known","unit":"percent"},"damageProfileRef":{"gameReleaseId":"darktide:1.13.2","recordId":"darktide:damage-profile:chainaxe-p1:default_light_chainaxe"},"profile":"default_light_chainaxe","weaponRef":{"gameReleaseId":"darktide:1.13.2","recordId":"darktide:weapon:chainaxe:p1-m1"},"weaponStat":"chainaxe_armor_pierce_stat"}`
- Evidence:
  - `darktide:1.13.2:darktide:evidence:chainaxe:p1-m1-armor-penetration-comparison-code`: At commit ba6c148, chainaxe_armor_pierce_stat applies default_armor_pierce_stat endpoints 0.1 and 0.95; inputs 60% and 80% give t=0.61 and 0.78. The light default_light_chainaxe profile exposes armored/resistant via lerp_1_5 [1.035,1.965] -&gt; 1.6023/1.7604 and super_armor via lerp_0_75 [0.48,1.02] -&gt; 0.8094/0.9012. The heavy_chainaxe profile exposes armored via lerp_0_75 -&gt; 0.8094/0.9012 and super_armor via lerp_0_3 [0.174,0.426] -&gt; 0.32772/0.37056. UI display_type percentage multiplies each raw ratio by 100 and prints two decimals. Only explicit profile armor keys are claimed; values are not final damage.

## Claim `darktide:claim:chainaxe:p1-m1-default-light-attack-power-comparison-60`

- Game release: `darktide:1.13.2`
- Property: `damage_templates.default_light_chainaxe.targets[1].power_distribution.attack`
- Target: `darktide:1.13.2:darktide:stat-definition:chainaxe-p1-m1-default-light-attack-power-table`
- Known value: `113` `attack-power-point`
- Basis: `code-derived`
- Review state: `approved`
- Context (JSON): `{"attackMode":"light","comparisonStat":{"decimal":"60","status":"known","unit":"percent"},"damageProfileRef":{"gameReleaseId":"darktide:1.13.2","recordId":"darktide:damage-profile:chainaxe-p1:default_light_chainaxe"},"profile":"default_light_chainaxe","weaponRef":{"gameReleaseId":"darktide:1.13.2","recordId":"darktide:weapon:chainaxe:p1-m1"},"weaponStat":"chainaxe_dps_stat"}`
- Evidence:
  - `darktide:1.13.2:darktide:evidence:chainaxe:p1-m1-damage-comparison-code`: At commit ba6c148, chainaxe_p1_m1 displays action_left_down_light as the light attack-power row and action_left_heavy as the heavy row. The mapped profiles are default_light_chainaxe with raw target-1 attack endpoints 80 and 140, and heavy_chainaxe with endpoints 150 and 300. default_melee_dps_stat interpolates 0.25 to 0.75: inputs 60% and 80% give t=0.55 and 0.65. The resulting source parameters are light 113 and 119; heavy 232.5 and 247.5 attack-power points. These are profile/mode-scoped parameters, not final HP damage and not values for every displayed segment. The player-facing weapon-info panel exposes the raw power_distribution.attack value through a default display row, with no scalar conversion, and formats it to two decimals; this is a source parameter, not health damage.

## Claim `darktide:claim:chainaxe:p1-m1-default-light-attack-power-comparison-80`

- Game release: `darktide:1.13.2`
- Property: `damage_templates.default_light_chainaxe.targets[1].power_distribution.attack`
- Target: `darktide:1.13.2:darktide:stat-definition:chainaxe-p1-m1-default-light-attack-power-table`
- Known value: `119` `attack-power-point`
- Basis: `code-derived`
- Review state: `approved`
- Context (JSON): `{"attackMode":"light","comparisonStat":{"decimal":"80","status":"known","unit":"percent"},"damageProfileRef":{"gameReleaseId":"darktide:1.13.2","recordId":"darktide:damage-profile:chainaxe-p1:default_light_chainaxe"},"profile":"default_light_chainaxe","weaponRef":{"gameReleaseId":"darktide:1.13.2","recordId":"darktide:weapon:chainaxe:p1-m1"},"weaponStat":"chainaxe_dps_stat"}`
- Evidence:
  - `darktide:1.13.2:darktide:evidence:chainaxe:p1-m1-damage-comparison-code`: At commit ba6c148, chainaxe_p1_m1 displays action_left_down_light as the light attack-power row and action_left_heavy as the heavy row. The mapped profiles are default_light_chainaxe with raw target-1 attack endpoints 80 and 140, and heavy_chainaxe with endpoints 150 and 300. default_melee_dps_stat interpolates 0.25 to 0.75: inputs 60% and 80% give t=0.55 and 0.65. The resulting source parameters are light 113 and 119; heavy 232.5 and 247.5 attack-power points. These are profile/mode-scoped parameters, not final HP damage and not values for every displayed segment. The player-facing weapon-info panel exposes the raw power_distribution.attack value through a default display row, with no scalar conversion, and formats it to two decimals; this is a source parameter, not health damage.

## Claim `darktide:claim:chainaxe:p1-m1-defence-push-cost-60`

- Game release: `darktide:1.13.2`
- Property: `weapon_stamina_templates.linesman.push_cost`
- Target: `darktide:1.13.2:darktide:weapon:chainaxe:p1-m1`
- Known value: `1.8` `stamina-point`
- Basis: `code-derived`
- Review state: `approved`
- Context (JSON): `{"comparisonStat":{"decimal":"60","status":"known","unit":"percent"},"profile":"linesman","weaponRef":{"gameReleaseId":"darktide:1.13.2","recordId":"darktide:weapon:chainaxe:p1-m1"},"weaponStat":"chainaxe_defence_stat"}`
- Evidence:
  - `darktide:1.13.2:darktide:evidence:chainaxe:p1-m1-defence-comparison-code`: At commit ba6c148 both chainaxe marks use the linesman stamina template. The player-visible stamina_modifier is the fixed value 4, shown with a plus sign and two decimals as +4.00. The defence slider maps sprint_cost_per_second endpoints 0.25 to 0.75, so inputs 60% and 80% produce first-stage t=0.55 and 0.65, then linesman endpoints 1.25 to 0.75 produce raw 0.975 and 0.925 stamina points per second. The push_cost slider endpoints are 0 to 1, so t=0.60 and 0.80 applied to linesman endpoints 3 to 1 produce 1.8 and 1.4 stamina points. The Source UI formats stamina, sprint cost, and push cost with two decimals; binary floating-point therefore displays sprint cost as 0.97 and 0.93 while raw values remain 0.975 and 0.925, and push cost as 1.80 and 1.40.

## Claim `darktide:claim:chainaxe:p1-m1-defence-push-cost-80`

- Game release: `darktide:1.13.2`
- Property: `weapon_stamina_templates.linesman.push_cost`
- Target: `darktide:1.13.2:darktide:weapon:chainaxe:p1-m1`
- Known value: `1.4` `stamina-point`
- Basis: `code-derived`
- Review state: `approved`
- Context (JSON): `{"comparisonStat":{"decimal":"80","status":"known","unit":"percent"},"profile":"linesman","weaponRef":{"gameReleaseId":"darktide:1.13.2","recordId":"darktide:weapon:chainaxe:p1-m1"},"weaponStat":"chainaxe_defence_stat"}`
- Evidence:
  - `darktide:1.13.2:darktide:evidence:chainaxe:p1-m1-defence-comparison-code`: At commit ba6c148 both chainaxe marks use the linesman stamina template. The player-visible stamina_modifier is the fixed value 4, shown with a plus sign and two decimals as +4.00. The defence slider maps sprint_cost_per_second endpoints 0.25 to 0.75, so inputs 60% and 80% produce first-stage t=0.55 and 0.65, then linesman endpoints 1.25 to 0.75 produce raw 0.975 and 0.925 stamina points per second. The push_cost slider endpoints are 0 to 1, so t=0.60 and 0.80 applied to linesman endpoints 3 to 1 produce 1.8 and 1.4 stamina points. The Source UI formats stamina, sprint cost, and push cost with two decimals; binary floating-point therefore displays sprint cost as 0.97 and 0.93 while raw values remain 0.975 and 0.925, and push cost as 1.80 and 1.40.

## Claim `darktide:claim:chainaxe:p1-m1-defence-sprint-cost-60`

- Game release: `darktide:1.13.2`
- Property: `weapon_stamina_templates.linesman.sprint_cost_per_second`
- Target: `darktide:1.13.2:darktide:weapon:chainaxe:p1-m1`
- Known value: `0.975` `stamina-point-per-second`
- Basis: `code-derived`
- Review state: `approved`
- Context (JSON): `{"comparisonStat":{"decimal":"60","status":"known","unit":"percent"},"profile":"linesman","weaponRef":{"gameReleaseId":"darktide:1.13.2","recordId":"darktide:weapon:chainaxe:p1-m1"},"weaponStat":"chainaxe_defence_stat"}`
- Evidence:
  - `darktide:1.13.2:darktide:evidence:chainaxe:p1-m1-defence-comparison-code`: At commit ba6c148 both chainaxe marks use the linesman stamina template. The player-visible stamina_modifier is the fixed value 4, shown with a plus sign and two decimals as +4.00. The defence slider maps sprint_cost_per_second endpoints 0.25 to 0.75, so inputs 60% and 80% produce first-stage t=0.55 and 0.65, then linesman endpoints 1.25 to 0.75 produce raw 0.975 and 0.925 stamina points per second. The push_cost slider endpoints are 0 to 1, so t=0.60 and 0.80 applied to linesman endpoints 3 to 1 produce 1.8 and 1.4 stamina points. The Source UI formats stamina, sprint cost, and push cost with two decimals; binary floating-point therefore displays sprint cost as 0.97 and 0.93 while raw values remain 0.975 and 0.925, and push cost as 1.80 and 1.40.

## Claim `darktide:claim:chainaxe:p1-m1-defence-sprint-cost-80`

- Game release: `darktide:1.13.2`
- Property: `weapon_stamina_templates.linesman.sprint_cost_per_second`
- Target: `darktide:1.13.2:darktide:weapon:chainaxe:p1-m1`
- Known value: `0.925` `stamina-point-per-second`
- Basis: `code-derived`
- Review state: `approved`
- Context (JSON): `{"comparisonStat":{"decimal":"80","status":"known","unit":"percent"},"profile":"linesman","weaponRef":{"gameReleaseId":"darktide:1.13.2","recordId":"darktide:weapon:chainaxe:p1-m1"},"weaponStat":"chainaxe_defence_stat"}`
- Evidence:
  - `darktide:1.13.2:darktide:evidence:chainaxe:p1-m1-defence-comparison-code`: At commit ba6c148 both chainaxe marks use the linesman stamina template. The player-visible stamina_modifier is the fixed value 4, shown with a plus sign and two decimals as +4.00. The defence slider maps sprint_cost_per_second endpoints 0.25 to 0.75, so inputs 60% and 80% produce first-stage t=0.55 and 0.65, then linesman endpoints 1.25 to 0.75 produce raw 0.975 and 0.925 stamina points per second. The push_cost slider endpoints are 0 to 1, so t=0.60 and 0.80 applied to linesman endpoints 3 to 1 produce 1.8 and 1.4 stamina points. The Source UI formats stamina, sprint cost, and push cost with two decimals; binary floating-point therefore displays sprint cost as 0.97 and 0.93 while raw values remain 0.975 and 0.925, and push cost as 1.80 and 1.40.

## Claim `darktide:claim:chainaxe:p1-m1-defence-stamina-60`

- Game release: `darktide:1.13.2`
- Property: `weapon_stamina_templates.linesman.stamina_modifier`
- Target: `darktide:1.13.2:darktide:weapon:chainaxe:p1-m1`
- Known value: `4` `stamina-point`
- Basis: `code-derived`
- Review state: `approved`
- Context (JSON): `{"comparisonStat":{"decimal":"60","status":"known","unit":"percent"},"profile":"linesman","weaponRef":{"gameReleaseId":"darktide:1.13.2","recordId":"darktide:weapon:chainaxe:p1-m1"},"weaponStat":"chainaxe_defence_stat"}`
- Evidence:
  - `darktide:1.13.2:darktide:evidence:chainaxe:p1-m1-defence-comparison-code`: At commit ba6c148 both chainaxe marks use the linesman stamina template. The player-visible stamina_modifier is the fixed value 4, shown with a plus sign and two decimals as +4.00. The defence slider maps sprint_cost_per_second endpoints 0.25 to 0.75, so inputs 60% and 80% produce first-stage t=0.55 and 0.65, then linesman endpoints 1.25 to 0.75 produce raw 0.975 and 0.925 stamina points per second. The push_cost slider endpoints are 0 to 1, so t=0.60 and 0.80 applied to linesman endpoints 3 to 1 produce 1.8 and 1.4 stamina points. The Source UI formats stamina, sprint cost, and push cost with two decimals; binary floating-point therefore displays sprint cost as 0.97 and 0.93 while raw values remain 0.975 and 0.925, and push cost as 1.80 and 1.40.

## Claim `darktide:claim:chainaxe:p1-m1-defence-stamina-80`

- Game release: `darktide:1.13.2`
- Property: `weapon_stamina_templates.linesman.stamina_modifier`
- Target: `darktide:1.13.2:darktide:weapon:chainaxe:p1-m1`
- Known value: `4` `stamina-point`
- Basis: `code-derived`
- Review state: `approved`
- Context (JSON): `{"comparisonStat":{"decimal":"80","status":"known","unit":"percent"},"profile":"linesman","weaponRef":{"gameReleaseId":"darktide:1.13.2","recordId":"darktide:weapon:chainaxe:p1-m1"},"weaponStat":"chainaxe_defence_stat"}`
- Evidence:
  - `darktide:1.13.2:darktide:evidence:chainaxe:p1-m1-defence-comparison-code`: At commit ba6c148 both chainaxe marks use the linesman stamina template. The player-visible stamina_modifier is the fixed value 4, shown with a plus sign and two decimals as +4.00. The defence slider maps sprint_cost_per_second endpoints 0.25 to 0.75, so inputs 60% and 80% produce first-stage t=0.55 and 0.65, then linesman endpoints 1.25 to 0.75 produce raw 0.975 and 0.925 stamina points per second. The push_cost slider endpoints are 0 to 1, so t=0.60 and 0.80 applied to linesman endpoints 3 to 1 produce 1.8 and 1.4 stamina points. The Source UI formats stamina, sprint cost, and push cost with two decimals; binary floating-point therefore displays sprint cost as 0.97 and 0.93 while raw values remain 0.975 and 0.925, and push cost as 1.80 and 1.40.

## Claim `darktide:claim:chainaxe:p1-m1-mobility-dodge-distance-60`

- Game release: `darktide:1.13.2`
- Property: `weapon_dodge_templates.smiter_plus.distance_scale`
- Target: `darktide:1.13.2:darktide:weapon:chainaxe:p1-m1`
- Known value: `0.96` `ratio`
- Basis: `code-derived`
- Review state: `approved`
- Context (JSON): `{"comparisonStat":{"decimal":"60","status":"known","unit":"percent"},"profile":"smiter_plus","weaponRef":{"gameReleaseId":"darktide:1.13.2","recordId":"darktide:weapon:chainaxe:p1-m1"},"weaponStat":"chainaxe_mobility_stat"}`
- Evidence:
  - `darktide:1.13.2:darktide:evidence:chainaxe:p1-m1-mobility-comparison-code`: At commit ba6c148 both marks use smiter_plus dodge and default sprint templates. default_dodge_stat endpoints 0.25 to 0.75 make t=0.55/0.65 at 60%/80%; smiter_plus distance_scale 0.85 to 1.05 yields raw 0.96/0.98, displayed as -4.00%/-2.00% by (value-1)*100. Its diminishing_return_start endpoints 2 to 4 yield raw 3.1/3.3 effective dodges, floored then displayed as 3.00/3.00; speed_modifier stays 1 and displays +0.00%. default_sprint_stat endpoints 0.05 to 0.95 yield t=0.59/0.77; default sprint_speed_mod endpoints -0.5 to 0.5 yield raw additive parameter points 0.09/0.27; the pinned source does not expose a physical speed unit, displayed as +0.09/+0.27. The UI uses two decimal places and signed formatting for these rows. Hidden movement-curve and non-displayed fields are not included.

## Claim `darktide:claim:chainaxe:p1-m1-mobility-dodge-distance-80`

- Game release: `darktide:1.13.2`
- Property: `weapon_dodge_templates.smiter_plus.distance_scale`
- Target: `darktide:1.13.2:darktide:weapon:chainaxe:p1-m1`
- Known value: `0.98` `ratio`
- Basis: `code-derived`
- Review state: `approved`
- Context (JSON): `{"comparisonStat":{"decimal":"80","status":"known","unit":"percent"},"profile":"smiter_plus","weaponRef":{"gameReleaseId":"darktide:1.13.2","recordId":"darktide:weapon:chainaxe:p1-m1"},"weaponStat":"chainaxe_mobility_stat"}`
- Evidence:
  - `darktide:1.13.2:darktide:evidence:chainaxe:p1-m1-mobility-comparison-code`: At commit ba6c148 both marks use smiter_plus dodge and default sprint templates. default_dodge_stat endpoints 0.25 to 0.75 make t=0.55/0.65 at 60%/80%; smiter_plus distance_scale 0.85 to 1.05 yields raw 0.96/0.98, displayed as -4.00%/-2.00% by (value-1)*100. Its diminishing_return_start endpoints 2 to 4 yield raw 3.1/3.3 effective dodges, floored then displayed as 3.00/3.00; speed_modifier stays 1 and displays +0.00%. default_sprint_stat endpoints 0.05 to 0.95 yield t=0.59/0.77; default sprint_speed_mod endpoints -0.5 to 0.5 yield raw additive parameter points 0.09/0.27; the pinned source does not expose a physical speed unit, displayed as +0.09/+0.27. The UI uses two decimal places and signed formatting for these rows. Hidden movement-curve and non-displayed fields are not included.

## Claim `darktide:claim:chainaxe:p1-m1-mobility-dodge-speed-60`

- Game release: `darktide:1.13.2`
- Property: `weapon_dodge_templates.smiter_plus.speed_modifier`
- Target: `darktide:1.13.2:darktide:weapon:chainaxe:p1-m1`
- Known value: `1` `ratio`
- Basis: `code-derived`
- Review state: `approved`
- Context (JSON): `{"comparisonStat":{"decimal":"60","status":"known","unit":"percent"},"profile":"smiter_plus","weaponRef":{"gameReleaseId":"darktide:1.13.2","recordId":"darktide:weapon:chainaxe:p1-m1"},"weaponStat":"chainaxe_mobility_stat"}`
- Evidence:
  - `darktide:1.13.2:darktide:evidence:chainaxe:p1-m1-mobility-comparison-code`: At commit ba6c148 both marks use smiter_plus dodge and default sprint templates. default_dodge_stat endpoints 0.25 to 0.75 make t=0.55/0.65 at 60%/80%; smiter_plus distance_scale 0.85 to 1.05 yields raw 0.96/0.98, displayed as -4.00%/-2.00% by (value-1)*100. Its diminishing_return_start endpoints 2 to 4 yield raw 3.1/3.3 effective dodges, floored then displayed as 3.00/3.00; speed_modifier stays 1 and displays +0.00%. default_sprint_stat endpoints 0.05 to 0.95 yield t=0.59/0.77; default sprint_speed_mod endpoints -0.5 to 0.5 yield raw additive parameter points 0.09/0.27; the pinned source does not expose a physical speed unit, displayed as +0.09/+0.27. The UI uses two decimal places and signed formatting for these rows. Hidden movement-curve and non-displayed fields are not included.

## Claim `darktide:claim:chainaxe:p1-m1-mobility-dodge-speed-80`

- Game release: `darktide:1.13.2`
- Property: `weapon_dodge_templates.smiter_plus.speed_modifier`
- Target: `darktide:1.13.2:darktide:weapon:chainaxe:p1-m1`
- Known value: `1` `ratio`
- Basis: `code-derived`
- Review state: `approved`
- Context (JSON): `{"comparisonStat":{"decimal":"80","status":"known","unit":"percent"},"profile":"smiter_plus","weaponRef":{"gameReleaseId":"darktide:1.13.2","recordId":"darktide:weapon:chainaxe:p1-m1"},"weaponStat":"chainaxe_mobility_stat"}`
- Evidence:
  - `darktide:1.13.2:darktide:evidence:chainaxe:p1-m1-mobility-comparison-code`: At commit ba6c148 both marks use smiter_plus dodge and default sprint templates. default_dodge_stat endpoints 0.25 to 0.75 make t=0.55/0.65 at 60%/80%; smiter_plus distance_scale 0.85 to 1.05 yields raw 0.96/0.98, displayed as -4.00%/-2.00% by (value-1)*100. Its diminishing_return_start endpoints 2 to 4 yield raw 3.1/3.3 effective dodges, floored then displayed as 3.00/3.00; speed_modifier stays 1 and displays +0.00%. default_sprint_stat endpoints 0.05 to 0.95 yield t=0.59/0.77; default sprint_speed_mod endpoints -0.5 to 0.5 yield raw additive parameter points 0.09/0.27; the pinned source does not expose a physical speed unit, displayed as +0.09/+0.27. The UI uses two decimal places and signed formatting for these rows. Hidden movement-curve and non-displayed fields are not included.

## Claim `darktide:claim:chainaxe:p1-m1-mobility-effective-dodges-60`

- Game release: `darktide:1.13.2`
- Property: `weapon_dodge_templates.smiter_plus.diminishing_return_start`
- Target: `darktide:1.13.2:darktide:weapon:chainaxe:p1-m1`
- Known value: `3.1` `dodge-count`
- Basis: `code-derived`
- Review state: `approved`
- Context (JSON): `{"comparisonStat":{"decimal":"60","status":"known","unit":"percent"},"profile":"smiter_plus","weaponRef":{"gameReleaseId":"darktide:1.13.2","recordId":"darktide:weapon:chainaxe:p1-m1"},"weaponStat":"chainaxe_mobility_stat"}`
- Evidence:
  - `darktide:1.13.2:darktide:evidence:chainaxe:p1-m1-mobility-comparison-code`: At commit ba6c148 both marks use smiter_plus dodge and default sprint templates. default_dodge_stat endpoints 0.25 to 0.75 make t=0.55/0.65 at 60%/80%; smiter_plus distance_scale 0.85 to 1.05 yields raw 0.96/0.98, displayed as -4.00%/-2.00% by (value-1)*100. Its diminishing_return_start endpoints 2 to 4 yield raw 3.1/3.3 effective dodges, floored then displayed as 3.00/3.00; speed_modifier stays 1 and displays +0.00%. default_sprint_stat endpoints 0.05 to 0.95 yield t=0.59/0.77; default sprint_speed_mod endpoints -0.5 to 0.5 yield raw additive parameter points 0.09/0.27; the pinned source does not expose a physical speed unit, displayed as +0.09/+0.27. The UI uses two decimal places and signed formatting for these rows. Hidden movement-curve and non-displayed fields are not included.

## Claim `darktide:claim:chainaxe:p1-m1-mobility-effective-dodges-80`

- Game release: `darktide:1.13.2`
- Property: `weapon_dodge_templates.smiter_plus.diminishing_return_start`
- Target: `darktide:1.13.2:darktide:weapon:chainaxe:p1-m1`
- Known value: `3.3` `dodge-count`
- Basis: `code-derived`
- Review state: `approved`
- Context (JSON): `{"comparisonStat":{"decimal":"80","status":"known","unit":"percent"},"profile":"smiter_plus","weaponRef":{"gameReleaseId":"darktide:1.13.2","recordId":"darktide:weapon:chainaxe:p1-m1"},"weaponStat":"chainaxe_mobility_stat"}`
- Evidence:
  - `darktide:1.13.2:darktide:evidence:chainaxe:p1-m1-mobility-comparison-code`: At commit ba6c148 both marks use smiter_plus dodge and default sprint templates. default_dodge_stat endpoints 0.25 to 0.75 make t=0.55/0.65 at 60%/80%; smiter_plus distance_scale 0.85 to 1.05 yields raw 0.96/0.98, displayed as -4.00%/-2.00% by (value-1)*100. Its diminishing_return_start endpoints 2 to 4 yield raw 3.1/3.3 effective dodges, floored then displayed as 3.00/3.00; speed_modifier stays 1 and displays +0.00%. default_sprint_stat endpoints 0.05 to 0.95 yield t=0.59/0.77; default sprint_speed_mod endpoints -0.5 to 0.5 yield raw additive parameter points 0.09/0.27; the pinned source does not expose a physical speed unit, displayed as +0.09/+0.27. The UI uses two decimal places and signed formatting for these rows. Hidden movement-curve and non-displayed fields are not included.

## Claim `darktide:claim:chainaxe:p1-m1-mobility-sprint-speed-60`

- Game release: `darktide:1.13.2`
- Property: `weapon_sprint_templates.default.sprint_speed_mod`
- Target: `darktide:1.13.2:darktide:weapon:chainaxe:p1-m1`
- Known value: `0.09` `point`
- Basis: `code-derived`
- Review state: `approved`
- Context (JSON): `{"comparisonStat":{"decimal":"60","status":"known","unit":"percent"},"profile":"default","weaponRef":{"gameReleaseId":"darktide:1.13.2","recordId":"darktide:weapon:chainaxe:p1-m1"},"weaponStat":"chainaxe_mobility_stat"}`
- Evidence:
  - `darktide:1.13.2:darktide:evidence:chainaxe:p1-m1-mobility-comparison-code`: At commit ba6c148 both marks use smiter_plus dodge and default sprint templates. default_dodge_stat endpoints 0.25 to 0.75 make t=0.55/0.65 at 60%/80%; smiter_plus distance_scale 0.85 to 1.05 yields raw 0.96/0.98, displayed as -4.00%/-2.00% by (value-1)*100. Its diminishing_return_start endpoints 2 to 4 yield raw 3.1/3.3 effective dodges, floored then displayed as 3.00/3.00; speed_modifier stays 1 and displays +0.00%. default_sprint_stat endpoints 0.05 to 0.95 yield t=0.59/0.77; default sprint_speed_mod endpoints -0.5 to 0.5 yield raw additive parameter points 0.09/0.27; the pinned source does not expose a physical speed unit, displayed as +0.09/+0.27. The UI uses two decimal places and signed formatting for these rows. Hidden movement-curve and non-displayed fields are not included.

## Claim `darktide:claim:chainaxe:p1-m1-mobility-sprint-speed-80`

- Game release: `darktide:1.13.2`
- Property: `weapon_sprint_templates.default.sprint_speed_mod`
- Target: `darktide:1.13.2:darktide:weapon:chainaxe:p1-m1`
- Known value: `0.27` `point`
- Basis: `code-derived`
- Review state: `approved`
- Context (JSON): `{"comparisonStat":{"decimal":"80","status":"known","unit":"percent"},"profile":"default","weaponRef":{"gameReleaseId":"darktide:1.13.2","recordId":"darktide:weapon:chainaxe:p1-m1"},"weaponStat":"chainaxe_mobility_stat"}`
- Evidence:
  - `darktide:1.13.2:darktide:evidence:chainaxe:p1-m1-mobility-comparison-code`: At commit ba6c148 both marks use smiter_plus dodge and default sprint templates. default_dodge_stat endpoints 0.25 to 0.75 make t=0.55/0.65 at 60%/80%; smiter_plus distance_scale 0.85 to 1.05 yields raw 0.96/0.98, displayed as -4.00%/-2.00% by (value-1)*100. Its diminishing_return_start endpoints 2 to 4 yield raw 3.1/3.3 effective dodges, floored then displayed as 3.00/3.00; speed_modifier stays 1 and displays +0.00%. default_sprint_stat endpoints 0.05 to 0.95 yield t=0.59/0.77; default sprint_speed_mod endpoints -0.5 to 0.5 yield raw additive parameter points 0.09/0.27; the pinned source does not expose a physical speed unit, displayed as +0.09/+0.27. The UI uses two decimal places and signed formatting for these rows. Hidden movement-curve and non-displayed fields are not included.

## Claim `darktide:claim:chainaxe:p1-m1-sawing-heavy-active-final-saw-60`

- Game release: `darktide:1.13.2`
- Property: `base_stats.chainaxe_sawing_stat.damage.action_left_heavy.overrides.heavy_chainaxe_active_sticky_last.targets[1].power_distribution.attack`
- Target: `darktide:1.13.2:darktide:weapon:chainaxe:p1-m1`
- Known value: `852.5` `attack-power-point`
- Basis: `code-derived`
- Review state: `approved`
- Context (JSON): `{"attackMode":"heavy","comparisonStat":{"decimal":"60","status":"known","unit":"percent"},"damageProfileRef":{"gameReleaseId":"darktide:1.13.2","recordId":"darktide:damage-profile:chainaxe-p1:heavy_chainaxe_active_sticky_last"},"profile":"heavy_chainaxe_active_sticky_last","weaponRef":{"gameReleaseId":"darktide:1.13.2","recordId":"darktide:weapon:chainaxe:p1-m1"},"weaponStat":"chainaxe_sawing_stat"}`
- Evidence:
  - `darktide:1.13.2:darktide:evidence:chainaxe:p1-m1-sawing-comparison-code`: At commit ba6c148, chainaxe_sawing_stat maps the displayed light/heavy saw rows to source profile overrides. default_melee_dps_stat endpoints 0.25 to 0.75 give t=0.55/0.65 for the 60%/80% comparison. Profile raw attack-power endpoints yield light active first saw 248/264 (160 to 320), light active final saw 465/495 (300 to 600), ordinary light final saw 173.75/196.25 (50 to 275), heavy active first saw 310/330 (200 to 400), and heavy active final saw 852.5/907.5 (550 to 1100). These are sawing profile attack-power parameters, not health damage or the ordinary light/heavy attack power rows. The player-facing weapon-info panel exposes the raw power_distribution.attack value through a default display row, with no scalar conversion, and formats it to two decimals; this is a source parameter, not health damage.

## Claim `darktide:claim:chainaxe:p1-m1-sawing-heavy-active-final-saw-80`

- Game release: `darktide:1.13.2`
- Property: `base_stats.chainaxe_sawing_stat.damage.action_left_heavy.overrides.heavy_chainaxe_active_sticky_last.targets[1].power_distribution.attack`
- Target: `darktide:1.13.2:darktide:weapon:chainaxe:p1-m1`
- Known value: `907.5` `attack-power-point`
- Basis: `code-derived`
- Review state: `approved`
- Context (JSON): `{"attackMode":"heavy","comparisonStat":{"decimal":"80","status":"known","unit":"percent"},"damageProfileRef":{"gameReleaseId":"darktide:1.13.2","recordId":"darktide:damage-profile:chainaxe-p1:heavy_chainaxe_active_sticky_last"},"profile":"heavy_chainaxe_active_sticky_last","weaponRef":{"gameReleaseId":"darktide:1.13.2","recordId":"darktide:weapon:chainaxe:p1-m1"},"weaponStat":"chainaxe_sawing_stat"}`
- Evidence:
  - `darktide:1.13.2:darktide:evidence:chainaxe:p1-m1-sawing-comparison-code`: At commit ba6c148, chainaxe_sawing_stat maps the displayed light/heavy saw rows to source profile overrides. default_melee_dps_stat endpoints 0.25 to 0.75 give t=0.55/0.65 for the 60%/80% comparison. Profile raw attack-power endpoints yield light active first saw 248/264 (160 to 320), light active final saw 465/495 (300 to 600), ordinary light final saw 173.75/196.25 (50 to 275), heavy active first saw 310/330 (200 to 400), and heavy active final saw 852.5/907.5 (550 to 1100). These are sawing profile attack-power parameters, not health damage or the ordinary light/heavy attack power rows. The player-facing weapon-info panel exposes the raw power_distribution.attack value through a default display row, with no scalar conversion, and formats it to two decimals; this is a source parameter, not health damage.

## Claim `darktide:claim:chainaxe:p1-m1-sawing-heavy-active-first-saw-60`

- Game release: `darktide:1.13.2`
- Property: `base_stats.chainaxe_sawing_stat.damage.action_left_heavy.overrides.heavy_chainaxe_active_sticky.targets[1].power_distribution.attack`
- Target: `darktide:1.13.2:darktide:weapon:chainaxe:p1-m1`
- Known value: `310` `attack-power-point`
- Basis: `code-derived`
- Review state: `approved`
- Context (JSON): `{"attackMode":"heavy","comparisonStat":{"decimal":"60","status":"known","unit":"percent"},"damageProfileRef":{"gameReleaseId":"darktide:1.13.2","recordId":"darktide:damage-profile:chainaxe-p1:heavy_chainaxe_active_sticky"},"profile":"heavy_chainaxe_active_sticky","weaponRef":{"gameReleaseId":"darktide:1.13.2","recordId":"darktide:weapon:chainaxe:p1-m1"},"weaponStat":"chainaxe_sawing_stat"}`
- Evidence:
  - `darktide:1.13.2:darktide:evidence:chainaxe:p1-m1-sawing-comparison-code`: At commit ba6c148, chainaxe_sawing_stat maps the displayed light/heavy saw rows to source profile overrides. default_melee_dps_stat endpoints 0.25 to 0.75 give t=0.55/0.65 for the 60%/80% comparison. Profile raw attack-power endpoints yield light active first saw 248/264 (160 to 320), light active final saw 465/495 (300 to 600), ordinary light final saw 173.75/196.25 (50 to 275), heavy active first saw 310/330 (200 to 400), and heavy active final saw 852.5/907.5 (550 to 1100). These are sawing profile attack-power parameters, not health damage or the ordinary light/heavy attack power rows. The player-facing weapon-info panel exposes the raw power_distribution.attack value through a default display row, with no scalar conversion, and formats it to two decimals; this is a source parameter, not health damage.

## Claim `darktide:claim:chainaxe:p1-m1-sawing-heavy-active-first-saw-80`

- Game release: `darktide:1.13.2`
- Property: `base_stats.chainaxe_sawing_stat.damage.action_left_heavy.overrides.heavy_chainaxe_active_sticky.targets[1].power_distribution.attack`
- Target: `darktide:1.13.2:darktide:weapon:chainaxe:p1-m1`
- Known value: `330` `attack-power-point`
- Basis: `code-derived`
- Review state: `approved`
- Context (JSON): `{"attackMode":"heavy","comparisonStat":{"decimal":"80","status":"known","unit":"percent"},"damageProfileRef":{"gameReleaseId":"darktide:1.13.2","recordId":"darktide:damage-profile:chainaxe-p1:heavy_chainaxe_active_sticky"},"profile":"heavy_chainaxe_active_sticky","weaponRef":{"gameReleaseId":"darktide:1.13.2","recordId":"darktide:weapon:chainaxe:p1-m1"},"weaponStat":"chainaxe_sawing_stat"}`
- Evidence:
  - `darktide:1.13.2:darktide:evidence:chainaxe:p1-m1-sawing-comparison-code`: At commit ba6c148, chainaxe_sawing_stat maps the displayed light/heavy saw rows to source profile overrides. default_melee_dps_stat endpoints 0.25 to 0.75 give t=0.55/0.65 for the 60%/80% comparison. Profile raw attack-power endpoints yield light active first saw 248/264 (160 to 320), light active final saw 465/495 (300 to 600), ordinary light final saw 173.75/196.25 (50 to 275), heavy active first saw 310/330 (200 to 400), and heavy active final saw 852.5/907.5 (550 to 1100). These are sawing profile attack-power parameters, not health damage or the ordinary light/heavy attack power rows. The player-facing weapon-info panel exposes the raw power_distribution.attack value through a default display row, with no scalar conversion, and formats it to two decimals; this is a source parameter, not health damage.

## Claim `darktide:claim:chainaxe:p1-m1-sawing-light-active-final-saw-60`

- Game release: `darktide:1.13.2`
- Property: `base_stats.chainaxe_sawing_stat.damage.action_left_down_light.overrides.light_chainaxe_active_sticky_last.targets[1].power_distribution.attack`
- Target: `darktide:1.13.2:darktide:weapon:chainaxe:p1-m1`
- Known value: `465` `attack-power-point`
- Basis: `code-derived`
- Review state: `approved`
- Context (JSON): `{"attackMode":"light","comparisonStat":{"decimal":"60","status":"known","unit":"percent"},"damageProfileRef":{"gameReleaseId":"darktide:1.13.2","recordId":"darktide:damage-profile:chainaxe-p1:light_chainaxe_active_sticky_last"},"profile":"light_chainaxe_active_sticky_last","weaponRef":{"gameReleaseId":"darktide:1.13.2","recordId":"darktide:weapon:chainaxe:p1-m1"},"weaponStat":"chainaxe_sawing_stat"}`
- Evidence:
  - `darktide:1.13.2:darktide:evidence:chainaxe:p1-m1-sawing-comparison-code`: At commit ba6c148, chainaxe_sawing_stat maps the displayed light/heavy saw rows to source profile overrides. default_melee_dps_stat endpoints 0.25 to 0.75 give t=0.55/0.65 for the 60%/80% comparison. Profile raw attack-power endpoints yield light active first saw 248/264 (160 to 320), light active final saw 465/495 (300 to 600), ordinary light final saw 173.75/196.25 (50 to 275), heavy active first saw 310/330 (200 to 400), and heavy active final saw 852.5/907.5 (550 to 1100). These are sawing profile attack-power parameters, not health damage or the ordinary light/heavy attack power rows. The player-facing weapon-info panel exposes the raw power_distribution.attack value through a default display row, with no scalar conversion, and formats it to two decimals; this is a source parameter, not health damage.

## Claim `darktide:claim:chainaxe:p1-m1-sawing-light-active-final-saw-80`

- Game release: `darktide:1.13.2`
- Property: `base_stats.chainaxe_sawing_stat.damage.action_left_down_light.overrides.light_chainaxe_active_sticky_last.targets[1].power_distribution.attack`
- Target: `darktide:1.13.2:darktide:weapon:chainaxe:p1-m1`
- Known value: `495` `attack-power-point`
- Basis: `code-derived`
- Review state: `approved`
- Context (JSON): `{"attackMode":"light","comparisonStat":{"decimal":"80","status":"known","unit":"percent"},"damageProfileRef":{"gameReleaseId":"darktide:1.13.2","recordId":"darktide:damage-profile:chainaxe-p1:light_chainaxe_active_sticky_last"},"profile":"light_chainaxe_active_sticky_last","weaponRef":{"gameReleaseId":"darktide:1.13.2","recordId":"darktide:weapon:chainaxe:p1-m1"},"weaponStat":"chainaxe_sawing_stat"}`
- Evidence:
  - `darktide:1.13.2:darktide:evidence:chainaxe:p1-m1-sawing-comparison-code`: At commit ba6c148, chainaxe_sawing_stat maps the displayed light/heavy saw rows to source profile overrides. default_melee_dps_stat endpoints 0.25 to 0.75 give t=0.55/0.65 for the 60%/80% comparison. Profile raw attack-power endpoints yield light active first saw 248/264 (160 to 320), light active final saw 465/495 (300 to 600), ordinary light final saw 173.75/196.25 (50 to 275), heavy active first saw 310/330 (200 to 400), and heavy active final saw 852.5/907.5 (550 to 1100). These are sawing profile attack-power parameters, not health damage or the ordinary light/heavy attack power rows. The player-facing weapon-info panel exposes the raw power_distribution.attack value through a default display row, with no scalar conversion, and formats it to two decimals; this is a source parameter, not health damage.

## Claim `darktide:claim:chainaxe:p1-m1-sawing-light-active-first-saw-60`

- Game release: `darktide:1.13.2`
- Property: `base_stats.chainaxe_sawing_stat.damage.action_left_down_light.overrides.light_chainaxe_active_sticky.targets[1].power_distribution.attack`
- Target: `darktide:1.13.2:darktide:weapon:chainaxe:p1-m1`
- Known value: `248` `attack-power-point`
- Basis: `code-derived`
- Review state: `approved`
- Context (JSON): `{"attackMode":"light","comparisonStat":{"decimal":"60","status":"known","unit":"percent"},"damageProfileRef":{"gameReleaseId":"darktide:1.13.2","recordId":"darktide:damage-profile:chainaxe-p1:light_chainaxe_active_sticky"},"profile":"light_chainaxe_active_sticky","weaponRef":{"gameReleaseId":"darktide:1.13.2","recordId":"darktide:weapon:chainaxe:p1-m1"},"weaponStat":"chainaxe_sawing_stat"}`
- Evidence:
  - `darktide:1.13.2:darktide:evidence:chainaxe:p1-m1-sawing-comparison-code`: At commit ba6c148, chainaxe_sawing_stat maps the displayed light/heavy saw rows to source profile overrides. default_melee_dps_stat endpoints 0.25 to 0.75 give t=0.55/0.65 for the 60%/80% comparison. Profile raw attack-power endpoints yield light active first saw 248/264 (160 to 320), light active final saw 465/495 (300 to 600), ordinary light final saw 173.75/196.25 (50 to 275), heavy active first saw 310/330 (200 to 400), and heavy active final saw 852.5/907.5 (550 to 1100). These are sawing profile attack-power parameters, not health damage or the ordinary light/heavy attack power rows. The player-facing weapon-info panel exposes the raw power_distribution.attack value through a default display row, with no scalar conversion, and formats it to two decimals; this is a source parameter, not health damage.

## Claim `darktide:claim:chainaxe:p1-m1-sawing-light-active-first-saw-80`

- Game release: `darktide:1.13.2`
- Property: `base_stats.chainaxe_sawing_stat.damage.action_left_down_light.overrides.light_chainaxe_active_sticky.targets[1].power_distribution.attack`
- Target: `darktide:1.13.2:darktide:weapon:chainaxe:p1-m1`
- Known value: `264` `attack-power-point`
- Basis: `code-derived`
- Review state: `approved`
- Context (JSON): `{"attackMode":"light","comparisonStat":{"decimal":"80","status":"known","unit":"percent"},"damageProfileRef":{"gameReleaseId":"darktide:1.13.2","recordId":"darktide:damage-profile:chainaxe-p1:light_chainaxe_active_sticky"},"profile":"light_chainaxe_active_sticky","weaponRef":{"gameReleaseId":"darktide:1.13.2","recordId":"darktide:weapon:chainaxe:p1-m1"},"weaponStat":"chainaxe_sawing_stat"}`
- Evidence:
  - `darktide:1.13.2:darktide:evidence:chainaxe:p1-m1-sawing-comparison-code`: At commit ba6c148, chainaxe_sawing_stat maps the displayed light/heavy saw rows to source profile overrides. default_melee_dps_stat endpoints 0.25 to 0.75 give t=0.55/0.65 for the 60%/80% comparison. Profile raw attack-power endpoints yield light active first saw 248/264 (160 to 320), light active final saw 465/495 (300 to 600), ordinary light final saw 173.75/196.25 (50 to 275), heavy active first saw 310/330 (200 to 400), and heavy active final saw 852.5/907.5 (550 to 1100). These are sawing profile attack-power parameters, not health damage or the ordinary light/heavy attack power rows. The player-facing weapon-info panel exposes the raw power_distribution.attack value through a default display row, with no scalar conversion, and formats it to two decimals; this is a source parameter, not health damage.

## Claim `darktide:claim:chainaxe:p1-m1-sawing-light-ordinary-light-final-saw-60`

- Game release: `darktide:1.13.2`
- Property: `base_stats.chainaxe_sawing_stat.damage.action_left_down_light.overrides.light_chainaxe_sticky_last_quick.targets[1].power_distribution.attack`
- Target: `darktide:1.13.2:darktide:weapon:chainaxe:p1-m1`
- Known value: `173.75` `attack-power-point`
- Basis: `code-derived`
- Review state: `approved`
- Context (JSON): `{"attackMode":"light","comparisonStat":{"decimal":"60","status":"known","unit":"percent"},"damageProfileRef":{"gameReleaseId":"darktide:1.13.2","recordId":"darktide:damage-profile:chainaxe-p1:light_chainaxe_sticky_last_quick"},"profile":"light_chainaxe_sticky_last_quick","weaponRef":{"gameReleaseId":"darktide:1.13.2","recordId":"darktide:weapon:chainaxe:p1-m1"},"weaponStat":"chainaxe_sawing_stat"}`
- Evidence:
  - `darktide:1.13.2:darktide:evidence:chainaxe:p1-m1-sawing-comparison-code`: At commit ba6c148, chainaxe_sawing_stat maps the displayed light/heavy saw rows to source profile overrides. default_melee_dps_stat endpoints 0.25 to 0.75 give t=0.55/0.65 for the 60%/80% comparison. Profile raw attack-power endpoints yield light active first saw 248/264 (160 to 320), light active final saw 465/495 (300 to 600), ordinary light final saw 173.75/196.25 (50 to 275), heavy active first saw 310/330 (200 to 400), and heavy active final saw 852.5/907.5 (550 to 1100). These are sawing profile attack-power parameters, not health damage or the ordinary light/heavy attack power rows. The player-facing weapon-info panel exposes the raw power_distribution.attack value through a default display row, with no scalar conversion, and formats it to two decimals; this is a source parameter, not health damage.

## Claim `darktide:claim:chainaxe:p1-m1-sawing-light-ordinary-light-final-saw-80`

- Game release: `darktide:1.13.2`
- Property: `base_stats.chainaxe_sawing_stat.damage.action_left_down_light.overrides.light_chainaxe_sticky_last_quick.targets[1].power_distribution.attack`
- Target: `darktide:1.13.2:darktide:weapon:chainaxe:p1-m1`
- Known value: `196.25` `attack-power-point`
- Basis: `code-derived`
- Review state: `approved`
- Context (JSON): `{"attackMode":"light","comparisonStat":{"decimal":"80","status":"known","unit":"percent"},"damageProfileRef":{"gameReleaseId":"darktide:1.13.2","recordId":"darktide:damage-profile:chainaxe-p1:light_chainaxe_sticky_last_quick"},"profile":"light_chainaxe_sticky_last_quick","weaponRef":{"gameReleaseId":"darktide:1.13.2","recordId":"darktide:weapon:chainaxe:p1-m1"},"weaponStat":"chainaxe_sawing_stat"}`
- Evidence:
  - `darktide:1.13.2:darktide:evidence:chainaxe:p1-m1-sawing-comparison-code`: At commit ba6c148, chainaxe_sawing_stat maps the displayed light/heavy saw rows to source profile overrides. default_melee_dps_stat endpoints 0.25 to 0.75 give t=0.55/0.65 for the 60%/80% comparison. Profile raw attack-power endpoints yield light active first saw 248/264 (160 to 320), light active final saw 465/495 (300 to 600), ordinary light final saw 173.75/196.25 (50 to 275), heavy active first saw 310/330 (200 to 400), and heavy active final saw 852.5/907.5 (550 to 1100). These are sawing profile attack-power parameters, not health damage or the ordinary light/heavy attack power rows. The player-facing weapon-info panel exposes the raw power_distribution.attack value through a default display row, with no scalar conversion, and formats it to two decimals; this is a source parameter, not health damage.

## Claim `darktide:claim:chainaxe:p1-m2-armor-penetration-heavy-armored-60`

- Game release: `darktide:1.13.2`
- Property: `damage_templates.heavy_chainaxe_smiter.targets[1].armor_damage_modifier.attack[armor_types.armored]`
- Target: `darktide:1.13.2:darktide:weapon:chainaxe:p1-m2`
- Known value: `0.8094` `ratio`
- Basis: `code-derived`
- Review state: `approved`
- Context (JSON): `{"armorClass":"armored","attackMode":"heavy","comparisonStat":{"decimal":"60","status":"known","unit":"percent"},"damageProfileRef":{"gameReleaseId":"darktide:1.13.2","recordId":"darktide:damage-profile:chainaxe-p1:heavy_chainaxe_smiter"},"profile":"heavy_chainaxe_smiter","weaponRef":{"gameReleaseId":"darktide:1.13.2","recordId":"darktide:weapon:chainaxe:p1-m2"},"weaponStat":"chainaxe_armor_pierce_stat"}`
- Evidence:
  - `darktide:1.13.2:darktide:evidence:chainaxe:p1-m2-armor-penetration-comparison-code`: At commit ba6c148, chainaxe_armor_pierce_stat applies default_armor_pierce_stat endpoints 0.1 and 0.95; inputs 60% and 80% give t=0.61 and 0.78. The light_chainaxe_tank profile exposes armored/resistant via lerp_1_5 [1.035,1.965] -&gt; 1.6023/1.7604, super_armor via lerp_0_75 [0.48,1.02] -&gt; 0.8094/0.9012, and disgustingly_resilient via lerp_1_33 [0.9,1.77] -&gt; 1.4307/1.5786. heavy_chainaxe_smiter exposes armored via lerp_0_75 -&gt; 0.8094/0.9012 and super_armor via lerp_0_3 [0.174,0.426] -&gt; 0.32772/0.37056. UI display_type percentage multiplies each raw ratio by 100 and prints two decimals. Only explicit profile armor keys are claimed; values are not final damage.

## Claim `darktide:claim:chainaxe:p1-m2-armor-penetration-heavy-armored-80`

- Game release: `darktide:1.13.2`
- Property: `damage_templates.heavy_chainaxe_smiter.targets[1].armor_damage_modifier.attack[armor_types.armored]`
- Target: `darktide:1.13.2:darktide:weapon:chainaxe:p1-m2`
- Known value: `0.9012` `ratio`
- Basis: `code-derived`
- Review state: `approved`
- Context (JSON): `{"armorClass":"armored","attackMode":"heavy","comparisonStat":{"decimal":"80","status":"known","unit":"percent"},"damageProfileRef":{"gameReleaseId":"darktide:1.13.2","recordId":"darktide:damage-profile:chainaxe-p1:heavy_chainaxe_smiter"},"profile":"heavy_chainaxe_smiter","weaponRef":{"gameReleaseId":"darktide:1.13.2","recordId":"darktide:weapon:chainaxe:p1-m2"},"weaponStat":"chainaxe_armor_pierce_stat"}`
- Evidence:
  - `darktide:1.13.2:darktide:evidence:chainaxe:p1-m2-armor-penetration-comparison-code`: At commit ba6c148, chainaxe_armor_pierce_stat applies default_armor_pierce_stat endpoints 0.1 and 0.95; inputs 60% and 80% give t=0.61 and 0.78. The light_chainaxe_tank profile exposes armored/resistant via lerp_1_5 [1.035,1.965] -&gt; 1.6023/1.7604, super_armor via lerp_0_75 [0.48,1.02] -&gt; 0.8094/0.9012, and disgustingly_resilient via lerp_1_33 [0.9,1.77] -&gt; 1.4307/1.5786. heavy_chainaxe_smiter exposes armored via lerp_0_75 -&gt; 0.8094/0.9012 and super_armor via lerp_0_3 [0.174,0.426] -&gt; 0.32772/0.37056. UI display_type percentage multiplies each raw ratio by 100 and prints two decimals. Only explicit profile armor keys are claimed; values are not final damage.

## Claim `darktide:claim:chainaxe:p1-m2-armor-penetration-heavy-super_armor-60`

- Game release: `darktide:1.13.2`
- Property: `damage_templates.heavy_chainaxe_smiter.targets[1].armor_damage_modifier.attack[armor_types.super_armor]`
- Target: `darktide:1.13.2:darktide:weapon:chainaxe:p1-m2`
- Known value: `0.32772` `ratio`
- Basis: `code-derived`
- Review state: `approved`
- Context (JSON): `{"armorClass":"super_armor","attackMode":"heavy","comparisonStat":{"decimal":"60","status":"known","unit":"percent"},"damageProfileRef":{"gameReleaseId":"darktide:1.13.2","recordId":"darktide:damage-profile:chainaxe-p1:heavy_chainaxe_smiter"},"profile":"heavy_chainaxe_smiter","weaponRef":{"gameReleaseId":"darktide:1.13.2","recordId":"darktide:weapon:chainaxe:p1-m2"},"weaponStat":"chainaxe_armor_pierce_stat"}`
- Evidence:
  - `darktide:1.13.2:darktide:evidence:chainaxe:p1-m2-armor-penetration-comparison-code`: At commit ba6c148, chainaxe_armor_pierce_stat applies default_armor_pierce_stat endpoints 0.1 and 0.95; inputs 60% and 80% give t=0.61 and 0.78. The light_chainaxe_tank profile exposes armored/resistant via lerp_1_5 [1.035,1.965] -&gt; 1.6023/1.7604, super_armor via lerp_0_75 [0.48,1.02] -&gt; 0.8094/0.9012, and disgustingly_resilient via lerp_1_33 [0.9,1.77] -&gt; 1.4307/1.5786. heavy_chainaxe_smiter exposes armored via lerp_0_75 -&gt; 0.8094/0.9012 and super_armor via lerp_0_3 [0.174,0.426] -&gt; 0.32772/0.37056. UI display_type percentage multiplies each raw ratio by 100 and prints two decimals. Only explicit profile armor keys are claimed; values are not final damage.

## Claim `darktide:claim:chainaxe:p1-m2-armor-penetration-heavy-super_armor-80`

- Game release: `darktide:1.13.2`
- Property: `damage_templates.heavy_chainaxe_smiter.targets[1].armor_damage_modifier.attack[armor_types.super_armor]`
- Target: `darktide:1.13.2:darktide:weapon:chainaxe:p1-m2`
- Known value: `0.37056` `ratio`
- Basis: `code-derived`
- Review state: `approved`
- Context (JSON): `{"armorClass":"super_armor","attackMode":"heavy","comparisonStat":{"decimal":"80","status":"known","unit":"percent"},"damageProfileRef":{"gameReleaseId":"darktide:1.13.2","recordId":"darktide:damage-profile:chainaxe-p1:heavy_chainaxe_smiter"},"profile":"heavy_chainaxe_smiter","weaponRef":{"gameReleaseId":"darktide:1.13.2","recordId":"darktide:weapon:chainaxe:p1-m2"},"weaponStat":"chainaxe_armor_pierce_stat"}`
- Evidence:
  - `darktide:1.13.2:darktide:evidence:chainaxe:p1-m2-armor-penetration-comparison-code`: At commit ba6c148, chainaxe_armor_pierce_stat applies default_armor_pierce_stat endpoints 0.1 and 0.95; inputs 60% and 80% give t=0.61 and 0.78. The light_chainaxe_tank profile exposes armored/resistant via lerp_1_5 [1.035,1.965] -&gt; 1.6023/1.7604, super_armor via lerp_0_75 [0.48,1.02] -&gt; 0.8094/0.9012, and disgustingly_resilient via lerp_1_33 [0.9,1.77] -&gt; 1.4307/1.5786. heavy_chainaxe_smiter exposes armored via lerp_0_75 -&gt; 0.8094/0.9012 and super_armor via lerp_0_3 [0.174,0.426] -&gt; 0.32772/0.37056. UI display_type percentage multiplies each raw ratio by 100 and prints two decimals. Only explicit profile armor keys are claimed; values are not final damage.

## Claim `darktide:claim:chainaxe:p1-m2-armor-penetration-light-armored-60`

- Game release: `darktide:1.13.2`
- Property: `damage_templates.light_chainaxe_tank.targets[1].armor_damage_modifier.attack[armor_types.armored]`
- Target: `darktide:1.13.2:darktide:weapon:chainaxe:p1-m2`
- Known value: `1.6023` `ratio`
- Basis: `code-derived`
- Review state: `approved`
- Context (JSON): `{"armorClass":"armored","attackMode":"light","comparisonStat":{"decimal":"60","status":"known","unit":"percent"},"damageProfileRef":{"gameReleaseId":"darktide:1.13.2","recordId":"darktide:damage-profile:chainaxe-p1:light_chainaxe_tank"},"profile":"light_chainaxe_tank","weaponRef":{"gameReleaseId":"darktide:1.13.2","recordId":"darktide:weapon:chainaxe:p1-m2"},"weaponStat":"chainaxe_armor_pierce_stat"}`
- Evidence:
  - `darktide:1.13.2:darktide:evidence:chainaxe:p1-m2-armor-penetration-comparison-code`: At commit ba6c148, chainaxe_armor_pierce_stat applies default_armor_pierce_stat endpoints 0.1 and 0.95; inputs 60% and 80% give t=0.61 and 0.78. The light_chainaxe_tank profile exposes armored/resistant via lerp_1_5 [1.035,1.965] -&gt; 1.6023/1.7604, super_armor via lerp_0_75 [0.48,1.02] -&gt; 0.8094/0.9012, and disgustingly_resilient via lerp_1_33 [0.9,1.77] -&gt; 1.4307/1.5786. heavy_chainaxe_smiter exposes armored via lerp_0_75 -&gt; 0.8094/0.9012 and super_armor via lerp_0_3 [0.174,0.426] -&gt; 0.32772/0.37056. UI display_type percentage multiplies each raw ratio by 100 and prints two decimals. Only explicit profile armor keys are claimed; values are not final damage.

## Claim `darktide:claim:chainaxe:p1-m2-armor-penetration-light-armored-80`

- Game release: `darktide:1.13.2`
- Property: `damage_templates.light_chainaxe_tank.targets[1].armor_damage_modifier.attack[armor_types.armored]`
- Target: `darktide:1.13.2:darktide:weapon:chainaxe:p1-m2`
- Known value: `1.7604` `ratio`
- Basis: `code-derived`
- Review state: `approved`
- Context (JSON): `{"armorClass":"armored","attackMode":"light","comparisonStat":{"decimal":"80","status":"known","unit":"percent"},"damageProfileRef":{"gameReleaseId":"darktide:1.13.2","recordId":"darktide:damage-profile:chainaxe-p1:light_chainaxe_tank"},"profile":"light_chainaxe_tank","weaponRef":{"gameReleaseId":"darktide:1.13.2","recordId":"darktide:weapon:chainaxe:p1-m2"},"weaponStat":"chainaxe_armor_pierce_stat"}`
- Evidence:
  - `darktide:1.13.2:darktide:evidence:chainaxe:p1-m2-armor-penetration-comparison-code`: At commit ba6c148, chainaxe_armor_pierce_stat applies default_armor_pierce_stat endpoints 0.1 and 0.95; inputs 60% and 80% give t=0.61 and 0.78. The light_chainaxe_tank profile exposes armored/resistant via lerp_1_5 [1.035,1.965] -&gt; 1.6023/1.7604, super_armor via lerp_0_75 [0.48,1.02] -&gt; 0.8094/0.9012, and disgustingly_resilient via lerp_1_33 [0.9,1.77] -&gt; 1.4307/1.5786. heavy_chainaxe_smiter exposes armored via lerp_0_75 -&gt; 0.8094/0.9012 and super_armor via lerp_0_3 [0.174,0.426] -&gt; 0.32772/0.37056. UI display_type percentage multiplies each raw ratio by 100 and prints two decimals. Only explicit profile armor keys are claimed; values are not final damage.

## Claim `darktide:claim:chainaxe:p1-m2-armor-penetration-light-disgustingly_resilient-60`

- Game release: `darktide:1.13.2`
- Property: `damage_templates.light_chainaxe_tank.targets[1].armor_damage_modifier.attack[armor_types.disgustingly_resilient]`
- Target: `darktide:1.13.2:darktide:weapon:chainaxe:p1-m2`
- Known value: `1.4307` `ratio`
- Basis: `code-derived`
- Review state: `approved`
- Context (JSON): `{"armorClass":"disgustingly_resilient","attackMode":"light","comparisonStat":{"decimal":"60","status":"known","unit":"percent"},"damageProfileRef":{"gameReleaseId":"darktide:1.13.2","recordId":"darktide:damage-profile:chainaxe-p1:light_chainaxe_tank"},"profile":"light_chainaxe_tank","weaponRef":{"gameReleaseId":"darktide:1.13.2","recordId":"darktide:weapon:chainaxe:p1-m2"},"weaponStat":"chainaxe_armor_pierce_stat"}`
- Evidence:
  - `darktide:1.13.2:darktide:evidence:chainaxe:p1-m2-armor-penetration-comparison-code`: At commit ba6c148, chainaxe_armor_pierce_stat applies default_armor_pierce_stat endpoints 0.1 and 0.95; inputs 60% and 80% give t=0.61 and 0.78. The light_chainaxe_tank profile exposes armored/resistant via lerp_1_5 [1.035,1.965] -&gt; 1.6023/1.7604, super_armor via lerp_0_75 [0.48,1.02] -&gt; 0.8094/0.9012, and disgustingly_resilient via lerp_1_33 [0.9,1.77] -&gt; 1.4307/1.5786. heavy_chainaxe_smiter exposes armored via lerp_0_75 -&gt; 0.8094/0.9012 and super_armor via lerp_0_3 [0.174,0.426] -&gt; 0.32772/0.37056. UI display_type percentage multiplies each raw ratio by 100 and prints two decimals. Only explicit profile armor keys are claimed; values are not final damage.

## Claim `darktide:claim:chainaxe:p1-m2-armor-penetration-light-disgustingly_resilient-80`

- Game release: `darktide:1.13.2`
- Property: `damage_templates.light_chainaxe_tank.targets[1].armor_damage_modifier.attack[armor_types.disgustingly_resilient]`
- Target: `darktide:1.13.2:darktide:weapon:chainaxe:p1-m2`
- Known value: `1.5786` `ratio`
- Basis: `code-derived`
- Review state: `approved`
- Context (JSON): `{"armorClass":"disgustingly_resilient","attackMode":"light","comparisonStat":{"decimal":"80","status":"known","unit":"percent"},"damageProfileRef":{"gameReleaseId":"darktide:1.13.2","recordId":"darktide:damage-profile:chainaxe-p1:light_chainaxe_tank"},"profile":"light_chainaxe_tank","weaponRef":{"gameReleaseId":"darktide:1.13.2","recordId":"darktide:weapon:chainaxe:p1-m2"},"weaponStat":"chainaxe_armor_pierce_stat"}`
- Evidence:
  - `darktide:1.13.2:darktide:evidence:chainaxe:p1-m2-armor-penetration-comparison-code`: At commit ba6c148, chainaxe_armor_pierce_stat applies default_armor_pierce_stat endpoints 0.1 and 0.95; inputs 60% and 80% give t=0.61 and 0.78. The light_chainaxe_tank profile exposes armored/resistant via lerp_1_5 [1.035,1.965] -&gt; 1.6023/1.7604, super_armor via lerp_0_75 [0.48,1.02] -&gt; 0.8094/0.9012, and disgustingly_resilient via lerp_1_33 [0.9,1.77] -&gt; 1.4307/1.5786. heavy_chainaxe_smiter exposes armored via lerp_0_75 -&gt; 0.8094/0.9012 and super_armor via lerp_0_3 [0.174,0.426] -&gt; 0.32772/0.37056. UI display_type percentage multiplies each raw ratio by 100 and prints two decimals. Only explicit profile armor keys are claimed; values are not final damage.

## Claim `darktide:claim:chainaxe:p1-m2-armor-penetration-light-resistant-60`

- Game release: `darktide:1.13.2`
- Property: `damage_templates.light_chainaxe_tank.targets[1].armor_damage_modifier.attack[armor_types.resistant]`
- Target: `darktide:1.13.2:darktide:weapon:chainaxe:p1-m2`
- Known value: `1.6023` `ratio`
- Basis: `code-derived`
- Review state: `approved`
- Context (JSON): `{"armorClass":"resistant","attackMode":"light","comparisonStat":{"decimal":"60","status":"known","unit":"percent"},"damageProfileRef":{"gameReleaseId":"darktide:1.13.2","recordId":"darktide:damage-profile:chainaxe-p1:light_chainaxe_tank"},"profile":"light_chainaxe_tank","weaponRef":{"gameReleaseId":"darktide:1.13.2","recordId":"darktide:weapon:chainaxe:p1-m2"},"weaponStat":"chainaxe_armor_pierce_stat"}`
- Evidence:
  - `darktide:1.13.2:darktide:evidence:chainaxe:p1-m2-armor-penetration-comparison-code`: At commit ba6c148, chainaxe_armor_pierce_stat applies default_armor_pierce_stat endpoints 0.1 and 0.95; inputs 60% and 80% give t=0.61 and 0.78. The light_chainaxe_tank profile exposes armored/resistant via lerp_1_5 [1.035,1.965] -&gt; 1.6023/1.7604, super_armor via lerp_0_75 [0.48,1.02] -&gt; 0.8094/0.9012, and disgustingly_resilient via lerp_1_33 [0.9,1.77] -&gt; 1.4307/1.5786. heavy_chainaxe_smiter exposes armored via lerp_0_75 -&gt; 0.8094/0.9012 and super_armor via lerp_0_3 [0.174,0.426] -&gt; 0.32772/0.37056. UI display_type percentage multiplies each raw ratio by 100 and prints two decimals. Only explicit profile armor keys are claimed; values are not final damage.

## Claim `darktide:claim:chainaxe:p1-m2-armor-penetration-light-resistant-80`

- Game release: `darktide:1.13.2`
- Property: `damage_templates.light_chainaxe_tank.targets[1].armor_damage_modifier.attack[armor_types.resistant]`
- Target: `darktide:1.13.2:darktide:weapon:chainaxe:p1-m2`
- Known value: `1.7604` `ratio`
- Basis: `code-derived`
- Review state: `approved`
- Context (JSON): `{"armorClass":"resistant","attackMode":"light","comparisonStat":{"decimal":"80","status":"known","unit":"percent"},"damageProfileRef":{"gameReleaseId":"darktide:1.13.2","recordId":"darktide:damage-profile:chainaxe-p1:light_chainaxe_tank"},"profile":"light_chainaxe_tank","weaponRef":{"gameReleaseId":"darktide:1.13.2","recordId":"darktide:weapon:chainaxe:p1-m2"},"weaponStat":"chainaxe_armor_pierce_stat"}`
- Evidence:
  - `darktide:1.13.2:darktide:evidence:chainaxe:p1-m2-armor-penetration-comparison-code`: At commit ba6c148, chainaxe_armor_pierce_stat applies default_armor_pierce_stat endpoints 0.1 and 0.95; inputs 60% and 80% give t=0.61 and 0.78. The light_chainaxe_tank profile exposes armored/resistant via lerp_1_5 [1.035,1.965] -&gt; 1.6023/1.7604, super_armor via lerp_0_75 [0.48,1.02] -&gt; 0.8094/0.9012, and disgustingly_resilient via lerp_1_33 [0.9,1.77] -&gt; 1.4307/1.5786. heavy_chainaxe_smiter exposes armored via lerp_0_75 -&gt; 0.8094/0.9012 and super_armor via lerp_0_3 [0.174,0.426] -&gt; 0.32772/0.37056. UI display_type percentage multiplies each raw ratio by 100 and prints two decimals. Only explicit profile armor keys are claimed; values are not final damage.

## Claim `darktide:claim:chainaxe:p1-m2-armor-penetration-light-super_armor-60`

- Game release: `darktide:1.13.2`
- Property: `damage_templates.light_chainaxe_tank.targets[1].armor_damage_modifier.attack[armor_types.super_armor]`
- Target: `darktide:1.13.2:darktide:weapon:chainaxe:p1-m2`
- Known value: `0.8094` `ratio`
- Basis: `code-derived`
- Review state: `approved`
- Context (JSON): `{"armorClass":"super_armor","attackMode":"light","comparisonStat":{"decimal":"60","status":"known","unit":"percent"},"damageProfileRef":{"gameReleaseId":"darktide:1.13.2","recordId":"darktide:damage-profile:chainaxe-p1:light_chainaxe_tank"},"profile":"light_chainaxe_tank","weaponRef":{"gameReleaseId":"darktide:1.13.2","recordId":"darktide:weapon:chainaxe:p1-m2"},"weaponStat":"chainaxe_armor_pierce_stat"}`
- Evidence:
  - `darktide:1.13.2:darktide:evidence:chainaxe:p1-m2-armor-penetration-comparison-code`: At commit ba6c148, chainaxe_armor_pierce_stat applies default_armor_pierce_stat endpoints 0.1 and 0.95; inputs 60% and 80% give t=0.61 and 0.78. The light_chainaxe_tank profile exposes armored/resistant via lerp_1_5 [1.035,1.965] -&gt; 1.6023/1.7604, super_armor via lerp_0_75 [0.48,1.02] -&gt; 0.8094/0.9012, and disgustingly_resilient via lerp_1_33 [0.9,1.77] -&gt; 1.4307/1.5786. heavy_chainaxe_smiter exposes armored via lerp_0_75 -&gt; 0.8094/0.9012 and super_armor via lerp_0_3 [0.174,0.426] -&gt; 0.32772/0.37056. UI display_type percentage multiplies each raw ratio by 100 and prints two decimals. Only explicit profile armor keys are claimed; values are not final damage.

## Claim `darktide:claim:chainaxe:p1-m2-armor-penetration-light-super_armor-80`

- Game release: `darktide:1.13.2`
- Property: `damage_templates.light_chainaxe_tank.targets[1].armor_damage_modifier.attack[armor_types.super_armor]`
- Target: `darktide:1.13.2:darktide:weapon:chainaxe:p1-m2`
- Known value: `0.9012` `ratio`
- Basis: `code-derived`
- Review state: `approved`
- Context (JSON): `{"armorClass":"super_armor","attackMode":"light","comparisonStat":{"decimal":"80","status":"known","unit":"percent"},"damageProfileRef":{"gameReleaseId":"darktide:1.13.2","recordId":"darktide:damage-profile:chainaxe-p1:light_chainaxe_tank"},"profile":"light_chainaxe_tank","weaponRef":{"gameReleaseId":"darktide:1.13.2","recordId":"darktide:weapon:chainaxe:p1-m2"},"weaponStat":"chainaxe_armor_pierce_stat"}`
- Evidence:
  - `darktide:1.13.2:darktide:evidence:chainaxe:p1-m2-armor-penetration-comparison-code`: At commit ba6c148, chainaxe_armor_pierce_stat applies default_armor_pierce_stat endpoints 0.1 and 0.95; inputs 60% and 80% give t=0.61 and 0.78. The light_chainaxe_tank profile exposes armored/resistant via lerp_1_5 [1.035,1.965] -&gt; 1.6023/1.7604, super_armor via lerp_0_75 [0.48,1.02] -&gt; 0.8094/0.9012, and disgustingly_resilient via lerp_1_33 [0.9,1.77] -&gt; 1.4307/1.5786. heavy_chainaxe_smiter exposes armored via lerp_0_75 -&gt; 0.8094/0.9012 and super_armor via lerp_0_3 [0.174,0.426] -&gt; 0.32772/0.37056. UI display_type percentage multiplies each raw ratio by 100 and prints two decimals. Only explicit profile armor keys are claimed; values are not final damage.

## Claim `darktide:claim:chainaxe:p1-m2-damage-heavy-attack-power-60`

- Game release: `darktide:1.13.2`
- Property: `damage_templates.heavy_chainaxe_smiter.targets[1].power_distribution.attack`
- Target: `darktide:1.13.2:darktide:weapon:chainaxe:p1-m2`
- Known value: `166` `attack-power-point`
- Basis: `code-derived`
- Review state: `approved`
- Context (JSON): `{"attackMode":"heavy","comparisonStat":{"decimal":"60","status":"known","unit":"percent"},"damageProfileRef":{"gameReleaseId":"darktide:1.13.2","recordId":"darktide:damage-profile:chainaxe-p1:heavy_chainaxe_smiter"},"profile":"heavy_chainaxe_smiter","weaponRef":{"gameReleaseId":"darktide:1.13.2","recordId":"darktide:weapon:chainaxe:p1-m2"},"weaponStat":"chainaxe_dps_stat"}`
- Evidence:
  - `darktide:1.13.2:darktide:evidence:chainaxe:p1-m2-damage-comparison-code`: At commit ba6c148, chainaxe_p1_m2 displays action_left_down_light as the light attack-power row and action_heavy_1 as the heavy row. The mapped profiles are light_chainaxe_tank with raw target-1 attack endpoints 80 and 150, and heavy_chainaxe_smiter with endpoints 100 and 220. default_melee_dps_stat interpolates 0.25 to 0.75: inputs 60% and 80% give t=0.55 and 0.65. The resulting source parameters are light 118.5 and 125.5; heavy 166 and 178 attack-power points. These are profile/mode-scoped parameters, not final HP damage and not values for every displayed segment. The player-facing weapon-info panel exposes the raw power_distribution.attack value through a default display row, with no scalar conversion, and formats it to two decimals; this is a source parameter, not health damage.

## Claim `darktide:claim:chainaxe:p1-m2-damage-heavy-attack-power-80`

- Game release: `darktide:1.13.2`
- Property: `damage_templates.heavy_chainaxe_smiter.targets[1].power_distribution.attack`
- Target: `darktide:1.13.2:darktide:weapon:chainaxe:p1-m2`
- Known value: `178` `attack-power-point`
- Basis: `code-derived`
- Review state: `approved`
- Context (JSON): `{"attackMode":"heavy","comparisonStat":{"decimal":"80","status":"known","unit":"percent"},"damageProfileRef":{"gameReleaseId":"darktide:1.13.2","recordId":"darktide:damage-profile:chainaxe-p1:heavy_chainaxe_smiter"},"profile":"heavy_chainaxe_smiter","weaponRef":{"gameReleaseId":"darktide:1.13.2","recordId":"darktide:weapon:chainaxe:p1-m2"},"weaponStat":"chainaxe_dps_stat"}`
- Evidence:
  - `darktide:1.13.2:darktide:evidence:chainaxe:p1-m2-damage-comparison-code`: At commit ba6c148, chainaxe_p1_m2 displays action_left_down_light as the light attack-power row and action_heavy_1 as the heavy row. The mapped profiles are light_chainaxe_tank with raw target-1 attack endpoints 80 and 150, and heavy_chainaxe_smiter with endpoints 100 and 220. default_melee_dps_stat interpolates 0.25 to 0.75: inputs 60% and 80% give t=0.55 and 0.65. The resulting source parameters are light 118.5 and 125.5; heavy 166 and 178 attack-power points. These are profile/mode-scoped parameters, not final HP damage and not values for every displayed segment. The player-facing weapon-info panel exposes the raw power_distribution.attack value through a default display row, with no scalar conversion, and formats it to two decimals; this is a source parameter, not health damage.

## Claim `darktide:claim:chainaxe:p1-m2-damage-light-attack-power-60`

- Game release: `darktide:1.13.2`
- Property: `damage_templates.light_chainaxe_tank.targets[1].power_distribution.attack`
- Target: `darktide:1.13.2:darktide:weapon:chainaxe:p1-m2`
- Known value: `118.5` `attack-power-point`
- Basis: `code-derived`
- Review state: `approved`
- Context (JSON): `{"attackMode":"light","comparisonStat":{"decimal":"60","status":"known","unit":"percent"},"damageProfileRef":{"gameReleaseId":"darktide:1.13.2","recordId":"darktide:damage-profile:chainaxe-p1:light_chainaxe_tank"},"profile":"light_chainaxe_tank","weaponRef":{"gameReleaseId":"darktide:1.13.2","recordId":"darktide:weapon:chainaxe:p1-m2"},"weaponStat":"chainaxe_dps_stat"}`
- Evidence:
  - `darktide:1.13.2:darktide:evidence:chainaxe:p1-m2-damage-comparison-code`: At commit ba6c148, chainaxe_p1_m2 displays action_left_down_light as the light attack-power row and action_heavy_1 as the heavy row. The mapped profiles are light_chainaxe_tank with raw target-1 attack endpoints 80 and 150, and heavy_chainaxe_smiter with endpoints 100 and 220. default_melee_dps_stat interpolates 0.25 to 0.75: inputs 60% and 80% give t=0.55 and 0.65. The resulting source parameters are light 118.5 and 125.5; heavy 166 and 178 attack-power points. These are profile/mode-scoped parameters, not final HP damage and not values for every displayed segment. The player-facing weapon-info panel exposes the raw power_distribution.attack value through a default display row, with no scalar conversion, and formats it to two decimals; this is a source parameter, not health damage.

## Claim `darktide:claim:chainaxe:p1-m2-damage-light-attack-power-80`

- Game release: `darktide:1.13.2`
- Property: `damage_templates.light_chainaxe_tank.targets[1].power_distribution.attack`
- Target: `darktide:1.13.2:darktide:weapon:chainaxe:p1-m2`
- Known value: `125.5` `attack-power-point`
- Basis: `code-derived`
- Review state: `approved`
- Context (JSON): `{"attackMode":"light","comparisonStat":{"decimal":"80","status":"known","unit":"percent"},"damageProfileRef":{"gameReleaseId":"darktide:1.13.2","recordId":"darktide:damage-profile:chainaxe-p1:light_chainaxe_tank"},"profile":"light_chainaxe_tank","weaponRef":{"gameReleaseId":"darktide:1.13.2","recordId":"darktide:weapon:chainaxe:p1-m2"},"weaponStat":"chainaxe_dps_stat"}`
- Evidence:
  - `darktide:1.13.2:darktide:evidence:chainaxe:p1-m2-damage-comparison-code`: At commit ba6c148, chainaxe_p1_m2 displays action_left_down_light as the light attack-power row and action_heavy_1 as the heavy row. The mapped profiles are light_chainaxe_tank with raw target-1 attack endpoints 80 and 150, and heavy_chainaxe_smiter with endpoints 100 and 220. default_melee_dps_stat interpolates 0.25 to 0.75: inputs 60% and 80% give t=0.55 and 0.65. The resulting source parameters are light 118.5 and 125.5; heavy 166 and 178 attack-power points. These are profile/mode-scoped parameters, not final HP damage and not values for every displayed segment. The player-facing weapon-info panel exposes the raw power_distribution.attack value through a default display row, with no scalar conversion, and formats it to two decimals; this is a source parameter, not health damage.

## Claim `darktide:claim:chainaxe:p1-m2-defence-push-cost-60`

- Game release: `darktide:1.13.2`
- Property: `weapon_stamina_templates.linesman.push_cost`
- Target: `darktide:1.13.2:darktide:weapon:chainaxe:p1-m2`
- Known value: `1.8` `stamina-point`
- Basis: `code-derived`
- Review state: `approved`
- Context (JSON): `{"comparisonStat":{"decimal":"60","status":"known","unit":"percent"},"profile":"linesman","weaponRef":{"gameReleaseId":"darktide:1.13.2","recordId":"darktide:weapon:chainaxe:p1-m2"},"weaponStat":"chainaxe_defence_stat"}`
- Evidence:
  - `darktide:1.13.2:darktide:evidence:chainaxe:p1-m2-defence-comparison-code`: At commit ba6c148 both chainaxe marks use the linesman stamina template. The player-visible stamina_modifier is the fixed value 4, shown with a plus sign and two decimals as +4.00. The defence slider maps sprint_cost_per_second endpoints 0.25 to 0.75, so inputs 60% and 80% produce first-stage t=0.55 and 0.65, then linesman endpoints 1.25 to 0.75 produce raw 0.975 and 0.925 stamina points per second. The push_cost slider endpoints are 0 to 1, so t=0.60 and 0.80 applied to linesman endpoints 3 to 1 produce 1.8 and 1.4 stamina points. The Source UI formats stamina, sprint cost, and push cost with two decimals; binary floating-point therefore displays sprint cost as 0.97 and 0.93 while raw values remain 0.975 and 0.925, and push cost as 1.80 and 1.40.

## Claim `darktide:claim:chainaxe:p1-m2-defence-push-cost-80`

- Game release: `darktide:1.13.2`
- Property: `weapon_stamina_templates.linesman.push_cost`
- Target: `darktide:1.13.2:darktide:weapon:chainaxe:p1-m2`
- Known value: `1.4` `stamina-point`
- Basis: `code-derived`
- Review state: `approved`
- Context (JSON): `{"comparisonStat":{"decimal":"80","status":"known","unit":"percent"},"profile":"linesman","weaponRef":{"gameReleaseId":"darktide:1.13.2","recordId":"darktide:weapon:chainaxe:p1-m2"},"weaponStat":"chainaxe_defence_stat"}`
- Evidence:
  - `darktide:1.13.2:darktide:evidence:chainaxe:p1-m2-defence-comparison-code`: At commit ba6c148 both chainaxe marks use the linesman stamina template. The player-visible stamina_modifier is the fixed value 4, shown with a plus sign and two decimals as +4.00. The defence slider maps sprint_cost_per_second endpoints 0.25 to 0.75, so inputs 60% and 80% produce first-stage t=0.55 and 0.65, then linesman endpoints 1.25 to 0.75 produce raw 0.975 and 0.925 stamina points per second. The push_cost slider endpoints are 0 to 1, so t=0.60 and 0.80 applied to linesman endpoints 3 to 1 produce 1.8 and 1.4 stamina points. The Source UI formats stamina, sprint cost, and push cost with two decimals; binary floating-point therefore displays sprint cost as 0.97 and 0.93 while raw values remain 0.975 and 0.925, and push cost as 1.80 and 1.40.

## Claim `darktide:claim:chainaxe:p1-m2-defence-sprint-cost-60`

- Game release: `darktide:1.13.2`
- Property: `weapon_stamina_templates.linesman.sprint_cost_per_second`
- Target: `darktide:1.13.2:darktide:weapon:chainaxe:p1-m2`
- Known value: `0.975` `stamina-point-per-second`
- Basis: `code-derived`
- Review state: `approved`
- Context (JSON): `{"comparisonStat":{"decimal":"60","status":"known","unit":"percent"},"profile":"linesman","weaponRef":{"gameReleaseId":"darktide:1.13.2","recordId":"darktide:weapon:chainaxe:p1-m2"},"weaponStat":"chainaxe_defence_stat"}`
- Evidence:
  - `darktide:1.13.2:darktide:evidence:chainaxe:p1-m2-defence-comparison-code`: At commit ba6c148 both chainaxe marks use the linesman stamina template. The player-visible stamina_modifier is the fixed value 4, shown with a plus sign and two decimals as +4.00. The defence slider maps sprint_cost_per_second endpoints 0.25 to 0.75, so inputs 60% and 80% produce first-stage t=0.55 and 0.65, then linesman endpoints 1.25 to 0.75 produce raw 0.975 and 0.925 stamina points per second. The push_cost slider endpoints are 0 to 1, so t=0.60 and 0.80 applied to linesman endpoints 3 to 1 produce 1.8 and 1.4 stamina points. The Source UI formats stamina, sprint cost, and push cost with two decimals; binary floating-point therefore displays sprint cost as 0.97 and 0.93 while raw values remain 0.975 and 0.925, and push cost as 1.80 and 1.40.

## Claim `darktide:claim:chainaxe:p1-m2-defence-sprint-cost-80`

- Game release: `darktide:1.13.2`
- Property: `weapon_stamina_templates.linesman.sprint_cost_per_second`
- Target: `darktide:1.13.2:darktide:weapon:chainaxe:p1-m2`
- Known value: `0.925` `stamina-point-per-second`
- Basis: `code-derived`
- Review state: `approved`
- Context (JSON): `{"comparisonStat":{"decimal":"80","status":"known","unit":"percent"},"profile":"linesman","weaponRef":{"gameReleaseId":"darktide:1.13.2","recordId":"darktide:weapon:chainaxe:p1-m2"},"weaponStat":"chainaxe_defence_stat"}`
- Evidence:
  - `darktide:1.13.2:darktide:evidence:chainaxe:p1-m2-defence-comparison-code`: At commit ba6c148 both chainaxe marks use the linesman stamina template. The player-visible stamina_modifier is the fixed value 4, shown with a plus sign and two decimals as +4.00. The defence slider maps sprint_cost_per_second endpoints 0.25 to 0.75, so inputs 60% and 80% produce first-stage t=0.55 and 0.65, then linesman endpoints 1.25 to 0.75 produce raw 0.975 and 0.925 stamina points per second. The push_cost slider endpoints are 0 to 1, so t=0.60 and 0.80 applied to linesman endpoints 3 to 1 produce 1.8 and 1.4 stamina points. The Source UI formats stamina, sprint cost, and push cost with two decimals; binary floating-point therefore displays sprint cost as 0.97 and 0.93 while raw values remain 0.975 and 0.925, and push cost as 1.80 and 1.40.

## Claim `darktide:claim:chainaxe:p1-m2-defence-stamina-60`

- Game release: `darktide:1.13.2`
- Property: `weapon_stamina_templates.linesman.stamina_modifier`
- Target: `darktide:1.13.2:darktide:weapon:chainaxe:p1-m2`
- Known value: `4` `stamina-point`
- Basis: `code-derived`
- Review state: `approved`
- Context (JSON): `{"comparisonStat":{"decimal":"60","status":"known","unit":"percent"},"profile":"linesman","weaponRef":{"gameReleaseId":"darktide:1.13.2","recordId":"darktide:weapon:chainaxe:p1-m2"},"weaponStat":"chainaxe_defence_stat"}`
- Evidence:
  - `darktide:1.13.2:darktide:evidence:chainaxe:p1-m2-defence-comparison-code`: At commit ba6c148 both chainaxe marks use the linesman stamina template. The player-visible stamina_modifier is the fixed value 4, shown with a plus sign and two decimals as +4.00. The defence slider maps sprint_cost_per_second endpoints 0.25 to 0.75, so inputs 60% and 80% produce first-stage t=0.55 and 0.65, then linesman endpoints 1.25 to 0.75 produce raw 0.975 and 0.925 stamina points per second. The push_cost slider endpoints are 0 to 1, so t=0.60 and 0.80 applied to linesman endpoints 3 to 1 produce 1.8 and 1.4 stamina points. The Source UI formats stamina, sprint cost, and push cost with two decimals; binary floating-point therefore displays sprint cost as 0.97 and 0.93 while raw values remain 0.975 and 0.925, and push cost as 1.80 and 1.40.

## Claim `darktide:claim:chainaxe:p1-m2-defence-stamina-80`

- Game release: `darktide:1.13.2`
- Property: `weapon_stamina_templates.linesman.stamina_modifier`
- Target: `darktide:1.13.2:darktide:weapon:chainaxe:p1-m2`
- Known value: `4` `stamina-point`
- Basis: `code-derived`
- Review state: `approved`
- Context (JSON): `{"comparisonStat":{"decimal":"80","status":"known","unit":"percent"},"profile":"linesman","weaponRef":{"gameReleaseId":"darktide:1.13.2","recordId":"darktide:weapon:chainaxe:p1-m2"},"weaponStat":"chainaxe_defence_stat"}`
- Evidence:
  - `darktide:1.13.2:darktide:evidence:chainaxe:p1-m2-defence-comparison-code`: At commit ba6c148 both chainaxe marks use the linesman stamina template. The player-visible stamina_modifier is the fixed value 4, shown with a plus sign and two decimals as +4.00. The defence slider maps sprint_cost_per_second endpoints 0.25 to 0.75, so inputs 60% and 80% produce first-stage t=0.55 and 0.65, then linesman endpoints 1.25 to 0.75 produce raw 0.975 and 0.925 stamina points per second. The push_cost slider endpoints are 0 to 1, so t=0.60 and 0.80 applied to linesman endpoints 3 to 1 produce 1.8 and 1.4 stamina points. The Source UI formats stamina, sprint cost, and push cost with two decimals; binary floating-point therefore displays sprint cost as 0.97 and 0.93 while raw values remain 0.975 and 0.925, and push cost as 1.80 and 1.40.

## Claim `darktide:claim:chainaxe:p1-m2-mobility-dodge-distance-60`

- Game release: `darktide:1.13.2`
- Property: `weapon_dodge_templates.smiter_plus.distance_scale`
- Target: `darktide:1.13.2:darktide:weapon:chainaxe:p1-m2`
- Known value: `0.96` `ratio`
- Basis: `code-derived`
- Review state: `approved`
- Context (JSON): `{"comparisonStat":{"decimal":"60","status":"known","unit":"percent"},"profile":"smiter_plus","weaponRef":{"gameReleaseId":"darktide:1.13.2","recordId":"darktide:weapon:chainaxe:p1-m2"},"weaponStat":"chainaxe_mobility_stat"}`
- Evidence:
  - `darktide:1.13.2:darktide:evidence:chainaxe:p1-m2-mobility-comparison-code`: At commit ba6c148 both marks use smiter_plus dodge and default sprint templates. default_dodge_stat endpoints 0.25 to 0.75 make t=0.55/0.65 at 60%/80%; smiter_plus distance_scale 0.85 to 1.05 yields raw 0.96/0.98, displayed as -4.00%/-2.00% by (value-1)*100. Its diminishing_return_start endpoints 2 to 4 yield raw 3.1/3.3 effective dodges, floored then displayed as 3.00/3.00; speed_modifier stays 1 and displays +0.00%. default_sprint_stat endpoints 0.05 to 0.95 yield t=0.59/0.77; default sprint_speed_mod endpoints -0.5 to 0.5 yield raw additive parameter points 0.09/0.27; the pinned source does not expose a physical speed unit, displayed as +0.09/+0.27. The UI uses two decimal places and signed formatting for these rows. Hidden movement-curve and non-displayed fields are not included.

## Claim `darktide:claim:chainaxe:p1-m2-mobility-dodge-distance-80`

- Game release: `darktide:1.13.2`
- Property: `weapon_dodge_templates.smiter_plus.distance_scale`
- Target: `darktide:1.13.2:darktide:weapon:chainaxe:p1-m2`
- Known value: `0.98` `ratio`
- Basis: `code-derived`
- Review state: `approved`
- Context (JSON): `{"comparisonStat":{"decimal":"80","status":"known","unit":"percent"},"profile":"smiter_plus","weaponRef":{"gameReleaseId":"darktide:1.13.2","recordId":"darktide:weapon:chainaxe:p1-m2"},"weaponStat":"chainaxe_mobility_stat"}`
- Evidence:
  - `darktide:1.13.2:darktide:evidence:chainaxe:p1-m2-mobility-comparison-code`: At commit ba6c148 both marks use smiter_plus dodge and default sprint templates. default_dodge_stat endpoints 0.25 to 0.75 make t=0.55/0.65 at 60%/80%; smiter_plus distance_scale 0.85 to 1.05 yields raw 0.96/0.98, displayed as -4.00%/-2.00% by (value-1)*100. Its diminishing_return_start endpoints 2 to 4 yield raw 3.1/3.3 effective dodges, floored then displayed as 3.00/3.00; speed_modifier stays 1 and displays +0.00%. default_sprint_stat endpoints 0.05 to 0.95 yield t=0.59/0.77; default sprint_speed_mod endpoints -0.5 to 0.5 yield raw additive parameter points 0.09/0.27; the pinned source does not expose a physical speed unit, displayed as +0.09/+0.27. The UI uses two decimal places and signed formatting for these rows. Hidden movement-curve and non-displayed fields are not included.

## Claim `darktide:claim:chainaxe:p1-m2-mobility-dodge-speed-60`

- Game release: `darktide:1.13.2`
- Property: `weapon_dodge_templates.smiter_plus.speed_modifier`
- Target: `darktide:1.13.2:darktide:weapon:chainaxe:p1-m2`
- Known value: `1` `ratio`
- Basis: `code-derived`
- Review state: `approved`
- Context (JSON): `{"comparisonStat":{"decimal":"60","status":"known","unit":"percent"},"profile":"smiter_plus","weaponRef":{"gameReleaseId":"darktide:1.13.2","recordId":"darktide:weapon:chainaxe:p1-m2"},"weaponStat":"chainaxe_mobility_stat"}`
- Evidence:
  - `darktide:1.13.2:darktide:evidence:chainaxe:p1-m2-mobility-comparison-code`: At commit ba6c148 both marks use smiter_plus dodge and default sprint templates. default_dodge_stat endpoints 0.25 to 0.75 make t=0.55/0.65 at 60%/80%; smiter_plus distance_scale 0.85 to 1.05 yields raw 0.96/0.98, displayed as -4.00%/-2.00% by (value-1)*100. Its diminishing_return_start endpoints 2 to 4 yield raw 3.1/3.3 effective dodges, floored then displayed as 3.00/3.00; speed_modifier stays 1 and displays +0.00%. default_sprint_stat endpoints 0.05 to 0.95 yield t=0.59/0.77; default sprint_speed_mod endpoints -0.5 to 0.5 yield raw additive parameter points 0.09/0.27; the pinned source does not expose a physical speed unit, displayed as +0.09/+0.27. The UI uses two decimal places and signed formatting for these rows. Hidden movement-curve and non-displayed fields are not included.

## Claim `darktide:claim:chainaxe:p1-m2-mobility-dodge-speed-80`

- Game release: `darktide:1.13.2`
- Property: `weapon_dodge_templates.smiter_plus.speed_modifier`
- Target: `darktide:1.13.2:darktide:weapon:chainaxe:p1-m2`
- Known value: `1` `ratio`
- Basis: `code-derived`
- Review state: `approved`
- Context (JSON): `{"comparisonStat":{"decimal":"80","status":"known","unit":"percent"},"profile":"smiter_plus","weaponRef":{"gameReleaseId":"darktide:1.13.2","recordId":"darktide:weapon:chainaxe:p1-m2"},"weaponStat":"chainaxe_mobility_stat"}`
- Evidence:
  - `darktide:1.13.2:darktide:evidence:chainaxe:p1-m2-mobility-comparison-code`: At commit ba6c148 both marks use smiter_plus dodge and default sprint templates. default_dodge_stat endpoints 0.25 to 0.75 make t=0.55/0.65 at 60%/80%; smiter_plus distance_scale 0.85 to 1.05 yields raw 0.96/0.98, displayed as -4.00%/-2.00% by (value-1)*100. Its diminishing_return_start endpoints 2 to 4 yield raw 3.1/3.3 effective dodges, floored then displayed as 3.00/3.00; speed_modifier stays 1 and displays +0.00%. default_sprint_stat endpoints 0.05 to 0.95 yield t=0.59/0.77; default sprint_speed_mod endpoints -0.5 to 0.5 yield raw additive parameter points 0.09/0.27; the pinned source does not expose a physical speed unit, displayed as +0.09/+0.27. The UI uses two decimal places and signed formatting for these rows. Hidden movement-curve and non-displayed fields are not included.

## Claim `darktide:claim:chainaxe:p1-m2-mobility-effective-dodges-60`

- Game release: `darktide:1.13.2`
- Property: `weapon_dodge_templates.smiter_plus.diminishing_return_start`
- Target: `darktide:1.13.2:darktide:weapon:chainaxe:p1-m2`
- Known value: `3.1` `dodge-count`
- Basis: `code-derived`
- Review state: `approved`
- Context (JSON): `{"comparisonStat":{"decimal":"60","status":"known","unit":"percent"},"profile":"smiter_plus","weaponRef":{"gameReleaseId":"darktide:1.13.2","recordId":"darktide:weapon:chainaxe:p1-m2"},"weaponStat":"chainaxe_mobility_stat"}`
- Evidence:
  - `darktide:1.13.2:darktide:evidence:chainaxe:p1-m2-mobility-comparison-code`: At commit ba6c148 both marks use smiter_plus dodge and default sprint templates. default_dodge_stat endpoints 0.25 to 0.75 make t=0.55/0.65 at 60%/80%; smiter_plus distance_scale 0.85 to 1.05 yields raw 0.96/0.98, displayed as -4.00%/-2.00% by (value-1)*100. Its diminishing_return_start endpoints 2 to 4 yield raw 3.1/3.3 effective dodges, floored then displayed as 3.00/3.00; speed_modifier stays 1 and displays +0.00%. default_sprint_stat endpoints 0.05 to 0.95 yield t=0.59/0.77; default sprint_speed_mod endpoints -0.5 to 0.5 yield raw additive parameter points 0.09/0.27; the pinned source does not expose a physical speed unit, displayed as +0.09/+0.27. The UI uses two decimal places and signed formatting for these rows. Hidden movement-curve and non-displayed fields are not included.

## Claim `darktide:claim:chainaxe:p1-m2-mobility-effective-dodges-80`

- Game release: `darktide:1.13.2`
- Property: `weapon_dodge_templates.smiter_plus.diminishing_return_start`
- Target: `darktide:1.13.2:darktide:weapon:chainaxe:p1-m2`
- Known value: `3.3` `dodge-count`
- Basis: `code-derived`
- Review state: `approved`
- Context (JSON): `{"comparisonStat":{"decimal":"80","status":"known","unit":"percent"},"profile":"smiter_plus","weaponRef":{"gameReleaseId":"darktide:1.13.2","recordId":"darktide:weapon:chainaxe:p1-m2"},"weaponStat":"chainaxe_mobility_stat"}`
- Evidence:
  - `darktide:1.13.2:darktide:evidence:chainaxe:p1-m2-mobility-comparison-code`: At commit ba6c148 both marks use smiter_plus dodge and default sprint templates. default_dodge_stat endpoints 0.25 to 0.75 make t=0.55/0.65 at 60%/80%; smiter_plus distance_scale 0.85 to 1.05 yields raw 0.96/0.98, displayed as -4.00%/-2.00% by (value-1)*100. Its diminishing_return_start endpoints 2 to 4 yield raw 3.1/3.3 effective dodges, floored then displayed as 3.00/3.00; speed_modifier stays 1 and displays +0.00%. default_sprint_stat endpoints 0.05 to 0.95 yield t=0.59/0.77; default sprint_speed_mod endpoints -0.5 to 0.5 yield raw additive parameter points 0.09/0.27; the pinned source does not expose a physical speed unit, displayed as +0.09/+0.27. The UI uses two decimal places and signed formatting for these rows. Hidden movement-curve and non-displayed fields are not included.

## Claim `darktide:claim:chainaxe:p1-m2-mobility-sprint-speed-60`

- Game release: `darktide:1.13.2`
- Property: `weapon_sprint_templates.default.sprint_speed_mod`
- Target: `darktide:1.13.2:darktide:weapon:chainaxe:p1-m2`
- Known value: `0.09` `point`
- Basis: `code-derived`
- Review state: `approved`
- Context (JSON): `{"comparisonStat":{"decimal":"60","status":"known","unit":"percent"},"profile":"default","weaponRef":{"gameReleaseId":"darktide:1.13.2","recordId":"darktide:weapon:chainaxe:p1-m2"},"weaponStat":"chainaxe_mobility_stat"}`
- Evidence:
  - `darktide:1.13.2:darktide:evidence:chainaxe:p1-m2-mobility-comparison-code`: At commit ba6c148 both marks use smiter_plus dodge and default sprint templates. default_dodge_stat endpoints 0.25 to 0.75 make t=0.55/0.65 at 60%/80%; smiter_plus distance_scale 0.85 to 1.05 yields raw 0.96/0.98, displayed as -4.00%/-2.00% by (value-1)*100. Its diminishing_return_start endpoints 2 to 4 yield raw 3.1/3.3 effective dodges, floored then displayed as 3.00/3.00; speed_modifier stays 1 and displays +0.00%. default_sprint_stat endpoints 0.05 to 0.95 yield t=0.59/0.77; default sprint_speed_mod endpoints -0.5 to 0.5 yield raw additive parameter points 0.09/0.27; the pinned source does not expose a physical speed unit, displayed as +0.09/+0.27. The UI uses two decimal places and signed formatting for these rows. Hidden movement-curve and non-displayed fields are not included.

## Claim `darktide:claim:chainaxe:p1-m2-mobility-sprint-speed-80`

- Game release: `darktide:1.13.2`
- Property: `weapon_sprint_templates.default.sprint_speed_mod`
- Target: `darktide:1.13.2:darktide:weapon:chainaxe:p1-m2`
- Known value: `0.27` `point`
- Basis: `code-derived`
- Review state: `approved`
- Context (JSON): `{"comparisonStat":{"decimal":"80","status":"known","unit":"percent"},"profile":"default","weaponRef":{"gameReleaseId":"darktide:1.13.2","recordId":"darktide:weapon:chainaxe:p1-m2"},"weaponStat":"chainaxe_mobility_stat"}`
- Evidence:
  - `darktide:1.13.2:darktide:evidence:chainaxe:p1-m2-mobility-comparison-code`: At commit ba6c148 both marks use smiter_plus dodge and default sprint templates. default_dodge_stat endpoints 0.25 to 0.75 make t=0.55/0.65 at 60%/80%; smiter_plus distance_scale 0.85 to 1.05 yields raw 0.96/0.98, displayed as -4.00%/-2.00% by (value-1)*100. Its diminishing_return_start endpoints 2 to 4 yield raw 3.1/3.3 effective dodges, floored then displayed as 3.00/3.00; speed_modifier stays 1 and displays +0.00%. default_sprint_stat endpoints 0.05 to 0.95 yield t=0.59/0.77; default sprint_speed_mod endpoints -0.5 to 0.5 yield raw additive parameter points 0.09/0.27; the pinned source does not expose a physical speed unit, displayed as +0.09/+0.27. The UI uses two decimal places and signed formatting for these rows. Hidden movement-curve and non-displayed fields are not included.

## Claim `darktide:claim:chainaxe:p1-m2-sawing-heavy-active-final-saw-60`

- Game release: `darktide:1.13.2`
- Property: `base_stats.chainaxe_sawing_stat.damage.action_heavy_1.overrides.heavy_chainaxe_active_sticky_last.targets[1].power_distribution.attack`
- Target: `darktide:1.13.2:darktide:weapon:chainaxe:p1-m2`
- Known value: `852.5` `attack-power-point`
- Basis: `code-derived`
- Review state: `approved`
- Context (JSON): `{"attackMode":"heavy","comparisonStat":{"decimal":"60","status":"known","unit":"percent"},"damageProfileRef":{"gameReleaseId":"darktide:1.13.2","recordId":"darktide:damage-profile:chainaxe-p1:heavy_chainaxe_active_sticky_last"},"profile":"heavy_chainaxe_active_sticky_last","weaponRef":{"gameReleaseId":"darktide:1.13.2","recordId":"darktide:weapon:chainaxe:p1-m2"},"weaponStat":"chainaxe_sawing_stat"}`
- Evidence:
  - `darktide:1.13.2:darktide:evidence:chainaxe:p1-m2-sawing-comparison-code`: At commit ba6c148, chainaxe_sawing_stat maps the displayed light/heavy saw rows to source profile overrides. default_melee_dps_stat endpoints 0.25 to 0.75 give t=0.55/0.65 for the 60%/80% comparison. Profile raw attack-power endpoints yield light active first saw 248/264 (160 to 320), light active final saw 465/495 (300 to 600), heavy active first saw 310/330 (200 to 400), and heavy active final saw 852.5/907.5 (550 to 1100). These are sawing profile attack-power parameters, not health damage or the ordinary light/heavy attack power rows. The player-facing weapon-info panel exposes the raw power_distribution.attack value through a default display row, with no scalar conversion, and formats it to two decimals; this is a source parameter, not health damage.

## Claim `darktide:claim:chainaxe:p1-m2-sawing-heavy-active-final-saw-80`

- Game release: `darktide:1.13.2`
- Property: `base_stats.chainaxe_sawing_stat.damage.action_heavy_1.overrides.heavy_chainaxe_active_sticky_last.targets[1].power_distribution.attack`
- Target: `darktide:1.13.2:darktide:weapon:chainaxe:p1-m2`
- Known value: `907.5` `attack-power-point`
- Basis: `code-derived`
- Review state: `approved`
- Context (JSON): `{"attackMode":"heavy","comparisonStat":{"decimal":"80","status":"known","unit":"percent"},"damageProfileRef":{"gameReleaseId":"darktide:1.13.2","recordId":"darktide:damage-profile:chainaxe-p1:heavy_chainaxe_active_sticky_last"},"profile":"heavy_chainaxe_active_sticky_last","weaponRef":{"gameReleaseId":"darktide:1.13.2","recordId":"darktide:weapon:chainaxe:p1-m2"},"weaponStat":"chainaxe_sawing_stat"}`
- Evidence:
  - `darktide:1.13.2:darktide:evidence:chainaxe:p1-m2-sawing-comparison-code`: At commit ba6c148, chainaxe_sawing_stat maps the displayed light/heavy saw rows to source profile overrides. default_melee_dps_stat endpoints 0.25 to 0.75 give t=0.55/0.65 for the 60%/80% comparison. Profile raw attack-power endpoints yield light active first saw 248/264 (160 to 320), light active final saw 465/495 (300 to 600), heavy active first saw 310/330 (200 to 400), and heavy active final saw 852.5/907.5 (550 to 1100). These are sawing profile attack-power parameters, not health damage or the ordinary light/heavy attack power rows. The player-facing weapon-info panel exposes the raw power_distribution.attack value through a default display row, with no scalar conversion, and formats it to two decimals; this is a source parameter, not health damage.

## Claim `darktide:claim:chainaxe:p1-m2-sawing-heavy-active-first-saw-60`

- Game release: `darktide:1.13.2`
- Property: `base_stats.chainaxe_sawing_stat.damage.action_heavy_1.overrides.heavy_chainaxe_active_sticky.targets[1].power_distribution.attack`
- Target: `darktide:1.13.2:darktide:weapon:chainaxe:p1-m2`
- Known value: `310` `attack-power-point`
- Basis: `code-derived`
- Review state: `approved`
- Context (JSON): `{"attackMode":"heavy","comparisonStat":{"decimal":"60","status":"known","unit":"percent"},"damageProfileRef":{"gameReleaseId":"darktide:1.13.2","recordId":"darktide:damage-profile:chainaxe-p1:heavy_chainaxe_active_sticky"},"profile":"heavy_chainaxe_active_sticky","weaponRef":{"gameReleaseId":"darktide:1.13.2","recordId":"darktide:weapon:chainaxe:p1-m2"},"weaponStat":"chainaxe_sawing_stat"}`
- Evidence:
  - `darktide:1.13.2:darktide:evidence:chainaxe:p1-m2-sawing-comparison-code`: At commit ba6c148, chainaxe_sawing_stat maps the displayed light/heavy saw rows to source profile overrides. default_melee_dps_stat endpoints 0.25 to 0.75 give t=0.55/0.65 for the 60%/80% comparison. Profile raw attack-power endpoints yield light active first saw 248/264 (160 to 320), light active final saw 465/495 (300 to 600), heavy active first saw 310/330 (200 to 400), and heavy active final saw 852.5/907.5 (550 to 1100). These are sawing profile attack-power parameters, not health damage or the ordinary light/heavy attack power rows. The player-facing weapon-info panel exposes the raw power_distribution.attack value through a default display row, with no scalar conversion, and formats it to two decimals; this is a source parameter, not health damage.

## Claim `darktide:claim:chainaxe:p1-m2-sawing-heavy-active-first-saw-80`

- Game release: `darktide:1.13.2`
- Property: `base_stats.chainaxe_sawing_stat.damage.action_heavy_1.overrides.heavy_chainaxe_active_sticky.targets[1].power_distribution.attack`
- Target: `darktide:1.13.2:darktide:weapon:chainaxe:p1-m2`
- Known value: `330` `attack-power-point`
- Basis: `code-derived`
- Review state: `approved`
- Context (JSON): `{"attackMode":"heavy","comparisonStat":{"decimal":"80","status":"known","unit":"percent"},"damageProfileRef":{"gameReleaseId":"darktide:1.13.2","recordId":"darktide:damage-profile:chainaxe-p1:heavy_chainaxe_active_sticky"},"profile":"heavy_chainaxe_active_sticky","weaponRef":{"gameReleaseId":"darktide:1.13.2","recordId":"darktide:weapon:chainaxe:p1-m2"},"weaponStat":"chainaxe_sawing_stat"}`
- Evidence:
  - `darktide:1.13.2:darktide:evidence:chainaxe:p1-m2-sawing-comparison-code`: At commit ba6c148, chainaxe_sawing_stat maps the displayed light/heavy saw rows to source profile overrides. default_melee_dps_stat endpoints 0.25 to 0.75 give t=0.55/0.65 for the 60%/80% comparison. Profile raw attack-power endpoints yield light active first saw 248/264 (160 to 320), light active final saw 465/495 (300 to 600), heavy active first saw 310/330 (200 to 400), and heavy active final saw 852.5/907.5 (550 to 1100). These are sawing profile attack-power parameters, not health damage or the ordinary light/heavy attack power rows. The player-facing weapon-info panel exposes the raw power_distribution.attack value through a default display row, with no scalar conversion, and formats it to two decimals; this is a source parameter, not health damage.

## Claim `darktide:claim:chainaxe:p1-m2-sawing-light-active-final-saw-60`

- Game release: `darktide:1.13.2`
- Property: `base_stats.chainaxe_sawing_stat.damage.action_left_down_light.overrides.light_chainaxe_active_sticky_last.targets[1].power_distribution.attack`
- Target: `darktide:1.13.2:darktide:weapon:chainaxe:p1-m2`
- Known value: `465` `attack-power-point`
- Basis: `code-derived`
- Review state: `approved`
- Context (JSON): `{"attackMode":"light","comparisonStat":{"decimal":"60","status":"known","unit":"percent"},"damageProfileRef":{"gameReleaseId":"darktide:1.13.2","recordId":"darktide:damage-profile:chainaxe-p1:light_chainaxe_active_sticky_last"},"profile":"light_chainaxe_active_sticky_last","weaponRef":{"gameReleaseId":"darktide:1.13.2","recordId":"darktide:weapon:chainaxe:p1-m2"},"weaponStat":"chainaxe_sawing_stat"}`
- Evidence:
  - `darktide:1.13.2:darktide:evidence:chainaxe:p1-m2-sawing-comparison-code`: At commit ba6c148, chainaxe_sawing_stat maps the displayed light/heavy saw rows to source profile overrides. default_melee_dps_stat endpoints 0.25 to 0.75 give t=0.55/0.65 for the 60%/80% comparison. Profile raw attack-power endpoints yield light active first saw 248/264 (160 to 320), light active final saw 465/495 (300 to 600), heavy active first saw 310/330 (200 to 400), and heavy active final saw 852.5/907.5 (550 to 1100). These are sawing profile attack-power parameters, not health damage or the ordinary light/heavy attack power rows. The player-facing weapon-info panel exposes the raw power_distribution.attack value through a default display row, with no scalar conversion, and formats it to two decimals; this is a source parameter, not health damage.

## Claim `darktide:claim:chainaxe:p1-m2-sawing-light-active-final-saw-80`

- Game release: `darktide:1.13.2`
- Property: `base_stats.chainaxe_sawing_stat.damage.action_left_down_light.overrides.light_chainaxe_active_sticky_last.targets[1].power_distribution.attack`
- Target: `darktide:1.13.2:darktide:weapon:chainaxe:p1-m2`
- Known value: `495` `attack-power-point`
- Basis: `code-derived`
- Review state: `approved`
- Context (JSON): `{"attackMode":"light","comparisonStat":{"decimal":"80","status":"known","unit":"percent"},"damageProfileRef":{"gameReleaseId":"darktide:1.13.2","recordId":"darktide:damage-profile:chainaxe-p1:light_chainaxe_active_sticky_last"},"profile":"light_chainaxe_active_sticky_last","weaponRef":{"gameReleaseId":"darktide:1.13.2","recordId":"darktide:weapon:chainaxe:p1-m2"},"weaponStat":"chainaxe_sawing_stat"}`
- Evidence:
  - `darktide:1.13.2:darktide:evidence:chainaxe:p1-m2-sawing-comparison-code`: At commit ba6c148, chainaxe_sawing_stat maps the displayed light/heavy saw rows to source profile overrides. default_melee_dps_stat endpoints 0.25 to 0.75 give t=0.55/0.65 for the 60%/80% comparison. Profile raw attack-power endpoints yield light active first saw 248/264 (160 to 320), light active final saw 465/495 (300 to 600), heavy active first saw 310/330 (200 to 400), and heavy active final saw 852.5/907.5 (550 to 1100). These are sawing profile attack-power parameters, not health damage or the ordinary light/heavy attack power rows. The player-facing weapon-info panel exposes the raw power_distribution.attack value through a default display row, with no scalar conversion, and formats it to two decimals; this is a source parameter, not health damage.

## Claim `darktide:claim:chainaxe:p1-m2-sawing-light-active-first-saw-60`

- Game release: `darktide:1.13.2`
- Property: `base_stats.chainaxe_sawing_stat.damage.action_left_down_light.overrides.light_chainaxe_active_sticky.targets[1].power_distribution.attack`
- Target: `darktide:1.13.2:darktide:weapon:chainaxe:p1-m2`
- Known value: `248` `attack-power-point`
- Basis: `code-derived`
- Review state: `approved`
- Context (JSON): `{"attackMode":"light","comparisonStat":{"decimal":"60","status":"known","unit":"percent"},"damageProfileRef":{"gameReleaseId":"darktide:1.13.2","recordId":"darktide:damage-profile:chainaxe-p1:light_chainaxe_active_sticky"},"profile":"light_chainaxe_active_sticky","weaponRef":{"gameReleaseId":"darktide:1.13.2","recordId":"darktide:weapon:chainaxe:p1-m2"},"weaponStat":"chainaxe_sawing_stat"}`
- Evidence:
  - `darktide:1.13.2:darktide:evidence:chainaxe:p1-m2-sawing-comparison-code`: At commit ba6c148, chainaxe_sawing_stat maps the displayed light/heavy saw rows to source profile overrides. default_melee_dps_stat endpoints 0.25 to 0.75 give t=0.55/0.65 for the 60%/80% comparison. Profile raw attack-power endpoints yield light active first saw 248/264 (160 to 320), light active final saw 465/495 (300 to 600), heavy active first saw 310/330 (200 to 400), and heavy active final saw 852.5/907.5 (550 to 1100). These are sawing profile attack-power parameters, not health damage or the ordinary light/heavy attack power rows. The player-facing weapon-info panel exposes the raw power_distribution.attack value through a default display row, with no scalar conversion, and formats it to two decimals; this is a source parameter, not health damage.

## Claim `darktide:claim:chainaxe:p1-m2-sawing-light-active-first-saw-80`

- Game release: `darktide:1.13.2`
- Property: `base_stats.chainaxe_sawing_stat.damage.action_left_down_light.overrides.light_chainaxe_active_sticky.targets[1].power_distribution.attack`
- Target: `darktide:1.13.2:darktide:weapon:chainaxe:p1-m2`
- Known value: `264` `attack-power-point`
- Basis: `code-derived`
- Review state: `approved`
- Context (JSON): `{"attackMode":"light","comparisonStat":{"decimal":"80","status":"known","unit":"percent"},"damageProfileRef":{"gameReleaseId":"darktide:1.13.2","recordId":"darktide:damage-profile:chainaxe-p1:light_chainaxe_active_sticky"},"profile":"light_chainaxe_active_sticky","weaponRef":{"gameReleaseId":"darktide:1.13.2","recordId":"darktide:weapon:chainaxe:p1-m2"},"weaponStat":"chainaxe_sawing_stat"}`
- Evidence:
  - `darktide:1.13.2:darktide:evidence:chainaxe:p1-m2-sawing-comparison-code`: At commit ba6c148, chainaxe_sawing_stat maps the displayed light/heavy saw rows to source profile overrides. default_melee_dps_stat endpoints 0.25 to 0.75 give t=0.55/0.65 for the 60%/80% comparison. Profile raw attack-power endpoints yield light active first saw 248/264 (160 to 320), light active final saw 465/495 (300 to 600), heavy active first saw 310/330 (200 to 400), and heavy active final saw 852.5/907.5 (550 to 1100). These are sawing profile attack-power parameters, not health damage or the ordinary light/heavy attack power rows. The player-facing weapon-info panel exposes the raw power_distribution.attack value through a default display row, with no scalar conversion, and formats it to two decimals; this is a source parameter, not health damage.

## Claim `darktide:claim:chainaxe:p1-movement-speed-on-activation-duration`

- Game release: `darktide:1.13.2`
- Property: `template.buff_override.active_duration`
- Target: `darktide:1.13.2:darktide:blessing-variant:chainaxe:p1-movement-speed-on-activation`
- Known value: `2` `s`
- Basis: `code-observed`
- Review state: `approved`
- Context (JSON): `{}`
- Evidence:
  - `darktide:1.13.2:darktide:evidence:chainaxe:p1-movement-speed-on-activation-code`: The fixed P1 traits table defines movement_speed values 0.17, 0.18, 0.19, and 0.2; each relevant override has active_duration = 2 (lines 119-143). This supports the literal template parameter only and does not establish actual in-game effect duration.

## Claim `darktide:claim:chainaxe:p1-movement-speed-on-activation-tier1-display-percent`

- Game release: `darktide:1.13.2`
- Property: `description.format_values.movement_speed.defined_tier_1_display_percent`
- Target: `darktide:1.13.2:darktide:blessing-variant:chainaxe:p1-movement-speed-on-activation`
- Known value: `17` `percent`
- Basis: `code-derived`
- Review state: `approved`
- Context (JSON): `{}`
- Evidence:
  - `darktide:1.13.2:darktide:evidence:chainaxe:p1-movement-speed-on-activation-code`: The fixed P1 traits table defines movement_speed values 0.17, 0.18, 0.19, and 0.2; each relevant override has active_duration = 2 (lines 119-143). This supports the literal template parameter only and does not establish actual in-game effect duration.
  - `darktide:1.13.2:darktide:evidence:chainaxe:p1-movement-speed-on-activation-tier1-display-percent-code`: The fixed trait definition configures movement_speed as a percentage format with a + prefix and its defined tier 1 is 0.17. The pinned trait value parser applies default percentage scaling because no custom value manipulation is configured, so the description-format value is 17 percent. This covers defined tier 1 only, not verified obtainable or game-tested; runtime movement outcome and localized-description compatibility are unverified.

## Claim `darktide:claim:chainaxe:p1-movement-speed-on-activation-tier2-display-percent`

- Game release: `darktide:1.13.2`
- Property: `description.format_values.movement_speed.defined_tier_2_display_percent`
- Target: `darktide:1.13.2:darktide:blessing-variant:chainaxe:p1-movement-speed-on-activation`
- Known value: `18` `percent`
- Basis: `code-derived`
- Review state: `approved`
- Context (JSON): `{}`
- Evidence:
  - `darktide:1.13.2:darktide:evidence:chainaxe:p1-movement-speed-on-activation-code`: The fixed P1 traits table defines movement_speed values 0.17, 0.18, 0.19, and 0.2; each relevant override has active_duration = 2 (lines 119-143). This supports the literal template parameter only and does not establish actual in-game effect duration.
  - `darktide:1.13.2:darktide:evidence:chainaxe:p1-movement-speed-on-activation-tier2-display-percent-code`: The fixed trait definition configures movement_speed as a percentage format with a + prefix; its defined tier 2 is 0.18. The pinned trait value parser applies default percentage scaling with no custom value manipulation for this descriptor, so the description-format value is 18 percent. This covers defined tier 2 only, not verified obtainable or game-tested; runtime movement outcome and localized-description compatibility are unverified.

## Claim `darktide:claim:chainaxe:p1-movement-speed-on-activation-tier3-display-percent`

- Game release: `darktide:1.13.2`
- Property: `description.format_values.movement_speed.defined_tier_3_display_percent`
- Target: `darktide:1.13.2:darktide:blessing-variant:chainaxe:p1-movement-speed-on-activation`
- Known value: `19` `percent`
- Basis: `code-derived`
- Review state: `approved`
- Context (JSON): `{}`
- Evidence:
  - `darktide:1.13.2:darktide:evidence:chainaxe:p1-movement-speed-on-activation-code`: The fixed P1 traits table defines movement_speed values 0.17, 0.18, 0.19, and 0.2; each relevant override has active_duration = 2 (lines 119-143). This supports the literal template parameter only and does not establish actual in-game effect duration.
  - `darktide:1.13.2:darktide:evidence:chainaxe:p1-movement-speed-on-activation-tier3-display-percent-code`: The fixed trait definition configures movement_speed as a percentage format with a + prefix; its defined tier 3 is 0.19. The pinned trait value parser applies default percentage scaling with no custom value manipulation for this descriptor, so the description-format value is 19 percent. This covers defined tier 3 only, not verified obtainable or game-tested; runtime movement outcome and localized-description compatibility are unverified.

## Claim `darktide:claim:chainaxe:p1-movement-speed-on-activation-tier4-display-percent`

- Game release: `darktide:1.13.2`
- Property: `description.format_values.movement_speed.defined_tier_4_display_percent`
- Target: `darktide:1.13.2:darktide:blessing-variant:chainaxe:p1-movement-speed-on-activation`
- Known value: `20` `percent`
- Basis: `code-derived`
- Review state: `approved`
- Context (JSON): `{}`
- Evidence:
  - `darktide:1.13.2:darktide:evidence:chainaxe:p1-movement-speed-on-activation-code`: The fixed P1 traits table defines movement_speed values 0.17, 0.18, 0.19, and 0.2; each relevant override has active_duration = 2 (lines 119-143). This supports the literal template parameter only and does not establish actual in-game effect duration.
  - `darktide:1.13.2:darktide:evidence:chainaxe:p1-movement-speed-on-activation-tier4-display-percent-code`: The fixed trait definition configures movement_speed as a percentage format with a + prefix; its defined tier 4 is 0.2. The pinned trait value parser applies default percentage scaling with no custom value manipulation for this descriptor, so the description-format value is 20 percent. This covers defined tier 4 only, not verified obtainable or game-tested; runtime movement outcome and localized-description compatibility are unverified.

## Claim `darktide:claim:psyker:brain-burst-improved-description-display-percent`

- Game release: `darktide:1.13.2`
- Property: `description.format_values.damage.display_percent`
- Target: `darktide:1.13.2:darktide:skill:psyker:brain-burst-improved`
- Known value: `50` `percent`
- Basis: `code-derived`
- Review state: `approved`
- Context (JSON): `{}`
- Evidence:
  - `darktide:1.13.2:darktide:evidence:psyker:brain-burst-improved-smite-damage-multiplier-code`: At the fixed upstream commit, the psyker_brain_burst_improved template assigns the code literal 1.5 to stat_buffs[stat_buffs.smite_damage_multiplier]. This evidence supports only the parameter value; downstream damage outcome and runtime application are unverified.
  - `darktide:1.13.2:darktide:evidence:psyker:brain-burst-improved-description-display-percent-code`: The talent definition binds the improved brain-burst description's damage format value to smite_damage_multiplier and applies (value - 1) * 100; the pinned talent layout parser renders the percentage with its configured prefix. With source parameter 1.5, the description-format value is 50 percent. This is a code-derived display parameter, not a final damage value; Steam build and localized-description compatibility are unverified.

## Claim `darktide:claim:psyker:brain-burst-improved-normal-charge-base-time`

- Game release: `darktide:1.13.2`
- Property: `action.psyker_smite.action_charge_target.default_charge_time`
- Target: `darktide:1.13.2:darktide:skill:psyker:brain-burst-improved`
- Known value: `3` `s`
- Basis: `code-observed`
- Review state: `approved`
- Context (JSON): `{}`
- Evidence:
  - `darktide:1.13.1:darktide:evidence:psyker:brain-burst-improved-normal-charge-base-time-legacy-analysis`: The archived analysis records a 3-second normal-charge default when smite_attack_speed=1. Under the described non-target-locked update conditions, charging and Peril can begin before a valid target is acquired. This is a template-level observation, not a universal runtime time.
  - `darktide:1.13.1:darktide:evidence:psyker:brain-burst-improved-lock-on-charge-legacy-analysis`: A fresh lock-on charge requires a valid Smite target and uses the normal 3-second default. Chaining can preserve current charge level, while changing the target resets the charge timer. If a target supports Smite stagger, more than 0.25 seconds locked applies one small stagger; these are bounded branch observations, not universal runtime timing.
  - `darktide:1.13.1:darktide:evidence:psyker:brain-burst-improved-combined-charge-and-peril-example-legacy-analysis`: Under the archived no-buff assumptions with smite_attack_speed=1, full charge is estimated at 20% Peril; a successful hit adds the 25% base cost for 45% total. Holding full charge for another second adds 9%/s. These are template-based estimates, not measured runtime outcomes.

## Claim `darktide:claim:psyker:brain-burst-improved-smite-damage-multiplier`

- Game release: `darktide:1.13.2`
- Property: `template.stat_buffs.smite_damage_multiplier`
- Target: `darktide:1.13.2:darktide:skill:psyker:brain-burst-improved`
- Known value: `1.5` `ratio`
- Basis: `code-observed`
- Review state: `approved`
- Context (JSON): `{}`
- Evidence:
  - `darktide:1.13.2:darktide:evidence:psyker:brain-burst-improved-smite-damage-multiplier-code`: At the fixed upstream commit, the psyker_brain_burst_improved template assigns the code literal 1.5 to stat_buffs[stat_buffs.smite_damage_multiplier]. This evidence supports only the parameter value; downstream damage outcome and runtime application are unverified.
  - `darktide:1.13.2:darktide:evidence:psyker:brain-burst-improved-smite-damage-calculation-code`: At the fixed upstream commit, the damage calculation checks damage_type == damage_types.smite, reads attacker_stat_buffs.smite_damage_multiplier on that branch, and multiplies the parameter into damage_multiplier (lines 506-514). This records the bounded conditional and multiplication relation only; other calculation stages and final damage are not resolved.
  - `darktide:1.13.2:darktide:evidence:psyker:smite-action-damage-type-code`: At the fixed upstream commit, the psyker_smite_kill damage target in the psyker_smite action uses damage_types.smite (lines 538-562). This links the selected action to the shared calculation branch condition only; it does not establish runtime resolution or final damage.
  - `darktide:1.13.1:darktide:evidence:psyker:brain-burst-improved-legacy-analysis-smite-damage-multiplier`: The archived analysis identifies a 1.5 Smite damage multiplier and relates it to the Smite-only calculation branch. This is a bounded parameter relationship, not a final-damage result.

## Claim `darktide:claim:psyker:brain-burst-improved-sticky-charge-base-time`

- Game release: `darktide:1.13.2`
- Property: `action.psyker_smite.action_charge_target_sticky.charge_time`
- Target: `darktide:1.13.2:darktide:skill:psyker:brain-burst-improved`
- Known value: `2` `s`
- Basis: `code-observed`
- Review state: `approved`
- Context (JSON): `{}`
- Evidence:
  - `darktide:1.13.1:darktide:evidence:psyker:brain-burst-improved-sticky-charge-base-time-legacy-analysis`: The archived analysis records a 2-second sticky charge when smite_attack_speed=1, after acquiring a valid lockable target; target-locked mode cannot precharge or switch targets while the lock is maintained. If the target supports Smite stagger, maintaining the lock for 1 second applies one small stagger.
  - `darktide:1.13.1:darktide:evidence:psyker:brain-burst-improved-combined-charge-and-peril-example-legacy-analysis`: Under the archived no-buff assumptions with smite_attack_speed=1, full charge is estimated at 20% Peril; a successful hit adds the 25% base cost for 45% total. Holding full charge for another second adds 9%/s. These are template-based estimates, not measured runtime outcomes.

## Claim `darktide:claim:psyker:brain-burst-improved-successful-hit-base-peril-ratio`

- Game release: `darktide:1.13.2`
- Property: `charge_template.psyker_smite_use_power.warp_charge_percent`
- Target: `darktide:1.13.2:darktide:skill:psyker:brain-burst-improved`
- Known value: `0.25` `ratio`
- Basis: `code-observed`
- Review state: `approved`
- Context (JSON): `{}`
- Evidence:
  - `darktide:1.13.1:darktide:evidence:psyker:brain-burst-improved-successful-hit-base-peril-legacy-analysis`: The archived analysis records a 0.25 base Peril parameter paid only after successful damage; empty casts and misses do not enter that payment branch. The described payment is independent of charge level because the template does not enable use_charge.
  - `darktide:1.13.1:darktide:evidence:psyker:brain-burst-improved-combined-charge-and-peril-example-legacy-analysis`: Under the archived no-buff assumptions with smite_attack_speed=1, full charge is estimated at 20% Peril; a successful hit adds the 25% base cost for 45% total. Holding full charge for another second adds 9%/s. These are template-based estimates, not measured runtime outcomes.
