# Official announcement workflow

## Official announcement intake

Keep an announcement as an official-document record with its own canonical topic, original publication date, official source URL, and exact source snapshot. A publication date does not establish a game release or build. Do not add a `gameReleaseId` unless the existing source contract supplies that identity.

## Translation and media

Preserve the source order, headings, paragraphs, lists, table cells, links, image occurrences, and spoilers in the closed announcement block model. Use safe HTTPS links for official-document sources and inline links. Keep video links as links; do not embed remote players or accept raw HTML. Every image occurrence must point to a pinned asset record while repeated uses may share the same asset. Keep image alt text and the original source URL.

## Import, review, and preview

From the Web repository root, rebuild a pending candidate from the fixed M05 source snapshots and pinned asset metadata. The output path must be new; the importer refuses to overwrite an existing file:

```powershell
node scripts/content/w15-announcement-import.mjs --write w15-announcement-review-candidate.json
node scripts/content/w15-migration-report.mjs --verify-m05
```

The importer checks the five source files, publication dates, image occurrence order, and asset pins. The report command verifies the fixed row-to-block map. These commands validate the W15 source mapping; neither creates review receipts or adds the candidate to the shared package. The current `formal-pending-authoring.json` is prepared through the existing `validateWebAuthoring` and `computeReviewDigests` APIs. Those are APIs, not a W15 CLI. `npm run contract:w07:validate` and `node scripts/content/contract-w07.mjs --out-root w15-w07-review-draft` load only the fixed W07 seed inputs; they do not validate this pending file or W09 overlays and must not be described as doing so. The W07 writer's parent directory must exist and its output directory must not.

The fixed terminology snapshot is approved as a writing reference for Web-owned Traditional Chinese wording only: its individual rows remain draft or pending, and it does not approve current gameplay facts or add runtime terms. See the [Web term candidate](../../content/authoring/v2/w15/term-candidates.json) and its [approval record](../contracts/w15/content-approval.json). Source-owned technical-context terms are tracked separately in the fixed [Source term candidate](https://github.com/SyuanTsai/DarkTide-Source-Data/blob/1a7eed6f50b369f9e90c1f2989c5c827b0aa2357/docs/references/w15/term-candidates.json) and its [approval record](https://github.com/SyuanTsai/DarkTide-Source-Data/blob/codex/SYP-349-w15-migration/docs/references/w15/content-approval.json).

After exact target and dependency digests have human review receipts, the existing `loadW09VerifiedComposition` API in `scripts/content/contract-w09-compose.mjs` and normal publisher validate the selected W09 composition. To inspect the resulting app, serve the complete verified `dist` produced by that publisher:

```powershell
npm run serve:static
```

Do not run `npm run build` for this preview: `scripts/build.mjs` creates the legacy package and can overwrite the verified shared-package `dist`. `serve:static` only previews the verified artifact when that artifact is already present.

This replaces the historical prompt's direct Mods Markdown edits, Media-Assets Issue upload/closure, and non-Draft PR steps. Announcement content and pinned assets are Web-owned structured records; the normal owner review and release process controls publication. Do not infer a gameplay release from an announcement date or title.

## Review and publication

New or changed announcement fields remain pending until the existing Web review flow records a receipt bound to the exact target and dependency digests. Importer parity, an upstream merge, a source-language match, or a compiler success is not a human approval. Keep announcement-only changes in the optional announcement domain so they do not stale unrelated gameplay or term reviews. Do not generate an alternate Markdown publication or perform selection, allocation, or deployment from this workflow.

Historical prompt source: [AI-Darktide-Announcement-Translation-Workflow.md](https://github.com/SyuanTsai/Warhammer-40-000-DARKTIDE-Mods/blob/241ad76ce62330472aa423055a5b85db59bb6c0d/AI%20Prompt/AI-Darktide-Announcement-Translation-Workflow.md).

The pending W15 source mapping and review status are tracked in the [W15 migration index](../contracts/w15/migration-index.md); the pending candidate is not part of a shared release.
