# Web authoring contract v2

The file **content/schema/v2/web-authoring.schema.json** defines the Web-owned authoring format. The validator in **scripts/content/contract-authoring.mjs** checks the Draft 2020-12 schema, cross-file ownership and references, immutable official excerpts, review dependencies, and the pinned Source contract. The entry point is separate from the W01 preview loader and does not connect this contract to a renderer or publisher.

## Ownership and fixed inputs

Web owns the minimum official English excerpt and its locator, exact UTF-8 source string, ordered text and parameter segments, parameter bindings, resolved string, and hashes. The accompanying faithfulTranslation is explicitly marked as a translation rather than official localized text. Official excerpts must exactly match the separate safe input snapshot at **content/fixtures/v2/web-authoring/official-inputs.json**; changing both an excerpt and its local hashes does not replace the pinned input bytes.

The fixtures are synthetic and always have publicationEligible set to false. The weapon example intentionally preserves the official rendered value **40** while its Source claim uses **0**. The validator keeps these as separate owner fields, so the mechanics claim cannot rewrite an official string.

Web stores errata separately from official wording. Each erratum binds a unique segment ID and hash from that presentation's own fixed official source and cites typed Source claim and evidence records. A change to the official segment invalidates the anchor and the relevant review digest.

**content/contracts/source-v2.lock.json** pins the Source repository, commit, schema ID, and raw SHA-256 for the Source schema, representative fixture, and validator. The files under **content/contracts/source-v2-snapshot/** are an immutable offline cache copied byte-for-byte from those Source Git blobs. Source remains the sole owner of technical schema and records; the cache is verified before importing the Source validator and does not create an editable Web copy.

## References and presentation

Record references use the tuple (recordId, gameReleaseId, kind). Same-release references are the default. A cross-release reference must include the Source-owned release-compatibility record that covers the exact earlier-to-current release pair. Wrong-kind, dangling, mismatched, or unsupported references fail validation. Blessing tier presentations are checked against the referenced Source blessing variant's defined tiers.

Presentation records cover skills, blessings, weapons, catalog entries, curios, perks, and classifications. Detail sections use a unique ordered subset of effects, conditions, calculation, notes, and extra; empty sections can be omitted. Individual item text, presentation names, and term label/definition have separate content-review targets. Claim and term references stay typed. Web carries no mechanics values, formulas, executable expressions, selectors, matcher programs, or MOD impact fields.

Term localization is scoped to a Source term and must keep its Source context key. Announcements are ordered Web blocks with a date, revision, source metadata, and optional asset metadata. Heading, paragraph, link, list item, table cell, image occurrence, and spoiler container each carry a stable blockId; spoiler contents remain ordered nested blocks. Image occurrences reference declared asset metadata by assetId, so the same asset can appear more than once without collapsing its occurrence order. Site announcements do not require a game release; gameplay announcements must name a pinned release and cite an official game source. Validation records asset metadata only and does not fetch or add images.

## Game changes and review receipts

Web summaries of technical changes use the same changeId and typed Source game-change record. Each field summary must name a field in that Source record's changedFields; a Web summary may cover a subset and does not duplicate Source before/after values. Official-text changes compare two pinned official inputs for the same stable entity and two ordered Source releases. The pair must differ by game version or build, have distinct verified snapshots, and contain a real difference in source/resolved text or ordered parameter binding; different locators, IDs, hashes, or release metadata alone do not constitute a text change. Correction chains use supersedesChangeId. An empty game-change list is valid.

Review targets name an owner, a field path relative to that owner, and a review dimension. A receipt binds the resulting field digest and dependency digest. Content review can target presentation names, individual detail/errata text, term label/definition, and a whole game-change fieldSummaries collection or an individual field summary; context review can target blessing applicability, errata context, and a term's context key. Game-change field-summary receipts depend on their referenced Source game-change record. Dependencies include fixed official inputs only for wording that depends on them, bounded Source closures for typed claim/context refs, the Source identity/context needed by names and term labels, and the Source release/content snapshots used by gameplay announcements or official-text comparisons. Term definitions additionally depend on the referenced Source term's technicalDefinitionEn field and its typed claim/evidence closure; changing that definition or a linked claim stales the definition review, while unrelated claims and commit-only changes do not. Technical field changes do not stale presentation names or term-label review. The Source Git commit itself is trace metadata and does not stale content when the referenced bytes stay the same. Translation edits stale translation review without staling unrelated detail review. Review state is derived from receipts as pending, approved, rejected, or stale; there is no writable approval-state field. A human reviewer value is provenance metadata and does not authenticate a person's identity. These receipts do not grant publication eligibility.

## Validation

Run the offline representative fixture check:

    node scripts/content/contract-authoring.mjs

The command verifies the locked Source snapshot and its representative fixture without network access or a sibling checkout. A reviewer with the matching Source checkout can additionally compare the real files and Git commit:

    node scripts/content/contract-authoring.mjs --source-root <Source-checkout>

The offline check is included as npm run contract:validate. It validates the W02 contract only. It does not migrate W01 content, change W01 preview behavior, integrate a production compiler or loader, or authorize release or deployment.
