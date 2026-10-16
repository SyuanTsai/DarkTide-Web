# W01 preview workflow

W01 has two isolated preview modes: `preview` for synthetic fixtures and `candidate-preview` for sanitized, non-fixture candidates that are still pending human content review. Both modes are publication-ineligible, and neither uses the existing production build or deploy commands.

## Compose the pinned Source request

In the Source checkout, run:

    npm test
    npm run content:preview
    npm run content:request

The request file is written under dist-w01/requests/<sourceRevision>-<commit>.json and contains only the Source repository, commit, sourceRevision, and manifest SHA-256.

In the Web candidate checkout, run:

    npm run w01:compose-source -- --request <request-json> --source-root <Source-checkout>

The composer verifies the Source repository origin, exact HEAD commit, manifest pin, clean tracked inputs, and generated technical/game-change artifact hashes. It updates source.lock.json and the exact generated Source bytes, then writes content/w01/composition-receipt.json with the request digest, candidate branch, lock digest, and artifact hashes. Repeating the same request is a no-op. Web-owned official text, term localization, errata, and announcements remain in web-authoring.json.

## Version and build the preview

`content/w01/release.json` pins the content version for the isolated package. Historical fixture R1 is `0.0.1`; published synthetic R2 A is `0.0.2`; published real representative candidates are `0.0.3` through `0.0.12`; pending `.13`, `.14`, and `.15` are retained as immutable prior candidates, and the current pending candidate is `0.0.16`. The `.5` candidate introduced Web-owned detail copy, a term label, an announcement, list rendering, and two approved remote images. The `.6` candidate added a narrower Source evidence path for the Psyker multiplier and parallel domain loading. The `.8` candidate adds a four-tier selector for the Chainaxe blessing: tier 4 is selected by default, and each option is bound to its matching Source value. Defined display values are 17%, 18%, 19%, and 20%; obtainable tiers remain unverified in Source metadata. The `.9` candidate enlarges the two existing approved images and moves their short source links below them. The `.10` candidate changed the five Web-owned Psyker condition strings recorded in [the historical .10 copy-review record](editorial-copy-review-0.0.10.md). The `.11` candidate revised Web-owned Psyker details and the four-tier blessing wording, and kept the approved icon credit visible. The `.12` candidate applies the reviewed Psyker and blessing player-copy changes recorded in [the .12 copy-review record](editorial-copy-review-0.0.12.md); official text, Source pins and claims, and numeric bindings remain unchanged. The `.13` candidate's compact-copy changes remain documented in [the historical .13 copy-review record](editorial-copy-review-0.0.13.md). The current workflow rebuilds exact published `.9` commit `d4a99510ea355b4703cf715c7f0978209cb04dd0`, exact published `.10` commit `9c84344642cef3a82085dac3e6d4874bf9d2a4c5`, exact published `.11` commit `3cf93b2e8c9acdcdc7ea5695c24e57a49c04b9b1`, and exact published `.12` commit `869f03f829b377ed4779ec73f55baf8a7507d6c4`, retaining their immutable data URLs. It then rebuilds exact prior `.13` commit `58487ee15c16e398b091c9ad2c29322f3bf5548e`, exact prior `.14` commit `b57d6268a470009a560eb03a8a3da4ba6748f106`, and exact prior `.15` commit `b3836b0e4ed8698aefff2973ad77a507709a39a9` before building `.16`. The historical `.14` Chainaxe comparison copy and `.15` player copy are documented in their respective review records; current `.16` Chainaxe copy and Source bindings are in [the .16 copy-review record](editorial-copy-review-0.0.16.md). The compiler accepts an explicit `--content-version major.minor.patch` when rebuilding a historical release. The resolved version is included in the data revision and must agree across the manifest, `version.json`, and the build receipt.

R1 `0.0.1` is pinned to Web commit `872bd72bad255d40af62329b8ffe97a357935275`. Published R2 A is pinned to Web commit `a7fabea66f56cd5c8236b6e84a3f6c6586175840`, package version `0.0.2`, data revision `954cbfaec4340d6237913c0edae39967ff28c55fee7b372bc74367a95a85d292`, build ID `1aea7c152c5383457f7b87e38f7c840bc7fa92cf3c9276fb18214d29ad790023`, and manifest SHA-256 `c2a17c9d17da123940e1432a957e5ced31be9f2977c3df7530deaacaa5ce361f`. R2 changes only the Web-owned synthetic skill name to `合成技能示例（修訂2）`; its official source text and Source claim stay byte-for-byte unchanged.

`UnitT10` tests an explicit `0.0.1` to `0.0.2` rebuild. `UnitT41` reconstructs exact historical R1 and A inputs before exercising the fixed R1 helper; `UnitT42` models a clean rollback commit B with the same pinned inputs. Both verify the immutable R1, A, and baseline data rows. These tests cover the historical R2-to-R1 helper path, not a rollback of the current real `.3` through `.7` candidate sequence.

The published `.6` candidate pins public Source commit `a205df69621d308a3d4b57461ec8128e359b48e3`, Source revision `1a92c29a928bcd766a453b69555930bfb5d57c86b3dfbd593b34bac29404f20d`, and manifest SHA-256 `c96229dfeeae86b3656648aada1119b4a3909d20fd8c444d676617d6e2ac0d79`. It contains a small Psyker skill, Chainaxe blessing variant, weapon, and term representative. The `.7` candidate pins public Source commit `f216b61e78b5507877645623950b954c1f8ec01b`, Source revision `b4068895536183ee34d3beff4d6741c8d6355c3912dd7e8bb1955c110d7d7ddc`, and manifest SHA-256 `64cb59aa48064f5e2cc31a6279fa8ba074bee1a4659830658da7cae5805ae982`. Its composition request is `129206296273443d716f4e310ed08fb9c75570330ada67a580f3e8c6c7107084`, with technical artifact SHA-256 `2dd339a8133e587c4f1d5381673f96e054d5d0d829ead3af6c7a253dd66f2272`; the Source `game-changes` set is empty. The `.7` candidate keeps the inherited Psyker analysis and adds Source-owned evidence for its existing damage and warp-charge details. It also references the byte-exact English archive at `https://github.com/SyuanTsai/Warhammer-40-000-DARKTIDE-Mods`, commit `241ad76ce62330472aa423055a5b85db59bb6c0d`, path `Game Info/releases/1.13.X/skills/talents/Psyker/en/psyker_brain_burst_improved.md`. This reference preserves historical analysis provenance; it does not assert current game-version compatibility or measured runtime behavior. Source owns numeric values and code evidence, while Web authoring supplies the exact official EN and zh-TW strings and player-facing details. The existing Psyker evidence narrows the 1.5 multiplier to the matching damage-type branch and its multiplication into `damage_multiplier`; it does not resolve later calculation stages or final damage. The inherited charge examples remain estimates under their stated attack-speed and modifier assumptions; they do not add a calculator or new assumptions. The announcement describes review status and does not announce a game change.

The `.8` candidate pins public Source commit `5d16c70a828d4bd6293a12430cd4ebea36c6ed1c`, Source revision `8e2996286df1875eb55d4e1ecd1650443ca9bd9b1a45a364c9c3f6de4f76048d`, and manifest SHA-256 `625725aa628f55bc484dd6fd267170b9991bb16b1d46c975a87193733c6418bc`. Its composition request SHA-256 is `0e0a6c02df37d009ffad15924d1128a9c84a8a3f423eb7955474adbc44b748e5`; the generated technical and game-change artifact SHA-256 values are `f911d99198ca926bc857f972d3c4b72aaf40623064e2c1c869932e0f007cc443` and `3fd1b487e10f6f7d701fc6835a8e299dde8d37387b10a258b48fb78044349c0d`. The blessing's option values bind to their corresponding Source tier claims. The selector displays compiled values and does not calculate or infer a tier value; the current review status remains pending.

## Editorial copy review (W01 human findings; pending)

Keep the existing copy constraints: state each supported point once in concise player-readable wording and omit unsupported empty sections; do not turn internal branches, reset behavior, or defaults into player instructions; state shared assumptions once and keep provenance, review status, and tier availability in existing metadata or review notes. Keep official strings byte-exact, put verified corrections in separate visible errata, defer weapon-image sourcing until an asset is approved, and keep W01 pending human review with W02 on hold.
Use this staged gate for each Web-owned player-copy change. It follows the W01 cold-read findings in [SYP-333 comment 11808](https://syuantsai.atlassian.net/browse/SYP-333?focusedCommentId=11808) and [comment 11810](https://syuantsai.atlassian.net/browse/SYP-333?focusedCommentId=11810).

1. Start from the inherited MOD player analysis for the skill or blessing. Use raw code and Source evidence to verify facts, not as the starting prose for players.
2. Before opening `claimRefs`, author rationale, or Source notes, read the rendered player copy as standalone text, in the form a player sees it.
3. For every changed sentence, check that the sentence itself identifies its subject or status bearer, trigger or timing, result, amount, and scope where applicable. Headings or surrounding context must not supply a missing subject. More than one reasonable reading is a failure.
4. Only after the standalone read passes, compare mechanics, numbers, negation, assumptions, and tier bindings against Source evidence and the fixed terminology reference.
5. When a finding appears, scan the complete copy for similar sentences, have Luna revise the affected wording, then have SOL recheck the full affected copy and its evidence alignment.
6. Send the human reviewer only the complete copy that has passed these internal checks. The human decides final content approval; human review is not the first-line ambiguity or fluency check.
7. For later updates, freeze human-approved unchanged copy. Review only new or changed wording and its affected dependencies, carrying forward valid checks for unchanged material.

Before Web-owned wording is compiled into the shared JSON used by the Web preview and extension, review it in Taiwanese Traditional Chinese against the existing Source claims and inherited analysis. Keep one review diff for each changed item with its exact before and proposed after text, preserved `claimRefs`/`termRef` or an explicit mapping from merged, moved, or added references to existing Source claims, Source commit/revision, terminology rule and reference version. SOL checks that numbers, conditions, negation, assumptions and limits still match the cited evidence; a human reviewer decides the final wording. This step does not change ownership: Source owns mechanics and evidence, Web owns player-facing wording and localization, and the official English and zh-TW text remains byte-exact. Corrections to official text, if ever established, stay in a separate visible erratum.

The terminology reference checked for this wording pass is the fixed Mods commit `241ad76ce62330472aa423055a5b85db59bb6c0d`, file `Referneces/Translation.md` (preserve the directory's spelling). Its Windows checkout SHA-256 is `5f6d232989b80f2d863a1cbbdaf7fe8e6fb8a3ec01e9390fd606a2f78c3e4073`; the Git blob bytes at that commit have SHA-256 `fb60e9e8b7beb81765ca50acb3483b9a10e3148e82f630bdf43878a8e45543a0`. The fixed glossary maps `Peril` to `反噬` / `靈能反噬`, `Stagger` / `Staggering` to `踉蹌`, `Brain Burst` to `顱腦爆裂`, `Brain Rupture` to `顱腦崩裂`, and `Smite` to `懲戒`. These are terminology references, not mechanics evidence. In particular, the code symbol `Smite` does not by itself establish that a specific skill should be presented to players using the glossary label `懲戒`; check the skill context before applying the term.

The five `.9` condition strings and their proposed `.10` wording, record IDs, and unchanged `claimRefs` are documented in [the historical W01 copy-review record](editorial-copy-review-0.0.10.md). The `.11` Web-owned Psyker and blessing changes are documented in [the .11 copy-review record](editorial-copy-review-0.0.11.md). The `.12` changes are documented in [the .12 copy-review record](editorial-copy-review-0.0.12.md), including the new shared numerical assumption, the merged charge/attack Peril detail, the moved lock-on wording, and the two added section-introduction items. The `.13` compact-copy changes are documented in [the historical .13 copy-review record](editorial-copy-review-0.0.13.md); historical `.14` Chainaxe comparison copy and `.15` player copy are documented in their respective records. The current `.16` Chainaxe copy and Source bindings are documented in [the .16 copy-review record](editorial-copy-review-0.0.16.md). The `.15` Source pin is commit `7f88a1368a29a79c0de654ee5cd17886dd360a47`, revision `f9917e5f8c14e1fd768f502b9c0cafa59602cae1ac5e9bf8372e467268de38e2`, and manifest SHA-256 `e8ec9697ce5b15d3e9e040a2c023f18db23e2fa7ab41ea25c28f75eb75e85835`. The `.16` Source pin is commit `285a06c8939ac505ac48e4d0e93b939a2b959211`, revision `3af04f0212a88e6b29f91f397178dd6d22c0c27d40566088eca8f8f06d4845c1`, and manifest SHA-256 `3140d7c5f8f49b2cd9b8574819159079d8542cf165d870af96890ca8efe063d6`. The `.16` view binds all 76 displayed stat claims for both marks and keeps official weapon-name bytes unchanged while showing the title once. A preview may show copy that is explicitly pending. Formal publication requires the reviewed wording diff and a human content decision.

For W06, carry this before/after, claim-reference, term-rule and Source-version record into the existing formal editorial review before publication. For W15, capture any approved terminology decisions as versioned Web-owned input and provenance in the existing workflow so a formal build never depends on a Mods checkout. Do not add another repository, translation pipeline or glossary owner. If the glossary is ambiguous, leave the term unresolved for human review.

Native official text preserves each locale's original text, ordered segments, source identity, and hash. A zh-TW string with `origin: "official"` is kept as official game text, not labeled a translation. Numeric placeholders bind to fixed Source claims: percentage display values require `code-derived` claims whose property starts with `description.format_values.<parameter>.`; the only plain-number exception is the code-observed `time` parameter for `template.buff_override.active_duration` in seconds. The raw `1.5` ratio remains a Source mechanic value and cannot populate the official damage placeholder; the displayed `+50%` is the separate description-format claim. The compiler generates resolved parameter strings from these inputs; Web authoring does not type numeric output values.

This candidate remains `pending-preview`, `fixtureOnly: false`, `publicationEligible: false`, and `candidatePreviewOnly: true`. The page shows a brief Traditional Chinese notice that the wording and game version are unverified and the content is pending review. The package retains its exact compatibility metadata checks; technical pin details are not shown to players. No human review receipt is included.

The real representative preview keeps official text and source identities unchanged. Existing skill and blessing text remains visible; the `.16` Chainaxe cards use the official name as their title without repeating it in a separate player-facing block. Detail sections render as lists, and only the approved Psyker and blessing images are shown with visible Games Lantern credit. No weapon image is available in the approved inputs, so the weapon card has no image.

## Build and retain the old data URLs

The current preview workflow uses one clean `dist-w01` output and runs these steps in order:

1. Build the pinned production baseline at commit `8a4b3db2b1e835f0757f387ca89a19b9092b35ee`.
2. Build exact R1 from `872bd72bad255d40af62329b8ffe97a357935275` into `dist-w01`, retain the baseline data, and verify.
3. Build published A from `a7fabea66f56cd5c8236b6e84a3f6c6586175840` into the same output, retain the baseline data again, and verify.
4. Build the exact published `.3` candidate from Web commit `e516a5b896f78273544c16047126c327337a8424` into the same output, retain baseline data, and verify its existing data URLs.
5. Freeze that verified `.3` package in runner temp storage, then check out the exact published `.4` source (`b401ae50d7ebb7e44aeb59a8c864a8b93628aead`) and rebuild it into the same output. Retain baseline data, verify `.4`, and freeze that package for lifecycle tests.
6. Check out exact published `.5` source `a09863ceac2bfca3944d09081c315d62b704563c`, rebuild it into the same output, retain baseline data, verify it, and freeze that package for lifecycle tests.
7. Check out exact published `.6` source `f2a465e9858e57c3a4850126522dacc71226453d`, rebuild it into the same output, retain baseline data, verify it, and freeze that package for lifecycle tests.
8. Check out exact published `.7` source `a11bdb73d4e00b735051bfcb55685623c05c9c12`, rebuild it into the same output, retain baseline data, verify it, and freeze that package for lifecycle tests.
9. Check out exact published `.8` source `b55cc3e21024b364bc6aa95f4ad46a9a3f6c48a1`, rebuild it into the same output, retain baseline data, and verify it.
10. Check out exact published `.9` source `d4a99510ea355b4703cf715c7f0978209cb04dd0`, rebuild it into the same output, retain baseline data, and verify it.
11. Check out exact published `.10` commit `9c84344642cef3a82085dac3e6d4874bf9d2a4c5`, rebuild it into the same output, retain baseline data, and verify its existing data URLs.
12. Check out exact published pending `.11` commit `3cf93b2e8c9acdcdc7ea5695c24e57a49c04b9b1`, rebuild it into the same output, retain baseline data, and verify its existing data URLs.
13. Check out exact published pending `.12` commit `869f03f829b377ed4779ec73f55baf8a7507d6c4`, rebuild it into the same output, retain the baseline data, verify it, and freeze the complete package for the `.13` retention test.
14. Check out exact prior `.13` commit `58487ee15c16e398b091c9ad2c29322f3bf5548e`, rebuild it into the same output, retain the baseline data, verify it, and freeze the package so its immutable data URLs remain available.
15. Check out exact prior `.14` commit `b57d6268a470009a560eb03a8a3da4ba6748f106`, rebuild it into the same output, retain the baseline data, verify it, and freeze the package for lifecycle tests.
16. Check out exact prior `.15` commit `b3836b0e4ed8698aefff2973ad77a507709a39a9`, rebuild it into the same output, retain the baseline data, verify it, and freeze the package for lifecycle tests.
17. Build the current pending `.16` candidate from the branch checkout into the same output, retain the baseline again, and verify the package. Run lifecycle tests with the frozen exact `.3` through `.7` and `.12` through `.15` packages, then upload and deploy the verified `.16` artifact only to the fixed preview worker.

The equivalent local commands must be run from the indicated pinned checkouts, in the same order:

    npm --prefix <pinned-base-checkout> run build
    npm --prefix <pinned-r1-checkout> run w01:build -- --output <web-checkout>/dist-w01
    npm --prefix <pinned-r1-checkout> run w01:retain -- --baseline-root <pinned-base-checkout> --output <web-checkout>/dist-w01
    npm --prefix <pinned-r1-checkout> run w01:verify -- <web-checkout>/dist-w01
    npm --prefix <published-a-checkout> run w01:build -- --output <web-checkout>/dist-w01
    npm --prefix <published-a-checkout> run w01:retain -- --baseline-root <pinned-base-checkout> --output <web-checkout>/dist-w01
    npm --prefix <published-a-checkout> run w01:verify -- <web-checkout>/dist-w01
    npm --prefix <published-real-0.0.3-checkout> run w01:build -- --candidate-preview --output <web-checkout>/dist-w01
    npm --prefix <published-real-0.0.3-checkout> run w01:retain -- --baseline-root <pinned-base-checkout> --output <web-checkout>/dist-w01
    npm --prefix <published-real-0.0.3-checkout> run w01:verify -- <web-checkout>/dist-w01
    npm --prefix <published-real-0.0.4-checkout> run w01:build -- --candidate-preview --output <web-checkout>/dist-w01
    npm --prefix <published-real-0.0.4-checkout> run w01:retain -- --baseline-root <pinned-base-checkout> --output <web-checkout>/dist-w01
    npm --prefix <published-real-0.0.4-checkout> run w01:verify -- <web-checkout>/dist-w01
    npm --prefix <published-real-0.0.5-checkout> run w01:build -- --candidate-preview --output <web-checkout>/dist-w01
    npm --prefix <published-real-0.0.5-checkout> run w01:retain -- --baseline-root <pinned-base-checkout> --output <web-checkout>/dist-w01
    npm --prefix <published-real-0.0.5-checkout> run w01:verify -- <web-checkout>/dist-w01
    npm --prefix <published-real-0.0.6-checkout> run w01:build -- --candidate-preview --output <web-checkout>/dist-w01
    npm --prefix <published-real-0.0.6-checkout> run w01:retain -- --baseline-root <pinned-base-checkout> --output <web-checkout>/dist-w01
    npm --prefix <published-real-0.0.6-checkout> run w01:verify -- <web-checkout>/dist-w01
    npm --prefix <published-real-0.0.7-checkout> run w01:build -- --candidate-preview --output <web-checkout>/dist-w01
    npm --prefix <published-real-0.0.7-checkout> run w01:retain -- --baseline-root <pinned-base-checkout> --output <web-checkout>/dist-w01
    npm --prefix <published-real-0.0.7-checkout> run w01:verify -- <web-checkout>/dist-w01
    npm --prefix <published-real-0.0.8-checkout> run w01:build -- --candidate-preview --output <web-checkout>/dist-w01
    npm --prefix <published-real-0.0.8-checkout> run w01:retain -- --baseline-root <pinned-base-checkout> --output <web-checkout>/dist-w01
    npm --prefix <published-real-0.0.8-checkout> run w01:verify -- <web-checkout>/dist-w01
    npm --prefix <published-real-0.0.9-checkout> run w01:build -- --candidate-preview --output <web-checkout>/dist-w01
    npm --prefix <published-real-0.0.9-checkout> run w01:retain -- --baseline-root <pinned-base-checkout> --output <web-checkout>/dist-w01
    npm --prefix <published-real-0.0.9-checkout> run w01:verify -- <web-checkout>/dist-w01
    npm --prefix <published-real-0.0.10-checkout> run w01:build -- --candidate-preview --output <web-checkout>/dist-w01
    npm --prefix <published-real-0.0.10-checkout> run w01:retain -- --baseline-root <pinned-base-checkout> --output <web-checkout>/dist-w01
    npm --prefix <published-real-0.0.10-checkout> run w01:verify -- <web-checkout>/dist-w01
    npm --prefix <published-real-0.0.11-checkout> run w01:build -- --candidate-preview --output <web-checkout>/dist-w01
    npm --prefix <published-real-0.0.11-checkout> run w01:retain -- --baseline-root <pinned-base-checkout> --output <web-checkout>/dist-w01
    npm --prefix <published-real-0.0.11-checkout> run w01:verify -- <web-checkout>/dist-w01
    npm --prefix <published-real-0.0.12-checkout> run w01:build -- --candidate-preview --output <web-checkout>/dist-w01
    npm --prefix <published-real-0.0.12-checkout> run w01:retain -- --baseline-root <pinned-base-checkout> --output <web-checkout>/dist-w01
    npm --prefix <published-real-0.0.12-checkout> run w01:verify -- <web-checkout>/dist-w01
    cp -a <web-checkout>/dist-w01/. <runner-temp>/w01-real-r12/
    npm --prefix <prior-real-0.0.13-checkout> run w01:build -- --candidate-preview --output <web-checkout>/dist-w01
    npm --prefix <prior-real-0.0.13-checkout> run w01:retain -- --baseline-root <pinned-base-checkout> --output <web-checkout>/dist-w01
    npm --prefix <prior-real-0.0.13-checkout> run w01:verify -- <web-checkout>/dist-w01
    cp -a <web-checkout>/dist-w01/. <runner-temp>/w01-real-r13/
    npm --prefix <prior-real-0.0.14-checkout> run w01:build -- --candidate-preview --output <web-checkout>/dist-w01
    npm --prefix <prior-real-0.0.14-checkout> run w01:retain -- --baseline-root <pinned-base-checkout> --output <web-checkout>/dist-w01
    npm --prefix <prior-real-0.0.14-checkout> run w01:verify -- <web-checkout>/dist-w01
    cp -a <web-checkout>/dist-w01/. <runner-temp>/w01-real-r14/
    npm --prefix <prior-real-0.0.15-checkout> run w01:build -- --candidate-preview --output <web-checkout>/dist-w01
    npm --prefix <prior-real-0.0.15-checkout> run w01:retain -- --baseline-root <pinned-base-checkout> --output <web-checkout>/dist-w01
    npm --prefix <prior-real-0.0.15-checkout> run w01:verify -- <web-checkout>/dist-w01
    cp -a <web-checkout>/dist-w01/. <runner-temp>/w01-real-r15/
    npm --prefix <web-checkout> run w01:build -- --candidate-preview --output dist-w01
    npm --prefix <web-checkout> run w01:retain -- --baseline-root <pinned-base-checkout> --output dist-w01
    npm --prefix <web-checkout> run w01:verify -- dist-w01

The baseline checkout must be commit 8a4b3db2b1e835f0757f387ca89a19b9092b35ee. The copier checks every one of the 2,277 old data paths, sizes, and SHA-256 hashes against docs/w01/retained-preview-manifest.json, refuses to overwrite different bytes, and records the retained inventory in the W01 receipt. The old data revision remains 0ae547d78d49c5d5c46b991df3736f9d868eebd98e902b1a62426dc075d3884b. The W01 preview uses a new immutable data revision and includes no old index, version, or runtime files.

The `.16` preview is written only to dist-w01 after the workflow reconstructs and retains the exact `.15` candidate. Fixture output identifies preview-only content; candidate output shows the short pending-review notice. Both include `X-Robots-Tag: noindex` and the fixed preview CORS headers, and remain publication-ineligible. Pull requests build and upload the isolated artifact. A push to `codex/SYP-311-w01` deploys only `wrangler.w01-preview.json` after checking the repository, branch, and freshly fetched branch head; the Cloudflare token is scoped to that deploy step. A separate receipt records remote version, manifest, domain, and retained-baseline verification.

The deployed-preview receipt accepts exactly two quarantine modes: a legacy fixture with `fixtureOnly: true`, no `candidatePreviewOnly` field, and `package_kind: "fixture"`; or a pending candidate with `fixtureOnly: false`, `candidatePreviewOnly: true`, and `package_kind: "pending-preview"`. The manifest's fixture flag must match that mode. Both modes still require `publicationEligible: false`, `formalPublishAllowed: false`, exact remote bytes, noindex/CORS headers, and the pinned retained-baseline check. Mixed or missing candidate flags fail before any remote request.

When rebuilding into an existing dist-w01, the compiler accepts only one of two prior receipt modes: a legacy fixture (`fixtureOnly: true` with no `candidatePreviewOnly` field) or a pending candidate (`fixtureOnly: false` and `candidatePreviewOnly: true`). Both must remain publication-ineligible, formal publishing disabled, and undeployed; the prior `version.json` and manifest identity must agree with the receipt. The compiler checks every listed file hash, keeps prior content-addressed data revisions byte-for-byte, replaces the preview runtime files, and writes a receipt covering both prior data URLs and the new build. Mixed/missing flags, unlisted files, or changed bytes fail closed.

## Fixed-R1 rollback helper

The reviewed rollback input is the exact `content/w01/rollback.json` file. It contains only these keys and values:

    {
      "schemaVersion": "1.0.0",
      "targetCommit": "872bd72bad255d40af62329b8ffe97a357935275",
      "contentVersion": "0.0.1",
      "dataRevision": "ac4e659408e9be4c1e56226f2fecdbf9b1bd033b8f0e2d7f2ef52be0aa821701",
      "buildId": "39c6ed446f9d526774d0404cf852042ffc2ffd38eb3ca8f4306088d070bf7265",
      "manifestSha256": "368451efd002e16c1ce068643bc1cac8bb7a90b51d7200f31d68aaaf07e189f7"
    }

This section documents the historical B/fixed-R1 helper validation path. It is not the current preview deployment workflow: current pushes reconstruct baseline, R1, published A, the exact published `.3` through `.12` candidates, and prior `.13` through `.15` before building pending `.16`. The current workflow does not invoke this helper. The helper remains the exact historical `0.0.2`-to-`0.0.1` recovery path; whole-preview rollback for the real `.3` through `.10` sequence requires a separately pinned release identity and reviewed selector before use.

The historical helper command is:

    npm run w01:rollback-r1 -- --expected-r2-commit <exact-R2-SHA> --source-root <pinned-R1-checkout> --baseline-root <pinned-base-checkout>

It verifies the active receipt's authoring commit against `--expected-r2-commit`, requires a clean R1 checkout at the fixed SHA, rebuilds R1 into the same output, and confirms all prior content-addressed data URLs remain byte-identical. It does not deploy by itself and does not accept an arbitrary R1 ref. The historical B/R2 rollback contract verifies this helper locally; it is not used by the current preview workflow.

## Fixed real-candidate preview recovery

The fixed preview recovery run restored the exact published `.3` runtime from Web commit `e516a5b896f78273544c16047126c327337a8424` after rebuilding and verifying the exact published `.4` package from commit `b401ae50d7ebb7e44aeb59a8c864a8b93628aead`. The recovery helper accepts only those pinned package identities and their exact receipts, checks every listed file and path, copies `.3` runtime files, and unions the verified `.4` `data/` rows. Any shared immutable path must have identical bytes. It verifies the staged result before replacing the active output; the `.4` output remains as a same-parent backup, and a failed replacement restores it. The restored package uses `.3` version/build/manifest identity and retains all `.4` data URLs. The `.7` workflow at that time rebuilt the exact published `.3` through `.6` packages for lifecycle tests, then built `.7` while retaining earlier immutable data URLs. The current `.14` workflow rebuilds pinned `.3` through `.12` history and exact prior `.13` before building its candidate.

The workflow writes a public-safe recovery proof with the controller commit that ran the recovery, the unchanged `.3` and `.4` compiler/source identities, both input receipt hashes, the retained `.4` data inventory digest, and the final receipt hash. It contains no local paths or private source material. The helper does not build a release or deploy; only the existing guarded workflow deploys the verified `dist-w01` to the fixed preview worker.

## Candidate pull request

After the candidate branch is committed and pushed, run npm run w01:pr from the fixed W01 branch. It uses the local gh CLI to reuse an existing open PR for that branch or create one if none exists. It refuses to silently reopen or duplicate a closed PR. Fixture and sanitized native pending-preview composition receipts are accepted only while publication and formal publishing remain disabled; PR text keeps human content review pending and does not label a native candidate as a fixture. Git push updates the existing branch; the script does not push code.
