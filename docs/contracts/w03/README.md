# W03 extension ledger

This is a deterministic, read-only scope and mapping inventory. Every row remains `planned` with `actualOutcome.status=not-started`; prior review states are not inherited. It does not migrate content, approve claims, or establish global current-game completeness.

## Ownership and version scope

- Web published content is pinned as historical game version 1.13.1; it is not a current package count. Talent-tree graph/layout stays a retained historical artifact because the formal Source v2 contract has no graph/layout target shape.
- Source v2 schema and representative fixture are pinned to 15f285ec3ad9314435141a18125cabfc1b3d1d19; the fixture is synthetic. W01 candidate records and the narrow two-claim audit remain separately pinned; the approval is not carried to any other row.
- The coverage report separately counts known values, known-zero values, unknown values, and NOT_IMPORTED fields for the fixed 125-record W01 representative candidate. Its two NOT_IMPORTED action/profile-resolution gaps are not converted into unknown values; this is representative scope, not a full-game completeness claim.
- Extension's 26 declared inputs are verified against the fixed release manifest. Its global inputCommit is e24f8bd0501ddd901f8d7583f445bda60c4f80b0; the two documented path-level source-commit exceptions are preserved in scope-manifest.json. Five local review overlays are represented only by path, status, size, and hashes; their bodies are not copied.
- Source-code registry has 57 groups (1 empty) and 203 unique template IDs. Registry membership does not establish player availability or full-build equivalence.
- Private input and Mods local delta details are limited to safe aggregate metadata.

## Hash domains and verification

`git-blob` rows bind an exact whole-file Git object. `raw` line ranges hash exact UTF-8 bytes, including newline bytes and using byte offsets. JSON and static-JavaScript pointers use parsed-value `JSON.stringify(value)` UTF-8 SHA-256; this is not a raw-source-byte hash.

Run `node scripts/content/contract-w03-ledger.mjs` to verify the checked A ledger and its frozen Mods index offline. A extension shards use deterministic gzip payloads in LF-safe JSON/base64 containers; the verifier checks both compressed and uncompressed hashes with a bounded decompression limit. Rebuild only with the fixed roots and `--generate`; generation fails unless repository HEADs, source blobs, and protected input state match the recorded pins.

## Formal W02 owner contracts

The formal Source/Web contract references are verified from their fixed owner-locked Git objects. Extension's formal W02 owner/C2 contract pin is 5a09f3628208550cca8696655f3012c23c53d5e5; the b18 legacy snapshot and its e24 manifest inputs remain a separate historical inventory. The C2 receipt is referenced by SHA-256 in scope-manifest.json and is not treated as runtime integration or publication approval.
