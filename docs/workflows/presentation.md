# Player-facing presentation workflow

## Shared skill presentation

Use the existing shared Web renderer and its validated view model for player-facing skill, blessing, weapon, and term content. Source remains the owner of technical facts; Web owns localized wording, official presentation, errata, and term labels. Do not create a second per-skill HTML or Markdown publishing pipeline.

## Safe presentation data

Render only validated structured text and supported block types. Preserve official wording, inline emphasis, links, and source context. Do not execute raw HTML or prompt text, infer game facts from a label, or fall back to English when required Traditional Chinese is missing. Unknown identity or applicability stays explicit and must not be guessed from page URLs or labels.

## Review and local preview

The existing W07 validation command and writer operate on fixed W07 seed inputs only:

```powershell
npm run contract:w07:validate
node scripts/content/contract-w07.mjs --out-root w07-review-draft
```

The parent directory must exist and the output directory must not. This output is a seed review artifact; it does not validate W09 overlays or the W15 `formal-pending-authoring.json` and creates no receipt. The W15 pending authoring and review digests use the existing `validateWebAuthoring` and `computeReviewDigests` APIs, not a new CLI. The selected composition is verified through `loadW09VerifiedComposition` in `scripts/content/contract-w09-compose.mjs` and the normal publisher. To inspect the actual app, serve the complete verified `dist` produced by that publisher:

```powershell
npm run serve:static
```

Do not run `npm run build` for this preview: `scripts/build.mjs` builds the legacy package and can overwrite the verified shared-package `dist`. An unselected candidate is not a player preview; `serve:static` is useful only when the verified publisher artifact is already present.

The historical Skill-Pages prompt's direct Mods Markdown/AI-LOGS authoring and separate GitHub Pages pages are retired as the publishing path. Source owns mechanics and evidence; Web owns localized presentation and review targets; the shared renderer produces the player view. Preserve the useful source analysis, navigation, readable detail sections, and responsive preview requirements through those owner-specific contracts rather than creating a second mechanics document or publishing pipeline.

## Review and release

Use the existing Web authoring and digest-bound review workflow. A successful render or a matching Source record does not create a Web approval. Keep optional official announcements separate from required gameplay features and do not expose technical proof or raw engine tokens as player labels.

Historical prompt source: [Skill-Pages-Workflow.md](https://github.com/SyuanTsai/Warhammer-40-000-DARKTIDE-Mods/blob/241ad76ce62330472aa423055a5b85db59bb6c0d/AI%20Prompt/Skill-Pages-Workflow.md).

The fixed terminology snapshot is approved as a writing reference for Web-owned Traditional Chinese wording only: its individual rows remain draft or pending, and it does not approve current gameplay facts or add runtime terms. See the [Web term candidate](../../content/authoring/v2/w15/term-candidates.json), its [approval record](../contracts/w15/content-approval.json), and the [W15 migration index](../contracts/w15/migration-index.md). Source-owned technical-context terms are tracked separately in the fixed [Source term candidate](https://github.com/SyuanTsai/DarkTide-Source-Data/blob/1a7eed6f50b369f9e90c1f2989c5c827b0aa2357/docs/references/w15/term-candidates.json) and its [approval record](https://github.com/SyuanTsai/DarkTide-Source-Data/blob/codex/SYP-349-w15-migration/docs/references/w15/content-approval.json).
