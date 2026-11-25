# Spec alignment — follow the submitted tables, not misleading samples

Every test case must follow the **client-submitted** specification (FSD / TSD / API spec) — not informal samples, old drafts, or assumptions. The most common spec-fidelity defect is copying values from a **narrative example block** when they contradict the authoritative **definition table**.

---

## Source-of-truth hierarchy

| Priority | Source | Use for |
|----------|--------|---------|
| 1 | **Header / field definition tables** | Algorithm, M/O/C, max length, business rules |
| 2 | **Error / response-code tables** | `responseCode`, HTTP status, messages |
| 3 | **Request/response JSON examples** | Field names and shapes only — **verify** against the tables |
| 4 | Referenced external PDFs/specs | Downstream codes, mappings |

**Do not** copy example request/response blocks when they contradict the definition tables. This is especially common with computed security headers (signatures, tokens).

---

## Phase 1 — mandatory extraction

Before authoring any TC:

1. Read the **full** submitted doc end-to-end. For `.docx`, dump **tables**, not only paragraphs.
2. Build an inventory: endpoints, headers (with the **Description** column), body fields (M/O/C), error codes, screen fields, validations.
3. For **computed** values (e.g. a signature header), capture verbatim: the algorithm + encoding, the key source, and the per-endpoint format string from the definition table.
4. RTM (col C) must point to the submitted file + section/table (or the spec URL / Figma link) — not a paraphrase.

---

## Computed security headers (general rule)

When the spec defines a header as, say, `Base64(HMAC-SHA512(...))`:

| Case | Rule |
|------|------|
| Happy-path Test Data | Use a value of the correct **shape/length** per the definition table (e.g. ~86–88 char Base64), or a `{placeholder}` plus a Pre-Condition documenting the algorithm |
| Invalid negative | A **wrong** value of **valid shape** (wrong digest, correct Base64 length) — not `bad-signature` or `deadbeef` |
| Legacy-sample negative | At most **one** dedicated TC may use the exact value from a sample block, and only if the Scenario states that intent (e.g. "40-char hex from sample — invalid per header table") |
| Empty negative | The header line present with a blank value (`X-SIGNATURE: `) |
| Per endpoint | The format/path must match the specific endpoint, not a copy-paste from another |

The validator flags 40-char-hex / `bad-signature` / `deadbeef` in an `X-SIGNATURE:` line on API rows unless the Scenario marks it as an intentional legacy/sample case.

---

## Self-review additions

- [ ] Every header value shape matches the **definition table**, not just the narrative example.
- [ ] Every `responseCode` / validation message in Expected Results exists in the submitted spec.
- [ ] Pre-Condition documents how computed values are produced for execution.
- [ ] No field max-length taken from an old template when the spec states a different limit.
