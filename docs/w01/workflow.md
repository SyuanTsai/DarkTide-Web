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

`content/w01/release.json` pins the content version for the isolated package. Historical fixture R1 is `0.0.1`; published synthetic R2 A is `0.0.2`; the current real representative candidate uses pending preview version `0.0.3`. The compiler accepts an explicit `--content-version major.minor.patch` when rebuilding a historical release. The resolved version is included in the data revision and must agree across the manifest, `version.json`, and the build receipt.

R1 `0.0.1` is pinned to Web commit `872bd72bad255d40af62329b8ffe97a357935275`. Published R2 A is pinned to Web commit `a7fabea66f56cd5c8236b6e84a3f6c6586175840`, package version `0.0.2`, data revision `954cbfaec4340d6237913c0edae39967ff28c55fee7b372bc74367a95a85d292`, build ID `1aea7c152c5383457f7b87e38f7c840bc7fa92cf3c9276fb18214d29ad790023`, and manifest SHA-256 `c2a17c9d17da123940e1432a957e5ced31be9f2977c3df7530deaacaa5ce361f`. R2 changes only the Web-owned synthetic skill name to `合成技能示例（修訂2）`; its official source text and Source claim stay byte-for-byte unchanged.

`UnitT10` tests an explicit `0.0.1` to `0.0.2` rebuild. `UnitT41` reconstructs exact historical R1 and A inputs before exercising the fixed R1 helper; `UnitT42` models a clean rollback commit B with the same pinned inputs. Both verify the immutable R1, A, and baseline data rows. These tests cover the historical R2-to-R1 helper path, not a rollback of the current real `0.0.3` candidate.

The current `candidate-preview` input pins public Source commit `83fdd201f67c6c490f32832419ea61353d7066d1`, Source revision `b48a8e6dcf61dcfbd8ca4ea8a89ebd636216c70907d82bd9fe6587b19c31851e`, and manifest SHA-256 `7546a19ff3396c712586e62af58d38d0ae707df1b279633de47658de091043f1`. It contains a small Psyker skill, Chainaxe blessing variant, weapon, and term representative; the Source domains supply numeric claims, while Web authoring supplies the exact official EN and zh-TW strings and presentation. `game-changes` remains empty for this Source snapshot.

Native official text preserves each locale's original text, ordered segments, source identity, and hash. A zh-TW string with `origin: "official"` is kept as official game text, not labeled a translation. Numeric placeholders bind to fixed Source claims: percentage display values require `code-derived` claims whose property starts with `description.format_values.<parameter>.`; the only plain-number exception is the code-observed `time` parameter for `template.buff_override.active_duration` in seconds. The raw `1.5` ratio remains a Source mechanic value and cannot populate the official damage placeholder; the displayed `+50%` is the separate description-format claim. The compiler generates resolved parameter strings from these inputs; Web authoring does not type numeric output values.

This candidate remains `pending-preview`, `fixtureOnly: false`, `publicationEligible: false`, and `candidatePreviewOnly: true`. Its preview banner says compatibility between the pinned source snapshot and Steam Build 25681127 is unverified and that content review is pending. No human review receipt is included.

## Build and retain the old data URLs

The current preview workflow uses one clean `dist-w01` output and runs these steps in order:

1. Build the pinned production baseline at commit `8a4b3db2b1e835f0757f387ca89a19b9092b35ee`.
2. Build exact R1 from `872bd72bad255d40af62329b8ffe97a357935275` into `dist-w01`, retain the baseline data, and verify.
3. Build published A from `a7fabea66f56cd5c8236b6e84a3f6c6586175840` into the same output, retain the baseline data again, and verify.
4. Build the current pending `0.0.3` candidate into that output, retain the baseline data again, and verify the candidate plus all prior data URLs.

The equivalent local commands must be run from the indicated pinned checkouts, in the same order:

    npm --prefix <pinned-base-checkout> run build
    npm --prefix <pinned-r1-checkout> run w01:build -- --output <web-checkout>/dist-w01
    npm --prefix <pinned-r1-checkout> run w01:retain -- --baseline-root <pinned-base-checkout> --output <web-checkout>/dist-w01
    npm --prefix <pinned-r1-checkout> run w01:verify -- <web-checkout>/dist-w01
    npm --prefix <published-a-checkout> run w01:build -- --output <web-checkout>/dist-w01
    npm --prefix <published-a-checkout> run w01:retain -- --baseline-root <pinned-base-checkout> --output <web-checkout>/dist-w01
    npm --prefix <published-a-checkout> run w01:verify -- <web-checkout>/dist-w01
    npm --prefix <web-checkout> run w01:build -- --candidate-preview --output dist-w01
    npm --prefix <web-checkout> run w01:retain -- --baseline-root <pinned-base-checkout> --output dist-w01
    npm --prefix <web-checkout> run w01:verify -- dist-w01

The baseline checkout must be commit 8a4b3db2b1e835f0757f387ca89a19b9092b35ee. The copier checks every one of the 2,277 old data paths, sizes, and SHA-256 hashes against docs/w01/retained-preview-manifest.json, refuses to overwrite different bytes, and records the retained inventory in the W01 receipt. The old data revision remains 0ae547d78d49c5d5c46b991df3736f9d868eebd98e902b1a62426dc075d3884b. The W01 preview uses a new immutable data revision and includes no old index, version, or runtime files.

The preview is written only to dist-w01. Fixture output displays a fixture warning; candidate output displays the pending-review and unverified-compatibility warning. Both include `X-Robots-Tag: noindex` and the fixed preview CORS headers, and remain publication-ineligible. Pull requests build and upload the isolated artifact. A push to `codex/SYP-311-w01` deploys only `wrangler.w01-preview.json` after checking the repository, branch, and freshly fetched branch head; the Cloudflare token is scoped to that deploy step. A separate receipt records remote version, manifest, domain, and retained-baseline verification.

When rebuilding into an existing dist-w01, the compiler first checks the prior receipt and every listed file hash. It keeps prior content-addressed data revisions byte-for-byte, replaces the preview runtime files, and writes a receipt covering both the prior data URLs and the new build. Unlisted or changed prior files make the rebuild fail closed.

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

This section documents the historical B/fixed-R1 helper validation path. It is not the current preview deployment workflow: current pushes build and publish the pending `0.0.3` candidate after reconstructing baseline, R1, and published A in that order. The current workflow does not invoke this helper. The helper remains the exact historical `0.0.2`-to-`0.0.1` recovery path; rollback for the real `0.0.3` candidate and a later `0.0.4` update still require a separately pinned release identity and reviewed selector before use.

The helper command is:

    npm run w01:rollback-r1 -- --expected-r2-commit <exact-R2-SHA> --source-root <pinned-R1-checkout> --baseline-root <pinned-base-checkout>

It verifies the active receipt's authoring commit against `--expected-r2-commit`, requires a clean R1 checkout at the fixed SHA, rebuilds R1 into the same output, and confirms all prior content-addressed data URLs remain byte-identical. It does not deploy by itself and does not accept an arbitrary R1 ref. The historical B/R2 rollback contract verifies this helper locally; the current candidate workflow independently publishes the pending `0.0.3` package to the fixed preview worker after verifying the retained baseline, R1, and A data.

## Candidate pull request

After the candidate branch is committed and pushed, run npm run w01:pr from the fixed W01 branch. It uses the local gh CLI to reuse an existing open PR for that branch or create one if none exists. It refuses to silently reopen or duplicate a closed PR. Git push updates the existing branch; the script does not push code.
