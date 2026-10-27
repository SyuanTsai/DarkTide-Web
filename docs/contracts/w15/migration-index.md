# W15 migration index

This index records fixed source-row destinations. It is not a content approval, selection, release allocation, or publication record.

Total: 4710 rows (M05 1291, M06 771, M07 8, M08 2623, A17 17).

| Group | Rows | Disposition |
| --- | ---: | --- |
| M05 | 1291 | candidate-pending-review |
| M06 | 771 | mapped-to-owner-workflow |
| M07 | 1 | migrated-exact-local-markdown-reference-check |
| M07 | 1 | migrated-existing-synthetic-local-reference-tests |
| M07 | 3 | private-fixed-tool-reused-line-endings-only |
| M07 | 1 | private-limn-readme-copied-byte-exact |
| M07 | 1 | private-owner-runbook-extended-for-m07 |
| M07 | 1 | replaced-with-scoped-player-renderer |
| M08 | 2543 | candidate-pending-review |
| M08 | 2 | historical-reference-candidate |
| M08 | 78 | retained-at-fixed-source |
| A17 | 17 | retained-pending-w01-candidate |

M05 announcement rows map to five exact-source candidates and remain pending human review. A17 remains a separate pending W01 status candidate. M08 Source and Web terminology references remain pending; 78 MOD-only rows remain at their fixed source. M06 rows map to owner-maintained workflow documentation. All five M07 Private rows now have fixed-source and destination evidence; three Python tools are newline-normalized code reuse, the Limn README is byte-identical documentation, and the Private runbook records the supported scope. This does not create game-content approval.

| Group detail | Fixed rows |
| --- | ---: |
| [M05 announcement row map](./m05-announcement-row-map.json) | 1,291 |
| [M06 workflow row map](./m06-row-map.json) | 771 |
| [M07 tool ownership map](./m07-tool-map.json) | 8 |
| [M08 terminology row map](./m08-row-map.json) | 2,623 |
| [A17 pending legacy candidate](./a17-legacy-candidate-map.json) | 17 |

The Web announcement and terminology candidates are under `content/authoring/v2/w15/`; the Source-owned reference candidate is `docs/references/w15/term-candidates.json` in DarkTide-Source-Data. All remain outside release inputs until the existing owner review flow approves exact digests.

See [row-outcome-overlay.json](./row-outcome-overlay.json) for every entry ID, source selector and hash, owner, target path/field, disposition, and review state. Rebuild or verify all reports with `node scripts/content/w15-migration-report.mjs --write-overlay` or `--verify-overlay` from the Web repository root. Rebuild or verify the Source-owned reference candidate with `node scripts/content/w15-migration-report.mjs --write-source-m08 <Source-repository-root>` or `--verify-source-m08 <Source-repository-root>`.
