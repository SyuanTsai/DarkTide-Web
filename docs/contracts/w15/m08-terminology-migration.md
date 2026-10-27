# M08 terminology and reference migration

This report accounts for 2623 fixed W03 M08 rows and 1332 distinct text fragments by exact source path, byte selector, and fragment hash. New Source/Web terminology remains pending; no gameplay receipt or release is created.

Source commit: [241ad76ce62330472aa423055a5b85db59bb6c0d](https://github.com/SyuanTsai/Warhammer-40-000-DARKTIDE-Mods/tree/241ad76ce62330472aa423055a5b85db59bb6c0d); W03 index SHA-256 90d1d27ed7673db16ff3c5b82640f2af7847466fc5a7a4fcd7d1f9795ee9af16.

| Destination owner | Rows |
| --- | ---: |
| mods | 78 |
| source | 1332 |
| web | 1213 |

MOD-only glossary/localization and workspace-archive rows remain at their exact fixed Mods paths. Source concepts and Web Traditional Chinese labels are separate pending candidate references; repeated text in different contexts remains separate. Historical notes are listed as reference material, not current mechanics.

The full row map and excerpts are in [m08-row-map.json](./m08-row-map.json). The separate Web candidate is `content/authoring/v2/w15/term-candidates.json`; the Source reference-only candidate is `docs/references/w15/term-candidates.json` in DarkTide-Source-Data. Both remain pending and are outside the shared release inputs. Rebuild the Source copy from this repository with `node scripts/content/w15-migration-report.mjs --write-source-m08 <Source-repository-root>`; verify it with `--verify-source-m08 <Source-repository-root>`.
