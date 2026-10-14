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

`content/w01/release.json` pins the content version for the isolated package. Historical fixture R1 is `0.0.1`; published synthetic R2 A is `0.0.2`; the published real representative candidates are `0.0.3` through `0.0.6`; the current pending candidate is `0.0.7`. The `.5` candidate introduced Web-owned detail copy, a term label, an announcement, list rendering, and two approved remote images. The `.6` candidate added a narrower Source evidence path for the Psyker multiplier and parallel domain loading. The current workflow rebuilds the exact published `.6` package and retains all of its immutable data URLs before building `.7`. The compiler accepts an explicit `--content-version major.minor.patch` when rebuilding a historical release. The resolved version is included in the data revision and must agree across the manifest, `version.json`, and the build receipt.

R1 `0.0.1` is pinned to Web commit `872bd72bad255d40af62329b8ffe97a357935275`. Published R2 A is pinned to Web commit `a7fabea66f56cd5c8236b6e84a3f6c6586175840`, package version `0.0.2`, data revision `954cbfaec4340d6237913c0edae39967ff28c55fee7b372bc74367a95a85d292`, build ID `1aea7c152c5383457f7b87e38f7c840bc7fa92cf3c9276fb18214d29ad790023`, and manifest SHA-256 `c2a17c9d17da123940e1432a957e5ced31be9f2977c3df7530deaacaa5ce361f`. R2 changes only the Web-owned synthetic skill name to `合成技能示例（修訂2）`; its official source text and Source claim stay byte-for-byte unchanged.

`UnitT10` tests an explicit `0.0.1` to `0.0.2` rebuild. `UnitT41` reconstructs exact historical R1 and A inputs before exercising the fixed R1 helper; `UnitT42` models a clean rollback commit B with the same pinned inputs. Both verify the immutable R1, A, and baseline data rows. These tests cover the historical R2-to-R1 helper path, not a rollback of the current real `.3` through `.7` candidate sequence.

The published `.6` candidate pins public Source commit `a205df69621d308a3d4b57461ec8128e359b48e3`, Source revision `1a92c29a928bcd766a453b69555930bfb5d57c86b3dfbd593b34bac29404f20d`, and manifest SHA-256 `c96229dfeeae86b3656648aada1119b4a3909d20fd8c444d676617d6e2ac0d79`. It contains a small Psyker skill, Chainaxe blessing variant, weapon, and term representative. The `.7` candidate pins public Source commit `f216b61e78b5507877645623950b954c1f8ec01b`, Source revision `b4068895536183ee34d3beff4d6741c8d6355c3912dd7e8bb1955c110d7d7ddc`, and manifest SHA-256 `64cb59aa48064f5e2cc31a6279fa8ba074bee1a4659830658da7cae5805ae982`. Its composition request is `129206296273443d716f4e310ed08fb9c75570330ada67a580f3e8c6c7107084`, with technical artifact SHA-256 `2dd339a8133e587c4f1d5381673f96e054d5d0d829ead3af6c7a253dd66f2272`; the Source `game-changes` set is empty. The `.7` candidate keeps the inherited Psyker analysis and adds Source-owned evidence for its existing damage and warp-charge details. It also references the byte-exact English archive at `https://github.com/SyuanTsai/Warhammer-40-000-DARKTIDE-Mods`, commit `241ad76ce62330472aa423055a5b85db59bb6c0d`, path `Game Info/releases/1.13.X/skills/talents/Psyker/en/psyker_brain_burst_improved.md`. This reference preserves historical analysis provenance; it does not assert current game-version compatibility or measured runtime behavior. Source owns numeric values and code evidence, while Web authoring supplies the exact official EN and zh-TW strings and player-facing details. The existing Psyker evidence narrows the 1.5 multiplier to the matching damage-type branch and its multiplication into `damage_multiplier`; it does not resolve later calculation stages or final damage. The inherited charge examples remain estimates under their stated attack-speed and modifier assumptions; they do not add a calculator or new assumptions. The announcement describes review status and does not announce a game change.

Native official text preserves each locale's original text, ordered segments, source identity, and hash. A zh-TW string with `origin: "official"` is kept as official game text, not labeled a translation. Numeric placeholders bind to fixed Source claims: percentage display values require `code-derived` claims whose property starts with `description.format_values.<parameter>.`; the only plain-number exception is the code-observed `time` parameter for `template.buff_override.active_duration` in seconds. The raw `1.5` ratio remains a Source mechanic value and cannot populate the official damage placeholder; the displayed `+50%` is the separate description-format claim. The compiler generates resolved parameter strings from these inputs; Web authoring does not type numeric output values.

This candidate remains `pending-preview`, `fixtureOnly: false`, `publicationEligible: false`, and `candidatePreviewOnly: true`. The page shows a brief Traditional Chinese notice that the wording and game version are unverified and the content is pending review. The package retains its exact compatibility metadata checks; technical pin details are not shown to players. No human review receipt is included.

The real representative preview shows the original Traditional Chinese game text unchanged. Detail sections render as lists, and only the approved Psyker and blessing images are shown with visible Games Lantern credit. No weapon image is available in the approved inputs, so the weapon card has no image.

## Build and retain the old data URLs

The current preview workflow uses one clean `dist-w01` output and runs these steps in order:

1. Build the pinned production baseline at commit `8a4b3db2b1e835f0757f387ca89a19b9092b35ee`.
2. Build exact R1 from `872bd72bad255d40af62329b8ffe97a357935275` into `dist-w01`, retain the baseline data, and verify.
3. Build published A from `a7fabea66f56cd5c8236b6e84a3f6c6586175840` into the same output, retain the baseline data again, and verify.
4. Build the exact published `.3` candidate from Web commit `e516a5b896f78273544c16047126c327337a8424` into the same output, retain baseline data, and verify its existing data URLs.
5. Freeze that verified `.3` package in runner temp storage, then check out the exact published `.4` source (`b401ae50d7ebb7e44aeb59a8c864a8b93628aead`) and rebuild it into the same output. Retain baseline data, verify `.4`, and freeze that package for lifecycle tests.
6. Check out exact published `.5` source `a09863ceac2bfca3944d09081c315d62b704563c`, rebuild it into the same output, retain baseline data, verify it, and freeze that package for lifecycle tests.
7. Check out exact published `.6` source `f2a465e9858e57c3a4850126522dacc71226453d`, rebuild it into the same output, retain baseline data, verify it, and freeze that package for lifecycle tests.
8. Build the current `.7` candidate from the branch checkout into the same output, retain the baseline again, and verify the package. Run lifecycle tests with the frozen exact `.3`, `.4`, `.5`, and `.6` packages, then upload and deploy the verified `.7` artifact only to the fixed preview worker.

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
    npm --prefix <web-checkout> run w01:build -- --candidate-preview --output dist-w01
    npm --prefix <web-checkout> run w01:retain -- --baseline-root <pinned-base-checkout> --output dist-w01
    npm --prefix <web-checkout> run w01:verify -- dist-w01

The baseline checkout must be commit 8a4b3db2b1e835f0757f387ca89a19b9092b35ee. The copier checks every one of the 2,277 old data paths, sizes, and SHA-256 hashes against docs/w01/retained-preview-manifest.json, refuses to overwrite different bytes, and records the retained inventory in the W01 receipt. The old data revision remains 0ae547d78d49c5d5c46b991df3736f9d868eebd98e902b1a62426dc075d3884b. The W01 preview uses a new immutable data revision and includes no old index, version, or runtime files.

The preview is written only to dist-w01. Fixture output identifies preview-only content; candidate output shows the short pending-review notice. Both include `X-Robots-Tag: noindex` and the fixed preview CORS headers, and remain publication-ineligible. Pull requests build and upload the isolated artifact. A push to `codex/SYP-311-w01` deploys only `wrangler.w01-preview.json` after checking the repository, branch, and freshly fetched branch head; the Cloudflare token is scoped to that deploy step. A separate receipt records remote version, manifest, domain, and retained-baseline verification.

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

This section documents the historical B/fixed-R1 helper validation path. It is not the current preview deployment workflow: current pushes reconstruct baseline, R1, published A, and the exact published `.3` through `.6` candidates before building pending `.7`. The current workflow does not invoke this helper. The helper remains the exact historical `0.0.2`-to-`0.0.1` recovery path; whole-preview rollback for the real `.3` through `.7` sequence requires a separately pinned release identity and reviewed selector before use.

The historical helper command is:

    npm run w01:rollback-r1 -- --expected-r2-commit <exact-R2-SHA> --source-root <pinned-R1-checkout> --baseline-root <pinned-base-checkout>

It verifies the active receipt's authoring commit against `--expected-r2-commit`, requires a clean R1 checkout at the fixed SHA, rebuilds R1 into the same output, and confirms all prior content-addressed data URLs remain byte-identical. It does not deploy by itself and does not accept an arbitrary R1 ref. The historical B/R2 rollback contract verifies this helper locally; it is not used by the current preview workflow.

## Fixed real-candidate preview recovery

The fixed preview recovery run restored the exact published `.3` runtime from Web commit `e516a5b896f78273544c16047126c327337a8424` after rebuilding and verifying the exact published `.4` package from commit `b401ae50d7ebb7e44aeb59a8c864a8b93628aead`. The recovery helper accepts only those pinned package identities and their exact receipts, checks every listed file and path, copies `.3` runtime files, and unions the verified `.4` `data/` rows. Any shared immutable path must have identical bytes. It verifies the staged result before replacing the active output; the `.4` output remains as a same-parent backup, and a failed replacement restores it. The restored package uses `.3` version/build/manifest identity and retains all `.4` data URLs. The current `.7` workflow rebuilds the exact published `.3`, `.4`, `.5`, and `.6` packages for lifecycle tests, then builds `.7` while retaining all earlier immutable data URLs.

The workflow writes a public-safe recovery proof with the controller commit that ran the recovery, the unchanged `.3` and `.4` compiler/source identities, both input receipt hashes, the retained `.4` data inventory digest, and the final receipt hash. It contains no local paths or private source material. The helper does not build a release or deploy; only the existing guarded workflow deploys the verified `dist-w01` to the fixed preview worker.

## Candidate pull request

After the candidate branch is committed and pushed, run npm run w01:pr from the fixed W01 branch. It uses the local gh CLI to reuse an existing open PR for that branch or create one if none exists. It refuses to silently reopen or duplicate a closed PR. Fixture and sanitized native pending-preview composition receipts are accepted only while publication and formal publishing remain disabled; PR text keeps human content review pending and does not label a native candidate as a fixture. Git push updates the existing branch; the script does not push code.
