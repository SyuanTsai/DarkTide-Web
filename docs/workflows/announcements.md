# Official announcement workflow

## Scheduled intake (SYP-542)

The owner's machine runs the Windows Task Scheduler task `DarkTide-Announcements-Daily` every day at 10:30 Asia/Taipei with `StartWhenAvailable`, so a missed run starts after the machine is back. Register it with `scripts/content/register-announcements-task.ps1 -InstallRunner`, which copies the runner from `origin/main` to `%LOCALAPPDATA%\DarkTide-Announcements\announcements-daily.ps1`; `-Unregister` removes the task. The runner creates a fresh detached worktree from `origin/main` and never uses the main checkout. It scans the Fatshark forum's Darktide Announcements category (70), exits without creating anything when there are no new topics, and otherwise captures the topics and translates them through `codex exec` (default `gpt-5.6-sol` with `medium` effort) using `scripts/content/announcements-translate-prompt.md` and the glossary from the Mods repository's `origin/main`. It runs build and check with up to two Codex fix rounds, then runs the tests. When everything passes it pushes `auto/announcements-YYYYMMDD` and opens a PR labelled `auto-announcements`; otherwise it opens a draft PR labelled `announcements-needs-review`, which is never auto-merged. Logs are kept in `%LOCALAPPDATA%\DarkTide-Announcements\logs`, with the latest 60 retained. `-DryRun` keeps the worktree and stops before commit, push, or PR creation. Only one automatic announcement PR may be open at a time; the next scheduled run retries.

From a clean checkout of current `main`, use the Taipei date for `YYYYMMDD`, then run the following commands. Create the branch only when the scan returns topics. Pass the scanned IDs in ascending publication order. Keep optional translator outlines outside the batch and out of the PR.

```text
node scripts/content/announcements-intake.mjs scan --json
git switch -c auto/announcements-YYYYMMDD
node scripts/content/announcements-intake.mjs capture --batch YYYYMMDD --topics ID,ID
# Translate each first post into the Markdown file named in batch-plan.json.
node scripts/content/announcements-intake.mjs build --batch YYYYMMDD
node scripts/content/announcements-intake.mjs check --batch YYYYMMDD
```

Use the Mods repository's `origin/main` copy of `Referneces/Translation.md` as the terminology reference. Follow the in-game display without mods and use official weapon names. At first use, include the English in parentheses for terms without an official Chinese name. The case-sensitive source patterns, required Chinese terms, and forbidden wording in `term-rules.json` are the hard gate. [Mods translation reference](https://github.com/SyuanTsai/Warhammer-40-000-DARKTIDE-Mods/blob/main/Referneces/Translation.md)

Use `# ` for the translated title, then shift source body headings down a level (up to level four). Keep all list entries as standalone `- ` bullets, use `> ` for quotes, and keep each image on its own Markdown line at the original source URL. Preserve the image occurrences, authored hyperlinks, and YouTube destinations. Convert Steam widgets and oneboxes to store links. The gate checks the paragraph count with a small allowance for splitting or joining paragraphs, and flags English-only prose, raw HTML, and unparsed Markdown. Generated preview icons and thumbnails do not count as article images, and lightbox original/download links do not count as prose. Automated batches are also checked against their snapshot and translation hashes, local image pins, and generated records. Running `check` without `--batch` checks all dated batches except those documented in `checkExemptBatches`.

End each translation with exactly one footer in the published format. Substitute the first-post author and publication date from the manifest.

```markdown
**來源與授權：**原文作者 FatsharkQuickpaw，首帖發布於 2026-11-19。本文為繁體中文翻譯與改作，依 [CC BY-NC-SA 3.0](https://creativecommons.org/licenses/by-nc-sa/3.0/) 分享；授權範圍僅及該論壇文章貢獻，不延伸至遊戲或商標。
```

Each new batch lives under `content/authoring/v2/official-announcements/YYYYMMDD/`:

- `source-snapshots/<topicId>.first-post.html` and `source-manifest.json` preserve the first-post HTML and its capture metadata with LF hashes.
- `batch-plan.json` maps topics to record IDs and translations. `translations/*.md` are the Traditional Chinese sources.
- `announcements.json` contains the generated records. `source-intake.json` records content hashes and the verified image pins. Image bytes are hashed in memory.
- `README.md` uses a heading with the batch date and a table with one row per post listing its original publication date, forum topic link, and record ID. Add a short note for any review-relevant asset or terminology decisions and the forum attribution.

Open a non-draft PR from `auto/announcements-YYYYMMDD` in the same repository into `main`. Apply `auto-announcements`. Only add files inside that one new dated directory. After **Static package fixture CI** succeeds on the PR, auto-merge verifies that the repository owner authored it, the tested head SHA matches, and the PR is mergeable. It checks the PR data using the gate and terminology from `main`, then squash-merges the tested SHA and deletes the branch. It reads the active release manifest linked from the production `/version.json` and dispatches `deploy.yml` using that manifest's existing `source.commit`. The Actions summary records the PR, merge commit, and deploy run.

The watch runs on `main` at 12:30 Asia/Taipei (04:30 UTC). When eligible topics are older than 48 hours and no announcement PR is open, it opens or comments on **公告自動排程落後** with the `announcements-stale` label and links to the stale topics. It closes the issue with a recovery comment when the stale count reaches zero. A healthy check with no open issue makes no issue changes.

- If intake did not run, run the installed runner manually with `pwsh -File "$env:LOCALAPPDATA\DarkTide-Announcements\announcements-daily.ps1"`, or start the registered task with `Start-ScheduledTask -TaskName DarkTide-Announcements-Daily`.
- For a manual backfill or rehearsal, pass explicit topic IDs and optionally keep all changes local: `pwsh -File "$env:LOCALAPPDATA\DarkTide-Announcements\announcements-daily.ps1" -Topics 125968 -DryRun`.
- For an `announcements-needs-review` draft PR, fix the Markdown on that branch, rerun `build` and `check`, mark the PR ready for review, and add the `auto-announcements` label.

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
