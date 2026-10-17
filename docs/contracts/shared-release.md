# Shared release metadata contract

This document describes the Web-owned version index and shared release manifest in [shared-release.schema.json](../../content/schema/v2/shared-release.schema.json). The schema is JSON Schema Draft 2020-12; the importable validator and read-only CLI are [contract-release.mjs](../../scripts/content/contract-release.mjs). The synthetic examples live under `content/fixtures/v2/shared-release/`.

This package defines metadata shape, byte integrity, patch selection, and file dependency checks. A successful validation means only that those checks passed. It does not verify that a Git commit or game snapshot exists, that Source or Web review is complete, or that publication is approved. Unknown or pending evidence is not converted into approval.

## Version and release pointers

`version.json` keeps the existing `schema_version`, `data_revision`, `build_id`, `game_version`, and `package_kind` fields. The formal schema accepts `schema_version: 2` and `package_kind: "published"`, and adds `game_releases`. Each supported game patch has exactly one pointer containing that patch's `content_version`, `data_revision`, manifest path, and exact manifest-byte SHA-256. A content version has four numeric parts: the three-part game version followed by a positive content revision, such as `1.13.2.1`.

The top-level `game_version` selects the default entry in `game_releases`; its `data_revision` must equal that entry. Consumers select by exact game patch with `selectGameRelease(version, gameVersion)`. The helper never chooses the numerically or lexically greatest content version across unrelated patches, so a supported older patch or a lower restored revision remains selectable.

Manifest paths follow the established same-origin shape `/data/{dataRevision}/manifest.json`. Re-running the same digest keeps the same manifest URL and release pointer; the release allocator must reuse that digest's existing `contentVersion` rather than overwrite it. A manifest embeds its patch identity, so one version index cannot reuse the same manifest path for different game patches. A rollback replaces the pointer for the selected patch with the older immutable manifest and its original `dataRevision`; exact-patch selection remains independent of any global maximum. Domain bytes are stored at `/data/{dataRevision}/{file.path}` and are shared by every consumer that selects them.

## Manifest and file metadata

Each manifest pins the public Source repository, a 40-character Source commit, Source revision and Source manifest SHA-256 values, plus Web authoring and compiler commits. Compatibility metadata carries `dataContractMajor`, a closed set of required features, and `gameSnapshotRefs` identifiers. The known required features are `official-errata-details-v1`, `official-native-localizations-v1`, and `blessing-tier-presentations-v1`. The blessing tier presentation feature requires native localizations; unknown features remain invalid until the contract and consumer support them.

The manifest can represent these existing domains: `skills`, `blessings`, `weapons`, `terms`, `catalog`, `curios`, `perks`, `classifications`, `announcements`, and `game-changes`. A package contains only the domains it publishes; consumers pass their own `requiredKinds` and `supportedKinds` to `selectConsumerFiles`. The helper checks that required kinds are supported and returns their transitive file dependencies. Consumer requirements are not copied into the shared manifest.

Every file row has a domain kind, relative `.json` path, exact byte size, SHA-256, and dependency paths. Paths use a restricted ASCII form and reject traversal, schemes, percent encoding, backslashes, absolute paths, empty segments, and case-insensitive collisions. Dependencies must point to listed files and form an acyclic graph. `changeIndexPath` is either `null` or points to a listed `game-changes` file.

An `announcements` file retains its own site or announcement scope inside that domain's JSON. Its presence does not create a game change, require a `game-changes` file, or attach individual announcement records to a game release. In particular, a site-only announcement update must not be interpreted as an official gameplay update. This metadata validator does not implement announcement publishing or game-version allocation.

Unknown properties are rejected. The shared manifest has no consumer projection, extension data, delivery revision, remote code, JavaScript selector template, or formula field. This metadata contract checks domain bodies only as UTF-8 JSON objects with exact byte sizes and hashes. The later fixed Web domain contract owns semantic validation of those records; this package does not claim to reject every code-like selector or other semantic construct inside an otherwise valid JSON body.

## Revision and hash order

`dataRevision` is the SHA-256 of a canonical content index. The index contains the fixed `source`, `web`, and `compatibility` tables, file metadata rows, and `changeIndexPath`. Its object keys are sorted lexically; file rows are sorted by UTF-8 path bytes; dependency, feature, and snapshot arrays are sorted by UTF-8 bytes. The compact UTF-8 JSON serialization is hashed without a trailing newline.

The index excludes `gameReleaseId`, `gameVersion`, `contentVersion`, its own `dataRevision`, the manifest's generated SHA, and all of `version.json`. The Source manifest SHA is included because it is a fixed input pin. This prevents a self-reference: domain bytes determine file hashes; the canonical content index determines `dataRevision`; exact manifest bytes determine the pointer's `manifest_sha256`; and `version.json` points to that manifest. `build_id` retains its existing site-build meaning and is not a substitute for `dataRevision`.

## Synthetic fixtures and validation

Every fixture has a sibling `fixture.json` marker with `fixtureOnly: true` and `publicationEligible: false`. Fixture pins and domain records are synthetic. The validator rejects a marker claiming publication eligibility, validates the actual `version.json`, manifest, and listed domain bytes, and rejects missing or unlisted files. The fixture package's `package_kind: "published"` value exercises the formal version shape only; the marker keeps the package explicitly non-publishable.

Run the CLI against either fixture directory:

```powershell
node scripts/content/contract-release.mjs --root content/fixtures/v2/shared-release/valid
node scripts/content/contract-release.mjs --root content/fixtures/v2/shared-release/announcement-only
```

The export API includes `validateVersion`, `validateManifest`, `validateFixtureMarker`, `computeDataRevision`, `validateReleaseDirectory`, `selectGameRelease`, and `selectConsumerFiles`. It uses only Node built-ins and performs no network access or writes. The CLI's success message explicitly reports structural validation, not publication approval.

This change does not alter `src/static/build.mjs`, W01's 0.0.17 preview, package scripts, deployment, or any runtime consumer. Formal site/compiler integration remains in the later owner packages (including the assigned W05 and W08–W12 work); this contract is not evidence that W01 or a production loader has adopted it.
