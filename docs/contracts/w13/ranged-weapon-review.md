# W13 ranged weapon Web review candidate

This document records the bounded `lasgun_p1_m1` Web candidate. It is pending human review and is not eligible for publication. No review receipt was created for the new candidate targets.

## Official name excerpt

The safe excerpt set is `w13-safe-official-locale-excerpts/1` (SHA-256 `3ace691c5ba1757ff143fca04718e991226b4a0ace871e6a87a4759e51aabeae`), from W04 batch `w04-25681127-20261018-9449f844838349d381c159226c56333b`. The Web official-input schema preserves the locale, key, hash, occurrence, and exact text; the excerpt record below also preserves the original export and entry indices for review.

| Locale | Resource | Key | Source hash | Occurrence | Entry index | Exact text | Text SHA-256 | Raw export SHA-256 |
| --- | --- | --- | --- | ---: | ---: | --- | --- | --- |
| en | items | `loc_weapon_family_lasgun_p1_m1` | `f93eef0d` | 1 | 12917 | `Infantry Lasgun` | `0f1b380b08bacd883d5bf730d5ff6157fbbc098af72be2256f6482bbf335bf01` | `89ac19b4de3f0b606e67b550e87a08c92d32d65d37fe3caea35f41b3169f37c1` |
| zh-TW | items | `loc_weapon_family_lasgun_p1_m1` | `f93eef0d` | 1 | 12913 | `步兵鐳射槍` | `691dfad2b858feab456f55f3466c9f0acfa72c8506e7c0c80fa0134b2ee4902a` | `8bf8909f538842782d1158a603f9511cd44a02f1ac083cf9c938918e406a9710` |

The official Traditional Chinese family text is **步兵鐳射槍**. `lasgun_p1_m1` is retained as a Source model token; this candidate does not establish a Games Lantern page identity or an official Roman mark name.

## Source-backed display scope

The fixed Source inputs are from Darktide-Source-Data commit `980a32bd620bf4456ddbc3fbd1a9a6453a11f426`, game release `darktide:1.13.2`. They support these presentation facts without running game code:

- `hipfire` / `ads` display as 腰射 / 機瞄; the Source fire mode `semi_auto` displays as 半自動.
- The source rows preserve ammunition usage, permission to fire with less than the required amount, action total time, action continuation time, flashlight activation time, and the `hitscan_templates...range` value. The range is shown without a unit.
- The two ammo stat definitions and curves are resolved through typed refs. Template endpoints 80/120 and 480/960 remain distinct from the Source's unknown player-obtainable range.
- `statSections` is empty because this weapon has no `statBindings`. The authoring validator still requires exact equality with any Source stat-binding groups, and the view reads the separate `statRefs` definitions directly.
- High-level action resolution and target applicability stay explicitly `NOT_IMPORTED`. The Web candidate does not infer a complete action graph or enemy coverage.

The W07 authoring overlay keeps the previous 38 approved targets and receipts unchanged. The new eight target rows (official name inputs, display labels, and two attack-profile bindings) are pending. The candidate's `publicationEligible` remains `false`.

## Fixed candidate cache and review loader

The reproducible pending package is `content/contracts/w13/ranged-candidate/`, pinned by `candidate-lock.json` SHA-256 `f9ff054b49cf341050d006067d00020eca28dad5ae869905842ddc9479f30329`. It contains the exact Source 980 owner contract and W09 candidate technical contract, the original W09 manifest/receipt/revision files, 16 Base64-preserved public-code source files, the two selected W04 family-name excerpts, the W07 Web candidate, and a cached copy of the historical selected-composition pointer.

The cached selected-composition pointer is pinned to its original path `content/contracts/w09/source-handoff/selected.json`, commit `ab5b5b336e4d0501b8b1fd8eda21b60178e64cb9`, and SHA-256 `10581f7c753f6a0147897841f603d4b5191b00aa6726cdad45d49bedbfdd9bf2`. The loader reads this cached historical snapshot and its immutable W09 request lock, so later changes to the live selected pointer do not change this review candidate. That request lock pins both existing Web overlays. The loader uses its immutable W06 overlay with all 34 current targets approved by the existing review API and all 39 historical receipts preserved. The W07 overlay retains its 38 approved targets and 38 receipts; the new W13 presentation has eight targets and zero receipts in this candidate.

Run `node scripts/content/w13-ranged-preview.mjs` from the Web checkout to verify cache bytes, Source schema and validator, original Source packet metadata, public-code Git blob hashes, exact W06/W07 overlays, Web authoring, and existing review states. This is the pure input validation step. It records the current W08 baseline/compiler lock hashes but does not claim those old pins bind this W13 candidate, and it does not compile or create a release artifact. Root will refresh and verify the normal W08 locks after the final code SHA before using the existing W09 projection and W08 candidate APIs.

## Normal compiler handoff required

The Web contract accepts empty `weaponView.statSections` only when they exactly match the Source groups. It also accepts an absent high-level action graph only for supported ranged modes whose weapon and profiles explicitly mark that field `NOT_IMPORTED`; present graphs retain the existing strict checks. W07 review reporting preserves valid existing receipts. The changed compiler file is `scripts/content/contract-authoring.mjs`, one of the four files in the W08 compiler file set. `content/schema/v2/web-authoring.schema.json` is an input-pinned authoring schema. The implementation step leaves the W08 compiler/input locks, selected lock, and historical composition pin for the subsequent normal pin operation. No provenance guard is bypassed.
