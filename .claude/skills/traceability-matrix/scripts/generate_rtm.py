#!/usr/bin/env python3
"""Generate a PMO Requirements Traceability Matrix (RTM) as a styled Excel workbook.

PMO chain: BRD -> UREQ -> FSD -> TSD -> JIRA -> Test Cases.

Reads a CSV with the 22 PMO columns (plus optional trailing audit columns) and
writes an .xlsx with:
  - RTM                 : wide PMO layout (merged color-coded group bands) + Audit band
  - Coverage & Gaps       : gap summary (% Proven, counts, hop breakdown)
  - Gap Types Guide       : plain-language dictionary of every Gap Type code
  - Coverage Accountability : feature/leaf vs row-level proven metrics
  - Gaps <Stage>          : one sheet per **provided** source (all gap cases)
  - Legend & Standards    : column dictionary + PMBOK / ISO 29148 / BABOK crosswalk

PMO branching trace model::
  BRD → UREQ → FSD → TSD → JIRA
                FSD → Test Case  (direct — not via TSD/JIRA)

Usage:
  python generate_rtm.py input.csv -o rtm.xlsx --project "Project Name"
"""
from __future__ import annotations

import argparse
import csv
import re
import sys
from dataclasses import dataclass

try:
    from openpyxl import Workbook
    from openpyxl.styles import Alignment, Border, Font, PatternFill, Side
    from openpyxl.utils import get_column_letter
    import chain
    import gap_accountability as ga
except ImportError:
    sys.stderr.write(
        "ERROR: openpyxl is required. Install it with:\n"
        "  pip install -r requirements.txt\n"
    )
    sys.exit(2)


@dataclass
class Stage:
    key: str
    id_col: str
    pic_col: str
    columns: list
    band: str
    tint: str


STAGES: list[Stage] = [
    Stage("BRD", "BRD ID", "BRD PIC",
          ["BRD ID", "BRD Section Page", "Business Requirement Description", "BRD PIC"],
          band="8EAADB", tint="D9E1F2"),
    Stage("UREQ", "UREQ ID", "UREQ PIC",
          ["UREQ ID", "UREQ Section Page", "UREQ Description", "UREQ PIC"],
          band="A9D08E", tint="E2EFDA"),
    Stage("FSD", "FSD ID", "FSD PIC",
          ["FSD ID", "FSD Section Page", "Functional Specification Description", "FSD PIC"],
          band="4BACC6", tint="DAEEF3"),
    Stage("TSD", "TSD ID", "TSD PIC",
          ["TSD ID", "TSD Section Page", "Technical Description", "TSD PIC"],
          band="FFD966", tint="FFF2CC"),
    Stage("JIRA", "Jira Task ID", "JIRA PIC",
          ["Jira Task ID", "Jira Task Development Description", "JIRA PIC"],
          band="F4B183", tint="FCE4D6"),
    Stage("Test Case", "Test Case ID", "Test Case PIC",
          ["Test Case ID", "Test Case Description", "Test Case PIC"],
          band="B4A7D6", tint="E4DFEC"),
]

_STAGE_ORDER: list[str] = [s.key for s in STAGES]
_STAGE_BY_KEY: dict[str, Stage] = {s.key: s for s in STAGES}
_STAGE_ALIASES: dict[str, str] = {
    "TESTCASE": "Test Case", "TC": "Test Case", "TEST_CASE": "Test Case",
}


def _parse_stages_arg(spec: str) -> list[str]:
    """Parse a comma-separated stage spec into an ordered active-stage key list.

    'all' or empty returns all 6 stages (backward compatible default).
    """
    if not spec or spec.strip().lower() == "all":
        return list(_STAGE_ORDER)
    raw = [s.strip() for s in spec.split(",") if s.strip()]
    active: set[str] = set()
    for name in raw:
        canonical = _STAGE_ALIASES.get(name.upper().replace(" ", "").replace("-", ""), name)
        if canonical not in _STAGE_ORDER:
            _fail(f"Unknown stage: {name!r}. Valid stages: {', '.join(_STAGE_ORDER)}")
        active.add(canonical)
    return [s for s in _STAGE_ORDER if s in active]


def _active_stage_objs(active_keys: list[str]) -> list[Stage]:
    """Return Stage objects for the given keys in PMO chain order."""
    return [_STAGE_BY_KEY[k] for k in active_keys if k in _STAGE_BY_KEY]

PMO_COLUMNS: list[str] = [c for s in STAGES for c in s.columns]

# Audit columns (optional, appended after the 22 PMO columns).
AUDIT_COLUMNS: list[str] = [
    "Match Status", "Confidence", "Evidence", "Reasoning", "Auditor Verdict",
]
AUDIT_BAND_COLOR = "595959"   # dark grey band header
AUDIT_TINT_MATCH = "E2EFDA"   # green tint for MATCH rows
AUDIT_TINT_PARTIAL = "FFF2CC" # yellow tint for PARTIAL rows
AUDIT_TINT_GAP = "FCE4D6"     # orange tint for GAP rows
AUDIT_TINT_DEFAULT = "F2F2F2" # neutral tint for unknown status

WIDE_DESCRIPTION_COLS = {
    "Business Requirement Description",
    "UREQ Description",
    "Functional Specification Description",
    "Technical Description",
    "Jira Task Development Description",
    "Test Case Description",
    "Evidence", "Reasoning", "Auditor Verdict",
}

THIN = Side(style="thin", color="BFBFBF")
MEDIUM = Side(style="medium", color="404040")
WHITE_BOLD = Font(bold=True, color="FFFFFF")
DARK_BOLD = Font(bold=True, color="262626")

STATUS_TINT = {
    "MATCH": AUDIT_TINT_MATCH,
    "PARTIAL": AUDIT_TINT_PARTIAL,
    "GAP": AUDIT_TINT_GAP,
}


def _fail(msg: str) -> None:
    sys.stderr.write(f"ERROR: {msg}\n")
    sys.exit(1)


def read_rows(path: str) -> tuple[list[dict], list[str]]:
    """Read CSV; validate PMO columns; preserve any trailing audit columns."""
    try:
        with open(path, newline="", encoding="utf-8-sig") as fh:
            reader = csv.DictReader(fh)
            if reader.fieldnames is None:
                _fail(f"Input file '{path}' is empty.")
            present = {(h or "").strip() for h in reader.fieldnames}
            missing = [c for c in PMO_COLUMNS if c not in present]
            if missing:
                _fail(
                    "Input CSV is missing required PMO columns:\n  - "
                    + "\n  - ".join(missing)
                )
            # Detect audit columns present in this file.
            extra_cols = [c for c in AUDIT_COLUMNS if c in present]
            all_cols = PMO_COLUMNS + extra_cols
            rows = []
            for raw in reader:
                rows.append({c: (raw.get(c) or "").strip() for c in all_cols})
    except FileNotFoundError:
        _fail(f"Input file not found: {path}")
    if not rows:
        _fail("Input CSV has headers but no data rows.")
    return rows, extra_cols


def stage_left_col(stage_index: int) -> int:
    return 1 + sum(len(STAGES[i].columns) for i in range(stage_index))


def audit_start_col(extra_cols: list[str]) -> int:
    return len(PMO_COLUMNS) + 1 if extra_cols else 0


def _audit_row_tint(row: dict, extra_cols: list[str]) -> str:
    if "Match Status" in extra_cols:
        return STATUS_TINT.get(row.get("Match Status", ""), AUDIT_TINT_DEFAULT)
    return AUDIT_TINT_DEFAULT


def build_rtm_sheet(wb: Workbook, rows: list[dict], extra_cols: list[str],
                    merge_upstream: bool) -> None:
    ws = wb.active
    ws.title = "RTM"
    band_row, header_row, first_data_row = 1, 2, 3

    # PMO group bands + headers.
    for s_idx, stage in enumerate(STAGES):
        left = stage_left_col(s_idx)
        right = left + len(stage.columns) - 1
        ws.merge_cells(start_row=band_row, start_column=left,
                       end_row=band_row, end_column=right)
        bc = ws.cell(row=band_row, column=left, value=stage.key)
        bc.fill = PatternFill("solid", fgColor=stage.band)
        bc.font = WHITE_BOLD
        bc.alignment = Alignment(horizontal="center", vertical="center")
        for offset, header in enumerate(stage.columns):
            hc = ws.cell(row=header_row, column=left + offset, value=header)
            hc.fill = PatternFill("solid", fgColor=stage.band)
            hc.font = WHITE_BOLD
            hc.alignment = Alignment(horizontal="center", vertical="center", wrap_text=True)

    # Audit band + headers (if audit columns present).
    if extra_cols:
        al = audit_start_col(extra_cols)
        ar = al + len(extra_cols) - 1
        ws.merge_cells(start_row=band_row, start_column=al,
                       end_row=band_row, end_column=ar)
        abc = ws.cell(row=band_row, column=al, value="Audit")
        abc.fill = PatternFill("solid", fgColor=AUDIT_BAND_COLOR)
        abc.font = WHITE_BOLD
        abc.alignment = Alignment(horizontal="center", vertical="center")
        for offset, header in enumerate(extra_cols):
            ahc = ws.cell(row=header_row, column=al + offset, value=header)
            ahc.fill = PatternFill("solid", fgColor=AUDIT_BAND_COLOR)
            ahc.font = WHITE_BOLD
            ahc.alignment = Alignment(horizontal="center", vertical="center", wrap_text=True)

    # Data rows.
    for r_offset, row in enumerate(rows):
        excel_row = first_data_row + r_offset
        for s_idx, stage in enumerate(STAGES):
            left = stage_left_col(s_idx)
            for offset, header in enumerate(stage.columns):
                cell = ws.cell(row=excel_row, column=left + offset, value=row[header])
                cell.fill = PatternFill("solid", fgColor=stage.tint)
                cell.alignment = Alignment(
                    vertical="top",
                    wrap_text=header in WIDE_DESCRIPTION_COLS,
                )
        if extra_cols:
            tint = _audit_row_tint(row, extra_cols)
            al = audit_start_col(extra_cols)
            for offset, header in enumerate(extra_cols):
                cell = ws.cell(row=excel_row, column=al + offset, value=row.get(header, ""))
                cell.fill = PatternFill("solid", fgColor=tint)
                cell.alignment = Alignment(
                    vertical="top",
                    wrap_text=header in WIDE_DESCRIPTION_COLS,
                )
                if header == "Auditor Verdict" and row.get(header, "").startswith("FLAG"):
                    cell.font = Font(color="C00000", bold=True)
                elif header == "Auditor Verdict" and row.get(header, "") == "PASS":
                    cell.font = Font(color="375623", bold=True)

    last_row = first_data_row + len(rows) - 1
    total_cols = len(PMO_COLUMNS) + len(extra_cols)
    _apply_borders(ws, band_row, last_row, total_cols, extra_cols)
    if merge_upstream:
        _merge_repeated_upstream(ws, rows, first_data_row)
    _set_widths(ws, extra_cols)
    ws.freeze_panes = "B3"
    ws.sheet_view.showGridLines = False


def _apply_borders(ws, top_row: int, bottom_row: int,
                   total_cols: int, extra_cols: list[str]) -> None:
    stage_left_cols = {stage_left_col(i) for i in range(len(STAGES))}
    audit_start = audit_start_col(extra_cols) if extra_cols else 0
    if audit_start:
        stage_left_cols.add(audit_start)
    for row in range(top_row, bottom_row + 1):
        for col in range(1, total_cols + 1):
            left_side = MEDIUM if col in stage_left_cols else THIN
            ws.cell(row=row, column=col).border = Border(
                left=left_side, right=THIN, top=THIN, bottom=THIN
            )


def _merge_repeated_upstream(ws, rows: list[dict], first_data_row: int) -> None:
    for s_idx, stage in enumerate(STAGES):
        left = stage_left_col(s_idx)
        right = left + len(stage.columns) - 1
        run_start = 0
        while run_start < len(rows):
            current = rows[run_start][stage.id_col]
            run_end = run_start
            if current:
                while (run_end + 1 < len(rows)
                       and rows[run_end + 1][stage.id_col] == current):
                    run_end += 1
            if run_end > run_start:
                top = first_data_row + run_start
                bottom = first_data_row + run_end
                for col in range(left, right + 1):
                    ws.merge_cells(start_row=top, start_column=col,
                                   end_row=bottom, end_column=col)
                    top_cell = ws.cell(row=top, column=col)
                    top_cell.alignment = Alignment(
                        vertical="center",
                        wrap_text=PMO_COLUMNS[col - 1] in WIDE_DESCRIPTION_COLS,
                    )
            run_start = run_end + 1


def _set_widths(ws, extra_cols: list[str]) -> None:
    all_cols = PMO_COLUMNS + extra_cols
    for idx, header in enumerate(all_cols, start=1):
        letter = get_column_letter(idx)
        if header in WIDE_DESCRIPTION_COLS:
            width = 42
        elif header.endswith("Section Page"):
            width = 16
        elif header.endswith("ID"):
            width = 14
        elif header in ("Match Status", "Confidence"):
            width = 14
        else:
            width = 16
        ws.column_dimensions[letter].width = width


NO_IDENTIFIER = "(no identifier in source)"


def _best_label(row: dict, stage: Stage) -> str:
    """Return the best available label: ID → Section Page → Description → fallback."""
    id_val = (row.get(stage.id_col) or "").strip()
    if id_val:
        return id_val
    for col in stage.columns[1:-1]:
        if "Section Page" in col:
            val = (row.get(col) or "").strip()
            if val:
                return val
    for col in stage.columns[1:-1]:
        if "Description" in col:
            val = (row.get(col) or "").strip()
            if val:
                return val[:60]
    return NO_IDENTIFIER


def _test_case_label(row: dict) -> str:
    """Label for the test case row: ID → Description → fallback."""
    tc_stage = STAGES[-1]
    label = _best_label(row, tc_stage)
    desc = (row.get("Test Case Description") or "").strip()
    if label != NO_IDENTIFIER and desc and label != desc[:60]:
        return f"{label} — {desc[:60]}"
    return label


def _relevant_gap_reason(reasoning: str, to_stage: str,
                          inactive: list[str] | None = None) -> str:
    """Extract the most relevant GAP note for a missing downstream active stage.

    Notes about inactive stages (e.g. 'BRD not provided') are treated as noise
    and skipped so the displayed reason points to the actual chain break.
    """
    if not reasoning:
        return "(no reason recorded)"

    text = reasoning
    if inactive:
        for stage in inactive:
            text = re.sub(
                rf"GAP:\s*source:\s*{re.escape(stage)}\s*not provided;?\s*",
                "",
                text,
                flags=re.I,
            )
        text = text.strip(" ;.")

    parts = [p.strip() for p in re.split(r"\.\s+", text) if p.strip()]

    stage_hints: dict[str, tuple[str, ...]] = {
        "TSD": ("tsd", "jira ticket", "link jira", "jira description", "image "),
        "JIRA": ("link jira", "jira export", "jira "),
        "FSD": ("fsd section", "fsd document", "fsd cite", "no fsd"),
        "Test Case": ("test case", "sit test"),
        "UREQ": ("ureq",),
        "BRD": ("brd",),
    }
    hints = (to_stage.lower(),) + stage_hints.get(to_stage, ())

    def _is_match_noise(part: str) -> bool:
        pl = part.lower()
        return (
            " and it exists" in pl
            or pl.startswith("sit cites fsd section")
            or pl.startswith("match:")
        )

    def _is_gap_clause(part: str) -> bool:
        if part.upper().startswith("GAP:"):
            return True
        pl = part.lower()
        return any(x in pl for x in (
            "has no ", "cannot ", "not found", "cannot be derived",
            "no explicit", "no recognizable", "not in ", "is blank",
        ))

    gap_parts = [p for p in parts if _is_gap_clause(p) and not _is_match_noise(p)]

    for part in gap_parts:
        pl = part.lower()
        if any(h in pl for h in hints):
            return part[:200]
    if gap_parts:
        return gap_parts[0][:200]
    for part in parts:
        if not _is_match_noise(part):
            return part[:200]
    return reasoning[:120]


def analyse_gaps(rows: list[dict], extra_cols: list[str],
                 active_stages: list[str] | None = None) -> dict:
    """Compute bidirectional gaps and audit-column statistics.

    active_stages
        Ordered list of stage keys the project has provided (e.g.
        ["FSD", "TSD", "JIRA", "Test Case"]).  Defaults to all 6 stages for
        backward compatibility.  Only adjacent active-stage pairs are checked
        for broken forward chains; inactive stages are never flagged.
    """
    if active_stages is None:
        active_stages = list(_STAGE_ORDER)

    act_objs = _active_stage_objs(active_stages)
    inactive = [s for s in _STAGE_ORDER if s not in active_stages]
    top_stage = act_objs[0] if act_objs else STAGES[0]
    leaf_stage = act_objs[-1] if act_objs else STAGES[-1]

    broken_forward: list[dict] = []
    missing_pic: list[tuple] = []
    orphans: list[dict] = []
    pic_by_line: dict[int, list[str]] = {}

    for line_no, row in enumerate(rows, start=1):
        populated = [s for s in STAGES if row[s.id_col]]
        reasoning = row.get("Reasoning", "")

        # Broken forward chains — PMO trace hops (includes FSD→Test Case branch).
        for frm, to in chain.trace_hops(active_stages):
            frm_stage = _STAGE_BY_KEY[frm]
            to_stage = _STAGE_BY_KEY[to]
            if row[frm_stage.id_col] and not row[to_stage.id_col]:
                from_lbl = _best_label(row, frm_stage)
                broken_forward.append({
                    "line_no": line_no,
                    "item_label": _test_case_label(row),
                    "from_stage": frm,
                    "to_stage": to,
                    "chain_broken": f"{frm} {from_lbl} → {to} missing",
                    "gap_reason": _relevant_gap_reason(reasoning, to, inactive),
                })

        # Missing PICs — any populated stage.
        for stage in populated:
            if not row[stage.pic_col]:
                msg = f"{row[stage.id_col]} ({stage.key}) has no PIC"
                missing_pic.append((line_no, msg))
                pic_by_line.setdefault(line_no, []).append(msg)

        # Backward orphans — downstream item missing required upstream hop.
        for frm, to in chain.trace_hops(active_stages):
            to_stage = _STAGE_BY_KEY[to]
            frm_stage = _STAGE_BY_KEY[frm]
            if row[to_stage.id_col] and not row[frm_stage.id_col]:
                to_lbl = _best_label(row, to_stage)
                orphans.append({
                    "line_no": line_no,
                    "item_label": f"{to} {to_lbl}",
                    "chain_broken": (
                        f"{to} {to_lbl} → {frm} missing "
                        f"(required upstream hop {chain.hop_label(frm, to)})"
                    ),
                    "gap_reason": _relevant_gap_reason(reasoning, frm, inactive),
                })

        # Legacy linear orphan check (top stage) — only when BRD is active.
        if "BRD" in active_stages and top_stage.key == "BRD":
            if not row[top_stage.id_col]:
                if row[leaf_stage.id_col]:
                    leaf_lbl = _best_label(row, leaf_stage)
                    orphans.append({
                        "line_no": line_no,
                        "item_label": _test_case_label(row),
                        "chain_broken": (
                            f"{leaf_stage.key} {leaf_lbl} → {top_stage.key} missing "
                            f"(cannot trace backward to top active stage)"
                        ),
                        "gap_reason": _relevant_gap_reason(reasoning, top_stage.key, inactive),
                    })

    # FSD items missing downstream branch coverage (TSD and/or Test Case).
    untested_entries: list[dict] = []
    if "FSD" in active_stages:
        fsd_stage = _STAGE_BY_KEY["FSD"]
        fsd_branch: dict[str, dict[str, bool]] = {}
        for row in rows:
            fid = (row[fsd_stage.id_col] or "").strip()
            if not fid:
                continue
            page = row.get("FSD Section Page", "")
            key = f"{page}|{fid}" if page else fid
            entry = fsd_branch.setdefault(key, {"id": fid, "tsd": False, "tc": False})
            if "TSD" in active_stages and (row.get("TSD ID") or "").strip():
                entry["tsd"] = True
            if "Test Case" in active_stages and (row.get("Test Case ID") or "").strip():
                entry["tc"] = True

        for key, info in sorted(fsd_branch.items()):
            missing: list[str] = []
            if "TSD" in active_stages and not info["tsd"]:
                missing.append("TSD")
            if "Test Case" in active_stages and not info["tc"]:
                missing.append("Test Case")
            if not missing:
                continue
            branches = " and ".join(missing)
            untested_entries.append({
                "line_no": None,
                "top_id": info["id"],
                "item_label": f"FSD {info['id']}",
                "chain_broken": f"FSD {info['id']} → {branches} branch missing",
                "gap_reason": (
                    f"No RTM row connects FSD {info['id']} to "
                    f"{chain.hop_label('FSD', missing[0])}"
                    + (f" (and {missing[1]} branch)" if len(missing) > 1 else "")
                ),
            })
    else:
        # Non-FSD-top projects: legacy top → leaf forward coverage.
        top_has_leaf: dict[str, bool] = {}
        for row in rows:
            top_id = row[top_stage.id_col]
            if top_id:
                top_has_leaf[top_id] = (
                    top_has_leaf.get(top_id, False) or bool(row[leaf_stage.id_col])
                )
        for top_id in sorted(t for t, ok in top_has_leaf.items() if not ok):
            untested_entries.append({
                "line_no": None,
                "top_id": top_id,
                "item_label": f"{top_stage.key} {top_id}",
                "chain_broken": (
                    f"{top_stage.key} {top_id} → {leaf_stage.key} missing"
                ),
                "gap_reason": (
                    f"No RTM row connects {top_stage.key} {top_id} "
                    f"forward to a {leaf_stage.key}"
                ),
            })

    forward_breakdown: dict[str, int] = {}
    for entry in broken_forward:
        hop = f"{entry['from_stage']} → {entry['to_stage']}"
        forward_breakdown[hop] = forward_breakdown.get(hop, 0) + 1

    _enrich_gap_entries(broken_forward, rows, active_stages, pic_by_line)
    _enrich_gap_entries(orphans, rows, active_stages, pic_by_line)
    _enrich_untested_entries(
        untested_entries, rows, active_stages, top_stage, pic_by_line,
    )

    counts = {s.key: len({row[s.id_col] for row in rows if row[s.id_col]}) for s in STAGES}
    # Mark inactive stages clearly in counts.
    for s in inactive:
        counts[s] = "not provided"
    counts["Rows"] = len(rows)

    status_counts: dict[str, int] = {"MATCH": 0, "PARTIAL": 0, "GAP": 0, "unknown": 0}
    if "Match Status" in extra_cols:
        for row in rows:
            s = row.get("Match Status", "").strip()
            if s in status_counts:
                status_counts[s] += 1
            else:
                status_counts["unknown"] += 1

    total = len(rows)
    proven_pct = round(100 * status_counts["MATCH"] / total, 1) if total else 0.0

    return {
        "counts": counts,
        "broken_forward": broken_forward,
        "forward_breakdown": forward_breakdown,
        "untested": untested_entries,
        "orphans": orphans,
        "missing_pic": missing_pic,
        "status_counts": status_counts,
        "proven_pct": proven_pct,
        "has_audit": "Match Status" in extra_cols,
        "top_stage": top_stage.key,
        "leaf_stage": leaf_stage.key,
        "active_stages": active_stages,
        "inactive_stages": inactive,
        "trace_hops": [chain.hop_label(a, b) for a, b in chain.trace_hops(active_stages)],
    }


def _stage_absent_col(stage_key: str) -> str:
    """Column key for 'No <Stage>' flags on gap detail rows."""
    return "no_" + stage_key.lower().replace(" ", "_")


def _enrich_gap_entries(
    entries: list[dict],
    rows: list[dict],
    active_stages: list[str],
    pic_by_line: dict[int, list[str]],
) -> None:
    """Attach per-row Match Status, missing-stage flags, and PIC gaps."""
    for entry in entries:
        line_no = entry.get("line_no")
        for key in active_stages:
            entry[_stage_absent_col(key)] = ""
        entry["missing_pic"] = ""
        entry["match_status"] = ""
        if not line_no or line_no < 1 or line_no > len(rows):
            continue
        row = rows[line_no - 1]
        entry["match_status"] = (row.get("Match Status") or "").strip()
        for key in active_stages:
            stage = _STAGE_BY_KEY[key]
            if not (row.get(stage.id_col) or "").strip():
                entry[_stage_absent_col(key)] = "Yes"
        pics = pic_by_line.get(line_no, [])
        if pics:
            entry["missing_pic"] = "; ".join(pics)


def _enrich_untested_entries(
    entries: list[dict],
    rows: list[dict],
    active_stages: list[str],
    top_stage: Stage,
    pic_by_line: dict[int, list[str]],
) -> None:
    """Attach aggregate missing-stage flags across all rows sharing an FSD id."""
    for entry in entries:
        top_id = entry.get("top_id", "")
        for key in active_stages:
            entry[_stage_absent_col(key)] = "Yes"
        entry["missing_pic"] = ""
        entry["match_status"] = ""
        pic_msgs: list[str] = []
        for line_no, row in enumerate(rows, start=1):
            if (row.get(top_stage.id_col) or "").strip() != top_id:
                continue
            if not entry["match_status"]:
                entry["match_status"] = (row.get("Match Status") or "").strip()
            pic_msgs.extend(pic_by_line.get(line_no, []))
            for key in active_stages:
                stage = _STAGE_BY_KEY[key]
                if (row.get(stage.id_col) or "").strip():
                    entry[_stage_absent_col(key)] = ""
        if pic_msgs:
            entry["missing_pic"] = "; ".join(dict.fromkeys(pic_msgs))


def _write_horizontal_table(
    ws,
    row: int,
    headers: list[str],
    data_rows: list[list],
    *,
    col_widths: list[int] | None = None,
) -> int:
    """Write a header row plus data rows; return the next free row."""
    wrap = Alignment(wrap_text=True, vertical="top")
    if col_widths:
        for idx, width in enumerate(col_widths, start=1):
            ws.column_dimensions[get_column_letter(idx)].width = width
    for col_idx, header in enumerate(headers, start=1):
        hc = ws.cell(row=row, column=col_idx, value=header)
        hc.font = DARK_BOLD
        hc.fill = PatternFill("solid", fgColor="D9D9D9")
        hc.alignment = Alignment(horizontal="center", vertical="center", wrap_text=True)
    row += 1
    if not data_rows:
        cell = ws.cell(row=row, column=1, value="None - OK")
        cell.font = Font(color="548235")
        return row + 2
    for data in data_rows:
        for col_idx, value in enumerate(data, start=1):
            ws.cell(row=row, column=col_idx, value=value).alignment = wrap
        row += 1
    return row + 1


def _absent_flags(entry: dict, stage_keys: list[str]) -> list[str]:
    return [entry.get(_stage_absent_col(k), "") for k in stage_keys]


def build_gap_types_guide_sheet(
    wb: Workbook,
    active: list[str],
    project: str,
) -> None:
    """Plain-language Gap Type dictionary — tab 2, right after RTM."""
    ws = wb.create_sheet("Gap Types Guide", 1)
    r = _title(ws, f"Gap Types Guide - {project}")
    ws.cell(
        row=2, column=1,
        value=(
            "Every code in the Gap Type column is explained below. "
            "Gaps are source-based only — no guessing. "
            "Trace model: BRD → UREQ → FSD → TSD → JIRA  |  FSD → Test Case (direct)."
        ),
    ).font = Font(italic=True, color="595959")
    r = 4
    r = _section(ws, r, f"Gap types for active sources ({', '.join(active)})")
    _write_horizontal_table(
        ws, r,
        ga.gap_type_guide_headers(),
        ga.gap_type_guide_rows(active),
        col_widths=ga.gap_type_guide_col_widths(),
    )


def build_accountability_sheet(
    wb: Workbook,
    rows: list[dict],
    gaps: dict,
    project: str,
) -> None:
    """Coverage Accountability — leaf-level vs row-level proven metrics."""
    ga.configure_stages(STAGES)
    ws = wb.create_sheet("Coverage Accountability")
    ws.column_dimensions["A"].width = 36
    ws.column_dimensions["B"].width = 22
    ws.column_dimensions["C"].width = 56

    r = _title(ws, f"Coverage Accountability - {project}")
    ws.cell(
        row=2, column=1,
        value=(
            "Two coverage views: row-level (% Proven on all rows) vs leaf-level "
            "(MATCH on requirement/leaf items only). Use leaf-level for sign-off."
        ),
    ).font = Font(italic=True, color="595959")
    r = 4

    summary = ga.build_accountability_summary(
        rows,
        gaps.get("active_stages", list(_STAGE_ORDER)),
        gaps.get("inactive_stages", []),
        gaps.get("status_counts", {}),
        gaps.get("proven_pct", 0.0),
    )
    wrap = Alignment(wrap_text=True, vertical="top")
    for row_data in summary:
        for col_idx, value in enumerate(row_data, start=1):
            cell = ws.cell(row=r, column=col_idx, value=value)
            cell.alignment = wrap
            if row_data[0] == "Metric" or (
                row_data[0] and row_data[0].isupper() and row_data[1] == ""
            ):
                cell.font = DARK_BOLD
                cell.fill = PatternFill("solid", fgColor="D9D9D9")
        r += 1


def build_per_source_gap_sheets(
    wb: Workbook,
    rows: list[dict],
    gaps: dict,
    project: str,
) -> int:
    """One ``Gaps <Stage>`` sheet per provided source — all gap cases."""
    ga.configure_stages(STAGES)
    active = gaps.get("active_stages", list(_STAGE_ORDER))
    inactive = gaps.get("inactive_stages", [])
    total_gaps = 0

    for stage_key in [s for s in _STAGE_ORDER if s in active]:
        entries = ga.collect_source_gaps(rows, stage_key, active, inactive)
        total_gaps += len(entries)
        sheet_name = ga.source_gap_sheet_name(stage_key)
        ws = wb.create_sheet(sheet_name)
        r = _title(ws, f"{stage_key} Gaps - {project}")
        hops = chain.downstream_hops(stage_key, active) + chain.upstream_hops(stage_key, active)
        hop_note = ", ".join(chain.hop_label(a, b) for a, b in hops) or "(no hops — stage inactive downstream)"
        ws.cell(
            row=2, column=1,
            value=(
                f"All gaps for source '{stage_key}' — honest, source-based only. "
                f"Required hops: {hop_note}. "
                f"See 'Gap Types Guide' sheet for code definitions."
            ),
        ).font = Font(italic=True, color="595959")
        r = 4
        r = _section(ws, r, f"Gap type codes for {stage_key}")
        r = _write_horizontal_table(
            ws, r,
            ga.gap_type_stage_summary_headers(),
            ga.gap_type_stage_summary_rows(stage_key),
            col_widths=ga.gap_type_stage_summary_col_widths(),
        )
        r = _section(ws, r, f"{stage_key} gaps  -  {len(entries)} found")
        _write_horizontal_table(
            ws, r,
            ga.source_gap_headers(stage_key),
            ga.source_gap_data_rows(entries, stage_key),
            col_widths=ga.source_gap_col_widths(stage_key),
        )

    return total_gaps


def build_coverage_sheet(
    wb: Workbook,
    rows: list[dict],
    gaps: dict,
    project: str,
) -> int:
    """Build summary + accountability + per-source gap sheets."""
    active = gaps.get("active_stages", list(_STAGE_ORDER))
    build_gap_types_guide_sheet(wb, active, project)
    build_coverage_summary_sheet(wb, rows, gaps, project)
    build_accountability_sheet(wb, rows, gaps, project)
    source_gap_count = build_per_source_gap_sheets(wb, rows, gaps, project)
    pic_n = len(gaps["missing_pic"])
    return source_gap_count + pic_n


def build_coverage_summary_sheet(
    wb: Workbook, rows: list[dict], gaps: dict, project: str,
) -> None:
    """Summary only — counts, breakdown, pointers to detail sheets."""
    ws = wb.create_sheet("Coverage & Gaps")
    ws.column_dimensions["A"].width = 42
    ws.column_dimensions["B"].width = 24
    ws.column_dimensions["C"].width = 50

    r = _title(ws, f"Coverage & Gap Analysis - {project}")
    ws.cell(
        row=2, column=1,
        value="Open the Gap Types Guide sheet (tab 2) for plain-language definitions of every Gap Type code.",
    ).font = Font(italic=True, color="1F3864")
    r = 4

    if gaps["has_audit"]:
        sc = gaps["status_counts"]
        r = _section(ws, r, "Match Status summary (% Proven)")
        proven_pct = gaps["proven_pct"]
        color = "548235" if proven_pct >= 80 else ("C09000" if proven_pct >= 40 else "C00000")
        pct_cell = ws.cell(
            row=r, column=2,
            value=f"% Proven (MATCH): {proven_pct}%  |  "
                  f"MATCH={sc['MATCH']}  PARTIAL={sc['PARTIAL']}  GAP={sc['GAP']}",
        )
        pct_cell.font = Font(bold=True, color=color)
        r += 2

    active = gaps.get("active_stages", list(_STAGE_ORDER))
    inactive = gaps.get("inactive_stages", [])

    r = _section(ws, r, "Trace model (PMO branching)")
    ws.cell(
        row=r, column=2,
        value="BRD → UREQ → FSD → TSD → JIRA  |  FSD → Test Case (direct)",
    ).font = Font(bold=True, color="1F3864")
    r += 1
    hops = gaps.get("trace_hops", [])
    if hops:
        ws.cell(row=r, column=1, value="Active hops evaluated")
        ws.cell(row=r, column=2, value=" | ".join(hops))
        r += 1
    r = _section(ws, r, "Active stages (provided)")
    ws.cell(row=r, column=2, value=" → ".join(active)).font = Font(
        bold=True, color="1F3864",
    )
    r += 1
    if inactive:
        ws.cell(
            row=r, column=2,
            value=f"Not provided (documented as GAP): {', '.join(inactive)}",
        ).font = Font(italic=True, color="595959")
        r += 1
    per_source = ", ".join(ga.source_gap_sheet_name(s) for s in active if s in active)
    ws.cell(
        row=r, column=1,
        value=f"Per-source gap sheets: {per_source}",
    ).font = Font(italic=True, color="1F3864")
    r += 2

    r = _section(ws, r, "Counts per stage (unique IDs in RTM)")
    for label, value in gaps["counts"].items():
        ws.cell(row=r, column=1, value=label)
        ws.cell(row=r, column=2, value=value)
        r += 1
    r += 1

    broken_n = len(gaps["broken_forward"])
    orphan_n = len(gaps["orphans"])
    untested_n = len(gaps["untested"])
    pic_n = len(gaps["missing_pic"])
    source_counts = ga.count_all_source_gaps(rows, active, inactive)
    total_source_gaps = sum(source_counts.values())
    total_issues = total_source_gaps + pic_n

    r = _section(ws, r, "Gap summary (see Gaps <Stage> sheets)")
    for col_idx, header in enumerate(["Gap type", "Count", "Detail sheet"], start=1):
        hc = ws.cell(row=r, column=col_idx, value=header)
        hc.font = DARK_BOLD
        hc.fill = PatternFill("solid", fgColor="D9D9D9")
    r += 1

    summary_rows: list[tuple] = [
        ("Accountability metrics", "(see sheet)", "Coverage Accountability"),
    ]
    for stage_key in [s for s in _STAGE_ORDER if s in active]:
        cnt = source_counts.get(stage_key, 0)
        summary_rows.append(
            (f"Gaps in {stage_key} source", cnt, ga.source_gap_sheet_name(stage_key))
        )
    summary_rows.extend([
        ("Broken trace hops (same row)", broken_n, "Gaps <Stage> + Accountability"),
        ("Backward orphans (missing upstream hop)", orphan_n, "Gaps <Stage>"),
        ("FSD missing downstream branch", untested_n, "Gaps FSD"),
        ("Missing PIC in source", pic_n, "Gaps <Stage> (Why column)"),
    ])
    for label, count, sheet in summary_rows:
        ws.cell(row=r, column=1, value=label)
        ws.cell(row=r, column=2, value=count)
        ws.cell(row=r, column=3, value=sheet)
        r += 1
    r += 1

    breakdown = gaps.get("forward_breakdown", {})
    if breakdown:
        r = _section(ws, r, "Forward chain breaks by hop")
        for hop, count in sorted(breakdown.items()):
            ws.cell(row=r, column=1, value=hop)
            ws.cell(row=r, column=2, value=count)
            r += 1
        r += 1

    verdict = (
        "PASS - no traceability gaps detected"
        if total_issues == 0
        else f"REVIEW - {total_issues} traceability issue(s) — open detail sheets"
    )
    cell = ws.cell(row=r, column=1, value=verdict)
    cell.font = Font(bold=True, color="548235" if total_issues == 0 else "C00000")
    ws.cell(row=r, column=2, value="")


def build_legend_sheet(wb: Workbook, project: str) -> None:
    ws = wb.create_sheet("Legend & Standards")
    ws.column_dimensions["A"].width = 36
    ws.column_dimensions["B"].width = 70

    r = _title(ws, f"Legend & Standards - {project}")

    r = _section(ws, r, "PMO trace model (branching)")
    ws.cell(
        row=r, column=2,
        value="BRD → UREQ → FSD → TSD → JIRA  |  FSD → Test Case (direct, not via TSD/JIRA)",
    )
    r += 2

    r = _section(ws, r, "Gap sheets (one per provided source)")
    ws.cell(
        row=r, column=2,
        value="Gap Types Guide — dictionary of all Gap Type codes. "
              "Gaps BRD | Gaps UREQ | Gaps FSD | … — detail rows with Why, How to Fix, How to Validate.",
    ).alignment = Alignment(wrap_text=True, vertical="top")
    r += 2

    r = _section(ws, r, "Gap Type column (on detail sheets)")
    ws.cell(
        row=r, column=2,
        value="Machine-readable code (e.g. ORPHAN_CHAPTER, NO_FSD_UPSTREAM). "
              "See Gap Types Guide sheet for plain-language meaning and typical cause.",
    ).alignment = Alignment(wrap_text=True, vertical="top")
    r += 2

    r = _section(ws, r, "Column dictionary - PMO (22 columns)")
    dictionary = [
        ("BRD ID / Section Page / Description / PIC", "Business requirement: what the business needs and why."),
        ("UREQ ID / Section Page / Description / PIC", "User requirement: what users need to do (stakeholder view)."),
        ("FSD ID / Section Page / Description / PIC", "Functional specification: what the system must do."),
        ("TSD ID / Section Page / Description / PIC", "Technical specification: how it is designed/built."),
        ("Jira Task ID / Description / PIC",
         "Development work item (real Jira issue key, e.g. PROJ-123). "
         "Description = JIRA Description if non-blank, else Summary (locked rule). "
         "PIC = Assignee from JIRA export."),
        ("Test Case ID / Description / PIC", "Verification that the requirement is met."),
    ]
    for term, meaning in dictionary:
        ws.cell(row=r, column=1, value=term).alignment = Alignment(vertical="top", wrap_text=True)
        ws.cell(row=r, column=2, value=meaning).alignment = Alignment(vertical="top", wrap_text=True)
        r += 1
    r += 1

    r = _section(ws, r, "Column dictionary - Audit (5 columns)")
    audit_dict = [
        ("Match Status", "MATCH = explicit source reference; PARTIAL = real but incomplete chain; GAP = no source evidence."),
        ("Confidence", "High = all hops MATCH; Medium = at least one PARTIAL; n/a = GAP."),
        ("Evidence", "Exact source location supporting the weakest link (or 'none in source')."),
        ("Reasoning", "One sentence starting with the status, quoting the source basis."),
        ("Auditor Verdict", "Filled by the auditor skill: PASS or FLAG <note>."),
    ]
    for term, meaning in audit_dict:
        ws.cell(row=r, column=1, value=term).font = Font(italic=True)
        ws.cell(row=r, column=2, value=meaning).alignment = Alignment(vertical="top", wrap_text=True)
        r += 1
    r += 1

    r = _section(ws, r, "Standards crosswalk")
    crosswalk = [
        ("BRD", "PMBOK business needs/goals; BABOK Business Requirements"),
        ("UREQ", "ISO/IEC/IEEE 29148 Stakeholder Requirements (StRS); BABOK Stakeholder Requirements"),
        ("FSD", "ISO/IEC/IEEE 29148 System/Software Requirements (SyRS/SRS); BABOK Solution Requirements"),
        ("TSD", "ISO/IEC/IEEE 29148 design; BABOK solution design"),
        ("JIRA", "PMBOK product development / WBS work package"),
        ("Test Case", "PMBOK test scenarios; ISO/IEC/IEEE 29148 verification (Inspection/Analysis/Demonstration/Test)"),
    ]
    for stage, mapping in crosswalk:
        ws.cell(row=r, column=1, value=stage).font = Font(bold=True)
        ws.cell(row=r, column=2, value=mapping).alignment = Alignment(vertical="top", wrap_text=True)
        r += 1


def _title(ws, text: str) -> int:
    cell = ws.cell(row=1, column=1, value=text)
    cell.font = Font(bold=True, size=14, color="1F3864")
    return 3


def _section(ws, row: int, text: str) -> int:
    cell = ws.cell(row=row, column=1, value=text)
    cell.font = DARK_BOLD
    cell.fill = PatternFill("solid", fgColor="D9D9D9")
    ws.cell(row=row, column=2).fill = PatternFill("solid", fgColor="D9D9D9")
    return row + 1


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Generate a PMO traceability matrix (.xlsx).")
    parser.add_argument("input", help="Path to the input CSV (22 PMO columns + optional audit columns).")
    parser.add_argument("-o", "--output", default="rtm.xlsx", help="Output .xlsx path.")
    parser.add_argument("--project", default="Untitled Project", help="Project name for headers.")
    parser.add_argument("--no-merge", action="store_true",
                        help="Do not visually merge repeated upstream IDs.")
    parser.add_argument(
        "--stages", default="all",
        help=(
            "Comma-separated list of active stages (e.g. 'FSD,TSD,JIRA,Test Case'). "
            "Only adjacent active-stage pairs are checked for broken chains. "
            "Defaults to all 6 stages. Inactive stages are shown as 'not provided'."
        ),
    )
    args = parser.parse_args(argv)

    active_stages = _parse_stages_arg(args.stages)

    rows, extra_cols = read_rows(args.input)

    wb = Workbook()
    build_rtm_sheet(wb, rows, extra_cols, merge_upstream=not args.no_merge)
    gaps = analyse_gaps(rows, extra_cols, active_stages=active_stages)
    ga.configure_stages(STAGES)
    issues = build_coverage_sheet(wb, rows, gaps, args.project)
    build_legend_sheet(wb, args.project)

    try:
        wb.save(args.output)
    except OSError as exc:
        _fail(f"Could not write '{args.output}': {exc}")

    print(f"Wrote {args.output}")
    print(f"  Rows: {gaps['counts']['Rows']}  |  "
          + "  ".join(f"{k}={gaps['counts'][k]}" for k in
                      ["BRD", "UREQ", "FSD", "TSD", "JIRA", "Test Case"]))
    if gaps["has_audit"]:
        sc = gaps["status_counts"]
        print(f"  Match Status: MATCH={sc['MATCH']}  PARTIAL={sc['PARTIAL']}  "
              f"GAP={sc['GAP']}  % Proven={gaps['proven_pct']}%")
    if issues:
        print(f"  Coverage & Gaps: {issues} issue(s) flagged - review the sheet.")
    else:
        print("  Coverage & Gaps: no traceability gaps detected.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
