# W08 Root independent findings

## Final independent verification — fixed compiler cd0d9ab88e9014ce303312f8f0bb0b043be90e7e

All F01–F08 closed after Luna fixes and Root verification. Root contract suite:110 Pass/0 Fail/0 Skip; the subsequent EOF-only single-LF trim changed no logic. Actual fixed compiler/input audit then passed with227 exact Source records,797 Source+72 Web=869 pending targets,0 receipts, four preserved limitations, two byte-identical six-file packages, same consumer selection paths/hashes, noargs read-only, blocked gate exit2, immutable/manual/partial/junction refusal with preservation, extra/bad-hash rejection, and consistently rehashed malformed UTF-8 rejection. The actual proof is `engineering-evidence.json` / independentActualCandidateAudit; no synthetic compiler identity is used for delivery.

| Finding | Final evidence |
| --- | --- |
| F01 local Git availability leaked into output | Root T02 Green; immutable output excludes history diagnostics. Final shallow-clone raw-byte verification is recorded separately in the Jira delivery. |
| F02 duplicated/undefined Source review target IDs | Root T03/T10 Green; actual797 full Source tuples+72 Web targets exactly once, registry union227. |
| F03 claimed state counts accepted | Root public API reproduced Red and Green; claimed approved counts against pending target now blocked. |
| F04 advertised manifest path absent | Actual six-file writer emits `data/<revision>/manifest.json` exactly at the envelope path, directory validator passes. |
| F05 Web-only event typed/provenance refs omitted | Root T05/T06 Green for nonempty synthetic events/announcements; real empty event lists remain empty. |
| F06 Web-only claims and registry seed coverage omitted | Actual real-data Red was fixed; complete Source union227 and all797 targets preserved, raw Web presentations/official/tiers/terms equal their fixed inputs. T11/T12 Green. |
| F07 approved rows lacked matching receipts | Root actual public API Red retained in evidence; Green blocks missing matching approval receipt. T13 covers mode/tuple/digest/calendar/latest/tie conflict; no real receipts generated. |
| F08 replacement decoding accepted malformed UTF-8 | Luna T14 actual Red→Green; Root rehashed malformed-byte probe against the real candidate independently rejects UTF-8. This is strict parsing evidence, not a claim of an actual published-data bypass. |

The following entries preserve the original review chronology; their earlier Open labels are superseded by this final verified table.

| ID | Code / trigger | Impact / minimum correction | State |
| --- | --- | --- | --- |
| W08-F01 | compileW08Candidate envelope.compiler.inputHistoryAvailable derives compilerIdentity.gitHistoryAvailable (~initial line879). Full checkout true vsdepth1 objectabsentfalse foridenticalpins. | Identical pinned inputs produce different candidate.json. Remove local history availability from immutable outputs/revision; diagnostics only. Add raw bytes identical historytrue/false regression. | Open, sent Luna |
| W08-F02 | reviewCoverage already collects Source targets from w07.sourceContract, thencompile adds sourceStateRows from sourceContract again (~749–847). Source targetId nonexistent. | Real loader doublecounts797 and invalid target/state totals; wrong review audit. One unique full Source tuple release/record/fieldPath/dimension, Web mode/target IDs separate. Expected final Source797+Web72=869 fortrueinput. | Open, sent Luna |
| W08-F03 | evaluateW08PublicationGate trusts review.states counters, ignores actualtargetrowstates (~554). | WithSourcebuildverified/publicationeligible true and targets:[pending], claimedallapproved counts yieldsready. Derive from actual targetrows/sourceTargets; ensure coverage and unique identities, reject/invalidate counter mismatch. Add explicitnegative. | Open; Root PUBLIC API actual Red via probe-review-gate.mjs, review-gate-probe.json expectedblocked actualready, no true receipt writes. Sent Luna |
| W08-F04 | candidateFileBytes writes root manifest.json but envelope advertises /data/revision/manifest.json; dirvalidator likewise readsrootmanifest. | Immutable manifest URL has no physical matchingfile; domainfiles already live underdata/revision. Write/readmanifest at declaredexactpath, validatepathmatches; no duplicateunlistedrootmanifest. | Open, sent Luna |
| W08-F05 | createDomainBytes game-changes/announcements useempty sourceRecords, no WebtypedSource/provenance closure; validateDomainDocument checksSourceRecordrefs only. | NonemptySourcegamechange typedWeb sourceRef canbe dangling andstillaccepted. SeedfromdomainWeb events/announcementrefs;validateallWebtyped/provenancerefs; site-onlyannouncementmustnotinventSourceevent. | Open, sent Luna |
| W08-F06 | Root actual W06/W07 authoring+fixedSource data in-memory projector probe (explicitsynthetic compilerSHA,nooutput) fails unresolvedWebSourceclaim `darktide:claim:chainaxe:p1-movement-speed-on-activation-tier4-display-percent`. makeRegistryDomainSeeds onlyaddsWebrefswhosekind==rootentitykind, silentlyomitsclaim/evidence rootsuniquetoWebtierparts. | For eachdomain seedALLtypedSource refs fromitsownpresentation/term rows, nototherdomainrows; closetransitivelywithSourceownerregistry. Add realtier4displayrefregressionandcheckallWebclaims/errata/official/term/tierparts. | ActualRootRed mainFprobe-real-data.mjs /real-data-projection-probe.json; sentLuna |

Initial module is not yet Green/schema absent, so these are code-path evidence, not claimedfullcandidate repro. Root will exercise actual APIs and close only after meaningful Green. First trivial syntax/export/fixture errors are implementation in progress and not separately counted as reviewed defects.

Luna acknowledgedF01–05 withconcretefixes/regressions. No Root productionmodifications. F03 independently executableRednowconfirmed, otherfourneedactualAPIafterbaselineGreen.

Root F03 incremental Green: samecontradictorycounts with explicit sourceTargets[] now blocked, blockers review-state-counts-mismatch/review-target-pending. Red preserved review-gate-probe-before-f03.json; currentGreenreview-gate-probe.json. Close after finalfrozencode rerun. All otheritems stillOpenpendingactualAPIpackageverification.

Root independent `node --test test/contract-w08-build.test.mjs` actual10/0/0 afterLunaaddedT01–T10. F01history/T02, F02uniquecount/T03+receiptsT10, F04writerT07, F05nonemptyeventT05+siteannouncementT06 allpasson syntheticfixtures. RealpositiveRootprobe exposedF06, soNOoverallactualintegrationGreen yet. Actualcompiler.lockstillmissing/intentionallynofixedcodeSHA. Candidate schemaexists~7KB, module~75KB, CLIimplementednoargs/--out-root/--check-gate. Source/locks/cache/pinsstillRootonly, nocodecommit.

Further scoped review pending: candidate validators actualdomain semantics/pinned Source/official/zhTW vs merely hash+shallowobject checks; strictfatalUTF8 (currentlyBuffer.toString silentlyreplacesbadbytes); ensurev17Source snapshot globalIDidentity notrelease-scoped; Source sourceSnapshotRef references; source/runtimepinchecks andno network onshallow; writernosafe-overwrite. Reproduce publicAPI cases afterbaselineGreen beforeformalfindings.
# Root additions after F06 real-data reproduction

- F06 real data advanced past Web-only claim closure, exposing omitted Source registry review coverage. Keep all 797 Source targets: weapons includes the complete selected-release armor-class registry; shared release-compatibility rows and their evidence are release provenance in all core domains. No hardcoded IDs or reduced denominator. Luna fixing with regression.
- F07 actual public API Red: `evaluateW08PublicationGate` with synthetic verified Source flags, one approved Web target, matching approved summary counts, but receiptCount=0/receipts=[] returned ready-for-release-allocation. Root command executed and output observed. Must require matching approval receipt evidence, not claimed states alone; real receipts remain untouched. Sent Luna.
- UTF-8 follow-up: `parseJson` uses replacement decoding; requested fatal decoding and a bad-byte regression before freezing. Real pinned directory rebuild still independently detects byte changes; do not misreport this as actual published-data bypass.
