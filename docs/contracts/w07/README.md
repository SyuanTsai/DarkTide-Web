# W07 weapon authoring review

Run `npm run contract:w07:validate` to validate the pinned W07 inputs. The command is read-only and does not write a review candidate.

To create the two review files, pass a new output directory explicitly:

```powershell
node scripts/content/contract-w07.mjs --out-root .tmp/w07-review-draft
```

The parent directory must already exist and the output directory must not. The writer refuses existing paths and symbolic-link parents. It writes `review-candidate.md` for the readable Chinese review and `review-matrix.json` for complete Source facts, official locators, review digests, coverage, and provenance. Re-running against the same inputs produces the same bytes.

The candidate has no human receipts and `publicationEligible` remains `false`. Source owns mechanics; the Web presentation only owns labels, notes, and typed references. This work does not execute damage overrides, calculate final damage, implement a renderer, or establish an exact Steam build. Weapon image references and licensing remain unverified for both selected marks.
