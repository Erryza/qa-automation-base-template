---
name: traceability-matrix
description: Create a Requirements Traceability Matrix (RTM) in the company PMO format (BRD to UREQ to FSD to TSD to JIRA to Test Cases), anchored to PMI PMBOK, ISO/IEC/IEEE 29148 and IIBA BABOK, and export a styled Excel workbook with bidirectional traceability, coverage/gap analysis, and independent audit verdicts. Use when the user mentions a traceability matrix, RTM, requirements traceability, BRD/UREQ/FSD/TSD/JIRA mapping, requirement-to-test mapping, coverage/gap analysis, RTM review, verify traceability, audit RTM, or sign off.
---

# RTM Skill

One skill, two roles: **Build** the RTM from source documents, then **Audit** it independently before sign-off. This skill is project-agnostic — all project-specific document parsing lives under **repository-root** `projects/<name>/` (never under `.cursor/skills/` or `.cursor/rules/`).

## Two governing principles

1. **Project-agnostic.** This skill contains no project-specific knowledge. All document layouts, column mappings, and domain heuristics belong only under **repo-root** `projects/<name>/` — keep `.cursor/skills/traceability-matrix/` limited to shared scripts, templates, and this skill doc.

2. **Honest, as-is, source-of-truth only.** A link is recorded only when the source explicitly states it. Never infer, keyword-match, or invent. If the source has no ID, leave the cell blank and state why in `Reasoning`. Blank-with-reason is correct; a guess is not.

---

## Role 1 — Build

### Workflow (locked — analyze → process → write → export)

Every RTM build follows these phases in order. Do not skip steps. **No guessing** at any phase — extract only what the source explicitly states; blank-with-reason is correct.

#### Phase A — Analyze (before writing any mapper code)

```
- [ ] A1  Confirm available sources per stage; declare active stages (--stages)
- [ ] A2  Build unique indexes from every provided source (docindex + project mapper)
- [ ] A3  Export index audit files (*_section_index.txt, *_section_collisions.txt)
- [ ] A4  Sample 20–30 source rows; catalog every citation style authors use
- [ ] A5  Run validate_citations.py — fix regex/index gaps before building rows
- [ ] A6  Record index counts (unique entries only) and collision counts for sign-off notes
```

**Index outputs (mandatory on every build):**

| File | Content |
|------|---------|
| `output/fsd_section_index.txt` | Unique FSD section IDs + titles |
| `output/tsd_section_index.txt` | Unique TSD section IDs + titles |
| `output/fsd_section_collisions.txt` | Same ID, different titles (audit only — not indexed twice) |
| `output/tsd_section_collisions.txt` | Same ID, different titles (audit only) |

**Index rules:** one entry per native ID; `min_depth=1` (chapter + all subsection depths); body heading wins over TOC; filter version-table noise (`1.0` artifacts). See **Section index rules** below.

```bash
python scripts/validate_citations.py \
  --jira projects/<name>/sources/jira.csv \
  --fsd  projects/<name>/sources/<fsd>.docx \
  --tsd  projects/<name>/sources/<tsd>.docx \
  --sit  projects/<name>/sources/<sit>.xlsx
```

#### Phase B — Process (index-then-verify linking, no guessing)

```
- [ ] B1  Extract explicit cites only — no guessing (citations.py — categories A–K)
- [ ] B2  Verify each cite against the unique index → MATCH / PARTIAL / GAP
- [ ] B3  Classify each row; assemble Evidence + Reasoning (chain.py)
- [ ] B4  One row per test case; one row per explicit JIRA multi-TSD cite
- [ ] B5  JIRA Description → Summary rule; document PIC via parse_document_pic()
```

#### Phase C — Write (27-column CSV)

```
- [ ] C1  Write rtm_input.csv with all 27 columns (Auditor Verdict blank)
- [ ] C2  No guessed values; blank-with-reason for every missing link
```

#### Phase D — Export (Excel + audit + optional alias review)

```
- [ ] D1  generate_rtm.py  → rtm.xlsx (--stages must match active stages)
- [ ] D2  audit_rtm.py     → rtm_audited.xlsx (gate must PASS)
- [ ] D3  propose_cite_aliases.py → cite_aliases.review.csv (optional background)
- [ ] D4  Sign-off: RTM + Gap Types Guide + Coverage & Gaps + Coverage Accountability + Gaps \<Stage\> (per provided source)
```

**One-command export (project mapper):**

```bash
python projects/<name>/build_rtm_input.py --export
```

Produces: `rtm_input.csv`, index files, collision reports, `rtm.xlsx`, `rtm_audited.xlsx`.

#### Phase E — Audit (Role 2 — independent verification)

```
- [ ] E1  audit_rtm.py gate PASS (zero FLAG rows)
- [ ] E2  Review Gap Types Guide + Coverage & Gaps summary + Gaps \<Stage\> for known PARTIAL/GAP acceptance
- [ ] E3  RTM is final only after audit gate PASS
```

### Legacy step checklist (maps to phases above)

```
- [ ] Step 1: Confirm sources + declare active stages          → Phase A1
- [ ] Step 2: Build unique indexes + validate citations        → Phase A2–A5
- [ ] Step 3: Extract links from source only (no guessing) — index-then-verify  → Phase B
- [ ] Step 4: Classify MATCH/PARTIAL/GAP + Evidence/Reasoning  → Phase B3
- [ ] Step 5: Write 27-column CSV                              → Phase C
- [ ] Step 6: generate_rtm.py → Excel                         → Phase D1
- [ ] Step 7: audit_rtm.py → verified workbook               → Phase D–E
```

### Step 1 — Confirm sources

Ask the user which documents are available before reading anything. Missing stages are GAP with reason `"source: <stage> document not provided"`.

#### Partial chains / dynamic anchoring (ISO/IEC/IEEE 29148 · PMBOK · BABOK)

You do not need the full 6-stage chain to produce a valid RTM. Standards require
traceability between the artifacts that *exist*; absent baselines are documented
gaps, not defects.

**Active stages** — the stages the user has declared as provided, in PMO chain
order (e.g. `FSD, TSD, JIRA, Test Case` when BRD and UREQ are unavailable).
Declare them explicitly; never auto-detect from column population.

**Row unit (leaf-driven)** — one row per item in the most-downstream active
stage (Test Case if present, else JIRA, else TSD, …), tracing backward through
active stages. Upstream active-stage items not referenced by any leaf row get
their own orphan rows so no provided artifact is dropped.

**JIRA with multiple TSD cites** — when a JIRA Description explicitly names
several TSD section or Image IDs, emit **one RTM row per cite** (duplicate JIRA
columns; TSD ID differs). Many JIRA tickets may share the same TSD ID. Use
`citations.parse_jira_tsd_targets()` in project mappers.

**Trace hops (branching at FSD)** — evaluate links only on explicit hops from
``chain.TRACE_HOPS`` (both stages must be active):

```
BRD → UREQ → FSD → TSD → JIRA
              FSD → Test Case   (direct — not via TSD/JIRA)
```

Use ``chain.trace_hops(active_stages)`` — never infer FSD→JIRA or TSD→Test Case hops.
Do not flag a gap between two stages when one of them is inactive.

**Inactive stages** — always left blank. `Reasoning` includes the standard
`chain.standard_inactive_reasoning(active_stages)` prefix, e.g.:
`GAP: source: BRD not provided; GAP: source: UREQ not provided`.

**Declare active stages to the scripts** — pass `--stages` to both
`generate_rtm.py` and `audit_rtm.py`. Both default to all 6 (backward
compatible).

```bash
python generate_rtm.py input.csv -o rtm.xlsx --project "Name" \
    --stages "FSD,TSD,JIRA,Test Case"

python audit_rtm.py input.csv -o audited.xlsx --project "Name" \
    --stages "FSD,TSD,JIRA,Test Case"
```

**Project mapper** — use `chain.py` helpers instead of hand-rolling the logic:
```python
import chain
ACTIVE_STAGES = chain.parse_active_stages("FSD,TSD,JIRA,Test Case")
INACTIVE_PREFIX = chain.standard_inactive_reasoning(ACTIVE_STAGES)

row["Jira Task Development Description"] = chain.jira_dev_description(jira_row)
reasoning = chain.assemble_reasoning(INACTIVE_PREFIX, pic_notes, match_notes, gap_notes)
overall, confidence = chain.rollup_status(statuses)
```

### Step 2 — Extract links (rules)

- Use the source's native identifiers exactly (real Jira keys, section numbers, test IDs). Never synthesise surrogate IDs.
- A link from stage A to stage B exists **only** when the source contains an explicit reference to the ID of the other:
  - FSD link: test source cites a specific FSD section that exists in the FSD document.
  - JIRA link: test source explicitly names a Jira issue key (e.g. `PROJ-123`).
  - TSD link: the matched Jira description explicitly cites a TSD section that exists in the TSD document.
- If the cited ID is not found in the target document → GAP (not PARTIAL).

#### Inspect all citation styles before writing the mapper (mandatory)

Authors rarely use a single canonical format. Before writing any regex or parser, read a representative sample of the source (20–30 rows of Jira descriptions, SIT cells, etc.) and identify **every distinct citation style** the authors actually use.

#### Index-then-verify linking (mandatory for every project mapper)

This is the general pattern all projects must follow. WOI (`projects/woi-universal-p2/`) is a **reference implementation** of this skill — not the other way around. Regex and document layout code live only under `projects/<name>/`; the workflow below is locked in the skill.

```
1. BUILD INDEX   — parse each target document into lookup tables (native IDs only)
2. SAMPLE SOURCE — read 20–30 rows; catalog every citation style authors use
3. EXTRACT       — one parser path per style; return explicit cited ID from source text
4. VERIFY        — cited ID exists in index → MATCH; cited but missing → GAP; no cite → GAP
```

**Allowed:** identifier lookup after an explicit citation in the source.
**Forbidden:** keyword search, topic matching, or “find anything in the doc that looks related.”

Build separate indexes per target type as needed:

| Index | Built from | Module |
|-------|------------|--------|
| Section index | FSD / TSD / BRD / UREQ DOCX headings (any numeric depth) | `docindex.parse_numbered_sections()` / `parse_flat_sections()` |
| Image/diagram index | TSD lines like `Image X.Y.Z.W: (title)` | `docindex.parse_image_index()` |
| Breadcrumb index | Auto-built from section hierarchy | `docindex.build_breadcrumb_index()` |
| Chapter index | Top-level chapter → subsections | `docindex.build_chapter_index()` |
| JIRA key index | JIRA CSV `Issue key` column | project mapper |
| Test Case index | SIT workbook `Test Case ID` column | project mapper |
| Cite aliases | Informal labels → section IDs (when auto-index fails) | **Optional.** GAPs visible in RTM without it. Agent-only file if team wants fewer GAPs later. |

**Section index rules (locked):**

- **Unique index only:** exactly **one entry per native section ID** in every source (FSD, TSD, BRD, UREQ). Same rule for Image IDs, JIRA keys, and Test Case IDs. Never count TOC repeats, body repeats, or duplicate-numbered APIs as separate index entries.
- When the source reuses a section ID for different content, keep **one** index entry (body heading wins over TOC) and export the conflict list via `docindex.scan_section_id_collisions()` → `*_section_collisions.txt`. Do **not** invent surrogate IDs (e.g. `3.5.1-b`).
- Index **every explicit numeric id** present in the target document: chapter
  (`5`, `6`), section (`5.1`), subsection (`6.3.2.1`), etc. Default
  `min_depth=1` in `parse_numbered_sections()` / `parse_flat_sections()`.
- `parse_heading_line()` accepts multi-level headings (`6.3.2 Title`) and
  chapter headings (`6. Functional Specification`).
- `parse_numbered_sections()` skips the TOC block through front matter so the
  last TOC entry does not absorb the document body. Descriptions fall back to
  the cleaned heading title when body text is absent.
- SIT / JIRA cells citing a chapter integer (e.g. `6`) → **MATCH** when that id
  is in the index; subsection list only when the chapter id itself is absent.
- Do **not** keyword-match unnumbered body prose into the index — only ids
  explicitly written in the source documents.

#### Informal cite labels (optional — not a sign-off gate)

If SIT uses informal text instead of FSD section numbers, those rows are **GAP in the RTM** with Reasoning. **Humans review only the RTM workbook** (Coverage & Gaps sheet).

`cite_aliases.json` is **optional** — it only reduces GAP count when the team asks the agent to apply mappings. New projects do not need this file.

**Pre-sign-off (agent/CI):** run `scripts/validate_citations.py` — catches regex bugs, not a human task.

#### Citation style taxonomy (generic — applies to FSD, TSD, JIRA, Test Case)

Each project implements extractors for the styles its authors actually use. Categories:

| Cat | Pattern (generic) | Verify against | If missing from index |
|-----|-------------------|----------------|----------------------|
| A | `TSD Section 3.2.5` / `FSD Section 6` (chapter) / `FSD Section 2.1.3` | Section index | GAP |
| B | `refer to TSD …` then section number in window | Section index | GAP |
| C | `on section *3.1.7*` / `from API on section 3.1.7` | Section index | GAP |
| D | `*3.1.7 [TAG] Title*` / `*3.5.1 Title*` | Section index | GAP |
| E | `refer to 3.x.x Title` / `refer *3.x.x*` (plain or asterisk) | Section index | GAP |
| F | `Image 1.1.3.1.1: (title)` | Image index | GAP |
| G | `1.1.5.8 API Process Logic Flow` | Section index | GAP |
| H | `3.11 Dashboard -` / `1.1.6 Mobile -` / `Dashboard and Mobile -` (heading copy) | Section index | GAP |
| I | `TSD Section Appendix` / `refer to Appendix` / `refer to *Appendix*` | — | PARTIAL |
| J | `refer to TSD [URL]` only (no section, no Image id) | — | PARTIAL |
| K | `3.7.3 Cashout to Bank - Bank List` (API heading at line start) | Section index | GAP |

All extractors are implemented in `scripts/citations.py`. Collect matching extractors via `extract_section_num()` / `parse_jira_description_refs()`, tried in **priority order**. First explicit match wins.

**False GAP is a honesty violation.** If the source explicitly cites an ID and the parser misses it, that is as wrong as inventing a link.

**Image identifiers are valid TSD references (Cat F).** When JIRA cites `Image X.Y.Z.W` and that exact identifier exists in the TSD image index, record MATCH.

**URL-only references (Cat J)** are PARTIAL — real reference, unverifiable identifier — not GAP.

The same taxonomy applies when linking SIT → FSD, JIRA → TSD, JIRA → Test Case, etc. Only the index and extractors change per project.

### Step 3 — Classification

| Status | Meaning |
|--------|---------|
| MATCH | Source explicitly provides the link AND the referenced ID exists in the target document |
| PARTIAL | Source provides a real but incomplete chain (one hop exists, the next is absent from all sources) |
| GAP | Source provides no reference, or referenced ID is not found, or stage/PIC is absent |

No keyword, heuristic, or inferred tier. No evidence → GAP.

### Step 4 — Evidence and Reasoning

- `Evidence`: exact source location, e.g. `SIT "Link Jira" cell = PROJ-123`. If none: `none in source`.
- `Reasoning`: one sentence starting with the status word: `MATCH: …`, `PARTIAL: …`, or `GAP: …`.

### Step 5 — Output columns (27 total)

**PMO (22):** `BRD ID | BRD Section Page | Business Requirement Description | BRD PIC | UREQ ID | UREQ Section Page | UREQ Description | UREQ PIC | FSD ID | FSD Section Page | Functional Specification Description | FSD PIC | TSD ID | TSD Section Page | Technical Description | TSD PIC | Jira Task ID | Jira Task Development Description | JIRA PIC | Test Case ID | Test Case Description | Test Case PIC`

**Audit (5, after the 22):** `Match Status | Confidence | Evidence | Reasoning | Auditor Verdict`

One row per test case (or per explicit TSD cite when JIRA lists several section/Image IDs). Leave stage cells blank (not "N/A") when the source has no data; `Reasoning` explains why. `Auditor Verdict` is always blank at build time.

#### JIRA column population (locked)

When a row has a **Jira Task ID**, populate **Jira Task Development Description** from the JIRA export using this order — **always**, in every project mapper:

1. **Description** — use when the field is non-blank after trim.
2. **Summary** — fallback when Description is blank or absent.

This is source text selection, not link inference. Truncate to the column limit (500 chars) if the mapper enforces one. Do **not** use Summary when Description exists, even if Summary is shorter or clearer.

**JIRA PIC:** Assignee from the JIRA export when present; blank otherwise (acknowledge in `Reasoning`).

**FSD / TSD PIC (document default):** When the stage row is populated from a DOCX
index lookup, set PIC from that document's Revision History / Version History
(latest `Updated By` or `Authors` row), falling back to cover-page `Created By` /
`Author`. Use `docindex.parse_document_pic()`. This is source metadata selection —
not link inference. Per-row SIT or JIRA PIC still takes precedence when present.

### Step 6 — Generate the workbook
```bash
pip install -r ~/.claude/skills/traceability-matrix/scripts/requirements.txt
python ~/.claude/skills/traceability-matrix/scripts/generate_rtm.py <output.csv> \
    -o rtm.xlsx --project "<name>"
```

---

## Role 2 — Audit

Run after building. The auditor independently verifies the builder output and is the only entity that fills `Auditor Verdict`.

### Automated audit
```bash
python ~/.claude/skills/traceability-matrix/scripts/audit_rtm.py <rtm_input.csv> \
    -o rtm_audited.xlsx --project "<name>"
```

### What the audit checks (per row)
1. `Evidence` must be non-empty when `Match Status` is MATCH or PARTIAL.
2. Every populated stage cell must have a non-blank PIC, or `Reasoning` must acknowledge the blank PIC.
3. Every Test Case without a BRD ID must have `Reasoning` acknowledging the absent BRD.
4. `Reasoning` must start with MATCH / PARTIAL / GAP.
5. `Auditor Verdict` must be blank at build time (only the auditor fills it).

### Verdict rules
- **PASS**: all honesty checks pass for this row.
- **FLAG \<note\>**: one or more honesty checks fail — note states the specific issue.

### Critical distinction — two independent dimensions (mandatory understanding)

| Dimension | Column | Question answered | PASS/FLAG meaning |
|-----------|--------|-------------------|-------------------|
| **Traceability completeness** | `Match Status` | Is the chain complete? | MATCH / PARTIAL / GAP |
| **Build honesty** | `Auditor Verdict` | Was the row built honestly? | PASS = honest; FLAG = dishonest |

**A `GAP` or `PARTIAL` row with `PASS` verdict is correct and expected.** It means: "a traceability gap exists AND it was honestly documented." PASS does NOT mean the gap is acceptable or resolved.

**A row gets `FLAG` only when the honesty contract is broken**, for example:
- Match Status is MATCH but Evidence is empty or `none in source`
- Reasoning does not start with MATCH / PARTIAL / GAP
- A populated stage has no PIC and Reasoning does not acknowledge it
- Builder pre-filled `Auditor Verdict` (only the auditor may fill it)

**Never conflate `Auditor Verdict = PASS` with "traceability is complete."** Use `Match Status` and the Coverage & Gaps summary + Gaps detail sheets to measure traceability completeness. Use `Auditor Verdict` to confirm the build was honest.

### Sign-off gate
The RTM is **final and proven** when:
1. Zero FLAG rows remain (or all FLAGs are formally accepted with documented justification).
2. `% Proven` (MATCH rows only) is reviewed and acknowledged.
3. All remaining PARTIAL / GAP rows are explicitly accepted by the PMO/BA as known gaps.

---

## Quality checklist
```
- [ ] Phase A: Active stages declared; unique indexes built for all provided sources
- [ ] Phase A: Index audit files exported (*_section_index.txt, *_section_collisions.txt)
- [ ] Phase A: validate_citations.py run; zero false GAPs from regex/index bugs
- [ ] Phase B: 20–30 source rows sampled; all citation styles cataloged and implemented
- [ ] Phase B: Index-then-verify only — no keyword matching across documents
- [ ] Phase B: Unique index only — one entry per native ID; collisions in audit file only
- [ ] Phase C: No cell contains a guessed or inferred value
- [ ] Phase C: Every blank stage cell has a Reasoning entry
- [ ] Phase C: Every MATCH/PARTIAL has quoted source in Evidence
- [ ] Phase C: Native source IDs used throughout
- [ ] Phase C: Jira Task Development Description = Description if non-blank, else Summary
- [ ] Phase D: --stages passed to generate_rtm.py and audit_rtm.py
- [ ] Phase D: Workbook includes Coverage summary + Coverage Accountability + Gaps \<Stage\> Detail (per provided source) + hop gap sheets + Legend
- [ ] Phase D: Auditor Verdict blank before audit; audit gate PASS before sign-off
```

## Project-specific mappers
Each project keeps its own mapper under `projects/<name>/build_rtm_input.py`. That script implements **Phase A–D** for that project's document layouts:

| Phase | Mapper responsibility |
|-------|----------------------|
| **Analyze** | Build unique section/image/JIRA/test-case indexes; export index + collision audit files |
| **Process** | Sample citation styles; extract via `citations.py`; verify via `docindex`; use `chain.py` |
| **Write** | Emit 27-column `rtm_input.csv` |
| **Export** | Call `generate_rtm.py`, `audit_rtm.py`, `propose_cite_aliases.py` via `--export` |

Locked behaviors in every mapper:
- **index-then-verify** — never keyword-match across documents
- **unique index only** — one entry per native ID; collisions → `*_section_collisions.txt`
- **Jira Task Development Description** = Description → Summary
- **active stages** + `--stages` on generate/audit scripts
- **`chain.py`** for inactive prefix, JIRA description, reasoning, status rollup

**WOI** (`projects/woi-universal-p2/`) is the current reference implementation. New projects copy the workflow, not the regex literals.

### Applying cite alias feedback (agent)

When the user reviews `cite_aliases.review.csv` and gives decisions:

```bash
python scripts/propose_cite_aliases.py \
  --apply projects/<name>/output/cite_aliases.review.csv \
  --aliases projects/<name>/cite_aliases.json
```

Then rebuild and re-audit the RTM. Only rows with a section ID in `map_to_fsd_section` are merged (not `ACCEPT_GAP` / `FIX_SOURCE`).

## Scripts reference
| Script | Purpose |
|--------|---------|
| `scripts/citations.py` | Generic regex extractors (categories A–K); `parse_jira_tsd_targets()` for multi-cite JIRA |
| `scripts/docindex.py` | Unique DOCX indexes, breadcrumb/chapter lookup, FSD cite resolver, collision scanner |
| `scripts/propose_cite_aliases.py` | Review CSV/MD generator + apply human feedback to JSON |
| `scripts/validate_citations.py` | Pre-sign-off regex gap scanner |
| `scripts/gap_accountability.py` | Coverage Accountability metrics + per-source gap detail (fix/validate guidance) |
| `scripts/generate_rtm.py` | Generic CSV → styled Excel (RTM + Coverage + Accountability + per-source Gaps + Legend) |
| `scripts/audit_rtm.py` | Independent row-by-row audit → Auditor Verdict + Audit Summary sheet |
| `scripts/chain.py` | Active stages, reasoning assembly, JIRA Description rule |
| `scripts/requirements.txt` | Python dependencies (`openpyxl`) |
| `templates/rtm_input.csv` | 27-column sample CSV for manual filling or reference |
| `templates/cite_aliases.json` | Empty starter (agent-populated after review) |
