#!/usr/bin/env python3
"""Scan JIRA export + SIT workbook for citation patterns not matched by citations.py.

Use before RTM sign-off to catch regex/index gaps (false GAP risk).
"""
from __future__ import annotations

import argparse
import csv
import sys
from pathlib import Path

SCRIPTS = Path(__file__).resolve().parent
sys.path.insert(0, str(SCRIPTS))

import citations  # noqa: E402
import docindex  # noqa: E402


def scan_jira(path: Path) -> tuple[int, int, list[tuple[str, str]]]:
    """Return (total, unmatched_with_desc, [(key, desc_snippet)])."""
    unmatched: list[tuple[str, str]] = []
    total = 0
    with_desc = 0
    with path.open(newline="", encoding="utf-8-sig") as fh:
        for row in csv.DictReader(fh):
            key = (row.get("Issue key") or "").strip()
            if not key:
                continue
            total += 1
            refs = citations.parse_jira_description_refs(
                row.get("Description") or "",
                row.get("Summary") or "",
            )
            targets = citations.parse_jira_tsd_targets(
                row.get("Description") or "",
                row.get("Summary") or "",
            )
            if not refs.has_desc:
                continue
            with_desc += 1
            if targets or refs.tsd_num or refs.tsd_image or refs.tsd_appendix or refs.tsd_ref_no_sec:
                continue
            unmatched.append((key, refs.snippet[:120]))
    return total, with_desc, unmatched


def scan_sit_fsd(path: Path, fsd_sections: dict, aliases: dict) -> list[tuple[str, str]]:
    """Return [(tc_id, cite)] for SIT rows whose FSD cite does not resolve."""
    import openpyxl  # noqa: WPS433

    gaps: list[tuple[str, str]] = []
    wb = openpyxl.load_workbook(path, read_only=True, data_only=True)
    breadcrumbs = docindex.build_breadcrumb_index(fsd_sections)
    chapters = docindex.build_chapter_index(fsd_sections)
    for sheet in wb.sheetnames:
        ws = wb[sheet]
        rows = list(ws.iter_rows(values_only=True))
        if not rows:
            continue
        headers = [str(h).strip() if h else "" for h in rows[0]]
        idx = {h: i for i, h in enumerate(headers) if h}
        tc_i = idx.get("Test Case ID") if idx.get("Test Case ID") is not None else idx.get("TC ID")
        fsd_i = idx.get("FSD Section")
        if tc_i is None:
            continue
        for row in rows[1:]:
            if not row or tc_i >= len(row):
                continue
            tc_id = str(row[tc_i] or "").strip()
            if not tc_id:
                continue
            raw = str(row[fsd_i] or "").strip() if fsd_i is not None and fsd_i < len(row) else ""
            if not raw:
                continue
            res = docindex.resolve_fsd_cite(
                fsd_sections, raw,
                breadcrumb_index=breadcrumbs,
                chapter_index=chapters,
                aliases=aliases,
            )
            if res.section_id is None and res.method != "chapter":
                gaps.append((tc_id, res.cite_raw[:80]))
    return gaps


def main() -> int:
    parser = argparse.ArgumentParser(description="Validate citation regex coverage.")
    parser.add_argument("--jira", type=Path, help="JIRA CSV export")
    parser.add_argument("--fsd", type=Path, help="FSD DOCX for SIT validation")
    parser.add_argument("--tsd", type=Path, help="TSD DOCX for collision audit")
    parser.add_argument("--sit", type=Path, help="SIT workbook")
    parser.add_argument("--aliases", type=Path, help="cite_aliases.json")
    args = parser.parse_args()

    if args.jira:
        total, with_desc, unmatched = scan_jira(args.jira)
        print(f"JIRA: {total} tickets, {with_desc} with description")
        print(f"  Unmatched TSD cites (potential regex gap): {len(unmatched)}")
        for key, snip in unmatched[:30]:
            print(f"    {key}: {snip!r}")
        if len(unmatched) > 30:
            print(f"    … and {len(unmatched) - 30} more")

    if args.fsd and args.sit:
        fsd = docindex.parse_numbered_sections(args.fsd)
        aliases = docindex.load_cite_aliases(args.aliases)
        gaps = scan_sit_fsd(args.sit, fsd, aliases)
        print(f"\nSIT FSD: {len(gaps)} cites do not resolve (excl. chapter-only)")
        for tc, cite in gaps[:30]:
            print(f"    {tc}: {cite!r}")

    if args.fsd:
        cols = docindex.scan_section_id_collisions(args.fsd)
        print(f"\nFSD section ID collisions (audit — not indexed twice): {len(cols)}")
        for c in cols[:15]:
            print(f"    {c.section_id}: {len(c.titles)} titles — {c.titles[0][:40]!r} …")

    if args.tsd:
        cols = docindex.scan_section_id_collisions(args.tsd)
        print(f"\nTSD section ID collisions (audit — not indexed twice): {len(cols)}")
        for c in cols[:15]:
            print(f"    {c.section_id}: {len(c.titles)} titles — {c.titles[0][:40]!r} …")

    return 0


if __name__ == "__main__":
    sys.exit(main())
