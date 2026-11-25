# Project playbooks — how to write an overlay

The core skill ([../SKILL.md](../SKILL.md)) is **generic** and works for any project and stack. A **project playbook** is a per-project overlay that captures everything specific to one engagement: input/output paths, header literals, prefix conventions, code maps, scope decisions, and a running session log.

**One playbook per project**, named after the project/feature folder. Read the matching playbook at task start; update its session log after every fix ([../references/continuous-improvement.md](../references/continuous-improvement.md)).

---

## What goes in the core skill vs an overlay

| Generic core skill | Project overlay |
|--------------------|-----------------|
| 5-phase workflow, A–N columns, bold Test Data rule | Input/output paths, workbook filename |
| Scope detection (API vs UI vs both) | Which scope this project actually is, and **why** |
| New/Regression/No-Test method | What the current change touches (the regression blast radius) |
| Excel format, validator, common mistakes | Exact header order, SIT literals, response-code maps |
| TC-ID convention (3-letter prefix per feature) | The actual prefixes used (e.g. `EAI`, `PTI`, `DEC`) |
| — | Whether to run the validator with `--strict-scope` and the forbidden-scope list |

---

## Template

Copy this and fill it in (see [../references/continuous-improvement.md](../references/continuous-improvement.md#project-playbook-format) for the canonical sections):

```markdown
# Project playbook — <Project Name>

## Workbook
- Path: test-cases/<Project>/Test Cases - <Feature>.xlsx
- Version: vX.Y
- Last updated: YYYY-MM-DD

## Inputs
- FSD / TSD / API spec paths · source repo · Figma link (if any)

## Scope
- Detected: API / UI / both
- strict-scope: on/off — if on, the forbidden-scope list and why

## Active rules (project-specific)
- Response-code maps, header order/literals, prefix table, business-rule quirks

## New vs Regression notes
- What the change touches · regression blast radius · No-Test decisions

## Session log (newest first)
### YYYY-MM-DD — <title>
- User ask / Changes / Validator result
```

---

## Worked example

No overlay ships here yet. For your project, create `<Project> - <Feature>.md` from the template above the first time `testcase-generate` runs for a feature, so that project-specific content (header order, feature prefixes, scope decisions) lives in the overlay and the core skill stays stack-agnostic.

**Not stored here:** the client deliverable (`.xlsx`).
