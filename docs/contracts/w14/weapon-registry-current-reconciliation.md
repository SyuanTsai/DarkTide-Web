# W14 Source weapon registry reconciliation

This report binds every entry in the frozen W03 `source-code-registry` shard to its original entry ID, selector, fragment digest, Source-Code blob, and the reviewed 1.13.2 Source package. The row-level evidence is in [`weapon-registry-current-reconciliation.json`](./weapon-registry-current-reconciliation.json).

## Fixed inputs

- W03 ledger SHA-256: `bdf4b02c278e9dafef9aea00ac8263fe7929b29e9dc0eb90325cf7c55daa2288`.
- Registry shard: `docs/contracts/w03/extension/source-code-registry-0001.json`, 260 entries, container SHA-256 `8dff6d52f00a6a65f1ae7c6d92439ebafbcde720c8775e30da5791e2076b23a7`.
- Source-Code input: [`weapon_templates.lua`](https://github.com/Aussiemon/Darktide-Source-Code/blob/ba6c148f3c2768ca3ce20d846a12e56e2f433f3e/scripts/settings/equipment/weapon_templates/weapon_templates.lua), commit `ba6c148f3c2768ca3ce20d846a12e56e2f433f3e`, Git blob `b6bf7f855140e84803456f178c1cd23460ce90c4`, raw SHA-256 `5694a180ae752a777368cbed441a1dd76fc457a4bfbe8cc1c0e3a760d08f0feb`, 16,928 bytes. All 260 W03 raw fragments were checked against this blob.
- Reviewed Source package: game release `darktide:1.13.2`, source revision `83e70e7946bd13738ea97ec6731daeb4df5eb42edec8e1e819f428ee2197005d`, candidate content version `1.13.2.1`, data revision `82b79e47e88717b4237655fe4909f0754bac18238c3a23530b985effd60f3130`. Its raw `technical.json` SHA-256 is `052514ee1a1dc8d4754189f3ca1c3dbc626b1e7577b282b3de001f03ed459dd2`; the fixed selected-composition evidence SHA-256 is `138975701c5c9a79357067395f96b94fafbe19e51e598fb1b61342b0a9e029a2` and input digest is `5768163ffa9cbd1ecfbadf07fcc99c42a708a66348fa8bdd61bc590a05a032e6`.
- The currently deployed 1.13.2.2 manifest (`29eeab431bba18dace68ade5f057183f99e23cc3419a22c0c08b0d7096d4a3a6`) carries the same data revision. The package review evidence is therefore tied by release and data revision; the report does not claim that `1.13.2.1` is the active content version.

## Reconciliation result

- The shard contains 57 group rows and 203 member rows. `unarmed` appears once as a group key and once as a member key; both W03 entry IDs and selectors are retained.
- Three member keys match exact `payload.templateKey` values in the reviewed current Source package: `chainaxe_p1_m1`, `chainaxe_p1_m2`, and `lasgun_p1_m1`. Their records have 9, 9, and 5 selected Source review targets respectively. Each target and dependency digest was recomputed with the Source validator and matched the fixed selected-composition evidence.
- Those three rows join to `darktide:weapon:chainaxe:p1-m1`, `darktide:weapon:chainaxe:p1-m2`, and `darktide:weapon:lasgun:p1-m1`. Their parent groups `chain_axes` and `lasguns` are linked by the W03 selector indices; the group rows remain `gameReleaseId: null` because the registry does not assign release identity to groups.
- The remaining 200 member entries have no exact current weapon record in this reviewed Source package. They remain registry-only source identities; this does not assert that the game lacks them or that they are available to players. No additional gameplay record or approval is inferred from registry membership.
- No group/member is joined by localized or English display name, prefix, or family-name guess.

The report is an inventory and approval-reuse check for the fixed W13 package, not a claim that the full 203-key registry is a complete 1.13.2 player catalog. W14 current-required coverage is tracked separately in the 7,408-row current mapping.
