#!/usr/bin/env python3
"""Audit a builder-produced RTM CSV and generate a verified Excel workbook.

Reads a 27-column RTM CSV (22 PMO + 5 audit columns produced by build_rtm_input.py),
independently verifies each row against the honesty contract, writes
'Auditor Verdict' (PASS or FLAG <note>) per row, and produces:

  - RTM           : PMO + Audit band with verdicts filled
  - Coverage & Gaps : gap analysis + % Proven + Match Status breakdown
  - Coverage Accountability : leaf vs row-level proven metrics + orphan breakdown
  - Gaps <Stage> Detail : per provided source (FSD, TSD, …) with fix/validate steps
  - Audit Summary : totals, top issues, pass/fail gate
  - Legend & Standards : column dictionary + standards crosswalk

TWO-DIMENSION DESIGN — read before interpreting results
-------------------------------------------------------
Match Status  (MATCH / PARTIAL / GAP)  answers: "Is the traceability chain complete?"
Auditor Verdict  (PASS / FLAG)         answers: "Was the row built honestly?"

These are independent. A GAP or PARTIAL row with PASS verdict is CORRECT — it means
the gap exists and was honestly documented. PASS does NOT mean the gap is resolved.

A row is FLAG only when a honesty check fails:
  - Match Status is MATCH or PARTIAL but Evidence is empty / 'none in source'
  - Reasoning does not start with MATCH / PARTIAL / GAP
  - A populated stage cell has no PIC and Reasoning does not acknowledge it
  - Builder pre-filled Auditor Verdict (only the auditor may fill it)

Use Match Status + Coverage & Gaps sheet to measure traceability completeness.
Use Auditor Verdict to confirm the build process was honest.

Usage:
  python audit_rtm.py input.csv -o audited.xlsx --project "Project Name"
"""
from __future__ import annotations

import argparse
import csv
import sys
from pathlib import Path

try:
    from openpyxl import Workbook
    from openpyxl.styles import Alignment, Font, PatternFill
except ImportError:
    sys.stderr.write(
        "ERROR: openpyxl is required. Install it with:\n"
        "  pip install -r requirements.txt\n"
    )
    sys.exit(2)

# generate_rtm.py lives alongside this script — use a direct import via sys.path.
_here = Path(__file__).parent
sys.path.insert(0, str(_here))
import generate_rtm as gen  # noqa: E402

PMO_COLUMNS = gen.PMO_COLUMNS
AUDIT_COLUMNS = gen.AUDIT_COLUMNS
STAGES = gen.STAGES
DARK_BOLD = gen.DARK_BOLD

VERDICT_COL = "Auditor Verdict"
MATCH_STATUS_COL = "Match Status"
EVIDENCE_COL = "Evidence"
REASONING_COL = "Reasoning"

# Map stage key -> id column and pic column (used in dynamic backward-trace check).
_STAGE_ID_MAP: dict[str, str] = {s.key: s.id_col for s in STAGES}
_STAGE_PIC_MAP: dict[str, str] = {s.key: s.pic_col for s in STAGES}


def _fail(msg: str) -> None:
    sys.stderr.write(f"ERROR: {msg}\n")
    sys.exit(1)


def load_rtm(path: str) -> list[dict]:
    """Load RTM CSV; validate all 22 PMO + builder audit columns are present."""
    try:
        with open(path, newline="", encoding="utf-8-sig") as fh:
            reader = csv.DictReader(fh)
            if not reader.fieldnames:
                _fail(f"File is empty: {path}")
            present = {(h or "").strip() for h in reader.fieldnames}
            missing_pmo = [c for c in PMO_COLUMNS if c not in present]
            if missing_pmo:
                _fail("Missing PMO columns:\n  - " + "\n  - ".join(missing_pmo))
            required_audit = [c for c in AUDIT_COLUMNS if c != VERDICT_COL]
            missing_audit = [c for c in required_audit if c not in present]
            if missing_audit:
                _fail(
                    "Missing builder audit columns (CSV was not produced by the builder):\n  - "
                    + "\n  - ".join(missing_audit)
                )
            all_cols = PMO_COLUMNS + AUDIT_COLUMNS
            rows = [{c: (raw.get(c) or "").strip() for c in all_cols} for raw in reader]
    except FileNotFoundError:
        _fail(f"File not found: {path}")
    if not rows:
        _fail("CSV has headers but no data rows.")
    return rows


def _check_row(row: dict, active_stages: list[str] | None = None) -> tuple[str, list[str]]:
    """Return (verdict, issues) for one data row.

    active_stages
        Ordered list of stage keys the project has provided.  Used to
        generalize the backward-trace check: the leaf row must acknowledge
        a missing link to its topmost ACTIVE stage, not specifically BRD.
        Defaults to all 6 stages for backward compatibility.
    """
    if active_stages is None:
        active_stages = [s.key for s in STAGES]

    top_stage = active_stages[0] if active_stages else "BRD"
    leaf_stage = active_stages[-1] if active_stages else "Test Case"
    top_id_col = _STAGE_ID_MAP.get(top_stage, "BRD ID")
    leaf_id_col = _STAGE_ID_MAP.get(leaf_stage, "Test Case ID")

    issues = []
    status = row.get(MATCH_STATUS_COL, "").strip()
    evidence = row.get(EVIDENCE_COL, "").strip()
    reasoning = row.get(REASONING_COL, "").strip()
    pre_verdict = row.get(VERDICT_COL, "").strip()

    # 1. Evidence contract: MATCH/PARTIAL must have real evidence.
    if status in ("MATCH", "PARTIAL") and (not evidence or evidence.lower() == "none in source"):
        issues.append(f"Match Status={status} but Evidence is absent or 'none in source'")

    # 2. Match Status value must be valid.
    if status not in ("MATCH", "PARTIAL", "GAP", ""):
        issues.append(f"Match Status has unexpected value: '{status}'")

    # 3. Reasoning must start with a status word.
    if reasoning and not reasoning.upper().startswith(("MATCH", "PARTIAL", "GAP")):
        issues.append(f"Reasoning does not start with MATCH/PARTIAL/GAP: '{reasoning[:60]}'")
    if not reasoning:
        issues.append("Reasoning is blank")

    # 4. PIC completeness: populated stage must have a PIC, or Reasoning must acknowledge it.
    for stage in STAGES:
        if row.get(stage.id_col) and not row.get(stage.pic_col):
            pic_ack = f"{stage.key} PIC blank in source" in reasoning
            if not pic_ack:
                issues.append(
                    f"{stage.key} populated ({row[stage.id_col]}) but PIC is blank "
                    f"(add 'GAP: {stage.key} PIC blank in source' to Reasoning)"
                )

    # 5. Backward trace: leaf row with no topmost-active-stage link must acknowledge it.
    #    When topmost stage is inactive (e.g. BRD not provided), the standard inactive
    #    prefix in Reasoning already covers it, so this check passes naturally.
    if row.get(leaf_id_col) and not row.get(top_id_col) and status != "GAP":
        top_ack = (
            f"{top_stage} not provided" in reasoning
            or f"source: {top_stage}" in reasoning
            or top_stage in reasoning
        )
        if not top_ack:
            issues.append(
                f"Row has {leaf_stage} but no {top_stage} (topmost active stage), "
                f"Match Status is not GAP, and Reasoning does not acknowledge "
                f"the missing {top_stage}"
            )

    # 6. Builder must not pre-fill Auditor Verdict.
    if pre_verdict:
        issues.append(f"Auditor Verdict was pre-filled by the builder: '{pre_verdict[:60]}'")

    if not issues:
        return "PASS", []
    return "FLAG: " + "; ".join(issues), issues


def audit_rows(rows: list[dict],
               active_stages: list[str] | None = None) -> tuple[list[dict], list[dict]]:
    """Write Auditor Verdict into each row; return (audited_rows, flag_rows)."""
    audited, flags = [], []
    for i, row in enumerate(rows):
        r = dict(row)
        verdict, issues = _check_row(r, active_stages=active_stages)
        r[VERDICT_COL] = verdict
        audited.append(r)
        if issues:
            flags.append({"row": i + 1, "verdict": verdict, "issues": issues})
    return audited, flags


def build_audit_summary_sheet(wb: Workbook, rows: list[dict], flags: list[dict],
                               project: str) -> None:
    ws = wb.create_sheet("Audit Summary")
    ws.column_dimensions["A"].width = 18
    ws.column_dimensions["B"].width = 80

    ws.cell(row=1, column=1, value=f"Audit Summary - {project}").font = \
        Font(bold=True, size=14, color="1F3864")

    total = len(rows)
    flag_count = len(flags)
    gate_pass = flag_count == 0
    sc = {"MATCH": 0, "PARTIAL": 0, "GAP": 0}
    for r in rows:
        s = r.get(MATCH_STATUS_COL, "")
        if s in sc:
            sc[s] += 1
    proven_pct = round(100 * sc["MATCH"] / total, 1) if total else 0.0

    def section(row_idx: int, label: str) -> int:
        c = ws.cell(row=row_idx, column=1, value=label)
        c.font = DARK_BOLD
        c.fill = PatternFill("solid", fgColor="D9D9D9")
        ws.cell(row=row_idx, column=2).fill = PatternFill("solid", fgColor="D9D9D9")
        return row_idx + 1

    def kv(row_idx: int, key: str, val, bold_val: bool = False, color: str = "") -> int:
        ws.cell(row=row_idx, column=1, value=key)
        vc = ws.cell(row=row_idx, column=2, value=val)
        if bold_val or color:
            vc.font = Font(bold=bold_val, color=color or "000000")
        return row_idx + 1

    r = 3
    r = section(r, "How to read this sheet")
    note_lines = [
        "Auditor Verdict (PASS/FLAG) = was the row built honestly?",
        "Match Status (MATCH/PARTIAL/GAP) = is the traceability chain complete?",
        "GAP or PARTIAL with PASS is CORRECT — gap exists and was honestly documented.",
        "PASS does NOT mean the gap is resolved. Review Match Status + Coverage & Gaps for completeness.",
    ]
    for line in note_lines:
        c = ws.cell(row=r, column=2, value=line)
        c.alignment = Alignment(wrap_text=True)
        c.font = Font(italic=True, color="595959")
        r += 1
    r += 1

    r = section(r, "Gate decision")
    gate_text = "PASS - RTM is verified and proven" if gate_pass \
        else f"FAIL - {flag_count} FLAG row(s) must be resolved before sign-off"
    r = kv(r, "Gate", gate_text, bold_val=True,
            color="548235" if gate_pass else "C00000")
    r += 1

    r = section(r, "Totals")
    r = kv(r, "Total rows", total)
    r = kv(r, "PASS rows", total - flag_count)
    r = kv(r, "FLAG rows", flag_count, bold_val=flag_count > 0,
            color="C00000" if flag_count else "")
    proven_color = "548235" if proven_pct >= 80 else ("C09000" if proven_pct >= 40 else "C00000")
    r = kv(r, "% Proven (MATCH)", f"{proven_pct}%", bold_val=True, color=proven_color)
    r = kv(r, "MATCH count", sc["MATCH"])
    r = kv(r, "PARTIAL count", sc["PARTIAL"])
    r = kv(r, "GAP count", sc["GAP"])
    r += 1

    r = section(r, f"FLAG details ({flag_count} rows)")
    if not flags:
        ws.cell(row=r, column=2, value="No FLAGs - all rows passed").font = Font(color="548235")
        r += 1
    else:
        for f in flags:
            ws.cell(row=r, column=1, value=f"row {f['row']}")
            ws.cell(row=r, column=2, value=f["verdict"]).alignment = \
                Alignment(wrap_text=True, vertical="top")
            r += 1


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Audit an RTM CSV and produce a verified workbook.")
    parser.add_argument("input", help="Path to the builder RTM CSV (27 columns).")
    parser.add_argument("-o", "--output", default="rtm_audited.xlsx")
    parser.add_argument("--project", default="Untitled Project")
    parser.add_argument("--no-merge", action="store_true")
    parser.add_argument(
        "--stages", default="all",
        help=(
            "Comma-separated active stages (e.g. 'FSD,TSD,JIRA,Test Case'). "
            "Must match the value used when building the CSV. Defaults to all 6."
        ),
    )
    args = parser.parse_args(argv)

    active_stages = gen._parse_stages_arg(args.stages)

    rows = load_rtm(args.input)
    audited, flags = audit_rows(rows, active_stages=active_stages)
    extra_cols = [c for c in AUDIT_COLUMNS if c in audited[0]]

    wb = Workbook()
    gen.build_rtm_sheet(wb, audited, extra_cols, merge_upstream=not args.no_merge)
    gaps = gen.analyse_gaps(audited, extra_cols, active_stages=active_stages)
    gen.ga.configure_stages(gen.STAGES)
    gen.build_coverage_sheet(wb, audited, gaps, args.project)
    build_audit_summary_sheet(wb, audited, flags, args.project)
    gen.build_legend_sheet(wb, args.project)

    try:
        wb.save(args.output)
    except OSError as exc:
        gen._fail(f"Could not write '{args.output}': {exc}")

    gate_pass = len(flags) == 0
    print(f"Wrote {args.output}")
    print(f"  Rows: {len(audited)}  PASS={len(audited)-len(flags)}  FLAG={len(flags)}")
    sc = gaps["status_counts"]
    print(f"  Match Status: MATCH={sc['MATCH']}  PARTIAL={sc['PARTIAL']}  "
          f"GAP={sc['GAP']}  % Proven={gaps['proven_pct']}%")
    print(f"  Gate: {'PASS - RTM is verified and proven.' if gate_pass else f'FAIL - {len(flags)} FLAG row(s) must be resolved.'}")
    return 0 if gate_pass else 1


if __name__ == "__main__":
    sys.exit(main())
