# Official announcement workflow

## Official announcement intake

Keep an announcement as an official-document record with its own canonical topic, original publication date, official source URL, and exact source snapshot. A publication date does not establish a game release or build. Do not add a `gameReleaseId` unless the existing source contract supplies that identity.

## Translation and media

Preserve the source order, headings, paragraphs, lists, table cells, links, image occurrences, and spoilers in the closed announcement block model. Use safe HTTPS links for official-document sources and inline links. Keep video links as links; do not embed remote players or accept raw HTML. Every image occurrence must point to a pinned asset record while repeated uses may share the same asset. Keep image alt text and the original source URL.

## Review and publication

New or changed announcement fields remain pending until the existing Web review flow records a receipt bound to the exact target and dependency digests. Importer parity, an upstream merge, a source-language match, or a compiler success is not a human approval. Keep announcement-only changes in the optional announcement domain so they do not stale unrelated gameplay or term reviews. Do not generate an alternate Markdown publication or perform selection, allocation, or deployment from this workflow.

Historical prompt source: [AI-Darktide-Announcement-Translation-Workflow.md](https://github.com/SyuanTsai/Warhammer-40-000-DARKTIDE-Mods/blob/241ad76ce62330472aa423055a5b85db59bb6c0d/AI%20Prompt/AI-Darktide-Announcement-Translation-Workflow.md).

The pending W15 source mapping and review status are tracked in the [W15 migration index](../contracts/w15/migration-index.md); the pending candidate is not part of a shared release.
