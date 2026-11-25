#!/usr/bin/env python3
"""Generic document index builders and cite resolvers for RTM project mappers.

Build indexes from DOCX files, then verify extracted cites via dictionary lookup.
No keyword/topic matching across document bodies.
"""
from __future__ import annotations

import json
import re
import zipfile
from collections import defaultdict
from dataclasses import dataclass
from pathlib import Path
from xml.etree import ElementTree as ET

from citations import (
    extract_section_from_cell,
    is_chapter_cite,
    normalize_sit_fsd_cell,
)

# ── DOCX helpers ──────────────────────────────────────────────────────────────


def docx_paragraphs(path: Path) -> list[str]:
    """Extract all non-empty paragraphs from a .docx file."""
    with zipfile.ZipFile(path) as zf:
        root = ET.fromstring(zf.read("word/document.xml"))
    ns = {"w": "http://schemas.openxmlformats.org/wordprocessingml/2006/main"}
    lines: list[str] = []
    for para in root.findall(".//w:p", ns):
        text = "".join(n.text or "" for n in para.findall(".//w:t", ns)).strip()
        if text:
            lines.append(text)
    return lines


# ── Section indexes ───────────────────────────────────────────────────────────

# \\s* allows glued headings like "1.1.12Dashboard - Balance Correction"
_NUMBERED_HEADING_RE = re.compile(r"^(\d+(?:\.\d+)+)\s*(.+)$")
# Chapter-level: "5. Introduction6" / "6. Functional Specification7" (single integer + dot + title)
_CHAPTER_HEADING_RE = re.compile(r"^(\d+)\.\s+(.+)$")
_IMAGE_LINE_RE = re.compile(
    r"Image\s+(\d+(?:\.\d+)+)\s*:?\s*(?:\(([^)]+)\)|(.+))?",
    re.I,
)
_TOC_START_RE = re.compile(r"^(?:Contents|Table of Contents)$", re.I)
_FRONT_MATTER_LINE_RE = re.compile(
    r"^(?:Revision History|Version History|References|Glossary|Acceptance|"
    r"Introduction|Document Control)$",
    re.I,
)
_POLLUTED_BODY_RE = re.compile(
    r"^(?:Revision History|Version History|References|Glossary)\b",
    re.I,
)


def section_depth(sec_id: str) -> int:
    """Return numeric depth of a section id ('6' -> 1, '5.1' -> 2, '6.3.2.1' -> 4)."""
    return len(sec_id.split("."))


def parse_heading_line(line: str) -> tuple[str, str] | None:
    """Return (section_id, title) from a DOCX heading line.

    Supports multi-level numbered headings (``5.1``, ``6.3.2.1``) and chapter-level
    headings (``5. Introduction``, ``6. Functional Specification``). Multi-level
    patterns take precedence so ``5.1 Purpose`` is not parsed as chapter ``5``.
    """
    m = _NUMBERED_HEADING_RE.match(line)
    if m:
        return m.group(1), m.group(2)
    m = _CHAPTER_HEADING_RE.match(line)
    if m:
        return m.group(1), m.group(2)
    return None


def parse_numbered_sections(path: Path, *, min_depth: int = 1) -> dict[str, dict]:
    """Build {section_id: {title, description?}} from numbered DOCX headings.

    Handles FSD-style documents where the Table of Contents repeats numbered
    headings with page numbers.  TOC entries contribute title only; body text
    is not accumulated until front matter (Revision History, etc.) ends.

    Default ``min_depth=1`` indexes chapter-level ids (``5``, ``6``) as well as
    ``5.1``, ``6.3.2``, etc. — every explicit numeric id in the document.
    """
    sections: dict[str, dict] = {}
    current_sec: str | None = None
    buf: list[str] = []
    in_toc = False

    def _commit():
        if current_sec:
            sections[current_sec] = {
                "title": buf[0] if buf else "",
                "description": " ".join(buf[1:])[:500] if len(buf) > 1 else "",
            }

    for line in docx_paragraphs(path):
        stripped = line.strip()
        if _TOC_START_RE.match(stripped):
            in_toc = True
            _commit()
            current_sec = None
            buf = []
            continue

        if _FRONT_MATTER_LINE_RE.match(stripped):
            in_toc = False
            _commit()
            current_sec = None
            buf = []
            continue

        parsed = parse_heading_line(line)
        if parsed and section_depth(parsed[0]) >= min_depth:
            sec_id, title = parsed
            if _is_section_index_noise(sec_id, title):
                continue
            _commit()
            if in_toc:
                sections.setdefault(sec_id, {"title": title, "description": ""})
                current_sec = None
                buf = []
            else:
                current_sec = sec_id
                buf = [title]
        elif current_sec and not in_toc:
            buf.append(line)
    _commit()
    return sections


def parse_flat_sections(path: Path, *, min_depth: int = 1) -> dict[str, dict]:
    """Build {section_id: {title}} — **one unique entry per native section ID** (TSD style).

    Skips the TOC block; body headings overwrite TOC placeholders. When the source
    reuses the same section number for different content, only the first body
    occurrence is indexed — see ``scan_section_id_collisions()`` for the audit list.
    """
    sections: dict[str, dict] = {}
    in_toc = False
    for line in docx_paragraphs(path):
        stripped = line.strip()
        if _TOC_START_RE.match(stripped):
            in_toc = True
            continue
        if _FRONT_MATTER_LINE_RE.match(stripped):
            in_toc = False
            continue
        parsed = parse_heading_line(line)
        if parsed and section_depth(parsed[0]) >= min_depth:
            sec_id, title = parsed
            if _is_section_index_noise(sec_id, title):
                continue
            if in_toc:
                sections.setdefault(sec_id, {"title": title[:500]})
            else:
                sections[sec_id] = {"title": title[:500]}
    return sections


def parse_image_index(path: Path) -> dict[str, dict]:
    """Build {image_id: {title}} — one unique entry per native Image ID."""
    images: dict[str, dict] = {}
    for line in docx_paragraphs(path):
        m = _IMAGE_LINE_RE.search(line)
        if m:
            num = m.group(1)
            if num in images:
                continue
            title = (m.group(2) or m.group(3) or "").strip().strip("_")
            images[num] = {"title": title[:500]}
    return images


@dataclass
class SectionCollision:
    """Same native section ID reused for different content in the source document."""

    section_id: str
    titles: list[str]
    line_numbers: list[int]


def scan_section_id_collisions(path: Path) -> list[SectionCollision]:
    """List section IDs reused with different titles (audit only — not indexed twice)."""
    by_id: dict[str, list[tuple[int, str]]] = defaultdict(list)
    for i, line in enumerate(docx_paragraphs(path)):
        parsed = parse_heading_line(line.strip())
        if not parsed or _is_section_index_noise(parsed[0], parsed[1]):
            continue
        by_id[parsed[0]].append((i, clean_section_title(parsed[1])))

    collisions: list[SectionCollision] = []
    for sec_id in sorted(by_id.keys(), key=lambda s: [int(p) for p in s.split(".")]):
        occs = by_id[sec_id]
        titles = list(dict.fromkeys(t for _, t in occs))
        if len(titles) > 1:
            collisions.append(
                SectionCollision(
                    section_id=sec_id,
                    titles=titles,
                    line_numbers=[ln for ln, _ in occs],
                )
            )
    return collisions


def write_collision_report(
    collisions: list[SectionCollision],
    path: Path,
    *,
    label: str = "Section ID collisions",
    source_name: str = "",
) -> None:
    """Write audit file for duplicate numbering in source (not part of the index)."""
    path.parent.mkdir(parents=True, exist_ok=True)
    lines = [
        f"{label} — {len(collisions)} section ID(s) reused with different titles",
        "These are source-document numbering errors. The index keeps ONE entry per ID.",
    ]
    if source_name:
        lines.append(f"Source: {source_name}")
    lines.extend(["", "Section ID\tOccurrences\tTitles (all in source)"])
    for col in collisions:
        titles = " | ".join(col.titles)
        lines.append(f"{col.section_id}\t{len(col.line_numbers)}\t{titles}")
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")


def section_lookup(
    sections: dict[str, dict],
    ref: str,
) -> dict | None:
    """Return section data for ref, or nearest ancestor prefix in index."""
    if ref in sections:
        return sections[ref]
    parts = ref.split(".")
    for length in range(len(parts) - 1, 0, -1):
        candidate = ".".join(parts[:length])
        if candidate in sections:
            return sections[candidate]
    return None


def _strip_title_noise(title: str) -> str:
    """Remove trailing page numbers glued to FSD titles (e.g. 'Send Money91')."""
    return re.sub(r"\d+\s*$", "", title).strip()


def clean_section_title(title: str) -> str:
    """Return a display-ready section heading (strip trailing page-number noise)."""
    return _strip_title_noise((title or "").strip())


def _is_section_index_noise(sec_id: str, title: str) -> bool:
    """Return True for version-table artifacts that are not real section headings."""
    cleaned = clean_section_title(title)
    if re.fullmatch(r"\d+\.0", sec_id) and cleaned in ("", ".", ".0", sec_id):
        return True
    return False


def section_display_description(section_data: dict) -> str:
    """Return section body text when present, otherwise the cleaned heading title."""
    body = (section_data.get("description") or "").strip()
    if body and not _POLLUTED_BODY_RE.match(body):
        return body[:500]
    title = clean_section_title(section_data.get("title", ""))
    return title[:500]


def write_section_index_txt(
    sections: dict[str, dict],
    path: Path,
    *,
    label: str = "Section Index",
    source_name: str = "",
) -> None:
    """Write a tab-separated section index audit file (all numeric depths)."""
    path.parent.mkdir(parents=True, exist_ok=True)
    sorted_ids = sorted(sections.keys(), key=lambda s: [int(p) for p in s.split(".")])
    lines = [f"{label} — {len(sorted_ids)} unique entries"]
    if source_name:
        lines.append(f"Source: {source_name}")
    lines.extend(["", "ID\tTitle\tDisplay Description"])
    for sec_id in sorted_ids:
        data = sections[sec_id]
        title = clean_section_title(data.get("title", ""))
        desc = section_display_description(data)
        lines.append(f"{sec_id}\t{title}\t{desc}")
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")


# ── Document-level PIC (revision / cover metadata) ───────────────────────────

_VERSION_NUM_RE = re.compile(r"^\d+(?:\.\d+)*$")
_HISTORY_SECTION_RE = re.compile(
    r"^(?:revision history|version history|document history|change history)$",
    re.I,
)
_PIC_HEADER_RE = re.compile(
    r"^(?:updated by|authors?|prepared by|created by)$",
    re.I,
)
_COVER_LABEL_RE = re.compile(
    r"^(?:created by|author|prepared by|updated by)$",
    re.I,
)
_INVALID_PIC_RE = re.compile(
    r"^(?:references|glossary|acceptance|document no|description|file name|item|"
    r"version|amendment|date|remarks|initial)$",
    re.I,
)


def _parse_version_tuple(version: str) -> tuple[int, ...]:
    try:
        return tuple(int(p) for p in version.split("."))
    except ValueError:
        return (0,)


def _looks_like_person_name(value: str) -> bool:
    if not value or len(value) > 80:
        return False
    if value == ":" or value.startswith("<"):
        return False
    if _INVALID_PIC_RE.match(value):
        return False
    if re.search(r"\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\b", value, re.I):
        return False
    if re.fullmatch(r"\d+(?:\.\d+)*", value):
        return False
    return bool(re.search(r"[A-Za-z]", value))


def _pic_from_cover_page(lines: list[str]) -> tuple[str, str]:
    """Extract PIC from cover-page Created By / Author labels."""
    for i, line in enumerate(lines):
        if not _COVER_LABEL_RE.match(line.strip()):
            continue
        for j in range(i + 1, min(i + 4, len(lines))):
            val = lines[j].strip()
            if val and val != ":" and _looks_like_person_name(val):
                return val, f"document cover {line.strip()}"
    return "", ""


def _pic_from_history_table(lines: list[str]) -> tuple[str, str]:
    """Extract PIC from Revision History / Version History flat table rows."""
    for i, line in enumerate(lines):
        if not _HISTORY_SECTION_RE.match(line.strip()):
            continue
        block = lines[i + 1 : i + 80]
        hdr_start: int | None = None
        for j, bl in enumerate(block):
            if bl.strip().lower() == "version":
                hdr_start = j
                break
        if hdr_start is None:
            continue

        headers: list[str] = []
        j = hdr_start
        while j < len(block) and len(headers) < 6:
            cell = block[j].strip()
            if _VERSION_NUM_RE.match(cell):
                break
            headers.append(cell)
            j += 1
        if not headers:
            continue

        pic_col: int | None = None
        for idx, header in enumerate(headers):
            if _PIC_HEADER_RE.match(header):
                pic_col = idx
                break
        if pic_col is None:
            continue

        ncols = len(headers)
        candidates: list[tuple[tuple[int, ...], str]] = []
        while j + ncols <= len(block):
            row = [block[j + k].strip() for k in range(ncols)]
            if not _VERSION_NUM_RE.match(row[0]):
                break
            name = row[pic_col].strip()
            if _looks_like_person_name(name):
                candidates.append((_parse_version_tuple(row[0]), name))
            j += ncols

        if candidates:
            _ver, name = max(candidates, key=lambda item: item[0])
            return name, f"document {line.strip()} {headers[pic_col]}"

    return "", ""


def parse_document_pic(path: Path) -> tuple[str, str]:
    """Return (pic_name, source_note) from DOCX revision history or cover metadata.

    Priority: latest row in Revision/Version History table, then cover-page
    Created By / Author.  This is source metadata selection — not link inference.
    """
    lines = docx_paragraphs(path)
    pic, note = _pic_from_history_table(lines)
    if pic:
        return pic, note
    return _pic_from_cover_page(lines[:40])


def build_breadcrumb_index(sections: dict[str, dict]) -> dict[str, str]:
    """Map 'Parent > Child' breadcrumb paths to section IDs from heading hierarchy."""
    index: dict[str, str] = {}
    for sec_id in sorted(sections.keys(), key=lambda s: [int(p) for p in s.split(".")]):
        parts = sec_id.split(".")
        titles: list[str] = []
        for i in range(1, len(parts) + 1):
            prefix = ".".join(parts[:i])
            if prefix in sections:
                titles.append(_strip_title_noise(sections[prefix].get("title", "")))
        if len(titles) >= 2:
            index[" > ".join(titles)] = sec_id
        if titles:
            index[titles[-1]] = sec_id
    return index


def build_chapter_index(sections: dict[str, dict]) -> dict[str, list[str]]:
    """Map chapter integer 'N' to sorted subsection IDs N.* present in index."""
    chapters: dict[str, list[str]] = {}
    for sec_id in sections:
        top = sec_id.split(".")[0]
        if top.isdigit():
            chapters.setdefault(top, []).append(sec_id)
    for k in chapters:
        chapters[k] = sorted(chapters[k], key=lambda s: [int(p) for p in s.split(".")])
    return chapters


def load_cite_aliases(path: Path | None) -> dict:
    """Load optional projects/<name>/cite_aliases.json for exact cite overrides."""
    if path is None or not path.is_file():
        return {}
    with path.open(encoding="utf-8") as fh:
        return json.load(fh)


@dataclass
class FsdResolveResult:
    section_id: str | None
    cite_raw: str
    method: str  # exact | ancestor | breadcrumb | alias | chapter | none
    chapter_subsections: list[str] | None = None


def resolve_fsd_cite(
    sections: dict[str, dict],
    raw_cell: str,
    *,
    breadcrumb_index: dict[str, str] | None = None,
    chapter_index: dict[str, list[str]] | None = None,
    aliases: dict | None = None,
) -> FsdResolveResult:
    """Resolve a SIT FSD Section cell to a section ID using index-then-verify only."""
    cite_raw = normalize_sit_fsd_cell(raw_cell)
    if not cite_raw:
        return FsdResolveResult(None, "", "none")

    aliases = aliases or {}
    breadcrumb_index = breadcrumb_index or {}
    chapter_index = chapter_index or {}

    # 1. Project alias (exact string — documented in cite_aliases.json)
    for key in ("fsd", "fsd_breadcrumb", "fsd_chapter"):
        bucket = aliases.get(key, {})
        if cite_raw in bucket:
            sid = bucket[cite_raw]
            if sid in sections:
                return FsdResolveResult(sid, cite_raw, "alias")

    # 2. Explicit section number from cell
    sec_num = extract_section_from_cell(raw_cell)
    if sec_num:
        if sec_num in sections:
            return FsdResolveResult(sec_num, cite_raw, "exact")
        data = section_lookup(sections, sec_num)
        if data:
            # Find the ancestor key that matched
            parts = sec_num.split(".")
            for length in range(len(parts), 0, -1):
                candidate = ".".join(parts[:length])
                if candidate in sections:
                    return FsdResolveResult(candidate, cite_raw, "ancestor")
        return FsdResolveResult(None, cite_raw, "none")

    # 3. Breadcrumb path (exact match from FSD hierarchy or alias file)
    if cite_raw in breadcrumb_index:
        sid = breadcrumb_index[cite_raw]
        if sid in sections:
            return FsdResolveResult(sid, cite_raw, "breadcrumb")

    # 4. Chapter-level cite (e.g. "6") — exact index entry wins over subsection list
    if is_chapter_cite(cite_raw):
        ch = cite_raw.strip()
        if ch in sections:
            return FsdResolveResult(ch, cite_raw, "exact")
        subs = chapter_index.get(ch, [])
        alias_ch = aliases.get("fsd_chapter", {}).get(ch)
        if alias_ch and alias_ch in sections:
            return FsdResolveResult(alias_ch, cite_raw, "alias")
        if subs:
            return FsdResolveResult(None, cite_raw, "chapter", chapter_subsections=subs)

    return FsdResolveResult(None, cite_raw, "none")
