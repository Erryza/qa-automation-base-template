#!/usr/bin/env python3
"""Propose cite alias mappings for human review — no hand-editing of JSON required.

When SIT (or other sources) use informal labels that auto-indexes cannot resolve,
this script writes a plain-language review sheet. Reviewers fill decisions in CSV
(or tell the agent in chat); the agent merges approved rows into cite_aliases.json.

Outputs (in project output/ folder):
  cite_aliases.review.csv  — open in Excel; fill column map_to_fsd_section
  cite_aliases.review.md    — same content + instructions for non-Excel users
"""
from __future__ import annotations

import argparse
import csv
import json
import sys
from collections import defaultdict
from dataclasses import dataclass, field
from datetime import date
from pathlib import Path

SCRIPTS = Path(__file__).resolve().parent
sys.path.insert(0, str(SCRIPTS))

import citations  # noqa: E402
import docindex  # noqa: E402

# Reviewer fills one of: FSD section ID (e.g. 6.3.3), ACCEPT_GAP, FIX_SOURCE
DECISION_ACCEPT_GAP = "ACCEPT_GAP"
DECISION_FIX_SOURCE = "FIX_SOURCE"


@dataclass
class ReviewItem:
    category: str
    source_text: str
    times_used: int = 0
    example_ids: list[str] = field(default_factory=list)
    hint: str = ""
    map_to_fsd_section: str = ""
    reviewer_notes: str = ""

    @property
    def row_id(self) -> str:
        return f"{self.category}:{self.source_text}"


def _categorize_unresolved(cite: str, method: str) -> tuple[str, str]:
    """Return (category, hint) for a human reviewer."""
    if citations.DOC_FILENAME_RE.search(cite):
        return "document_filename", "SIT cell contains a file name — fix the SIT FSD Section column"
    if citations.is_chapter_cite(cite) or method == "chapter":
        return "chapter_only", "Chapter number without subsection — pick a specific FSD section"
    if ">" in cite:
        return "informal_breadcrumb", "Informal label — confirm the correct FSD section number with BA/QA"
    return "unresolved_cite", "Cite does not match FSD index — confirm section ID or fix source"


def collect_sit_review_items(
    sit_path: Path,
    fsd_sections: dict[str, dict],
    aliases: dict,
    *,
    skip_sheets: set[str] | None = None,
) -> list[ReviewItem]:
    """Aggregate unresolved SIT FSD cites needing human decision."""
    import openpyxl  # noqa: WPS433

    skip_sheets = skip_sheets or set()
    breadcrumbs = docindex.build_breadcrumb_index(fsd_sections)
    chapters = docindex.build_chapter_index(fsd_sections)

    # Already approved in cite_aliases.json — do not re-propose
    approved: set[str] = set()
    for bucket in ("fsd", "fsd_breadcrumb", "fsd_chapter"):
        approved.update(aliases.get(bucket, {}).keys())

    buckets: dict[tuple[str, str], ReviewItem] = {}

    wb = openpyxl.load_workbook(sit_path, read_only=True, data_only=True)
    for sheet_name in wb.sheetnames:
        if sheet_name in skip_sheets:
            continue
        ws = wb[sheet_name]
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
            if res.section_id is not None:
                continue
            cite = res.cite_raw
            if cite in approved:
                continue

            cat, hint = _categorize_unresolved(cite, res.method)
            if res.method == "chapter" and res.chapter_subsections:
                hint += f". Subsections in FSD: {', '.join(res.chapter_subsections[:8])}"
                if len(res.chapter_subsections) > 8:
                    hint += ", …"

            key = (cat, cite)
            if key not in buckets:
                buckets[key] = ReviewItem(category=cat, source_text=cite, hint=hint)
            buckets[key].times_used += 1
            if len(buckets[key].example_ids) < 3:
                buckets[key].example_ids.append(tc_id)

    return sorted(buckets.values(), key=lambda x: (-x.times_used, x.source_text))


def write_review_csv(items: list[ReviewItem], path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", newline="", encoding="utf-8") as fh:
        writer = csv.DictWriter(fh, fieldnames=[
            "category",
            "source_text",
            "times_used",
            "example_test_cases",
            "hint",
            "map_to_fsd_section",
            "reviewer_notes",
        ])
        writer.writeheader()
        for it in items:
            writer.writerow({
                "category": it.category,
                "source_text": it.source_text,
                "times_used": it.times_used,
                "example_test_cases": "; ".join(it.example_ids),
                "hint": it.hint,
                "map_to_fsd_section": it.map_to_fsd_section,
                "reviewer_notes": it.reviewer_notes,
            })


def write_review_md(items: list[ReviewItem], path: Path, project: str) -> None:
    lines = [
        f"# Cite alias review — {project}",
        f"",
        f"Generated: {date.today().isoformat()}",
        f"",
        f"This file lists **informal source labels** the RTM could not map automatically.",
        f"You do **not** need to edit `cite_aliases.json` by hand.",
        f"",
        f"## What to do",
        f"",
        f"1. Open **`cite_aliases.review.csv`** in Excel (same folder as this file).",
        f"2. For each row, fill **`map_to_fsd_section`**:",
        f"   - A real FSD section ID (e.g. `6.3.3`) if the label is valid",
        f"   - `ACCEPT_GAP` if the RTM should stay GAP",
        f"   - `FIX_SOURCE` if QA should fix the SIT cell instead",
        f"3. Send the CSV back (or paste decisions in chat) — the **agent applies** them to `cite_aliases.json` and rebuilds.",
        f"",
        f"## Rows needing review ({len(items)})",
        f"",
    ]
    if not items:
        lines.append("_No unresolved informal cites — nothing to review._")
    else:
        lines.append("| Category | Source text | Used | Example tests | Hint |")
        lines.append("|----------|-------------|------|---------------|------|")
        for it in items:
            ex = ", ".join(it.example_ids)
            src = it.source_text.replace("|", "\\|")
            hint = it.hint.replace("|", "\\|")[:80]
            lines.append(f"| {it.category} | {src} | {it.times_used} | {ex} | {hint} |")

    path.write_text("\n".join(lines) + "\n", encoding="utf-8")


def apply_review_csv(review_csv: Path, aliases_path: Path) -> tuple[int, int]:
    """Merge approved decisions from review CSV into cite_aliases.json.

    Returns (approved_count, skipped_count).
    """
    if not review_csv.is_file():
        raise FileNotFoundError(review_csv)

    aliases = docindex.load_cite_aliases(aliases_path) if aliases_path.is_file() else {}
    for bucket in ("fsd_breadcrumb", "fsd_chapter", "fsd"):
        aliases.setdefault(bucket, {})

    approved = skipped = 0
    with review_csv.open(newline="", encoding="utf-8") as fh:
        for row in csv.DictReader(fh):
            cite = (row.get("source_text") or "").strip()
            decision = (row.get("map_to_fsd_section") or "").strip()
            if not cite or not decision:
                skipped += 1
                continue
            if decision.upper() in (DECISION_ACCEPT_GAP, DECISION_FIX_SOURCE):
                skipped += 1
                continue
            cat = (row.get("category") or "").strip()
            if cat == "chapter_only":
                aliases["fsd_chapter"][cite] = decision
            else:
                aliases["fsd_breadcrumb"][cite] = decision
            approved += 1

    aliases["_last_review"] = date.today().isoformat()
    aliases["_purpose"] = (
        "Machine-maintained file. Review cite_aliases.review.csv and ask the agent to apply feedback."
    )
    aliases_path.parent.mkdir(parents=True, exist_ok=True)
    with aliases_path.open("w", encoding="utf-8") as fh:
        json.dump(aliases, fh, indent=2, ensure_ascii=False)
        fh.write("\n")
    return approved, skipped


def propose(
    *,
    sit_path: Path,
    fsd_path: Path,
    output_dir: Path,
    project: str,
    aliases_path: Path | None = None,
    skip_sheets: set[str] | None = None,
) -> list[ReviewItem]:
    fsd_sections = docindex.parse_numbered_sections(fsd_path)
    aliases = docindex.load_cite_aliases(aliases_path)
    items = collect_sit_review_items(
        sit_path, fsd_sections, aliases, skip_sheets=skip_sheets,
    )
    write_review_csv(items, output_dir / "cite_aliases.review.csv")
    write_review_md(items, output_dir / "cite_aliases.review.md", project)
    return items


def main() -> int:
    parser = argparse.ArgumentParser(description="Propose cite aliases for human review.")
    parser.add_argument("--fsd", type=Path, required=True)
    parser.add_argument("--sit", type=Path, required=True)
    parser.add_argument("-o", "--output-dir", type=Path, default=Path("output"))
    parser.add_argument("--project", default="Project")
    parser.add_argument("--aliases", type=Path, help="Existing cite_aliases.json")
    parser.add_argument(
        "--apply", type=Path,
        help="Apply decisions from review CSV to cite_aliases.json",
    )
    args = parser.parse_args()

    if args.apply:
        if not args.aliases:
            sys.stderr.write("ERROR: --aliases required with --apply\n")
            return 1
        n, skip = apply_review_csv(args.apply, args.aliases)
        print(f"Applied {n} mapping(s) to {args.aliases} ({skip} row(s) skipped)")
        return 0

    items = propose(
        sit_path=args.sit,
        fsd_path=args.fsd,
        output_dir=args.output_dir,
        project=args.project,
        aliases_path=args.aliases,
    )
    print(f"Review items: {len(items)}")
    print(f"Wrote {args.output_dir / 'cite_aliases.review.csv'}")
    print(f"Wrote {args.output_dir / 'cite_aliases.review.md'}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
