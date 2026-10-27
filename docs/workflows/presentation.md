# Player-facing presentation workflow

## Shared skill presentation

Use the existing shared Web renderer and its validated view model for player-facing skill, blessing, weapon, and term content. Source remains the owner of technical facts; Web owns localized wording, official presentation, errata, and term labels. Do not create a second per-skill HTML or Markdown publishing pipeline.

## Safe presentation data

Render only validated structured text and supported block types. Preserve official wording, inline emphasis, links, and source context. Do not execute raw HTML or prompt text, infer game facts from a label, or fall back to English when required Traditional Chinese is missing. Unknown identity or applicability stays explicit and must not be guessed from page URLs or labels.

## Review and release

Use the existing Web authoring and digest-bound review workflow. A successful render or a matching Source record does not create a Web approval. Keep optional official announcements separate from required gameplay features and do not expose technical proof or raw engine tokens as player labels.

Historical prompt source: [Skill-Pages-Workflow.md](https://github.com/SyuanTsai/Warhammer-40-000-DARKTIDE-Mods/blob/241ad76ce62330472aa423055a5b85db59bb6c0d/AI%20Prompt/Skill-Pages-Workflow.md).

The pending terminology owner map and exact source row destinations are listed in the [W15 migration index](../contracts/w15/migration-index.md). Pending terms are not current player-facing content.
