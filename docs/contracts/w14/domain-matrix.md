# W14 domain and migration coverage matrix

This generated matrix inventories the fixed current package, archived Extension inputs, W03 scope, registry, history, and scoped Mods outcomes. It is an audit locator; it does not create approvals or claim registry player availability.

## Current reviewed package

- Game release: `darktide:1.13.2` (build 25681127).
- Runtime content version: `1.13.2.2`; data revision `82b79e47e88717b4237655fe4909f0754bac18238c3a23530b985effd60f3130`; manifest SHA-256 `29eeab431bba18dace68ade5f057183f99e23cc3419a22c0c08b0d7096d4a3a6`.
- Source review basis: `83e70e7946bd13738ea97ec6731daeb4df5eb42edec8e1e819f428ee2197005d`; source technical packet SHA-256 `052514ee1a1dc8d4754189f3ca1c3dbc626b1e7577b282b3de001f03ed459dd2`; 817 current Source targets (6 target receipts are 1.13.1 history).
- W13 prepared candidate is pinned at 100e3c0339078b5ed985e103d0ead818c361feb9:content/contracts/w09/prepared/w09-1a09e5ffcc1daf5358d2692b9234c9db/candidate.json, is publicationEligible=false, and is not a selection or publication action.
- The pinned candidate records 903 approved targets from 908 receipts (823 Source targets, including history, and 80 Web targets); it remains candidate-only.

| Core domain | Source records | Current record copies | Web presentations | Term localizations | Web review targets | Raw SHA-256 |
| --- | --- | --- | --- | --- | --- | --- |
| skills | 19 | 13 | 1 | 0 | 17 | 108628d9c9262541bd95741fcc0ef52b08ff874d02ce11eb0684bb52ef6da449 |
| blessings | 14 | 14 | 1 | 0 | 14 | 3e72d21be03b7beb966558665b7a4eb3fb389ea23fab8cf7c1cf722a409b22b5 |
| weapons | 207 | 207 | 3 | 0 | 46 | 132ec16e830d4af560bd212095f4fa0209bc8f238eb17a26528e112e6ebd41a8 |
| terms | 19 | 13 | 0 | 1 | 3 | 602cb6aca68e6add34aaa8eb0552efbba66324a97e7c4fbc406f03c0932b78f6 |

| Shared domain | Player display owner identities | Term localization identities |
| --- | --- | --- |
| skills | web:presentation:psyker-brain-burst-improved → darktide:skill:psyker:brain-burst-improved | none |
| blessings | web:presentation:chainaxe-p1-movement-speed → darktide:blessing:chainaxe:p1-movement-speed-on-activation | none |
| weapons | web:presentation:chainaxe-p1-m1 → darktide:weapon:chainaxe:p1-m1; web:presentation:chainaxe-p1-m2 → darktide:weapon:chainaxe:p1-m2; web:presentation:lasgun-p1-m1 → darktide:weapon:lasgun:p1-m1 | none |
| terms | none | web:term-localization:psyker-smite-damage-multiplier-parameter → darktide:term:psyker:smite-damage-multiplier-parameter |

The four domains contain 259 Source record copies and 236 unique release-qualified records (230 current and 6 other-release records). The exact identity inventory is in the JSON matrix.

W03 current-candidate reconciliation: 7408 rows (6840 Source / 568 Web); 0 unresolved rows in the fixed reconciliation reports and 17 announcement rows deferred to W15. This result is limited to the frozen W03 current-candidate scope.

The W03 weapon registry has 57 groups and 203 members. Three members match exact current Source `payload.templateKey` identities and have pinned approved digest evidence. The remaining 200 are registry-only in this package; this matrix does not infer game absence or player availability.

## Archived Extension domains

The 26-file and nine-file Extension batches are exact pinned-object preservation archives owned by Source. They are not current approval or an inferred snapshot mapping. The per-file list records every source hash and only provenance fields actually present in each archived input.

| Archive | Files | Raw bytes | W03 rows | Manifest SHA-256 |
| --- | --- | --- | --- | --- |
| fixed 26-file W03 Extension input archive | 26 | 92749157 | 1135823 | ba113ea0bde0cecb538505e48361036f1fdc6894aee75be03e49e0a88e95ddc2 |
| fixed nine-file additional W03 Extension input archive | 9 | 8075596 | 100477 | 6b685565b73d1f13c11c21c7a1928c9c035f7f67f014d29711ed46599f3369fd |

| Archived Extension input | Input role | Version evidence | W03 rows | Raw SHA-256 |
| --- | --- | --- | --- | --- |
| data/v1/blessing-comparisons.json | historical-extension-data-input | explicit-historical-1.13.1-declaration | 24460 | 46b7bc155c12ac1700b3e08a055f2dea51fe954ba9918b44108c0e310403e160 |
| data/v1/blessing-mechanics.json | historical-extension-data-input | explicit-1.13.1-player-guide-approval-dependency | 1966 | 4b06b82c451c7a5ee33b7aa60bf53e3429efb99aadb47b731611a649617b2f01 |
| data/v1/catalog.json | historical-catalog-or-class-input | explicit-historical-1.13.1-declaration | 66199 | f4e06f7e5e2bfa5422621634611f2362a88abf6f063a8f8f13704456b0b9b795 |
| data/v1/class-overview.json | historical-catalog-or-class-input | no-explicit-1.13.1-declaration-in-scanned-provenance-fields | 164 | 037dd24d8e8c7d14028b700d89965f35f46abfea0fdda5c71f7b91dc05f64ba6 |
| data/v1/closure/weapon-actions.catalog.json | historical-domain-closure-or-proposal-input | explicit-historical-1.13.1-declaration | 9911 | 0ae662bb67672811949bab49f4959bce1ce9ebd12ffb410b9396bd26e036c2b5 |
| data/v1/closure/weapons.json | historical-domain-closure-or-proposal-input | explicit-historical-1.13.1-declaration | 2508 | 18d3d02e43c9e1af973dbc2d2db17c81d01e925b9a011fdb94ecc6654082ee59 |
| data/v1/domains/abilities.json | historical-extension-domain-input | explicit-historical-1.13.1-declaration | 116047 | b3836da3dd66adf0b4cbc27aa70182acc8ef7799996df7bb64becebda3edd6e3 |
| data/v1/domains/blessings.json | historical-extension-domain-input | explicit-historical-1.13.1-declaration | 417661 | 18bf41aaa7e2ea7e68be5dc57e12c66db634dc3cf5803c3778e5abcd4fdf55b6 |
| data/v1/domains/curios.json | historical-extension-domain-input | explicit-historical-1.13.1-declaration | 2310 | 80a439bfe03f841cfd53379592c03aa5cb1f11d74492ad6c7ecdc8b136d96fb8 |
| data/v1/domains/weapons.json | historical-extension-domain-input | explicit-historical-1.13.1-declaration | 98386 | ad469b01caafe62ce7835725e684a2c64d527bb0df3c5d3b2340d8fdb6099341 |
| data/v1/mechanics/abilities.json | historical-mechanics-or-review-support-input | explicit-historical-1.13.1-declaration | 100036 | b13f7beac5add5a5b6d5c89a8bc0b7b51b5254a858649615b6a61435113deb42 |
| data/v1/mechanics/catalog-document-bindings.proposal.json | historical-mechanics-or-review-support-input | explicit-historical-1.13.1-declaration | 905 | 900d9facb0d853b8bc17f086a2f29d0c8ea1f2d85856aa49db7b49ff4652f156 |
| data/v1/mechanics/player-guides.json | historical-player-guide-input | no-explicit-1.13.1-declaration-in-scanned-provenance-fields | 14517 | 520c6407844cad1b124828d483d7c70b9f4580aee5f5d5a7d6645e89b2fc08a1 |
| data/v1/mechanics/reviewed-abilities.json | historical-mechanics-or-review-support-input | explicit-1.13.1-player-guide-approval-dependency | 127126 | 0627d999010b6d42e305f0d692c3535c5833515cee58bdfec166c8f574d95b50 |
| data/v1/review-approvals.json | historical-review-receipt-input-not-carried-forward | no release declaration or separately pinned version dependency | 10624 | bfcd3ba5c2eb6b93ad6433cb8842d7d6932c54d37eb3b3548bf435d6594e8952 |
| data/v1/weapon-actions.json | historical-weapon-action-input | explicit-historical-1.13.1-declaration | 103930 | 68fed6f3303ab8ad303cf14851bf8187c61dc76e6c88c94fbc489804f4a9340b |
| data/v1/website-display.json | historical-website-display-or-token-input | explicit-historical-1.13.1-declaration | 2223 | d1b444b873a5df8c274dfe8673007d48739e2b18a778fb5d8af6e0b9a1910e9b |
| data/v1/website-token-corrections.json | historical-website-display-or-token-input | no-explicit-1.13.1-declaration-in-scanned-provenance-fields | 102 | 1fdf935b6afc75da769dac2611491f6d77a5fe8c7440a6c00b54cfdf4ba50555 |
| docs/V1_ACTIONS_GAPS_REVIEW.json | historical-review-document-input-body-not-republished | no release declaration or separately pinned version dependency | 5980 | 3f685818c5ad079914b7dfeeec268d077d8c79a74632ece63734c22cb4390173 |
| docs/V1_BLESSINGS_43_CANDIDATES_REVIEW.json | historical-review-document-input-body-not-republished | no release declaration or separately pinned version dependency | 14783 | 31c490d1844b215462e76a1e98a7a270a61f8cbb1a6b51460e26fafcf3808427 |
| docs/V1_BLESSINGS_43_CROSS_REVIEW.json | historical-review-document-input-body-not-republished | no release declaration or separately pinned version dependency | 2892 | 3d841aef3c96b1b5f4f7cc8174bd567ec7f69954b7eda8c476bf08aa744de7b1 |
| docs/V1_BLESSING_MECHANICS_REVIEW.json | historical-review-document-input-body-not-republished | no release declaration or separately pinned version dependency | 2760 | c75756be633517c1511b2796b4518d7416d9e45368a7a2e439bedc0926470f1d |
| docs/V1_CATALOG_DOCUMENT_BINDINGS_CROSS_REVIEW.json | historical-review-document-input-body-not-republished | no release declaration or separately pinned version dependency | 272 | 33f8b67d2aece38c392621318bec05436b8967b9821dca84b0f481ffa9bc34d0 |
| docs/V1_NON_BLESSING_GAPS_CROSS_REVIEW.json | historical-review-document-input-body-not-republished | no release declaration or separately pinned version dependency | 2748 | 67e12f71ca9bbb467fd8588bba795197e1491b73e67301204d9e651172956baa |
| docs/V1_NON_BLESSING_GAPS_REVIEW.json | historical-review-document-input-body-not-republished | no release declaration or separately pinned version dependency | 5064 | 4d8961af47453220fe6ae50a40cc552099ee6c41e5da3be00cae430d21ed760b |
| docs/V1_WEBSITE_DISPLAY_INDEPENDENT_REVIEW.json | historical-review-document-input-body-not-republished | no release declaration or separately pinned version dependency | 2249 | dbf51d910940c05ae2ad984916270b62e55a8b0cc0135fecdfd791828322275a |
| data/v1/closure/abilities.json | historical-domain-closure-or-proposal-input | explicit-historical-1.13.1-declaration | 740 | 86a3bcd532aee4fc62ad73d1a58c20e8bf25f103c2de53ef48231bf02e78d93a |
| data/v1/closure/blessings.json | historical-domain-closure-or-proposal-input | no-explicit-1.13.1-declaration-in-scanned-provenance-fields | 14926 | 2807d50d88985fa4260a91c0e47ff499177b725583f7dca9c4097c208c9b633f |
| data/v1/closure/curios.json | historical-domain-closure-or-proposal-input | explicit-historical-1.13.1-declaration | 278 | 594566268305e6a882da83744837b7abeba763daee7bc7f5315ef5d37a5fab84 |
| data/v1/closure/weapons-derived-proposal.json | historical-domain-closure-or-proposal-input | explicit-historical-1.13.1-declaration | 2508 | 18d3d02e43c9e1af973dbc2d2db17c81d01e925b9a011fdb94ecc6654082ee59 |
| data/v1/mechanics/reviewed-abilities-a.json | historical-mechanics-or-review-support-input | explicit-historical-1.13.1-declaration | 33583 | c2fecf438ae648243bdd2fd1087a7a08c4ece4387b09e3b4bae64ce210f29222 |
| data/v1/mechanics/reviewed-abilities-b.json | historical-mechanics-or-review-support-input | explicit-historical-1.13.1-declaration | 23556 | 6a383e71624c9b5bbe155216ac80944b843df9b0b92e826eac6a2df1e8981729 |
| data/v1/mechanics/reviewed-abilities-corrections.json | historical-mechanics-or-review-support-input | explicit-historical-1.13.1-declaration | 1628 | 27d81184660c4648a2caa7da2c179d8ae84fd162ada98fb3991c92f54217de9e |
| data/v1/mechanics/reviewed-abilities-d.json | historical-mechanics-or-review-support-input | explicit-historical-1.13.1-declaration | 22641 | 15524fba45e01dafdee4fc1b77345196387ad5cd7aa1f4e606334f4a4a0e573a |
| data/v1/mechanics/reviewed-abilities-focused.json | historical-mechanics-or-review-support-input | explicit-historical-1.13.1-declaration | 617 | 5ea5b2881dd47222327092ce6f6c6a180c5122d999afa68a177b4c5c465f16b9 |

The historical player-guides inventory has 631 rows: 618 ability guides depend on the fixed reviewed-abilities SHA-256 and 13 blessing guides depend on the fixed blessing-mechanics SHA-256. Both dependencies declare SteamBuild_25606770_1.13.1; this is historical, not current approval. Guide text is not duplicated in this matrix.

Five hardcoded-content rows remain exact pinned Extension source-code references with no formal gameReleaseId; they are not current translated records.

## W03 A ledger and Mods ledger

| W03 A group | Rows | Source paths |
| --- | --- | --- |
| extension-additional-data | 100477 | 9 |
| extension-hardcoded-content-candidates | 5 | 2 |
| extension-release-inputs | 1136081 | 27 |
| extension-runtime-code | 8 | 8 |
| extension-runtime-config | 18 | 1 |
| extension-runtime-generated | 1 | 1 |
| extension-runtime-native-rules | 589 | 1 |
| extension-runtime-static-data | 295 | 1 |
| source-code-registry | 260 | 1 |
| source-formal-contract | 1770 | 2 |
| source-legacy-psyker | 382 | 4 |
| source-w01-candidates | 3584 | 3 |
| source-w01-review | 147 | 2 |
| web-published | 68039 | 1 |
| web-source-cache | 3 | 3 |
| web-source-lock | 9 | 1 |
| web-w01-inputs | 3988 | 7 |

| Mods group | Rows | Source paths | W14 disposition |
| --- | --- | --- | --- |
| K01 | 1090 | 1090 | kept-at-original-mods-owner |
| K02 | 4 | 4 | kept-at-original-mods-owner |
| M01 | 107060 | 3071 | archived-readable |
| M02 | 78489 | 78489 | private-restorable |
| M03 | 3 | 3 | private-restorable |
| M04 | 522 | 522 | private-restorable |
| M05 | 1291 | 5 | deferred-w15 |
| M06 | 771 | 6 | deferred-w15 |
| M07 | 8 | 8 | deferred-w15 |
| M08 | 2623 | 62 | deferred-w15 |

The public M01 archive holds 3,071 files / 107,060 W03 rows. M02/M03/M04 have a restricted preservation archive for 79,014 paths; all archive/file hashes and fixed tree membership were verified, with 11 fresh sample restores. The receipt explicitly does not claim a full restore. M05–M08 are deferred to W15; K01/K02 remain at the fixed Mods owner.

## Historical Web player index

The read-only /history/1.13.1 projection binds to Web commit 61f1dcda6cb80fb1ee2bf595b3b9a082825a912f, original source content SHA-256 3f3c24874004d67aa7e03b045ca5f9a7409a0bea3e9136247852c26ec2c34bcc, and player-index SHA-256 0a9d143d7174f7516bd59b0928c4e06b372480e408ffe7e2fe52f4906a34c6bb. The source inventory is 646 skills, 70 weapons, 167 blessings, 135 marks, and 605 variants. The Traditional Chinese player projection contains 645 skills, 68 weapons, 167 blessings, 132 marks, and 605 variants; 6 entries without a verified Traditional Chinese name are excluded and listed in the manifest.

## Scope limits

- The matrix reconciles the frozen W03 scope and current reviewed package; it does not claim the full game catalog is covered by the 260-entry registry or the 230 current Source records.
- Historical Extension inputs without an explicit version declaration remain version-unspecified; filenames and similar text are not used to assign a game release.
- No W15–W17 content is migrated here. The overlay manifest and per-row dispositions are generated separately.
