# M07 tool ownership map

This report maps all 8 fixed W03 M07 tool paths to owner-maintained replacements. It is not a game-data approval or a publication action.

Source commit: [241ad76ce62330472aa423055a5b85db59bb6c0d](https://github.com/SyuanTsai/Warhammer-40-000-DARKTIDE-Mods/tree/241ad76ce62330472aa423055a5b85db59bb6c0d/scripts/game-info); W03 index SHA-256 90d1d27ed7673db16ff3c5b82640f2af7847466fc5a7a4fcd7d1f9795ee9af16.

| Destination owner | Rows |
| --- | ---: |
| source | 2 |
| web | 1 |
| private | 5 |

The nine-file Private tool export is read back against fixed commit 194e8b043f18f9f3c877ed6790118add47401a5e (9 files, 69236 bytes). The three Python tools used by M07 are retained from that fixed Private bundle and compare byte-identically after CRLF/LF normalization; their W04 decoder provenance remains unchanged. The Limn README is copied byte-exact as documentation only. Source now carries the fixed local Markdown-reference checker and its two existing synthetic tests. These tools do not create game facts, fetch remote links, or reproduce the full legacy HTML/TSV output.

See [m07-tool-map.json](./m07-tool-map.json) for every entry ID, source blob, path, selector, target, and compatibility limit.
