# Split weapon and blessing domains

Shared releases may use either the historical four-core-domain layout or the split layout. A manifest must never mix the two layouts.

The split layout declares the `split-weapon-blessing-domains-v1` compatibility feature and contains:

- `domains/weapons-index.json` (`weapons-index`), with no dependencies.
- `domains/weapons/<familyId>.json` (`weapon-family`), depending only on `domains/weapons-index.json`.
- `domains/blessings-index.json` (`blessings-index`), with no dependencies.
- `domains/blessings/<slug>.json` (`blessing`), depending only on `domains/blessings-index.json`.
- The unchanged `skills` and `terms` domains and any existing optional domains.

`familyId` is the Source weapon payload's exact family ID. A blessing slug removes a leading `darktide:blessing:` and replaces every character outside `[A-Za-z0-9._-]` with `-`; slug collisions fail the build. Manifest rows are sorted by UTF-8 path.

List indexes contain the main Source records, release-compatibility records, and the minimum reviewed Web presentation needed for the list. Detail shards contain the complete typed Source and Web closure for that family or blessing.

## Browser loading

| Route | Files |
| --- | --- |
| Weapon list | weapons index |
| Weapon family or mark | weapons index, one family shard, blessings index |
| Blessing list | blessings index |
| Blessing detail | blessings index, one blessing shard, weapons index |
| Skills | skills and terms |

Every file remains limited to 16 MiB and every selected route remains limited to 24 MiB, including its manifest bytes. Historical legacy manifests keep their existing loading and rendering behavior.

The blessing index keeps every tier option in its original position but projects non-list tiers to their tier number. For each list tier it retains only the full zh-TW official reference, keeping other locale entries as positional projections; detail shards retain the full presentations.
