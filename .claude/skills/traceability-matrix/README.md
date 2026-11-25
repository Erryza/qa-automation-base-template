# Traceability Matrix Skill

A Cursor agent skill that builds and audits a Requirements Traceability Matrix (RTM) in the company PMO format, anchored to PMI PMBOK, ISO/IEC/IEEE 29148, and IIBA BABOK.

**Writing specs or test cases?** See [Guidance for writing traceable documents](#guidance-for-writing-traceable-documents) — how to cite IDs so the RTM can link your work honestly.

---

## What it produces

An Excel workbook (`.xlsx`) with eight sheets (all produced by shared scripts — no project-specific Excel code):

| Sheet | Content |
|-------|---------|
| **RTM** | 27-column PMO layout with colour-coded stage bands + Audit band |
| **Gap Types Guide** | **Plain-language dictionary** of every Gap Type code (what it means, typical cause) |
| **Coverage & Gaps** | **Summary only** — % Proven, stage counts, gap totals, hop breakdown, pointers to detail sheets |
| **Coverage Accountability** | Leaf vs row-level proven metrics; branching model notes |
| **Gaps \<Stage\>** | One sheet per **provided** source — gap rows + stage-specific type legend at top |
| **Audit Summary** | Row-by-row verdict totals, FLAG details, and a PASS/FAIL gate |
| **Legend & Standards** | Column dictionary, branching model, and standards crosswalk |

**Sign-off review:** Start with **Gap Types Guide** (decode codes), then **Coverage Accountability**, then **Gaps \<Stage\>** for each provided source.

---

## PMO chain (branching)

```
BRD → UREQ → FSD → TSD → JIRA
              FSD → Test Case   (direct — not via TSD/JIRA)
```

Trace hops evaluated (only when both stages are provided):

| Hop | Meaning |
|-----|---------|
| BRD → UREQ | Business requirement drives user requirement |
| UREQ → FSD | User requirement drives functional spec |
| FSD → TSD | Functional spec drives technical spec |
| TSD → JIRA | Technical spec drives development work |
| FSD → Test Case | Functional spec drives verification **directly** |

### Column headers (27 total)

| # | Stage | Columns |
|---|-------|---------|
| 1–4 | BRD | BRD ID, BRD Section Page, Business Requirement Description, BRD PIC |
| 5–8 | UREQ | UREQ ID, UREQ Section Page, UREQ Description, UREQ PIC |
| 9–12 | FSD | FSD ID, FSD Section Page, Functional Specification Description, FSD PIC |
| 13–16 | TSD | TSD ID, TSD Section Page, Technical Description, TSD PIC |
| 17–19 | JIRA | Jira Task ID, Jira Task Development Description, JIRA PIC |

**Jira Task Development Description (locked):** JIRA export **Description** when non-blank; otherwise **Summary**. Applies to every project mapper.

| 20–22 | Test Case | Test Case ID, Test Case Description, Test Case PIC |
| 23–27 | **Audit** | Match Status, Confidence, Evidence, Reasoning, Auditor Verdict |

---

## Two roles in one skill

### Role 1 — Build
Reads source documents and populates the RTM using **only explicit source references**. No keyword matching. No guessing. If the source has no link, the cell is left blank and `Reasoning` states exactly why.

### Role 2 — Audit
Independently verifies every row against the honesty contract. Fills `Auditor Verdict` (PASS or FLAG). The RTM is **not final** until the audit gate is PASS.

---

## How to prompt the agent

### Create a new RTM from source documents

```
Create a traceability matrix for <project name>.

FSD: @<fsd file.docx>
TSD: @<tsd file.docx>
JIRA: @<jira export.csv>
Test Case: @<sit workbook.xlsx>
BRD: I don't have it
UREQ: I don't have it

Export to Excel.
```

### Audit an existing RTM

```
Audit the RTM for <project name> at @<rtm_input.csv> and export the verified workbook.
```

### Full build + audit in one step

```
Build, export, and audit the traceability matrix for <project name>.

FSD: @<file>
TSD: @<file>
JIRA: @<file>
Test Case: @<file>
```

### Re-run after source files are updated

```
Re-run the <project name> RTM — the SIT file has been updated.
Use @<new sit file>. Export and audit.
```

### Export CSV to Excel only (CSV already exists)

```
Export the RTM CSV at @<rtm_input.csv> to Excel for project <name>.
```

### Check coverage gaps only

```
Show me the coverage gaps in the RTM at @<rtm_input.csv>.
```

---

## Confidence levels explained

| Match Status | Confidence | Meaning |
|---|---|---|
| **MATCH** | High | Every hop in the chain has an explicit source reference and the referenced ID exists in the target document |
| **PARTIAL** | Medium | At least one hop has a real source reference, but at least one downstream hop is absent from all sources |
| **GAP** | n/a | No source reference, referenced ID not found, or stage/PIC missing from source |

---

## Honesty rules (always applied)

1. A link is recorded **only** when the source document explicitly states it.
2. No keyword matching, no scoring, no inferred links.
3. If the source has no ID → cell is blank + `Reasoning` says why.
4. Missing stages (e.g. BRD not provided) → stated plainly, not treated as a defect.
5. `Auditor Verdict` is only filled by `audit_rtm.py`, never by the builder.
6. **Jira Task Development Description** = JIRA **Description** if non-blank, else **Summary** (locked — all projects).

---

## Guidance for writing traceable documents

Use this section when authoring or reviewing **BRD, UREQ, FSD, TSD, JIRA tickets, and test cases** so the next RTM can link them honestly. Share it with BAs, developers, and QA before they write or update specs.

### Why this matters (standards in plain language)

Traceability standards (ISO/IEC/IEEE 29148, PMI PMBOK, IIBA BABOK) all say the same thing in practice:

> **A link exists only when a document explicitly points to another document’s ID.**

The RTM does not guess from similar words. It records what your documents **actually say**. If you write links clearly, the matrix is complete. If you only describe the topic in prose, the matrix shows an honest **GAP** — not because the work is wrong, but because the **reference was never written down**.

### The golden rule

**Every hop in the chain must name the upstream ID in the downstream document.**

```
BRD section  →  cited in UREQ
UREQ section →  cited in FSD
FSD section  →  cited in TSD and/or Test Case
TSD section  →  cited in JIRA Description
JIRA key     →  cited in Test Case (when testing a specific ticket)
```

You do not need all six stages on every project. Whatever stages you **do** have must still cite the **next stage up** with a real ID when a relationship exists.

### What makes a link “explicit” (good)

An explicit link contains a **native ID** from the target document:

| Target | Good — author wrote… |
|--------|----------------------|
| FSD | `FSD Section 2.3.1` or `FSD Section 2.3.1 Login flow` |
| TSD | `TSD Section 3.1.7` or `refer to TSD Section 3.9.11` |
| TSD (diagram) | `Image 1.1.3.1.1: (Transaction Request Send Money Validator)` |
| TSD (inline) | `on section *3.1.7 [DASHBOARD] Get Implemented Configuration*` |
| JIRA | `W20D-4835` or `PROJ-123` in the test case “Link Jira” cell |
| Test Case | `TC-0042` in JIRA Description |

The RTM tool **looks up that ID** in the target document index. It does **not** search for keywords like “Send Money” or “KYC” across the whole TSD.

### What is not a link (avoid relying on these)

| Weak writing | Why RTM cannot use it |
|--------------|------------------------|
| “Same as login feature” | No ID — could mean many sections |
| “See TSD” / “Refer to spec” with no section number | Real reference, but **PARTIAL** at best |
| Only a Google Doc / GitLab URL | **PARTIAL** — link exists, ID not verifiable |
| “Implement send money with KYC” (no section) | Topic only — honest **GAP** |
| Similar words in JIRA and TSD | **Never used** — would create false links |

**Important:** A GAP in the RTM means “no explicit reference in the source,” not “the requirement is wrong.”

---

### How to write each document type

#### BRD / UREQ (when used)

- Give every requirement a **stable ID** (section number or REQ-ID).
- UREQ should cite **which BRD section** it derives from, e.g. `Derived from BRD Section 1.2`.
- FSD should cite **which UREQ** it satisfies, e.g. `UREQ Section 4.1`.

#### FSD (Functional Specification)

- Use **numbered sections** (e.g. `2.3.1 Title`) and keep numbers stable after baselines.
- Test cases (SIT) should fill **FSD Section** with that number — not paraphrase the title alone.
- When JIRA or TSD references FSD, prefer `FSD Section X.X.X`.

#### TSD (Technical Specification)

- Use **numbered sections** for APIs and features (e.g. `3.1.7 [DASHBOARD] Get Implemented Configuration By co Code`).
- Use **Image IDs** for sequence/flow diagrams (e.g. `Image 1.1.3.1.1: (title)`) and keep labels consistent in the doc.
- Put a space after section numbers in headings when possible (`3.1.7 Title` not `3.1.7Title`) so indexes stay accurate.
- JIRA tickets should cite TSD with **section number or Image ID**, not only a URL.

#### JIRA (development tickets)

- In **Description** (preferred over Summary for traceability), include:
  - **TSD:** `TSD Section 3.2.5` or `refer to TSD …` with section number, or `Image X.Y.Z.W`
  - **FSD:** `FSD Section 2.1.3` when relevant
  - **Test Case:** `TC-123` when a specific test applies
- Use the real issue key format (e.g. `W20D-4835`) — test cases should reference **development** keys, not unrelated bugfix keys, unless that is intentional.
- Avoid empty Description for work that implements a spec section; if Description is empty, RTM has nothing to trace.

**Recommended JIRA Description template:**

```
TSD Section: 3.1.7
FSD Section: (if applicable)
Test Case: TC-xxx (if applicable)

<implementation notes>
```

#### Test cases (SIT / test workbook)

- Every row needs a **Test Case ID** (e.g. `TC-0042`).
- Fill **FSD Section** with the FSD section number from the FSD document.
- Fill **Link Jira** (or equivalent) with the **development** JIRA key when the test verifies that ticket.
- Do not leave trace columns blank if the link is known — blank cells become GAP rows.

---

### Good vs bad examples (JIRA → TSD)

**Good — RTM can prove the link**

```
TSD Section 3.1.7
Implement KYC popup on send money when IS_SEND_MONEY_NEED_KYC is active.
```

```
Please refer to TSD Section 3.9.11 for API contract.
```

```
Please Refer to Image 1.1.3.1.1: (Transaction Request Send Money Validator)
```

```
from API on section *3.1.7 [DASHBOARD] Get Implemented Configuration By co Code*
```

**Weak — RTM will show GAP or PARTIAL**

```
Implement send money KYC popup.
(no TSD section or Image ID)
```

```
Please refer to TSD: https://docs.google.com/...
(URL only — PARTIAL)
```

```
See spec.
(no ID at all — GAP)
```

---

### Standards crosswalk (one sentence each)

| Standard | What it expects from your documents |
|----------|-------------------------------------|
| **ISO/IEC/IEEE 29148** | Requirements at each level reference parent/child artifacts by identifier; traceability is bidirectional and auditable. |
| **PMI PMBOK (RTM)** | The matrix maps deliverables through the lifecycle; each cell must be supportable from the baseline documents. |
| **IIBA BABOK** | Requirements are linked across abstraction levels (business → stakeholder → solution → validation) with explicit derive/satisfy relationships. |

Our RTM implements this as: **explicit ID in source → verify ID exists in target → MATCH; otherwise GAP with reason.**

---

### Checklist before you publish a document

```
□ Every requirement / feature has a stable section or item ID
□ Downstream docs cite upstream IDs (not only titles or topics)
□ JIRA Description names TSD section or Image ID when implementing spec work
□ Test cases put numeric FSD section in FSD Section column (e.g. 6.3.3.1)
□ Do not put document filenames in SIT FSD Section cells
□ Informal SIT labels unresolved? — visible as GAP in RTM Coverage & Gaps (no alias file required)
□ Links use native IDs (section numbers, Image X.Y.Z.W, PROJ-123, TC-xxx)
□ Avoid "see doc" / URL-only / class-name-only without a section or Image ID
□ Run validate_citations.py before RTM sign-off — 0 false GAPs from regex
```

Following this checklist reduces GAP rows in the RTM and makes audit sign-off straightforward.

### Supported JIRA → TSD cite formats (all projects)

Authors may use any of these — the shared `citations.py` handles all:

| Write this in JIRA Description | Category |
|--------------------------------|----------|
| `TSD Section 3.2.5` | A |
| `refer to TSD … point: *3.2.5*` | B |
| `on section *3.1.7*` | C |
| `*3.4.3 [INTERNAL] Lock Member Status V2*` | D |
| `refer *3.10.7 Payment Cashout*` | E |
| `Image 1.1.3.1.1: (title)` | F |
| `1.1.5.8 API Process Logic Flow` | G |
| `1.1.6 Mobile - Cashout to Bank` | H |
| `refer to Appendix` | I (PARTIAL) |
| `3.7.3 Cashout to Bank - Bank List` | K |

---

## JIRA description rule (locked)

For any row with a populated **Jira Task ID**:

```
Jira Task Development Description =
  trim(JIRA Description)  if non-blank
  else trim(JIRA Summary)
```

This is not link inference — it only chooses which existing JIRA text field fills the PMO column. Project mappers must implement this exactly.

---

## End-to-end pipeline (locked)

Every RTM build follows **Analyze → Process → Write → Export → Audit**. The agent must not skip phases.

```
ANALYZE          PROCESS           WRITE            EXPORT              AUDIT
────────         ───────           ─────            ──────              ─────
Confirm sources  Extract cites     rtm_input.csv    rtm.xlsx            audit gate PASS
Build indexes    Verify vs index   27 columns       rtm_audited.xlsx    Coverage & Gaps
Export index     Classify rows     blank=reason     index audit files   sign-off
Validate cites   chain.py          no guesses       collision reports
```

**WOI one command:**

```bash
python projects/woi-universal-p2/build_rtm_input.py --export
```

**Outputs in `projects/<name>/output/`:**

| File | Phase |
|------|-------|
| `fsd_section_index.txt` / `tsd_section_index.txt` | Analyze — unique index audit |
| `fsd_section_collisions.txt` / `tsd_section_collisions.txt` | Analyze — duplicate ID audit (not indexed twice) |
| `rtm_input.csv` | Write |
| `rtm.xlsx` | Export |
| `rtm_audited.xlsx` | Export + Audit (sign-off artifact) |
| `cite_aliases.review.csv` | Export (optional) |

---

## Index-then-verify linking (all projects)

Every project mapper under `projects/<name>/build_rtm_input.py` follows this workflow. WOI is the current reference implementation.

```
BUILD INDEX → SAMPLE SOURCE → EXTRACT (explicit cites) → VERIFY (lookup in index)
```

| Step | What | Where |
|------|------|-------|
| Build index | Section / Image / breadcrumb / chapter indexes — **one unique entry per native ID** (no duplicate rows) | `scripts/docindex.py` + project mapper |
| Sample source | Read 20–30 rows; list every citation style | Skill + `validate_citations.py` |
| Extract | Priority-ordered extractors (categories A–K) | `scripts/citations.py` |
| Verify | ID in index → MATCH; cited but missing → GAP | `docindex.section_lookup()` + mapper |
| Aliases | Approved informal cite → section ID | `cite_aliases.json` (agent-maintained) + `output/cite_aliases.review.csv` (human review) |

**Shared modules (all projects — do not copy regex into project mappers):**

| Module | Role |
|--------|------|
| `scripts/citations.py` | Generic regex extractors (categories A–K), JIRA ref parser, SIT cell normalizer |
| `scripts/docindex.py` | Unique DOCX indexes, breadcrumb/chapter lookup, FSD resolver, collision scanner |
| `scripts/validate_citations.py` | Pre-sign-off scan for unmatched cites (regex gap detector) |
| `scripts/chain.py` | Active stages, reasoning assembly, JIRA Description rule, status rollup |

Project mappers (`projects/<name>/build_rtm_input.py`) wire sources → shared modules → CSV. Only column names, sheet names, and `cite_aliases.json` are project-specific.

**Not allowed:** scanning full document text for keyword matches.

### Citation categories (generic — locked in citations.py)

| Cat | Example pattern | Result if verified |
|-----|-----------------|-------------------|
| A | `TSD Section 3.2.5` / `FSD Section 6` (chapter) / `FSD Section 2.1.3` | MATCH |
| B | `refer to TSD … 3.2.5` (600-char window) | MATCH |
| C | `on section *3.1.7*` | MATCH |
| D | `*3.1.7 [TAG] Title*` | MATCH |
| E | `refer to 3.x.x Title` / `refer *3.x.x*` | MATCH |
| F | `Image 1.1.3.1.1: (title)` | MATCH (image index) |
| G | `1.1.5.8 API Process Logic Flow` | MATCH |
| H | `3.11 Dashboard - Bulk Top` / `1.1.6 Mobile - Cashout to Bank` / `Dashboard and Mobile -` | MATCH |
| I | `TSD Section Appendix` / `refer to Appendix` / `refer to *Appendix*` | PARTIAL |
| J | `refer to TSD [URL only]` | PARTIAL |
| K | `3.7.3 Cashout to Bank - Bank List` (API heading at line start) | MATCH |

**False GAP is a honesty violation.** Run `validate_citations.py` before sign-off; any unmatched cite with a real section ID in the text is a regex bug.

### Informal cite labels — optional (RTM is the review surface)

**Not required.** Most projects never need `cite_aliases.json`.

| Situation | What happens | Human action |
|-----------|--------------|--------------|
| Normal FSD section numbers in SIT | Auto MATCH | None — just review RTM |
| Informal labels (e.g. `Shared Balance > Request Money`) | **GAP in RTM** with Reasoning | Review **Coverage & Gaps** sheet in RTM Excel only |
| Team wants fewer GAPs later | Agent can add approved mappings | Optional — only if someone asks |

**Sign-off uses RTM only:** `WOI … RTM Audited.xlsx` → RTM sheet + **Coverage & Gaps**. Every unresolved cite is already listed there as GAP with a one-line reason. No separate alias review is required.

`cite_aliases.review.csv` (if generated) is a **optional helper for the agent** when the team decides to improve coverage — not a human deliverable.

#### Optional alias workflow (only when team requests it)

1. Build generates `output/cite_aliases.review.csv` (background — humans can ignore it).
2. If the team wants to reduce GAPs, they tell the agent decisions in chat (or RTM feedback).
3. Agent applies → `cite_aliases.json` → rebuild.

**New projects:** start with **no** `cite_aliases.json`. **WOI** keeps its file from earlier approved mappings — WOI-only, not a template requirement.

---

## Partial chains — dynamic active-stage anchoring

The full PMO chain is BRD → UREQ → FSD → TSD → JIRA → Test Case. You do not need
all 6 stages. The RTM is standards-compliant with any subset (ISO/IEC/IEEE 29148,
PMBOK, BABOK all support partial baselines).

### Key concepts

| Concept | Meaning |
|---------|---------|
| **Active stages** | The ordered subset of stages the project has provided. Declared explicitly by the builder — never auto-detected. |
| **Inactive stages** | The rest. Always blank cells + `GAP: source: <stage> not provided` in Reasoning. |
| **Leaf-driven rows** | One row per item in the most-downstream active stage (Test Case → JIRA → TSD → …). |
| **Orphan rows** | Items in upstream active stages not referenced by any leaf row get their own row so no provided artifact is dropped. |
| **Adjacent-pair linking** | Links are evaluated only between consecutive active stages. A gap between an active and inactive stage is NOT a broken chain. |

### How to declare active stages

Pass `--stages` to both scripts (comma-separated, PMO order):

```bash
# Build
python generate_rtm.py rtm_input.csv -o rtm.xlsx \
    --project "My Project" --stages "FSD,TSD,JIRA,Test Case"

# Audit
python audit_rtm.py rtm_input.csv -o rtm_audited.xlsx \
    --project "My Project" --stages "FSD,TSD,JIRA,Test Case"
```

Valid stage names: `BRD`, `UREQ`, `FSD`, `TSD`, `JIRA`, `Test Case` (also accepts `TC` / `TestCase`).
Default is `all` (all 6 stages) — fully backward compatible.

### Using chain.py in a project mapper

```python
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parents[2] / ".cursor/skills/traceability-matrix/scripts"))
import chain

ACTIVE_STAGES   = chain.parse_active_stages("FSD,TSD,JIRA,Test Case")
INACTIVE_PREFIX = chain.standard_inactive_reasoning(ACTIVE_STAGES)

# In a row-builder:
row = chain.blank_row()
row["Jira Task Development Description"] = chain.jira_dev_description(jira_row)
reasoning = chain.assemble_reasoning(INACTIVE_PREFIX, pic_notes, match_notes, gap_notes)
overall, confidence = chain.rollup_status(statuses)
```

---

## Adding a new project

Each project has its own mapper script that handles its specific document formats.

1. Create a folder: `projects/<project-name>/`
2. Add subfolders: `sources/` (raw files) and `output/` (generated files)
3. Create `projects/<project-name>/build_rtm_input.py` — parse the project's files, apply the locked JIRA Description → Summary rule, and emit the 27-column CSV
4. Prompt the agent:

```
I want to create a traceability matrix for a new project called <name>.
Sources:
- FSD: @<file>
- TSD: @<file>
- JIRA: @<file>
- Test Case: @<file>

Create a project mapper under projects/<name>/ and generate the RTM.
```

> All project-specific knowledge (document layouts, column names, ID formats) belongs **only** inside **repository-root** `projects/<name>/` — not under `.cursor/skills/` or `.cursor/rules/`. The skill scripts are reused unchanged for every project.

---

## Running scripts manually

```bash
# Install dependency
pip install -r .cursor/skills/traceability-matrix/scripts/requirements.txt

# Build Excel from a ready CSV
python .cursor/skills/traceability-matrix/scripts/generate_rtm.py \
    <rtm_input.csv> -o rtm.xlsx --project "My Project"

# Audit the RTM
python .cursor/skills/traceability-matrix/scripts/audit_rtm.py \
    <rtm_input.csv> -o rtm_audited.xlsx --project "My Project"

# WOI project — build + export in one command
python projects/woi-universal-p2/build_rtm_input.py --export
```

---

## File structure

```
.cursor/
  skills/
    traceability-matrix/
      SKILL.md                  ← agent skill definition (build + audit)
      README.md                 ← this file
      scripts/
        chain.py                ← active stages, reasoning, JIRA Description rule
        citations.py            ← generic regex extractors (categories A–K)
        docindex.py             ← DOCX indexes, breadcrumb/chapter lookup, FSD resolver
        validate_citations.py   ← pre-sign-off regex gap scanner
        propose_cite_aliases.py ← generates review CSV/MD; applies human feedback to JSON
        generate_rtm.py         ← generic CSV → styled Excel exporter
        audit_rtm.py            ← independent row-by-row auditor
        requirements.txt        ← Python dependencies (openpyxl)
      templates/
        rtm_input.csv           ← 27-column sample CSV for manual filling
  rules/
    traceability-matrix.mdc     ← Cursor rule (enforced automatically on RTM files)

projects/
  woi-universal-p2/             ← WOI project (reference implementation)
    build_rtm_input.py          ← WOI-specific source wiring (uses citations.py + docindex.py)
    cite_aliases.json           ← approved mappings only (agent updates — do not hand edit)
    sources/                    ← raw source files (FSD, TSD, JIRA, SIT)
    output/                     ← RTM.xlsx, cite_aliases.review.csv, etc.
  <next-project>/               ← add new projects here
    build_rtm_input.py
    sources/
    output/
```

---

## Audit sign-off checklist

Before distributing the RTM, confirm all of the following:

```
□ Audit gate = PASS (0 FLAG rows)
□ validate_citations.py run — 0 false GAPs from regex (agent/CI; not a human step)
□ RTM Coverage & Gaps summary + Gaps detail sheets reviewed — all GAP/PARTIAL rows acknowledged
□ % Proven reviewed and its honest value acknowledged
□ All GAP rows have a Reasoning that names the source shortfall
□ No MATCH row has Evidence = "none in source"
□ All stage PICs populated, or Reasoning acknowledges the blank
□ Jira Task Development Description uses Description → Summary order (locked rule)
□ Auditor Verdict column filled (not blank) in the distributed file
```

### Validate citation coverage (agent/CI — not a human step)

```bash
python .cursor/skills/traceability-matrix/scripts/validate_citations.py \
    --jira projects/<name>/sources/jira.csv \
    --fsd projects/<name>/sources/fsd.docx \
    --sit projects/<name>/sources/sit.xlsx \
    --aliases projects/<name>/cite_aliases.json
```

- **JIRA unmatched list** — tickets with description but no extractor match. If the text contains a real section/Image ID, fix `citations.py` or add a category.
- **SIT FSD gaps** — cites that do not resolve. Fix SIT data, add `cite_aliases.json` entry, or accept honest GAP (e.g. document filename in cell).
