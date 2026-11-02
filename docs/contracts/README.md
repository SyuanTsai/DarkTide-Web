# Contract evidence archive

Large, reproducible contract-analysis evidence is stored in the GitHub Release
`contracts-archive-20261103`, rather than the normal checkout. Its immutable
inventory and digests are in [ARCHIVE.json](ARCHIVE.json).

To restore it before using a manual evidence CLI, run:

```powershell
node scripts/contracts-archive.mjs restore
```

Restoration downloads the declared Release asset, checks its SHA-256 and every
file's SHA-256, then writes only verified paths. It refuses to overwrite an
existing restore target. Restored files are working copies only: do not commit
them. The paths are intentionally not in `.gitignore`, because active W09
candidate and W14–W17 work still writes new files into some of these directories.

Run the restore command before using `scripts/content/contract-w17-retirement.mjs`,
`scripts/content/w15-migration-report.mjs`, `scripts/content/contract-w03-ledger.mjs`,
`scripts/content/contract-w14-ledger.mjs`, or `scripts/content/build-w14-*.mjs`,
or another manual contract-analysis command that needs archived evidence. The
fixture generator also reads archived evidence, so restore first before running
`node scripts/contracts-fixtures.mjs`.

To reproduce the release asset from its source commit:

```powershell
node scripts/contracts-archive.mjs pack --commit <full-sha> --output <directory-outside-the-worktree>
```
