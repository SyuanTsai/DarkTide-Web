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

The initial preview workflow builds R1 `0.0.1` from a clean runner. When R2 is prepared, its workflow update must check out the exact published R1 commit SHA, rebuild and verify that package, retain its data URLs, then compile the current release. The local R1-to-R2 contract test exercises the same output-retention sequence; the CI pin will be added after the R1 commit exists.

## Build and retain the old data URLs

Build the W01 preview, rebuild the fixed prior Web revision in a separate checkout, then retain and verify its complete old data subtree:

    npm run w01:build
    npm --prefix <pinned-base-checkout> run build
    npm run w01:retain -- --baseline-root <pinned-base-checkout>
    npm run w01:verify

The baseline checkout must be commit 8a4b3db2b1e835f0757f387ca89a19b9092b35ee. The copier checks every one of the 2,277 old data paths, sizes, and SHA-256 hashes against docs/w01/retained-preview-manifest.json, refuses to overwrite different bytes, and records the retained inventory in the W01 receipt. The old data revision remains 0ae547d78d49c5d5c46b991df3736f9d868eebd98e902b1a62426dc075d3884b. The W01 preview uses a new immutable data revision and includes no old index, version, or runtime files.

The preview is written only to dist-w01. It displays the fixture warning, includes `X-Robots-Tag: noindex` and public-fixture CORS headers, and remains publication-ineligible. Pull requests build and upload the isolated artifact. A push to `codex/SYP-311-w01` deploys only `wrangler.w01-preview.json` after checking the repository, branch, and freshly fetched branch head; the Cloudflare token is scoped to that deploy step. A separate receipt records remote version, manifest, domain, and retained-baseline verification.

When rebuilding into an existing dist-w01, the compiler first checks the prior receipt and every listed file hash. It keeps prior content-addressed data revisions byte-for-byte, replaces the preview runtime files, and writes a receipt covering both the prior data URLs and the new build. Unlisted or changed prior files make the rebuild fail closed.

## Candidate pull request

After the candidate branch is committed and pushed, run npm run w01:pr from the fixed W01 branch. It uses the local gh CLI to reuse an existing open PR for that branch or create one if none exists. It refuses to silently reopen or duplicate a closed PR. Git push updates the existing branch; the script does not push code.
