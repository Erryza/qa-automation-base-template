#!/usr/bin/env python3
"""
Structural validation for client-ready test case workbooks.
Self-review gate — does NOT validate spec accuracy or coverage completeness.

Checks (always on):
  - Template headers (cols A-N), Summary sheet present
  - TC IDs unique, PREFIX-SEQ format, contiguous sequence per sheet, one prefix per sheet
  - Row 3 separator empty, data from row 4, COUNTIF in Y2
  - Duplicate Scenario+Type / Test Data / Description / condition per feature sheet
  - Negative API-type TCs: bold varied field in Test Data (col J) via rich_text
  - No yellow fill (#FFF2CC) on Test Data cells
  - Test Data Header:/Body: sections (API-type rows only)
  - Doubled-header-line bug (e.g. "X-TIMESTAMP: X-TIMESTAMP: ")

Optional / opt-in (off by default — keep generic FE/UI workbooks passing):
  --strict-scope        Enforce a forbidden-scope profile (no ERQ/DB/SQL/network
                        sheets; Platform must be API). Use for API-only engagements
                        that ban out-of-scope rows (see project-playbooks/).
  --profile <name>      Named profile that may turn on strict scope. "oppa" / "api-only"
                        imply --strict-scope. "generic" (default) enforces nothing extra.

Platform / row-type awareness:
  API-type rows  (Platform in API_PLATFORMS) get the API-specific checks
  (bold negative Test Data, Header:/Body:, X-SIGNATURE shape).
  UI / Web / Mobile / Service rows are NOT subjected to those API-only checks,
  so a full-stack or FE-only workbook validates cleanly.

Skipped sheets (support, not feature tabs):
  summary, rule register, checklist, revision log, no-test log,
  pilot tcs, mapping issuer acquirer, report dashboard

Usage:
  python3 validate_workbook.py "<path-to-xlsx>"
  python3 validate_workbook.py "<path>" --strict-scope
  python3 validate_workbook.py "<path>" --profile oppa
Exit 0 = pass, 1 = failures found.

Requires: stdlib + openpyxl. Loads with rich_text=True for bold detection.
"""

from __future__ import annotations

import re
import sys
from pathlib import Path

try:
    from openpyxl import load_workbook
    from openpyxl.cell.rich_text import CellRichText, TextBlock
except ImportError:
    print("BLOCKER: openpyxl not installed. Run: pip3 install openpyxl")
    sys.exit(1)

HEADER_FILL = "ACB9CA"
CORE_HEADERS = [
    "S.No.",
    "TC ID",
    "ID FSD - RTM",
    "TC Type",
    "Platform",
    "Module",
    "Scenario",
    "Test Description",
    "Pre-Condition",
    "Test Data",
    "Test Steps",
    "Testing Type",
    "Expected Results",
    "Actual Results",  # accepted client template has no trailing space
]
SKIP_SHEETS = {
    "mapping issuer acquirer",
    "report dashboard",
    "rule register",
    "checklist",
    "a-grade checklist",
    "pilot tcs",
    "pilot 10 tcs",
    "revision log",
    "staff revision log",
    "no-test log",
    "no test log",
    "skipped log",
}

# Platforms recognized as "API-type" rows — these get API-specific checks
# (bold negative Test Data, Header:/Body:, signature shape). The Body: check only
# fires when the row actually contains a "POST " line, so a non-HTTP Service test
# without request/response blocks will not be forced into API shape.
API_PLATFORMS = {"API", "Service"}
# Platforms accepted on any workbook (generic). Strict-scope narrows this to API only.
PLATFORM_OK_GENERIC = {"API", "Web", "UI", "Mobile", "Service", "Integration"}
TC_TYPE_OK = {"Positive", "Negative"}

# --- opt-in strict-scope (forbidden out-of-scope rows; e.g. API-only engagements) ---
# These mirror an API-only project profile (see project-playbooks/OPPA - QR MPM.md).
FORBIDDEN_TAB_SUBSTRINGS = (
    "query reconcile",
    "db verification",
)
FORBIDDEN_TC_PREFIXES = ("ERQ-", "DBV-")
FORBIDDEN_DATA_PATTERNS = (
    re.compile(r"\bselect\s+.+\s+from\b", re.I),
    re.compile(r"redis-cli", re.I),
    re.compile(r"packet\s+capture|network\s+trace|egress", re.I),
)

# Signature mis-copy guard (used only on API-type rows): a definition table that says
# Base64(HMAC-SHA512) but Test Data shows 40-char hex / placeholder from a sample block.
LEGACY_X_SIGNATURE_HEX = re.compile(r"X-SIGNATURE:\s*[0-9a-f]{40}\b", re.I)
LEGACY_X_SIGNATURE_BAD = re.compile(r"X-SIGNATURE:\s*(?:bad-signature|deadbeef)\b", re.I)
# Generator bug: replace(value, "Header-Name: ") instead of full-line empty
DOUBLED_HEADER_LINE = re.compile(r"(?m)^([A-Za-z][A-Za-z0-9\-]*):\s+\1:\s*")
EMPTY_FIELD_IN_TEXT = re.compile(
    r"(?:using\s+empty\s+|empty\s+)([A-Za-z][A-Za-z0-9\-]*)(?:\s+in\s+header|\s+data)?|"
    r"([A-Za-z][A-Za-z0-9\-]*)\s+is\s+empty",
    re.I,
)


def norm_fill(cell) -> str:
    if not cell.fill or not cell.fill.start_color:
        return ""
    rgb = cell.fill.start_color.rgb
    if not rgb or rgb == "00000000":
        return ""
    return str(rgb).replace("FF", "", 1)[-6:].upper()


def fail(errors: list[str], msg: str, severity: str = "BLOCKER") -> None:
    errors.append(f"{severity}: {msg}")


def test_data_has_bold_mark(value) -> bool:
    """True if col J uses rich-text bold on at least one line (varied field)."""
    if isinstance(value, CellRichText):
        for part in value:
            if isinstance(part, TextBlock) and part.font and part.font.b:
                return True
    return False


def cell_has_yellow_test_data_fill(cell) -> bool:
    fg = getattr(cell.fill, "fgColor", None)
    rgb = getattr(fg, "rgb", "") if fg else ""
    return bool(rgb and "FFF2CC" in str(rgb).upper())


def norm_text(value) -> str:
    """Normalize text for duplicate comparison."""
    if value is None:
        return ""
    t = str(value).lower().strip()
    t = re.sub(r"\s+", " ", t)
    return t


def check_duplicates(
    sheet_name: str,
    rows: list[dict],
    errors: list[str],
    strict_scope: bool = False,
) -> None:
    """Flag duplicate test conditions on a feature sheet."""
    scenario_type: dict[str, list[str]] = {}
    test_data: dict[str, list[str]] = {}
    test_desc: dict[str, list[str]] = {}
    condition_fp: dict[str, list[str]] = {}

    for r in rows:
        tc_id = r["tc_id"]
        sc = norm_text(r.get("scenario"))
        tt = norm_text(r.get("tc_type"))
        td = norm_text(r.get("test_data"))
        desc = norm_text(r.get("test_description"))
        exp = norm_text(r.get("expected_results"))

        if sc and tt:
            key = f"{tt}|{sc}"
            scenario_type.setdefault(key, []).append(tc_id)

        if td:
            test_data.setdefault(td, []).append(tc_id)

        if desc:
            test_desc.setdefault(desc, []).append(tc_id)

        if sc and tt and exp:
            fp = f"{tt}|{sc}|{exp}"
            condition_fp.setdefault(fp, []).append(tc_id)

    # Sharing a Scenario / Description / (Scenario+Type+Expected) across rows is
    # normal in real deliverables — e.g. an error table where each row tests a
    # different response code under one scenario, differing only in input/Test Data.
    # So these are advisories in generic mode, blocking only under a strict profile.
    # Identical *Test Data* (the actual request) IS a true redundancy → always blocks.
    for key, ids in scenario_type.items():
        if len(ids) > 1:
            fail(
                errors,
                f"[{sheet_name}] Same Scenario+TC Type on {ids} — "
                f"ok if they differ in Test Data/input; merge if truly redundant",
                "BLOCKER" if strict_scope else "MINOR",
            )

    for key, ids in test_data.items():
        if len(ids) > 1:
            fail(
                errors,
                f"[{sheet_name}] Duplicate Test Data: {ids} — "
                f"identical request; remove redundant TC or change the varied field",
                "BLOCKER",
            )

    for key, ids in test_desc.items():
        if len(ids) > 1:
            fail(
                errors,
                f"[{sheet_name}] Same Test Description on {ids}",
                "MAJOR" if strict_scope else "MINOR",
            )

    for key, ids in condition_fp.items():
        if len(ids) > 1:
            fail(
                errors,
                f"[{sheet_name}] Same Scenario+Type+Expected Results on {ids} "
                f"(ok if Test Data differs)",
                "BLOCKER" if strict_scope else "MINOR",
            )


def validate_sheet(ws, sheet_name: str, errors: list[str], strict_scope: bool = False) -> int:
    tc_count = 0
    if ws.max_row < 4:
        fail(errors, f"[{sheet_name}] No data rows (expected from row 4)")
        return 0

    # Header row 1
    for col, expected in enumerate(CORE_HEADERS, start=1):
        actual = ws.cell(row=1, column=col).value
        if str(actual or "").strip() != expected.strip():  # tolerate trailing-space variants
            fail(
                errors,
                f"[{sheet_name}] A1 header col {col}: expected {expected!r}, got {actual!r}",
                "MAJOR",
            )

    hfill = norm_fill(ws.cell(row=1, column=1))
    if hfill and hfill != HEADER_FILL:
        fail(
            errors,
            f"[{sheet_name}] Header fill expected #{HEADER_FILL}, got #{hfill}",
            "MAJOR",
        )

    # Row 3 separator should not have TC ID
    if ws.cell(row=3, column=2).value:
        fail(errors, f"[{sheet_name}] Row 3 should be empty separator (TC ID found)", "MAJOR")

    prefixes: set[str] = set()
    seen_ids: set[str] = set()
    prev_seq: int | None = None
    module_vals: set[str] = set()
    row_records: list[dict] = []

    for row in range(4, ws.max_row + 1):
        tc_id = ws.cell(row=row, column=2).value
        if not tc_id:
            continue
        tc_count += 1
        tc_id = str(tc_id).strip()

        if tc_id in seen_ids:
            fail(errors, f"[{sheet_name}] Duplicate TC ID {tc_id}", "BLOCKER")
        seen_ids.add(tc_id)

        if "-" not in tc_id:
            fail(errors, f"[{sheet_name}] TC ID {tc_id} — expected PREFIX-SEQ format", "MAJOR")
        else:
            prefix, _, seq = tc_id.partition("-")
            prefixes.add(prefix)
            try:
                seq_n = int(seq)
                if prev_seq is not None and seq_n != prev_seq + 1:
                    fail(
                        errors,
                        f"[{sheet_name}] TC ID sequence gap before {tc_id}",
                        "MAJOR",
                    )
                prev_seq = seq_n
            except ValueError:
                fail(errors, f"[{sheet_name}] TC ID {tc_id} — seq not numeric", "MAJOR")

        platform = ws.cell(row=row, column=5).value
        plat = str(platform or "").strip()
        plat_l = plat.lower()  # platform labels are case-insensitive (WEB == Web)
        is_api_row = plat_l in {p.lower() for p in API_PLATFORMS}
        if platform and plat_l not in {p.lower() for p in PLATFORM_OK_GENERIC}:
            fail(
                errors,
                f"[{sheet_name}] {tc_id} unexpected Platform {platform!r} "
                f"(expected one of {sorted(PLATFORM_OK_GENERIC)})",
                "MAJOR",
            )

        tc_type = ws.cell(row=row, column=4).value
        if tc_type and str(tc_type).strip() not in TC_TYPE_OK:
            fail(
                errors,
                f"[{sheet_name}] {tc_id} TC Type must be Positive/Negative, got {tc_type!r}",
                "BLOCKER",
            )

        testing = ws.cell(row=row, column=12).value
        if testing and str(testing).strip() not in ("Automation", "Manual"):
            fail(errors, f"[{sheet_name}] {tc_id} unknown Testing Type {testing!r}", "MINOR")

        module = ws.cell(row=row, column=6).value
        if module:
            module_vals.add(str(module).strip())

        actual = ws.cell(row=row, column=14).value
        if actual and str(actual).strip():
            fail(
                errors,
                f"[{sheet_name}] {tc_id} Actual Results should be blank at authoring",
                "MAJOR",
            )

        exp = ws.cell(row=row, column=13).value
        if not exp or not str(exp).strip():
            fail(errors, f"[{sheet_name}] {tc_id} missing Expected Results", "BLOCKER")

        steps = ws.cell(row=row, column=11).value
        if is_api_row and steps and "Click the Send button" not in str(steps):
            fail(
                errors,
                f"[{sheet_name}] {tc_id} API Test Steps missing 'Click the Send button'",
                "MINOR",
            )

        data_cell = ws.cell(row=row, column=10)
        data = data_cell.value
        tc_type_s = str(ws.cell(row=row, column=4).value or "").strip()

        # Bold-negative Test Data: bolding the varied field is the norm, but some
        # legitimate negatives (error-table rows, omit-object, wrong-method) don't
        # vary a single inline field — so advisory by default, blocking only in strict.
        if tc_type_s == "Negative" and is_api_row:
            if not test_data_has_bold_mark(data):
                fail(
                    errors,
                    f"[{sheet_name}] {tc_id} Negative API TC: consider bolding the varied field in Test Data (col J)",
                    "MAJOR" if strict_scope else "MINOR",
                )
        # Yellow fill ban applies to every row type.
        if cell_has_yellow_test_data_fill(data_cell):
            fail(
                errors,
                f"[{sheet_name}] {tc_id} Test Data must not use yellow cell fill — bold the varied line only",
                "MAJOR",
            )

        # Header:/Body: structure + signature shape: API-type rows only.
        if data and is_api_row:
            ds = str(data)
            scenario = ws.cell(row=row, column=7).value or ""
            desc = ws.cell(row=row, column=8).value or ""
            if "Header:" not in ds:
                fail(errors, f"[{sheet_name}] {tc_id} API Test Data missing 'Header:' section", "MAJOR")
            if "Body:" not in ds and "POST " in ds:
                fail(errors, f"[{sheet_name}] {tc_id} API Test Data missing 'Body:' section", "MAJOR")
            doubled = DOUBLED_HEADER_LINE.search(ds)
            if doubled:
                hdr_name = doubled.group(1)
                fail(
                    errors,
                    f"[{sheet_name}] {tc_id} Test Data has doubled header line "
                    f"({hdr_name}: {hdr_name}:) — use '{hdr_name}: ' for empty or the actual invalid value",
                    "BLOCKER",
                )
            text = f"{scenario} {desc}"
            empty_m = EMPTY_FIELD_IN_TEXT.search(text)
            if empty_m:
                field_under_test = (empty_m.group(1) or empty_m.group(2) or "").strip()
                if field_under_test:
                    prefix = f"{field_under_test}:"
                    for line in ds.splitlines():
                        stripped = line.strip()
                        if not stripped.startswith(prefix):
                            continue
                        rest = stripped[len(prefix):].strip()
                        if rest and not rest.startswith("{"):
                            fail(
                                errors,
                                f"[{sheet_name}] {tc_id} Scenario/Description says empty "
                                f"{field_under_test} but Test Data has {stripped[:50]}",
                                "BLOCKER",
                            )
                        break
            legacy_tc_intentional = (
                "40-char hex" in scenario or "sample" in scenario.lower() or "legacy" in scenario.lower()
            )
            if (LEGACY_X_SIGNATURE_HEX.search(ds) or LEGACY_X_SIGNATURE_BAD.search(ds)) and not legacy_tc_intentional:
                fail(
                    errors,
                    f"[{sheet_name}] {tc_id} X-SIGNATURE looks like 40-char hex / placeholder; "
                    f"use the value shape from the spec's header definition table — see tsd-alignment.md",
                    "BLOCKER",
                )

        row_records.append(
            {
                "tc_id": tc_id,
                "tc_type": ws.cell(row=row, column=4).value,
                "scenario": ws.cell(row=row, column=7).value,
                "test_description": ws.cell(row=row, column=8).value,
                "test_data": ws.cell(row=row, column=10).value,
                "expected_results": ws.cell(row=row, column=13).value,
            }
        )

    check_duplicates(sheet_name, row_records, errors, strict_scope)

    if len(prefixes) > 1:
        fail(
            errors,
            f"[{sheet_name}] Multiple TC prefixes on one sheet: {prefixes}",
            "MAJOR",
        )

    # Module label often differs from the tab name (tab 'Inquiry QR' may carry
    # module 'API Decode QR MPM'), and a tab may legitimately carry >1 module —
    # so this is advisory, not blocking, unless the project profile is strict.
    if module_vals and sheet_name not in module_vals and len(module_vals) == 1:
        only = next(iter(module_vals))
        if only.lower() != sheet_name.lower():
            fail(
                errors,
                f"[{sheet_name}] Module col '{only}' differs from tab name (ok if intentional)",
                "MAJOR" if strict_scope else "MINOR",
            )

    y2 = ws.cell(row=2, column=25).value
    if not y2 or "COUNTIF" not in str(y2).upper():
        fail(errors, f"[{sheet_name}] Missing COUNTIF in Y2", "MAJOR")

    return tc_count


def check_strict_scope(wb, errors: list[str]) -> None:
    """Opt-in (--strict-scope): forbid out-of-scope sheets/rows for API-only profiles.

    Off by default so generic FE/UI/full-stack workbooks pass. A project profile
    that bans non-API rows (see project-playbooks/OPPA - QR MPM.md) opts in.
    """
    for name in wb.sheetnames:
        low = name.lower()
        if low == "summary" or low in SKIP_SHEETS:
            continue
        for forbidden in FORBIDDEN_TAB_SUBSTRINGS:
            if forbidden in low:
                fail(
                    errors,
                    f"Out-of-scope tab '{name}' — strict-scope profile forbids "
                    f"query-reconcile / DB sheets",
                    "BLOCKER",
                )

    for name in wb.sheetnames:
        if name == "Summary" or name.lower() in SKIP_SHEETS:
            continue
        ws = wb[name]
        for row in range(4, ws.max_row + 1):
            tc_id = ws.cell(row=row, column=2).value
            if not tc_id:
                continue
            tc_s = str(tc_id).strip()
            platform = str(ws.cell(row=row, column=5).value or "").strip()
            if platform and platform not in API_PLATFORMS:
                fail(
                    errors,
                    f"[{name}] {tc_s} strict-scope: Platform must be 'API' (got '{platform}')",
                    "BLOCKER",
                )
            for prefix in FORBIDDEN_TC_PREFIXES:
                if tc_s.upper().startswith(prefix):
                    fail(
                        errors,
                        f"[{name}] {tc_s} forbidden prefix {prefix} — out of scope (strict-scope)",
                        "BLOCKER",
                    )
            data = str(ws.cell(row=row, column=10).value or "")
            for pat in FORBIDDEN_DATA_PATTERNS:
                if pat.search(data):
                    fail(
                        errors,
                        f"[{name}] {tc_s} Test Data matches out-of-scope pattern "
                        f"({pat.pattern}) — strict-scope: API request/response only",
                        "BLOCKER",
                    )


def main() -> int:
    args = sys.argv[1:]
    strict_scope = False
    profile = "generic"
    path_arg = None
    i = 0
    while i < len(args):
        a = args[i]
        if a in ("--strict-scope", "--scope-api-only", "--strict"):  # aliases
            strict_scope = True
        elif a == "--profile":
            i += 1
            profile = (args[i] if i < len(args) else "generic").strip().lower()
            if profile in ("oppa", "api-only", "api_only", "strict"):
                strict_scope = True
        elif a.startswith("--profile="):
            profile = a.split("=", 1)[1].strip().lower()
            if profile in ("oppa", "api-only", "api_only", "strict"):
                strict_scope = True
        elif not a.startswith("--"):
            path_arg = a
        i += 1

    if not path_arg:
        print("Usage: validate_workbook.py <path-to-xlsx> [--strict-scope] [--profile <name>]")
        return 1

    path = Path(path_arg).expanduser().resolve()
    if not path.exists():
        print(f"BLOCKER: File not found: {path}")
        return 1

    wb = load_workbook(path, data_only=False, rich_text=True)
    errors: list[str] = []

    if "Summary" not in wb.sheetnames:
        fail(errors, "Missing Summary sheet", "BLOCKER")

    feature_sheets = [
        s
        for s in wb.sheetnames
        if s != "Summary" and s.lower() not in SKIP_SHEETS
    ]
    if not feature_sheets:
        fail(errors, "No feature tabs found", "BLOCKER")

    total_tc = 0
    for name in feature_sheets:
        total_tc += validate_sheet(wb[name], name, errors, strict_scope)

    if strict_scope:
        check_strict_scope(wb, errors)

    wb.close()

    print(f"Validated: {path.name}")
    print(f"Feature tabs: {len(feature_sheets)} | TC rows: {total_tc} | "
          f"profile: {profile} | strict-scope: {'on' if strict_scope else 'off'}")

    # BLOCKER/MAJOR fail the check; MINOR are advisories that do not fail it.
    blocking = [e for e in errors if e.startswith("BLOCKER") or e.startswith("MAJOR")]
    advisories = [e for e in errors if e.startswith("MINOR")]

    if blocking:
        print(f"\nFailed ({len(blocking)} blocking issue(s)):\n")
        for e in blocking:
            print(f"  {e}")
        if advisories:
            print(f"\nAdvisories ({len(advisories)}):")
            for e in advisories:
                print(f"  {e}")
        return 1

    print("\nStructural check: PASS")
    if strict_scope:
        print("Strict-scope check: PASS")
    if advisories:
        print(f"\nAdvisories ({len(advisories)}) — non-blocking:")
        for e in advisories:
            print(f"  {e}")
    print("(Structural only — still verify spec accuracy, coverage, and new-vs-regression by hand.)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
