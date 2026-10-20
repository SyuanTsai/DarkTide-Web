# W03 Mods mapping ledger

This generated ledger maps fixed-commit source selectors to planned owners. Every row remains `mappingStatus: planned` and `actualOutcome: not-started`; it does not record a migration or content approval.

Source pin: Mods repository id `mods`, commit `241ad76ce62330472aa423055a5b85db59bb6c0d`, 83260 tracked paths. The tree and each group have deterministic inventory digests in `mapping-ledger.json`.

| Group | Paths | Planned entries | Shards |
| --- | ---: | ---: | ---: |
| M01 | 3071 | 107060 | 22 |
| M02 | 78489 | 78489 | 15 |
| M03 | 3 | 3 | 1 |
| M04 | 522 | 522 | 1 |
| M05 | 5 | 1291 | 1 |
| M06 | 6 | 771 | 1 |
| M07 | 8 | 8 | 1 |
| M08 | 62 | 2623 | 1 |
| K01 | 1090 | 1090 | 1 |
| K02 | 4 | 4 | 1 |

M02 dialogue entries are Git-tree metadata only: no dialogue file bytes were read. M04 logs, K01/K02 retained files, and M07 tool source files are also mapped by Git blob metadata only. M01 legacy analysis is not treated as current game data; unverified release IDs stay null. M05 preserves each heading, paragraph, list item, table cell, image occurrence, and spoiler selector without fetching image assets. M06 and mixed M08 references use bounded block/entry selectors. No repeated term is deduplicated across contexts.

Private tool receipt: {"toolCount":3,"privateContentAggregateSha256":"8dc9aaae9846847fc102737e0f9fb4b2a352c1d87304e45e53d1b8ab57048fed","scheme":"sha256(JSON.stringify(sha256-git-blob-bytes-in-basename-ascending-order))","publicCounterpartOptionSurface":"same-option-names; source-byte-digests-differ","cliExecuted":false,"behaviorEquivalenceClaimed":false,"privateLocatorsOrPerFileDigestsPublished":false}. It contains only a three-tool aggregate digest and CLI-surface note; no private locator or per-file digest is published. Three existing untracked Mods documents remain preserved locally; their contents are not copied into this ledger.

This ledger is not a renderer/runtime integration, not a full restore, not a current-compatibility determination, and not publication approval. Rollback points retain the exact source commit/blob. Human review remains pending where the target would create or display game content.
