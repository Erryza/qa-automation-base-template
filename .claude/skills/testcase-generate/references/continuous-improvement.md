# Continuous improvement (per project)

**Purpose:** every prompt to create, fix, or review test cases should leave the project **smarter for the next run**. Knowledge lives in the **skill references + the project playbook + the workbook**, not in throwaway notes.

---

## Where knowledge lives (read in this order at task start)

| Priority | Source | What it holds |
|----------|--------|----------------|
| 1 | **Submitted spec** (FSD / TSD / API spec) + **source code** | Source of truth |
| 2 | [tsd-alignment.md](tsd-alignment.md) + [scope-detection.md](scope-detection.md) + [new-vs-regression.md](new-vs-regression.md) | Global rules |
| 3 | [common-mistakes.md](common-mistakes.md) | Cross-project defects — never repeat |
| 4 | `project-playbooks/<Project Name>.md` | Project-specific fixes, history, env notes |
| 5 | Workbook support sheets (No-Test Log, Rule Register) | Skip decisions + business rules |

---

## At the start of every task (create / fix / review)

1. Identify the project (folder / feature name).
2. Read [common-mistakes.md](common-mistakes.md) — at least the sections matching this scope (API/UI).
3. Read `project-playbooks/<Project Name>.md` if it exists — apply its **Active rules** before editing.
4. Open the workbook (if it exists): read the **No-Test Log** and any prior revision notes.
5. Plan to run `validate_workbook.py` before claiming a fix is done.

---

## After every prompt that changes test cases (fix, append, regenerate)

Do all that apply in one pass — don't wait to be asked again:

| Step | Action |
|------|--------|
| A | Apply the fix in the `.xlsx`; re-run `validate_workbook.py` until it passes |
| B | Update the **project playbook** Session log: date, what the user asked, what changed, TC IDs touched |
| C | If the defect is reusable on other projects → add a bullet to [common-mistakes.md](common-mistakes.md) |
| D | If New/Regression/No-Test decisions changed → update the **No-Test Log** sheet too |

**Rule:** if the user taught you something in chat, it must land in **B** (or the No-Test Log / common-mistakes) before you call the task done.

---

## Project playbook format

Path: `project-playbooks/<Project Name>.md`. Required sections:

```markdown
# Project playbook — <Project Name>

## Workbook
- Path: test-cases/<Project>/Test Cases - <Feature>.xlsx
- Version: vX.Y (bump on material edits)
- Last updated: YYYY-MM-DD

## Inputs
- FSD / TSD / API spec paths · source repo · Figma link (if any)

## Scope
- Detected: API / UI / both · strict-scope: on/off (and why)

## Active rules (project-specific)
- Bullets to follow on this engagement (literals, code maps, prefixes)

## New vs Regression notes
- What the change touches · what's in the regression blast radius · No-Test decisions

## Session log (newest first)
### YYYY-MM-DD — <short title>
- User ask: …
- Changes: TC IDs / sheets …
- Validator: pass/fail
```

See [project-playbooks/README.md](../project-playbooks/README.md) for how to write an overlay.

---

## What "better every prompt" means

| Wrong | Right |
|-------|-------|
| Rely on chat history only | Persist learnings in the playbook + workbook sheets |
| Same spec-fidelity mistake on regen | Read playbook Active rules + common-mistakes first |
| "Fixed" without running the validator | Pass the validator + log the session |
| Silently drop a behavior | Record it on the No-Test Log |
