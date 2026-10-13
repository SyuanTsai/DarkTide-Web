# W01 preview workflow

The W01 package is a fixture-only, publication-ineligible candidate. The existing production build and deploy commands are separate and are not used by this workflow.

## Compose the pinned Source request

In the Source checkout, run:

    npm test
    npm run content:preview
    npm run content:request

The request file is written under dist-w01/requests/<sourceRevision>-<commit>.json and contains only the Source repository, commit, sourceRevision, and manifest SHA-256.

In the Web candidate checkout, run:

    npm run w01:compose-source -- --request <request-json> --source-root <Source-checkout>

The composer verifies the Source repository origin, exact HEAD commit, manifest pin, and generated technical/game-change artifact hashes. It updates source.lock.json and the exact generated Source bytes, then writes content/w01/composition-receipt.json with the request digest, candidate branch, lock digest, and artifact hashes. Repeating the same request is a no-op. Web-owned official text, term localization, errata, and announcements remain in web-authoring.json.

## Version and build the preview

`content/w01/release.json` pins the public fixture content version. It begins at `0.0.1`; a later content revision can set `0.0.2`. The compiler accepts an explicit `--content-version major.minor.patch` when rebuilding a historical release. The resolved version is included in the data revision and must agree across the manifest, `version.json`, and the build receipt.

R1 `0.0.1` is pinned to Web commit `872bd72bad255d40af62329b8ffe97a357935275`. Published R2 A is pinned to Web commit `a7fabea66f56cd5c8236b6e84a3f6c6586175840`, package version `0.0.2`, data revision `954cbfaec4340d6237913c0edae39967ff28c55fee7b372bc74367a95a85d292`, build ID `1aea7c152c5383457f7b87e38f7c840bc7fa92cf3c9276fb18214d29ad790023`, and manifest SHA-256 `c2a17c9d17da123940e1432a957e5ced31be9f2977c3df7530deaacaa5ce361f`. R2 changes only the Web-owned synthetic skill name to `合成技能示例（修訂2）`; its official source text and Source claim stay byte-for-byte unchanged.

`UnitT10` tests an explicit `0.0.1` to `0.0.2` rebuild. `UnitT41` checks the helper against the current checkout, while `UnitT42` models a clean rollback commit B: it rebuilds fixed R1 and the baseline, rebuilds exact published A, then restores fixed R1 and verifies the immutable R1, A, and baseline data rows. The rollback workflow does not build R2 from B's authoring commit.

## Build and retain the old data URLs

Build the W01 preview, rebuild the fixed prior Web revision in a separate checkout, then retain and verify its complete old data subtree:

    npm run w01:build
    npm --prefix <pinned-base-checkout> run build
    npm run w01:retain -- --baseline-root <pinned-base-checkout>
    npm run w01:verify

The baseline checkout must be commit 8a4b3db2b1e835f0757f387ca89a19b9092b35ee. The copier checks every one of the 2,277 old data paths, sizes, and SHA-256 hashes against docs/w01/retained-preview-manifest.json, refuses to overwrite different bytes, and records the retained inventory in the W01 receipt. The old data revision remains 0ae547d78d49c5d5c46b991df3736f9d868eebd98e902b1a62426dc075d3884b. The W01 preview uses a new immutable data revision and includes no old index, version, or runtime files.

The preview is written only to dist-w01. It displays the fixture warning, includes `X-Robots-Tag: noindex` and public-fixture CORS headers, and remains publication-ineligible. Pull requests build and upload the isolated artifact. A push to `codex/SYP-311-w01` deploys only `wrangler.w01-preview.json` after checking the repository, branch, and freshly fetched branch head; the Cloudflare token is scoped to that deploy step. A separate receipt records remote version, manifest, domain, and retained-baseline verification.

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

The rollback workflow reconstructs the output from clean pinned inputs in this order: build baseline, build and retain exact R1, rebuild and retain exact published R2 A (`a7fabea66f56cd5c8236b6e84a3f6c6586175840`), verify A, then run the fixed-R1 helper and verify the restored package. The exact A checkout is separate from rollback candidate B, so the R2 data revision remains byte-identical to the deployed A package.

The helper command is:

    npm run w01:rollback-r1 -- --expected-r2-commit <exact-R2-SHA> --source-root <pinned-R1-checkout> --baseline-root <pinned-base-checkout>

It verifies the active receipt's authoring commit against `--expected-r2-commit`, requires a clean R1 checkout at the fixed SHA, rebuilds R1 into the same output, and confirms all prior content-addressed data URLs remain byte-identical. It does not deploy by itself and does not accept an arbitrary R1 ref. The workflow's preview-only deploy step publishes the resulting R1 runtime after verifying the exact branch head; the deployment receipt records R1 as active while retaining R2 A and baseline data URLs.

## Candidate pull request

After the candidate branch is committed and pushed, run npm run w01:pr from the fixed W01 branch. It uses the local gh CLI to reuse an existing open PR for that branch or create one if none exists. It refuses to silently reopen or duplicate a closed PR. Git push updates the existing branch; the script does not push code.
