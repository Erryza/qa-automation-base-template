#!/usr/bin/env python3
"""Generic citation extractors for RTM project mappers.

All projects import this module for priority-ordered, explicit-only ID extraction.
Regex lives here — not in individual project mappers. Project mappers supply
source text; this module returns cited IDs. Verification against document indexes
is done separately (see docindex.py).

Citation taxonomy (locked — keep in sync with SKILL.md):
  A  TSD/FSD Section X.X.X
  B  refer to TSD … then section number in window
  C  on section *X.X.X*
  D  *X.X.X [TAG] Title*
  E  refer to X.X.X Title (plain)
  F  Image X.Y.Z.W
  G  X.X.X API Process Logic Flow
  H  X.X.X Dashboard/Mobile/Dashboard and Mobile - Title  (heading copy)
  I  TSD Section Appendix / refer to Appendix
  J  refer to TSD [URL only]
  K  X.X.X Title - Subtitle  (API section heading at line start)
"""
from __future__ import annotations

import re
from dataclasses import dataclass

# ── Section number extractors (priority order) ────────────────────────────────

# Any explicit numeric depth: chapter (6), section (5.1), subsection (6.3.2.1)
_SEC_NUM = r"\d+(?:\.\d+)*"

# Cat A
SECTION_EXPLICIT_RE = re.compile(
    rf"(?:TSD|FSD|BRD|UREQ)\s+Section\s*\*?\s*({_SEC_NUM})",
    re.I,
)
# Cat I (full phrase)
SECTION_APPENDIX_EXPLICIT_RE = re.compile(
    r"(?:TSD|FSD)\s+Section\s*\*?\s*Appendix",
    re.I,
)
# Cat I (shorthand — authors often omit "TSD Section")
APPENDIX_CITE_RE = re.compile(
    r"(?:please\s+)?refer(?:\s+to)?\s*:?\s+\*?\s*Appendix\*?",
    re.I,
)
# Cat B window anchor
REFER_DOC_RE = re.compile(r"refer\s+to\s+(?:TSD|FSD)\b", re.I)
# In "refer to TSD …" windows: chapter (6) or subsection (6.3.2); cap bare integers at 2 digits
_NUM_IN_WINDOW = re.compile(r"\b(\d{1,2}(?:\.\d+(?:\.\d+)*)?)\b")
# Cat C
ON_SECTION_RE = re.compile(
    rf"(?:\bon\s+)?section\s+\*?\s*({_SEC_NUM})",
    re.I,
)
# Cat D
ASTERISK_SECTION_RE = re.compile(
    rf"\*({_SEC_NUM})\s+(?:\[[^\]]+\]\s*)?[^*\n]+?\*",
    re.I,
)
# Cat E (refer *sec*)
REFER_ASTERISK_SEC_RE = re.compile(
    rf"(?:please\s+)?refer(?:\s+to)?\s*:?\s+\*({_SEC_NUM})",
    re.I,
)
# Cat E (refer to sec Title — plain)
PLAIN_REFER_SEC_RE = re.compile(
    rf"(?:please\s+)?refer(?:\s+to)?\s*:?\s+({_SEC_NUM})\s+[A-Z\[]",
    re.I,
)
# Cat G
API_FLOW_SEC_RE = re.compile(
    rf"\b({_SEC_NUM})\s+API Process Logic Flow",
    re.I,
)
# Cat H — TSD/FSD UI section headings copied verbatim
HEADING_DASH_MOBILE_RE = re.compile(
    rf"(?:^|\n)\s*({_SEC_NUM})\s+(?:Dashboard and Mobile|Dashboard|Mobile)\s+-",
    re.I | re.MULTILINE,
)
# Cat K — API section headings: 3.7.3 Cashout to Bank - Bank List
HEADING_API_DASH_RE = re.compile(
    rf"(?:^|\n)\s*({_SEC_NUM})\s+[A-Z][A-Za-z0-9&][^\n]{0,80}?\s+-",
    re.I | re.MULTILINE,
)

# Cat F
IMAGE_CITE_RE = re.compile(r"Image\s+(\d+(?:\.\d+)+)", re.I)

# Test case ID
TC_REF_RE = re.compile(r"\bTC[-_ ]?(\d+)\b", re.I)

# SIT / spreadsheet cell: explicit section number (any depth, including chapter "6")
CELL_SECTION_NUM_RE = re.compile(r"^(\d+(?:\.\d+)*)$")

# Filename / document-reference noise — do not treat as section cites
DOC_FILENAME_RE = re.compile(
    r"\.(?:docx?|pdf|xlsx?)\b|(?:^|\s)(?:FSD|TSD|BRD|UREQ)\s+WOI\b",
    re.I,
)

# Chapter-only cite (single integer)
CHAPTER_CITE_RE = re.compile(r"^\s*(\d{1,2})\s*$")


@dataclass
class TsdTarget:
    """One explicit TSD section or Image cite from JIRA (or similar) source text."""

    kind: str  # section | image | appendix | url_only
    ref_id: str
    style: str
    pos: int = 0


@dataclass
class TsdRefs:
    """Explicit cross-references parsed from JIRA (or similar) description text."""

    has_desc: bool
    tsd_num: str | None
    tsd_appendix: bool
    tsd_image: str | None
    tsd_ref_no_sec: bool
    fsd_num: str | None
    tc_id: str | None
    snippet: str
    matched_style: str | None = None


_SECTION_PATTERNS: list[tuple[str, re.Pattern[str]]] = [
    ("A: explicit Section", SECTION_EXPLICIT_RE),
    ("C: on section", ON_SECTION_RE),
    ("E: refer *sec*", REFER_ASTERISK_SEC_RE),
    ("D: *sec [TAG] title*", ASTERISK_SECTION_RE),
    ("E: refer to sec Title", PLAIN_REFER_SEC_RE),
    ("G: API Process Logic Flow", API_FLOW_SEC_RE),
    ("H: Dashboard/Mobile heading", HEADING_DASH_MOBILE_RE),
    ("K: API section Title -", HEADING_API_DASH_RE),
]


def find_refer_doc_section(text: str, doc: str = "TSD") -> tuple[str | None, str | None]:
    """Cat B: first section number within 600 chars after 'refer to TSD/FSD'."""
    anchor = re.compile(rf"refer\s+to\s+{doc}\b", re.I)
    m = anchor.search(text)
    if not m:
        return None, None
    window = text[m.end(): m.end() + 600]
    for nm in _NUM_IN_WINDOW.finditer(window):
        before = window[: nm.start()]
        if re.search(r"image\s*$", before, re.I):
            continue
        return nm.group(1), "B: refer to doc window"
    return None, None


def extract_section_num(text: str, *, doc: str = "TSD") -> tuple[str | None, str | None]:
    """Return (section_number, style_label) from explicit citation patterns.

    Tries patterns in priority order; Cat B window is last fallback.
    """
    for label, pat in _SECTION_PATTERNS:
        m = pat.search(text)
        if m:
            return m.group(1), label

    num, label = find_refer_doc_section(text, doc)
    if num:
        return num, label
    return None, None


def has_appendix_cite(text: str) -> bool:
    """Cat I: Appendix reference (with or without 'Section' prefix)."""
    return bool(SECTION_APPENDIX_EXPLICIT_RE.search(text) or APPENDIX_CITE_RE.search(text))


def extract_image_num(text: str) -> str | None:
    """Cat F: first explicit Image X.Y.Z.W citation."""
    m = IMAGE_CITE_RE.search(text)
    return m.group(1) if m else None


def extract_all_image_nums(text: str) -> list[str]:
    """Cat F: all explicit Image X.Y.Z.W citations in source order (deduped)."""
    seen: set[str] = set()
    result: list[str] = []
    for m in IMAGE_CITE_RE.finditer(text):
        num = m.group(1)
        if num not in seen:
            seen.add(num)
            result.append(num)
    return result


def parse_jira_tsd_targets(description: str, summary: str = "") -> list[TsdTarget]:
    """Return every explicit TSD section/Image cite from a JIRA description.

    Source order is preserved; duplicate (kind, ref_id) pairs are dropped.
    When multiple targets exist, project mappers emit one RTM row per target.
    """
    desc = (description or "").strip()
    text = f"{desc} {summary or ''}".strip()
    if not desc:
        return []

    if has_appendix_cite(text):
        return [TsdTarget("appendix", "Appendix", "I: Appendix", 0)]

    candidates: list[TsdTarget] = []

    for m in IMAGE_CITE_RE.finditer(text):
        candidates.append(TsdTarget("image", m.group(1), "F: Image", m.start()))

    for label, pat in _SECTION_PATTERNS:
        for m in pat.finditer(text):
            candidates.append(TsdTarget("section", m.group(1), label, m.start()))

    for m in re.compile(r"refer\s+to\s+TSD\b", re.I).finditer(text):
        window = text[m.end(): m.end() + 600]
        for nm in _NUM_IN_WINDOW.finditer(window):
            before = window[: nm.start()]
            if re.search(r"image\s*$", before, re.I):
                continue
            candidates.append(
                TsdTarget("section", nm.group(1), "B: refer to doc window", m.start())
            )
            break

    candidates.sort(key=lambda t: t.pos)
    seen: set[tuple[str, str]] = set()
    result: list[TsdTarget] = []
    for target in candidates:
        key = (target.kind, target.ref_id)
        if key not in seen:
            seen.add(key)
            result.append(target)

    if not result and REFER_DOC_RE.search(text):
        return [TsdTarget("url_only", "", "J: URL-only refer to doc", 0)]

    return result


def _tsd_refs_from_target(target: TsdTarget, *, has_desc: bool, desc: str,
                        text: str) -> TsdRefs:
    """Map a single TsdTarget to legacy TsdRefs (backward compatibility)."""
    if target.kind == "appendix":
        return TsdRefs(
            has_desc=has_desc, tsd_num=None, tsd_appendix=True, tsd_image=None,
            tsd_ref_no_sec=False, fsd_num=extract_fsd_num(text) if has_desc else None,
            tc_id=extract_tc_id(text) if has_desc else None,
            snippet=desc[:200], matched_style=target.style,
        )
    if target.kind == "url_only":
        return TsdRefs(
            has_desc=has_desc, tsd_num=None, tsd_appendix=False, tsd_image=None,
            tsd_ref_no_sec=True, fsd_num=extract_fsd_num(text) if has_desc else None,
            tc_id=extract_tc_id(text) if has_desc else None,
            snippet=desc[:200], matched_style=target.style,
        )
    if target.kind == "image":
        return TsdRefs(
            has_desc=has_desc, tsd_num=None, tsd_appendix=False,
            tsd_image=target.ref_id, tsd_ref_no_sec=False,
            fsd_num=extract_fsd_num(text) if has_desc else None,
            tc_id=extract_tc_id(text) if has_desc else None,
            snippet=desc[:200], matched_style=target.style,
        )
    return TsdRefs(
        has_desc=has_desc, tsd_num=target.ref_id, tsd_appendix=False,
        tsd_image=None, tsd_ref_no_sec=False,
        fsd_num=extract_fsd_num(text) if has_desc else None,
        tc_id=extract_tc_id(text) if has_desc else None,
        snippet=desc[:200], matched_style=target.style,
    )


def extract_fsd_num(text: str) -> str | None:
    """Extract FSD section number from text (Cat A scoped to FSD)."""
    m = re.compile(rf"FSD\s+Section\s*\*?\s*({_SEC_NUM})", re.I).search(text)
    return m.group(1) if m else None


def extract_tc_id(text: str) -> str | None:
    m = TC_REF_RE.search(text)
    return f"TC-{m.group(1)}" if m else None


def parse_jira_description_refs(
    description: str,
    summary: str = "",
) -> TsdRefs:
    """Parse a ticket description for explicit TSD/FSD/TC cross-references.

    Returns the first explicit TSD target only. Use parse_jira_tsd_targets()
    when the source cites multiple section/Image IDs.
    """
    desc = (description or "").strip()
    text = f"{desc} {summary or ''}".strip()
    has_desc = bool(desc)
    targets = parse_jira_tsd_targets(description, summary)

    if targets:
        return _tsd_refs_from_target(targets[0], has_desc=has_desc, desc=desc, text=text)

    return TsdRefs(
        has_desc=has_desc,
        tsd_num=None,
        tsd_appendix=False,
        tsd_image=None,
        tsd_ref_no_sec=False,
        fsd_num=extract_fsd_num(text) if has_desc else None,
        tc_id=extract_tc_id(text) if has_desc else None,
        snippet=desc[:200] if desc else "",
        matched_style=None,
    )


def normalize_sit_fsd_cell(raw: str) -> str:
    """Return the cite string from a SIT FSD Section cell (first line, stripped)."""
    if not raw:
        return ""
    first_line = str(raw).split("\n")[0].strip()
    return first_line


def extract_section_from_cell(raw: str) -> str | None:
    """Extract a section number from a spreadsheet cell if explicitly present.

    Matches any depth: chapter ``6``, section ``5.1``, subsection ``6.3.2.1``.
    Returns None when the cell is a document filename/reference (not a cite).
    Verification against the document index is done separately (index-then-verify).
    """
    cite = normalize_sit_fsd_cell(raw)
    if not cite:
        return None
    if DOC_FILENAME_RE.search(cite):
        return None
    m = CELL_SECTION_NUM_RE.match(cite.strip())
    return m.group(1) if m else None


def is_chapter_cite(cite: str) -> bool:
    """True when cite is a single chapter integer (e.g. '6')."""
    return bool(CHAPTER_CITE_RE.match(cite.strip()))
