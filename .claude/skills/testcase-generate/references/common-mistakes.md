# Common mistakes — do not repeat

Read before every generation and after any rejection. When you discover a new defect pattern, add a bullet here **and** log it in the project playbook ([continuous-improvement.md](continuous-improvement.md)).

---

## Spec & accuracy (BLOCKER class)

- **Computed headers (e.g. X-SIGNATURE):** copying a 40-char hex / placeholder from a TSD *sample block* when the **definition table** specifies `Base64(HMAC-SHA512(...))`. Invalid negatives must use a wrong value of **valid shape** — not `bad-signature` / `deadbeef`. See [tsd-alignment.md](tsd-alignment.md).
- Using narrative **examples** when they contradict **definition tables**.
- Inventing a `responseCode`, HTTP status, or validation message not in the spec. **One wrong code can fail the whole workbook.**
- Pre-Condition endpoint/method (or screen/precondition) not matching the spec.
- Positive Expected Results on a Negative TC (e.g. Status 200 when testing invalid input).
- Test Data still shows the **valid** value while the Scenario says invalid/empty — the bad value must appear in Test Data.
- **Empty header doubled prefix** — `X-TIMESTAMP: X-TIMESTAMP: ` when the Scenario says empty; correct is `X-TIMESTAMP: ` (replace the value only, never the whole line with the prefix).
- **Scenario / Test Data mismatch** — Description says "empty" but Test Data shows an invalid value (or vice versa).

## Coverage (BLOCKER class)

- Submitting without a coverage inventory — gaps go undetected.
- **Any** mandatory field missing its invalid **or** empty Negative TC.
- **Any** spec `responseCode` / validation message with no TC asserting it.
- Only invalid OR only empty for a mandatory field — **both** are required.
- Missing the happy-path Positive per endpoint/screen.
- Boundary TCs that only change **case** (e.g. `IDR`→`idr`) — the validator lowercases Test Data for duplicate detection; use semantically different values (`XXX`, `UNKNOWN`).
- Copy-pasting the same Expected Results across all negatives.

## New / Regression / No-Test (BLOCKER class)

- Authoring only **New** behavior and leaving **Regression** (the change's blast radius) untested.
- Skipping the source-code classification step entirely and testing everything (re-testing unchanged behavior).
- Dropping a behavior silently — every skipped scenario must be on the **No-Test Log** with a reason.
- Encoding New/Regression in the **TC-ID prefix** instead of the **Test Category** column — breaks the one-prefix-per-sheet + contiguous-sequence rule the validator enforces.

## Format & template (MAJOR class)

- `Positive Case` instead of `Positive`.
- TC ID format wrong (`TC-INQ-P-001` instead of `AUT-001`).
- Missing row 3 separator or data starting before row 4.
- Wrong header color (not `#ACB9CA`) or missing wrap on J/K/M/N.
- Pre-filling Actual Results (col N) or Status (col O) before execution.
- Mixing two unrelated features on one tab. (Module col F need not equal the tab name — `Inquiry QR` may carry module `API Decode QR MPM` — but keep one coherent feature per tab.)

## Test Data & Test Steps (MAJOR class)

- Negative TC without **bold** on the varied line in Test Data (API rows) — reader can't see what drives the result.
- Using **yellow cell fill** or a `► [CHANGED]` prefix — use **bold only** on the changed line (transparent background).
- Using `[M]` / `[O]` instead of `(Mandatory)` / `(Optional)`.
- Not listing **every** spec field in the steps.
- API Test Data missing `Header:` / `Body:` labels, or missing the final `Click the Send button` step.

## Duplicates (BLOCKER class)

- Copy-pasting a row and changing only the TC ID / S.No.
- Same Scenario + same TC Type on one sheet.
- Identical Test Data on two rows — each negative must change **one** field from baseline.
- Same Scenario + Expected Results — redundant.
- Boundary TC duplicating a mandatory-field invalid/empty already covered.

## Scope

- Authoring UI test cases when there is no screen/Figma signal, or API test cases when there is no API spec — let scope **fall out of the inputs** ([scope-detection.md](scope-detection.md)).
- Padding the workbook with out-of-scope rows. Removing a **duplicate** or **out-of-scope** row is required; removing a **spec-required** row because the total "feels high" is not.
