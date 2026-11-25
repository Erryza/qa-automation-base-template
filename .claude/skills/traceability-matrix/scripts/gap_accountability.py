#!/usr/bin/env python3
"""Coverage accountability and per-source gap detail builders for RTM workbooks.

PMO branching model (trace hops evaluated):
  BRD → UREQ → FSD → TSD → JIRA
                FSD → Test Case  (direct branch)

One ``Gaps <Stage>`` sheet per **provided** source.  Every gap row includes
Why / How to Fix / How to Validate — honest, source-based only.
"""
from __future__ import annotations

import re
from typing import Any

import chain

# Human-readable catalog for every Gap Type code emitted by _classify_gap.
# Keys are stable codes; values are shown on the "Gap Types Guide" sheet.
GAP_TYPE_CATALOG: dict[str, dict[str, str]] = {
    # ── BRD ──
    "NO_UREQ_DOWNSTREAM": {
        "stage": "BRD",
        "title": "No UREQ cites this BRD",
        "meaning": (
            "This BRD section exists in the RTM but no UREQ item explicitly references it. "
            "The BRD → UREQ hop is broken on this row."
        ),
        "typical_cause": "UREQ document missing a cite to this BRD §, or UREQ not yet written.",
    },
    "ORPHAN_BRD": {
        "stage": "BRD",
        "title": "Orphan BRD item",
        "meaning": (
            "BRD section appears only on rows that cannot be traced forward to UREQ. "
            "Not proven in the active chain."
        ),
        "typical_cause": "Out-of-scope BRD text, or UREQ traceability not added yet.",
    },
    # ── UREQ ──
    "NO_BRD_UPSTREAM": {
        "stage": "UREQ",
        "title": "No BRD cites this UREQ",
        "meaning": (
            "This UREQ item has no explicit BRD section reference in source. "
            "The BRD → UREQ hop is broken."
        ),
        "typical_cause": "UREQ written without citing parent BRD § (most common UREQ gap).",
    },
    "NO_FSD_DOWNSTREAM": {
        "stage": "UREQ",
        "title": "No FSD cites this UREQ",
        "meaning": (
            "This UREQ item has no FSD section that explicitly references it. "
            "The UREQ → FSD hop is broken."
        ),
        "typical_cause": "FSD feature not yet mapped to this UREQ, or cite missing in FSD index.",
    },
    "ORPHAN_UREQ": {
        "stage": "UREQ",
        "title": "Orphan UREQ item",
        "meaning": (
            "UREQ section cannot be fully traced to both BRD (upstream) and FSD (downstream)."
        ),
        "typical_cause": "Missing BRD cite, missing FSD cite, or both.",
    },
    # ── FSD ──
    "NO_UREQ_UPSTREAM": {
        "stage": "FSD",
        "title": "No UREQ cites this FSD",
        "meaning": (
            "This FSD section has no explicit UREQ reference in source. "
            "The UREQ → FSD hop is broken."
        ),
        "typical_cause": "FSD written without UREQ traceability block or matrix cite.",
    },
    "ORPHAN_CHAPTER": {
        "stage": "FSD",
        "title": "FSD chapter not cited downstream",
        "meaning": (
            "Top-level FSD chapter (e.g. §7) has no direct TSD or Test Case cite. "
            "Child sections §7.1, §7.2 may still be cited — this is often expected."
        ),
        "typical_cause": "Downstream docs cite subsections only, not the chapter heading.",
    },
    "ORPHAN_SUBSECTION": {
        "stage": "FSD",
        "title": "FSD subsection not individually cited",
        "meaning": (
            "A nested FSD section has no own TSD/Test Case cite, but a parent section "
            "on the same feature IS cited. Granularity gap, not a missing feature."
        ),
        "typical_cause": "TSD/SIT cites parent § only; detail subsections not named explicitly.",
    },
    "OUT_OF_SCOPE_STRUCTURAL": {
        "stage": "FSD",
        "title": "FSD scaffolding section (not TSD-traceable)",
        "meaning": (
            "This FSD subsection is a document template heading — Activity Diagram, "
            "Screen Design, Use Case Diagram, Expected Performance, User Story, etc. "
            "TSD does not produce a 1:1 row for scaffolding; it covers the same content "
            "at feature grain (Screen Mapping, Process Logic Flow, FE Validation). "
            "NOT a coverage defect — the parent feature is MATCH."
        ),
        "typical_cause": (
            "FSD template produces 5–7 sub-headings per feature; TSD traces at feature level, "
            "not sub-heading level. This is expected and correct practice."
        ),
    },
    "COVERED_BY_PARENT": {
        "stage": "FSD",
        "title": "Covered at parent feature level",
        "meaning": (
            "This FSD sub-clause (e.g. Business Rules & Validation, Field Description) "
            "has no explicit TSD cite but its parent feature IS traced (parent TR = MATCH). "
            "The content is covered; the citation is at feature grain, not clause grain."
        ),
        "typical_cause": (
            "TSD traces at feature level (§7.x.y); individual sub-clauses §7.x.y.z "
            "are not separately listed in §10.2 matrix. Optional improvement only."
        ),
    },
    "NO_TSD_BRANCH": {
        "stage": "FSD",
        "title": "No TSD branch for this FSD",
        "meaning": (
            "This FSD section has no row linking it to any TSD item (FSD → TSD branch missing)."
        ),
        "typical_cause": "TSD §10.2 matrix or inline traceability does not list this FSD §.",
    },
    "NO_TEST_CASE_BRANCH": {
        "stage": "FSD",
        "title": "No Test Case branch for this FSD",
        "meaning": (
            "This FSD section has no SIT row with FSD Section cell citing it "
            "(direct FSD → Test Case branch — not via TSD/JIRA)."
        ),
        "typical_cause": "SIT pack missing or FSD Section column blank for this feature.",
    },
    "NO_TSD_AND_TEST_CASE": {
        "stage": "FSD",
        "title": "Neither TSD nor Test Case branch",
        "meaning": (
            "Both downstream branches from FSD are missing: no TSD cite AND no Test Case cite."
        ),
        "typical_cause": "Feature not yet designed (TSD) and not yet tested (SIT).",
    },
    "NO_TSD_ON_ROW": {
        "stage": "FSD",
        "title": "Chain row missing TSD",
        "meaning": (
            "This RTM chain row has FSD populated but TSD column is empty on the same row."
        ),
        "typical_cause": "Incomplete chain row — TSD cite exists elsewhere but not linked on this row.",
    },
    "NO_TEST_CASE_ON_ROW": {
        "stage": "FSD",
        "title": "Chain row missing Test Case",
        "meaning": (
            "This RTM chain row has FSD populated but Test Case column is empty."
        ),
        "typical_cause": "SIT row not yet linked on this chain row (FSD → Test Case direct branch).",
    },
    "PARTIAL_DOWNSTREAM": {
        "stage": "FSD",
        "title": "Partial downstream on matrix row",
        "meaning": (
            "TSD §10.2 matrix row exists but FSD reference is incomplete or broken (PARTIAL status)."
        ),
        "typical_cause": "Matrix has placeholder, wrong FSD §, or ambiguous document name.",
    },
    "ORPHAN_FEATURE": {
        "stage": "FSD",
        "title": "Orphan FSD feature",
        "meaning": (
            "FSD section has no proven downstream on any required branch (TSD and/or Test Case)."
        ),
        "typical_cause": "Feature in FSD not yet reflected in TSD or SIT sources.",
    },
    # ── TSD ──
    "NO_FSD_UPSTREAM": {
        "stage": "TSD",
        "title": "No FSD cites this TSD",
        "meaning": (
            "This TSD section has no explicit FSD document + § reference in source. "
            "The FSD → TSD hop is broken."
        ),
        "typical_cause": "TSD detail section without §10.2 matrix row or inline FSD cite (most common TSD gap).",
    },
    "NO_JIRA_DOWNSTREAM": {
        "stage": "TSD",
        "title": "No JIRA cites this TSD",
        "meaning": (
            "This TSD section has no JIRA ticket whose Description cites it. "
            "The TSD → JIRA hop is broken."
        ),
        "typical_cause": "Development ticket not yet created or JIRA Description missing TSD § cite.",
    },
    "ARCHITECTURE_NO_FSD": {
        "stage": "TSD",
        "title": "Architecture section (expected gap)",
        "meaning": (
            "TSD §1–§3 (architecture, ERD, infrastructure) typically has no FSD counterpart. "
            "Honest GAP unless a business rule applies."
        ),
        "typical_cause": "Technical foundation content — not a functional requirement gap.",
    },
    "ORPHAN_DETAIL_SUBSECTION": {
        "stage": "TSD",
        "title": "TSD detail subsection without FSD",
        "meaning": (
            "TSD subsection under a feature has no FSD cite; parent feature may be cited."
        ),
        "typical_cause": "Detail UI/field-level TSD not listed in §10.2 matrix.",
    },
    "MATRIX_INCOMPLETE_FSD": {
        "stage": "TSD",
        "title": "Matrix row missing FSD",
        "meaning": (
            "TSD §10.2 traceability matrix row has '—' or blank in the FSD column."
        ),
        "typical_cause": "Matrix not yet filled — replace dash with valid FSD document + §.",
    },
    "ORPHAN_TSD": {
        "stage": "TSD",
        "title": "Orphan TSD item",
        "meaning": (
            "TSD section cannot be traced to FSD upstream and/or JIRA downstream."
        ),
        "typical_cause": "Missing FSD cite, missing JIRA ticket, or both.",
    },
    # ── JIRA ──
    "NO_TSD_UPSTREAM": {
        "stage": "JIRA",
        "title": "No TSD cites this JIRA",
        "meaning": (
            "JIRA ticket Description does not explicitly cite a TSD section or Image ID. "
            "The TSD → JIRA hop is broken."
        ),
        "typical_cause": "JIRA Description missing TSD § reference (most common JIRA gap).",
    },
    "ORPHAN_JIRA": {
        "stage": "JIRA",
        "title": "Orphan JIRA ticket",
        "meaning": (
            "JIRA issue appears in RTM but cannot be matched to a TSD section via Description cite."
        ),
        "typical_cause": "Ticket created without traceability cite, or cite does not resolve in TSD index.",
    },
    "PARTIAL_TSD_CITE": {
        "stage": "JIRA",
        "title": "JIRA cites TSD but ID not found",
        "meaning": (
            "JIRA Description mentions a TSD reference but the cited section/Image ID "
            "does not resolve in the TSD document (PARTIAL status)."
        ),
        "typical_cause": "Typo in TSD § number, renamed section, or stale JIRA Description.",
    },
    # ── Test Case ──
    "NO_FSD_CITE": {
        "stage": "Test Case",
        "title": "Test Case missing FSD Section",
        "meaning": (
            "SIT row has no FSD Section cell value, so FSD → Test Case branch cannot be proven."
        ),
        "typical_cause": "SIT FSD Section column blank (most common Test Case gap).",
    },
    "ORPHAN_TEST_CASE": {
        "stage": "Test Case",
        "title": "Orphan test case",
        "meaning": (
            "Test case exists but FSD upstream cite is missing or incomplete."
        ),
        "typical_cause": "SIT row not mapped to FSD §; Test Case links direct from FSD only.",
    },
    # ── Shared ──
    "PARTIAL_CHAIN": {
        "stage": "(any)",
        "title": "Partial chain link",
        "meaning": (
            "A reference exists in source but is incomplete — real traceability, not fully proven "
            "(Match Status = PARTIAL)."
        ),
        "typical_cause": "Ambiguous cite, wrong § number, or one hop complete while another is broken.",
    },
    "CHAIN_GAP": {
        "stage": "(any)",
        "title": "Generic chain gap",
        "meaning": (
            "Row has GAP/PARTIAL status on a required hop; see Why and Evidence columns for detail."
        ),
        "typical_cause": "Catch-all when a specific classifier does not apply — always source-based.",
    },
}

STAGE_ID_COL: dict[str, str] = {}
STAGE_PIC_COL: dict[str, str] = {}
STAGE_PAGE_COL: dict[str, str] = {}
STAGE_DESC_COL: dict[str, str] = {}


def configure_stages(stages: list) -> None:
    """Bind stage key → column names from generate_rtm.STAGES objects."""
    global STAGE_ID_COL, STAGE_PIC_COL, STAGE_PAGE_COL, STAGE_DESC_COL
    STAGE_ID_COL = {s.key: s.id_col for s in stages}
    STAGE_PIC_COL = {s.key: s.pic_col for s in stages}
    STAGE_PAGE_COL = {
        s.key: next((c for c in s.columns if "Section Page" in c), "")
        for s in stages
    }
    STAGE_DESC_COL = {
        s.key: next(
            (c for c in s.columns if "Description" in c and "Section Page" not in c),
            "",
        )
        for s in stages
    }


# FSD section heading patterns — determined from FSD document templates.
# Structural = scaffolding; TSD traces at feature grain, not 1:1 sub-heading.
_FSD_STRUCTURAL_HEADINGS: frozenset[str] = frozenset({
    "activity diagram",
    "case and activity scenario",
    "case/activity scenario",
    "use case diagram",
    "screen design",
    "expected performance",
    "process flow",
    "user story",
    "user stories",
    "prerequisite",
    "description",
})
_FSD_REQUIREMENT_HEADINGS: frozenset[str] = frozenset({
    "business rules & validation",
    "business rules and validation",
    "field description and action control",
    "field description & action control",
})


def _fsd_section_category(desc: str, sec_id: str) -> str:
    """Return category for an FSD section based on heading text and depth.

    Categories:
      chapter         depth=1  (e.g. §7)
      feature_header  depth=2  (e.g. §7.1 — the feature the TSD traces to)
      structural      depth>=3, template scaffolding (Activity Diagram, Screen Design …)
      requirement     depth>=3, requirement sub-clause (Business Rules, Field Control …)
      other_subsection  depth>=3, does not match above patterns
    """
    d = (desc or "").strip().lower()
    depth = _section_depth(sec_id)
    if depth <= 1:
        return "chapter"
    if depth == 2:
        return "feature_header"
    for heading in _FSD_STRUCTURAL_HEADINGS:
        if d == heading or d.startswith(heading):
            return "structural"
    for heading in _FSD_REQUIREMENT_HEADINGS:
        if d == heading or heading in d:
            return "requirement"
    return "other_subsection"


def _id_col(stage: str) -> str:
    return STAGE_ID_COL.get(stage, f"{stage} ID")


def _pic_col(stage: str) -> str:
    return STAGE_PIC_COL.get(stage, f"{stage} PIC")


def _section_depth(sec_id: str) -> int:
    if not sec_id or sec_id.startswith("TR-"):
        return 0
    try:
        return len(sec_id.split("."))
    except ValueError:
        return 0


def _parse_fsd_doc_from_page(page: str) -> str:
    m = re.search(r"\(([^)]+)\)\s*$", page or "")
    return m.group(1).strip() if m else ""


def _fsd_key(row: dict) -> str:
    fsd_id = (row.get("FSD ID") or "").strip()
    if not fsd_id:
        return ""
    doc = _parse_fsd_doc_from_page(row.get("FSD Section Page", ""))
    return f"{doc}|{fsd_id}" if doc else fsd_id


def _ancestors(sec_id: str) -> list[str]:
    parts = sec_id.split(".")
    return [".".join(parts[:i]) for i in range(1, len(parts))]


def _clean_reasoning(reasoning: str, inactive: list[str]) -> str:
    if not reasoning:
        return ""
    text = reasoning
    for stage in inactive:
        text = re.sub(
            rf"GAP:\s*source:\s*{re.escape(stage)}\s*not provided;?\s*",
            "",
            text,
            flags=re.I,
        )
    parts = [p.strip() for p in re.split(r"\.\s+", text.strip(" ;.")) if p.strip()]
    gap_parts = [p for p in parts if p.upper().startswith("GAP:")]
    if gap_parts:
        return gap_parts[0][:300]
    non_match = [p for p in parts if not p.upper().startswith("MATCH:")]
    return (non_match[0] if non_match else parts[0] if parts else "")[:300]


def _row_kind(row: dict) -> str:
    ev = (row.get("Evidence") or "").lower()
    if "orphan fsd section" in ev:
        return "orphan_fsd"
    if "orphan tsd section" in ev:
        return "orphan_tsd"
    if "orphan jira" in ev or ("orphan" in ev and "jira" in ev):
        return "orphan_jira"
    if "§10.2 matrix" in ev or "matrix row" in ev:
        return "matrix_leaf"
    if row.get("Test Case ID"):
        return "test_case"
    if row.get("Jira Task ID"):
        return "jira"
    if row.get("TSD ID"):
        return "tsd_item"
    if row.get("FSD ID"):
        return "fsd_item"
    if row.get("UREQ ID"):
        return "ureq_item"
    if row.get("BRD ID"):
        return "brd_item"
    return "other"


def _broken_hops(row: dict, active: list[str]) -> list[tuple[str, str]]:
    broken: list[tuple[str, str]] = []
    for frm, to in chain.trace_hops(active):
        if (row.get(_id_col(frm)) or "").strip() and not (row.get(_id_col(to)) or "").strip():
            broken.append((frm, to))
    return broken


def _build_cited_fsd_keys(rows: list[dict]) -> set[str]:
    cited: set[str] = set()
    for row in rows:
        if row.get("Match Status") not in ("MATCH", "PARTIAL"):
            continue
        key = _fsd_key(row)
        if not key:
            continue
        cited.add(key)
        fsd_id = (row.get("FSD ID") or "").strip()
        doc = _parse_fsd_doc_from_page(row.get("FSD Section Page", ""))
        for anc in _ancestors(fsd_id):
            cited.add(f"{doc}|{anc}" if doc else anc)
    return cited


def _fsd_branch_index(rows: list[dict]) -> dict[str, dict[str, bool]]:
    """Map FSD key → which downstream branches appear on any RTM row."""
    idx: dict[str, dict[str, bool]] = {}
    for row in rows:
        key = _fsd_key(row)
        if not key:
            continue
        entry = idx.setdefault(key, {"tsd": False, "test_case": False, "jira": False})
        if (row.get("TSD ID") or "").strip():
            entry["tsd"] = True
        if (row.get("Test Case ID") or "").strip():
            entry["test_case"] = True
        if (row.get("Jira Task ID") or "").strip():
            entry["jira"] = True
    return idx


def _is_proven_for_stage(row: dict, stage_key: str, active: list[str]) -> bool:
    """True when this row has no gap involving *stage_key* on required hops."""
    if (row.get("Match Status") or "") != "MATCH":
        return False
    if not (row.get(_id_col(stage_key)) or "").strip():
        return False
    for frm, to in chain.trace_hops(active):
        if stage_key not in (frm, to):
            continue
        if (row.get(_id_col(frm)) or "").strip() and not (row.get(_id_col(to)) or "").strip():
            return False
    kind = _row_kind(row)
    if stage_key == "FSD" and kind == "orphan_fsd":
        return False
    if stage_key == "TSD" and kind == "orphan_tsd":
        return False
    return True


def _classify_gap(
    stage_key: str,
    row: dict,
    *,
    active: list[str],
    inactive: list[str],
    cited_fsd: set[str],
    fsd_branches: dict[str, dict[str, bool]],
    broken: list[tuple[str, str]],
) -> tuple[str, str, str, str]:
    """Return (gap_type, broken_hop, how_to_fix, how_to_validate)."""
    status = row.get("Match Status", "")
    kind = _row_kind(row)
    hop_str = "; ".join(chain.hop_label(a, b) for a, b in broken) if broken else ""

    # ── BRD ──────────────────────────────────────────────────────────────────
    if stage_key == "BRD":
        if ("BRD", "UREQ") in broken:
            return (
                "NO_UREQ_DOWNSTREAM",
                chain.hop_label("BRD", "UREQ"),
                "Add explicit UREQ reference in BRD or UREQ document citing this BRD section ID.",
                "Rebuild RTM; UREQ ID column should populate when cite exists in UREQ index.",
            )
        if status == "PARTIAL":
            return (
                "PARTIAL_CHAIN",
                hop_str,
                "Complete downstream UREQ cite or fix broken reference in source.",
                "Rebuild RTM; Match Status should become MATCH.",
            )
        return (
            "ORPHAN_BRD",
            hop_str,
            "Add UREQ item that explicitly cites this BRD section, or remove if out of scope.",
            "Search UREQ for BRD section ID; rebuild RTM after source update.",
        )

    # ── UREQ ─────────────────────────────────────────────────────────────────
    if stage_key == "UREQ":
        if ("BRD", "UREQ") in broken and "BRD" in active:
            return (
                "NO_BRD_UPSTREAM",
                chain.hop_label("BRD", "UREQ"),
                "Add explicit BRD section cite in UREQ source for this UREQ item.",
                "Rebuild RTM; BRD ID column should populate when cite resolves in BRD index.",
            )
        if ("UREQ", "FSD") in broken:
            return (
                "NO_FSD_DOWNSTREAM",
                chain.hop_label("UREQ", "FSD"),
                "Add explicit FSD section cite in FSD or UREQ naming this UREQ item.",
                "Rebuild RTM; FSD ID column should populate when cite exists in FSD index.",
            )
        if status == "PARTIAL":
            return (
                "PARTIAL_CHAIN",
                hop_str,
                "Complete missing BRD or FSD hop with explicit source cite.",
                "Rebuild RTM; both BRD and FSD columns should populate.",
            )
        return (
            "ORPHAN_UREQ",
            hop_str,
            "Add FSD feature that cites this UREQ, or add BRD→UREQ link if upstream missing.",
            "Verify UREQ cites BRD and FSD cites UREQ explicitly in source documents.",
        )

    # ── FSD ──────────────────────────────────────────────────────────────────
    if stage_key == "FSD":
        fsd_id = (row.get("FSD ID") or "").strip()
        depth = _section_depth(fsd_id)
        fkey = _fsd_key(row)
        branches = fsd_branches.get(fkey, {})

        if ("UREQ", "FSD") in broken and "UREQ" in active:
            return (
                "NO_UREQ_UPSTREAM",
                chain.hop_label("UREQ", "FSD"),
                "Add explicit UREQ section cite in FSD source for this FSD section.",
                "Rebuild RTM; UREQ ID column should populate when cite resolves in UREQ index.",
            )

        if kind == "orphan_fsd" or (fsd_id and not branches.get("tsd") and not branches.get("test_case")):
            parent_cited = any(
                f"{_parse_fsd_doc_from_page(row.get('FSD Section Page', ''))}|{a}" in cited_fsd
                for a in _ancestors(fsd_id)[1:]
            )
            if depth == 1:
                downstream = " or ".join(
                    s for s in ("TSD", "Test Case") if s in active
                ) or "downstream branch"
                return (
                    "ORPHAN_CHAPTER",
                    hop_str or "FSD → (branch)",
                    f"Add explicit {downstream} cite to FSD §{fsd_id}, "
                    f"OR accept as container-only if §{fsd_id}.x children are cited.",
                    f"Search sources for §{fsd_id}. If only §{fsd_id}.1+ cited, chapter orphan is expected.",
                )
            if parent_cited:
                desc_val = (row.get(STAGE_DESC_COL.get("FSD", "")) or "").strip()
                cat = _fsd_section_category(desc_val, fsd_id)
                if cat == "structural":
                    return (
                        "OUT_OF_SCOPE_STRUCTURAL",
                        "",
                        f"No action needed — FSD §{fsd_id} is a template scaffolding heading. "
                        f"Parent feature is traced. Exclude from sign-off count.",
                        f"Confirm parent §{'.'.join(fsd_id.split('.')[:2])} has MATCH status.",
                    )
                return (
                    "COVERED_BY_PARENT",
                    "",
                    f"Optional: add explicit TSD cite naming FSD §{fsd_id} for clause-level traceability. "
                    f"Not required for PMO sign-off — parent feature is MATCH.",
                    f"Confirm MATCH row exists for parent §{'.'.join(fsd_id.split('.')[:2])}.",
                )

        missing_branches: list[str] = []
        if "TSD" in active and not branches.get("tsd"):
            missing_branches.append("TSD")
        if "Test Case" in active and not branches.get("test_case"):
            missing_branches.append("Test Case")

        if missing_branches == ["TSD"]:
            return (
                "NO_TSD_BRANCH",
                chain.hop_label("FSD", "TSD"),
                f"Add TSD cite (§10.2 matrix or inline Traceability) for FSD §{fsd_id}.",
                "Rebuild RTM; TSD ID should populate on a row sharing this FSD §.",
            )
        if missing_branches == ["Test Case"]:
            return (
                "NO_TEST_CASE_BRANCH",
                chain.hop_label("FSD", "Test Case"),
                f"Add SIT Test Case with FSD Section cell citing §{fsd_id} (direct — not via TSD).",
                "Rebuild RTM; Test Case ID should populate on a row with this FSD §.",
            )
        if len(missing_branches) == 2:
            return (
                "NO_TSD_AND_TEST_CASE",
                f"{chain.hop_label('FSD', 'TSD')}; {chain.hop_label('FSD', 'Test Case')}",
                f"FSD §{fsd_id} has neither TSD nor Test Case branch. Add both cites in source.",
                "Rebuild RTM; expect rows on both FSD→TSD and FSD→Test Case branches.",
            )

        if ("FSD", "TSD") in broken:
            return (
                "NO_TSD_ON_ROW",
                chain.hop_label("FSD", "TSD"),
                "This row has FSD but no TSD — add explicit TSD section/TR cite in source.",
                "Rebuild RTM; TSD column should populate on this chain row.",
            )
        if ("FSD", "Test Case") in broken:
            return (
                "NO_TEST_CASE_ON_ROW",
                chain.hop_label("FSD", "Test Case"),
                "This row has FSD but no Test Case — add SIT row with FSD Section cite.",
                "Rebuild RTM; Test Case column should populate.",
            )

        if kind == "matrix_leaf" and status == "PARTIAL":
            return (
                "PARTIAL_DOWNSTREAM",
                hop_str,
                "Fix broken FSD section reference in TSD §10.2 matrix or complete downstream hop.",
                "Rebuild RTM; Match Status should become MATCH.",
            )

        return (
            "ORPHAN_FEATURE",
            hop_str,
            f"Add TSD and/or Test Case traceability naming FSD §{fsd_id}.",
            "Rebuild RTM after source update.",
        )

    # ── TSD ──────────────────────────────────────────────────────────────────
    if stage_key == "TSD":
        if ("FSD", "TSD") in broken:
            return (
                "NO_FSD_UPSTREAM",
                chain.hop_label("FSD", "TSD"),
                "Add explicit FSD document + § cite in TSD (§10.2 matrix or Traceability block).",
                "Rebuild RTM; FSD ID column should populate when cite resolves in FSD index.",
            )
        if ("TSD", "JIRA") in broken and "JIRA" in active:
            return (
                "NO_JIRA_DOWNSTREAM",
                chain.hop_label("TSD", "JIRA"),
                "Add JIRA ticket whose Description explicitly cites this TSD section or Image ID.",
                "Rebuild RTM; Jira Task ID should populate when JIRA export contains the cite.",
            )
        if kind == "orphan_tsd":
            tsd_id = (row.get("TSD ID") or "").strip()
            if tsd_id and tsd_id[0].isdigit() and int(tsd_id.split(".")[0]) <= 3:
                return (
                    "ARCHITECTURE_NO_FSD",
                    "",
                    "TSD §1–§3 (architecture/ERD) — no FSD counterpart unless business requirement exists.",
                    "Accept GAP or add BRD/UREQ/FSD if a business rule applies.",
                )
            return (
                "ORPHAN_DETAIL_SUBSECTION",
                hop_str,
                f"Add TR-ID to TSD §10.2 matrix or inline FSD cite for TSD §{tsd_id}.",
                "Parent feature heading should list TR-IDs; detail subsections follow feature cite.",
            )
        if kind == "matrix_leaf" and status == "PARTIAL" and not (row.get("FSD ID") or "").strip():
            tsd_id = (row.get("TSD ID") or "").strip()
            return (
                "MATRIX_INCOMPLETE_FSD",
                chain.hop_label("FSD", "TSD"),
                "Edit TSD §10.2 matrix: replace '—' with valid FSD Document + FSD §.",
                f"Update matrix row for {tsd_id}; rebuild RTM.",
            )
        if status in ("GAP", "PARTIAL"):
            return (
                "CHAIN_GAP",
                hop_str,
                "Add missing FSD upstream cite or JIRA downstream cite in TSD/JIRA source.",
                "Rebuild RTM; confirm Evidence quotes explicit cite.",
            )
        return ("ORPHAN_TSD", hop_str, "Review TSD section; add FSD and/or JIRA cites.", "Rebuild RTM.")

    # ── JIRA ─────────────────────────────────────────────────────────────────
    if stage_key == "JIRA":
        if ("TSD", "JIRA") in broken:
            return (
                "NO_TSD_UPSTREAM",
                chain.hop_label("TSD", "JIRA"),
                "Add explicit TSD section or Image ID cite in JIRA ticket Description.",
                "Rebuild RTM; TSD ID should populate from JIRA Description parse.",
            )
        if kind == "orphan_jira" or status == "GAP":
            return (
                "ORPHAN_JIRA",
                hop_str,
                "Link JIRA to TSD via Description cite, or add SIT row with Link Jira cell.",
                "Rebuild RTM; JIRA should appear on a row with TSD MATCH.",
            )
        if status == "PARTIAL":
            return (
                "PARTIAL_TSD_CITE",
                hop_str,
                "JIRA Description cites TSD but cited ID not found — fix cite or TSD index.",
                "Verify TSD section/Image ID exists; update JIRA Description.",
            )
        return (
            "NO_TSD_UPSTREAM",
            chain.hop_label("TSD", "JIRA"),
            "JIRA ticket must explicitly cite a TSD section in Description.",
            "Rebuild RTM after JIRA export update.",
        )

    # ── Test Case ────────────────────────────────────────────────────────────
    if stage_key == "Test Case":
        if ("FSD", "Test Case") in broken:
            return (
                "NO_FSD_UPSTREAM",
                chain.hop_label("FSD", "Test Case"),
                "Add FSD Section cell in SIT naming the FSD section ID (direct FSD→Test Case branch).",
                "Rebuild RTM; FSD ID should populate — Test Case does NOT require TSD/JIRA hop.",
            )
        if ("TSD", "JIRA") in broken:
            # Not a Test Case gap — different branch; should not appear on TC sheet
            pass
        if not (row.get("FSD ID") or "").strip():
            return (
                "NO_FSD_CITE",
                chain.hop_label("FSD", "Test Case"),
                "Populate SIT 'FSD Section' column with explicit FSD section number.",
                "Rebuild RTM; FSD ID column should populate when section exists in FSD index.",
            )
        if status == "PARTIAL":
            return (
                "PARTIAL_CHAIN",
                hop_str,
                "Test Case cites FSD but another hop is incomplete — check Reasoning.",
                "Rebuild RTM; Match Status should become MATCH.",
            )
        return (
            "ORPHAN_TEST_CASE",
            hop_str,
            "Ensure SIT row cites FSD Section and optionally Link Jira if JIRA branch used.",
            "Rebuild RTM; FSD column must populate from explicit SIT FSD Section cell.",
        )

    return (
        "CHAIN_GAP",
        hop_str,
        f"Review Reasoning; add explicit cross-reference for {stage_key} in source.",
        "Rebuild RTM; confirm Match Status improves without guessing.",
    )


def collect_source_gaps(
    rows: list[dict],
    stage_key: str,
    active_stages: list[str],
    inactive_stages: list[str],
) -> list[dict]:
    """All gap cases for one provided source stage."""
    if stage_key not in active_stages:
        return []

    id_col = _id_col(stage_key)
    page_col = STAGE_PAGE_COL.get(stage_key, "")
    desc_col = STAGE_DESC_COL.get(stage_key, "")
    pic_col = _pic_col(stage_key)

    cited_fsd = _build_cited_fsd_keys(rows)
    fsd_branches = _fsd_branch_index(rows)
    entries: list[dict] = []
    seen: set[tuple[int, str]] = set()

    for line_no, row in enumerate(rows, start=1):
        item_id = (row.get(id_col) or "").strip()
        if not item_id:
            continue

        if _is_proven_for_stage(row, stage_key, active_stages):
            continue

        broken = [h for h in _broken_hops(row, active_stages) if stage_key in h]
        status = (row.get("Match Status") or "").strip()

        include = bool(broken) or status in ("GAP", "PARTIAL")
        if stage_key == "FSD" and _row_kind(row) == "orphan_fsd":
            include = True
        if stage_key == "TSD" and _row_kind(row) == "orphan_tsd":
            include = True
        if stage_key == "FSD":
            fkey = _fsd_key(row)
            br = fsd_branches.get(fkey, {})
            if _row_kind(row) == "orphan_fsd":
                include = True
            elif status != "MATCH":
                if "TSD" in active_stages and not br.get("tsd"):
                    include = True
                if "Test Case" in active_stages and not br.get("test_case"):
                    include = True

        if not include:
            continue

        gap_type, broken_hop, fix, validate = _classify_gap(
            stage_key,
            row,
            active=active_stages,
            inactive=inactive_stages,
            cited_fsd=cited_fsd,
            fsd_branches=fsd_branches,
            broken=broken or _broken_hops(row, active_stages),
        )

        dedupe_key = (line_no, gap_type)
        if dedupe_key in seen:
            continue
        seen.add(dedupe_key)

        why = _clean_reasoning(row.get("Reasoning", ""), inactive_stages)
        if not (row.get(pic_col) or "").strip():
            pic_note = f"GAP: {stage_key} PIC blank in source"
            why = f"{why}. {pic_note}" if why else pic_note

        desc_val = (row.get(desc_col) or "").strip()
        fsd_cat = ""
        if stage_key == "FSD":
            fsd_id_val = (row.get(_id_col("FSD")) or "").strip()
            fsd_cat = _fsd_section_category(desc_val, fsd_id_val)

        entries.append({
            "line_no": line_no,
            "item_id": item_id,
            "section_page": (row.get(page_col) or "").strip(),
            "description": desc_val[:200],
            "fsd_category": fsd_cat,
            "gap_type": gap_type,
            "broken_hop": broken_hop,
            "match_status": status,
            "why": why,
            "evidence": (row.get("Evidence") or "").strip()[:200],
            "how_to_fix": fix,
            "how_to_validate": validate,
        })

    return entries


def _fsd_grain_metrics(rows: list[dict]) -> dict:
    """Compute feature-grain vs clause-grain FSD coverage metrics.

    Feature grain = TR matrix rows (§10.2 entries); this is what TSD authors
    trace at.  Clause grain = every FSD § heading, including template scaffolding.
    The gap between the two numbers is mostly structural FSD headings, not
    missing coverage.
    """
    from collections import Counter
    fsd_clause_rows = [r for r in rows if (r.get("FSD ID") or "").strip()]
    feature_rows = [r for r in fsd_clause_rows if (r.get("TSD ID") or "").strip().startswith("TR-")]
    orphan_fsd = [r for r in rows if _row_kind(r) == "orphan_fsd"]

    # Classify orphan FSD headings
    structural_n = requirement_n = feature_hdr_n = other_n = 0
    for r in orphan_fsd:
        fsd_id = (r.get("FSD ID") or "").strip()
        desc = (r.get("Functional Specification Description") or "").strip()
        cat = _fsd_section_category(desc, fsd_id)
        if cat == "structural":
            structural_n += 1
        elif cat == "requirement":
            requirement_n += 1
        elif cat == "feature_header":
            feature_hdr_n += 1
        else:
            other_n += 1

    feature_match = sum(1 for r in feature_rows if r.get("Match Status") == "MATCH")
    feature_partial = sum(1 for r in feature_rows if r.get("Match Status") == "PARTIAL")
    feature_total = len(feature_rows)
    feature_pct = round(100 * feature_match / feature_total, 1) if feature_total else 0.0

    return {
        "feature_total": feature_total,
        "feature_match": feature_match,
        "feature_partial": feature_partial,
        "feature_pct": feature_pct,
        "clause_orphan_total": len(orphan_fsd),
        "structural_n": structural_n,
        "requirement_n": requirement_n,
        "feature_hdr_n": feature_hdr_n,
        "other_n": other_n,
    }


def build_accountability_summary(
    rows: list[dict],
    active_stages: list[str],
    inactive_stages: list[str],
    status_counts: dict[str, int],
    proven_pct: float,
) -> list[list[Any]]:
    """Return rows for the Coverage Accountability sheet."""
    total = len(rows)
    hops = chain.trace_hops(active_stages)
    hop_labels = [chain.hop_label(a, b) for a, b in hops]

    orphan_fsd = sum(1 for r in rows if _row_kind(r) == "orphan_fsd")
    orphan_tsd = sum(1 for r in rows if _row_kind(r) == "orphan_tsd")
    chain_rows = total - orphan_fsd - orphan_tsd

    leaf_stages = [s for s in ("JIRA", "Test Case") if s in active_stages]
    leaf_match_counts: list[str] = []
    for leaf in leaf_stages:
        col = _id_col(leaf)
        lr = [r for r in rows if (r.get(col) or "").strip()]
        lm = sum(1 for r in lr if r.get("Match Status") == "MATCH")
        pct = round(100 * lm / len(lr), 1) if lr else 0.0
        leaf_match_counts.append(f"{leaf} MATCH={lm}/{len(lr)} ({pct}%)")

    chain_proven = round(100 * status_counts.get("MATCH", 0) / chain_rows, 1) if chain_rows else 0.0

    per_source = ", ".join(source_gap_sheet_name(s) for s in active_stages)

    result = [
        ["Metric", "Value", "Notes"],
        ["Trace model (branching)", "BRD→UREQ→FSD→TSD→JIRA; FSD→Test Case", "Test Case links direct from FSD"],
        ["Active hops evaluated", " | ".join(hop_labels), "Only hops where both stages provided"],
        ["Active stages", " → ".join(active_stages), ""],
        [
            "Inactive stages",
            ", ".join(inactive_stages) if inactive_stages else "(none)",
            "Documented in Reasoning — not defects",
        ],
        ["Per-source gap sheets", per_source, "All gap cases with fix/validate"],
        ["", "", ""],
        ["ROW-LEVEL COVERAGE (all RTM rows)", "", ""],
        ["Total RTM rows", total, ""],
        ["% Proven (all rows)", f"{proven_pct}%",
         "⚠ Low when orphan clause rows included — use Feature grain for sign-off"],
        ["MATCH / PARTIAL / GAP", f"{status_counts.get('MATCH',0)} / "
         f"{status_counts.get('PARTIAL',0)} / {status_counts.get('GAP',0)}", ""],
        ["", "", ""],
        ["CHAIN ROWS (excludes orphan section rows)", "", ""],
        ["Chain rows", chain_rows, ""],
        ["% Proven (chain rows)", f"{chain_proven}%", "Primary requirement traceability"],
        ["", "", ""],
    ]

    # FSD dual-grain section (only when FSD is active)
    if "FSD" in active_stages:
        g = _fsd_grain_metrics(rows)
        result += [
            ["FSD COVERAGE — TWO GRAINS", "", ""],
            ["", "", ""],
            ["FEATURE GRAIN (for PMO sign-off)", "", ""],
            ["  What it is", "Each TR row = one FSD feature traced to TSD",
             "TSD §10.2 matrix: one TR per feature section"],
            ["  TR rows (features traced)", g["feature_total"], ""],
            ["  MATCH (feature covered)", g["feature_match"],
             f"= {g['feature_pct']}% — PRIMARY SIGN-OFF METRIC"],
            ["  PARTIAL (needs fix)", g["feature_partial"],
             "Fix §10.2 matrix FSD '—' or unresolved doc references"],
            ["  Feature coverage %", f"{g['feature_pct']}%",
             "✔ Use this metric for FSD↔TSD sign-off"],
            ["", "", ""],
            ["CLAUSE GRAIN (informational only)", "", ""],
            ["  What it is", "Every FSD § heading, including template scaffolding",
             "Not all subsections require a 1:1 TSD row"],
            ["  Orphan FSD clause rows", g["clause_orphan_total"],
             "Headings not in §10.2 matrix — see Gaps FSD sheet"],
            [
                "    ↳ Template scaffolding (OUT_OF_SCOPE_STRUCTURAL)",
                g["structural_n"],
                "Activity Diagram, Screen Design, User Story, etc. — NOT coverage defects",
            ],
            [
                "    ↳ Requirement sub-clauses (COVERED_BY_PARENT)",
                g["requirement_n"],
                "Business Rules, Field Control — parent feature MATCH; cite depth optional",
            ],
            [
                "    ↳ Feature / chapter headers",
                g["feature_hdr_n"] + g["other_n"],
                "Container headings; real NO_TSD_BRANCH cases are flagged separately",
            ],
            ["  Clause coverage %", f"{round(100*(g['feature_match'])/(g['feature_total']+g['clause_orphan_total']),1) if (g['feature_total']+g['clause_orphan_total']) else 0}%",
             "⚠ Misleading for sign-off — use Feature grain above"],
            ["", "", ""],
        ]

    if leaf_match_counts:
        result += [
            ["LEAF COVERAGE (downstream branches)", "", ""],
            *[[f"  {x}", "", ""] for x in leaf_match_counts],
            ["", "", ""],
        ]

    result += [
        ["SIGN-OFF RULE", "", ""],
        ["Primary metric", "Feature grain % Proven (TR rows)", "PMO sign-off uses this"],
        ["Clause-grain gaps", "OUT_OF_SCOPE_STRUCTURAL = not defects; COVERED_BY_PARENT = optional", ""],
        ["Real fixes needed", "PARTIAL TR rows + NO_TSD_BRANCH sections", "See Gaps FSD sheet"],
        ["Review", f"Open {per_source}", "Each gap: Why + How to Fix + How to Validate"],
        ["Audit PASS ≠ complete", "Use Match Status + Gaps sheets", "Verdict PASS = honest build only"],
    ]

    return result


def gap_type_explanation(gap_type: str) -> str:
    """One-line human summary for a gap type code (empty if unknown)."""
    entry = GAP_TYPE_CATALOG.get(gap_type)
    if not entry:
        return ""
    return entry["meaning"]


def gap_types_for_stage(stage_key: str) -> list[str]:
    """Gap type codes that apply to one source stage, in catalog order."""
    return [
        code
        for code, meta in GAP_TYPE_CATALOG.items()
        if meta["stage"] in (stage_key, "(any)")
    ]


def gap_type_guide_headers() -> list[str]:
    return [
        "Source",
        "Gap Type (code)",
        "Short title",
        "What it means (plain language)",
        "Typical cause",
    ]


def gap_type_guide_rows(active_stages: list[str]) -> list[list[str]]:
    """Catalog rows filtered to stages provided in this RTM run."""
    rows: list[list[str]] = []
    for code, meta in GAP_TYPE_CATALOG.items():
        stage = meta["stage"]
        if stage != "(any)" and stage not in active_stages:
            continue
        rows.append([
            stage,
            code,
            meta["title"],
            meta["meaning"],
            meta["typical_cause"],
        ])
    return rows


def gap_type_guide_col_widths() -> list[int]:
    return [10, 24, 28, 52, 36]


def gap_type_stage_summary_rows(stage_key: str) -> list[list[str]]:
    """Compact reference rows for the top of each Gaps <Stage> sheet."""
    return [
        [
            code,
            GAP_TYPE_CATALOG[code]["title"],
            GAP_TYPE_CATALOG[code]["meaning"],
        ]
        for code in gap_types_for_stage(stage_key)
        if code in GAP_TYPE_CATALOG
    ]


def gap_type_stage_summary_headers() -> list[str]:
    return ["Gap Type", "Short title", "What it means"]


def gap_type_stage_summary_col_widths() -> list[int]:
    return [24, 28, 64]


def source_gap_sheet_name(stage_key: str) -> str:
    """Excel-safe sheet name: Gaps FSD, Gaps Test Case, etc."""
    return f"Gaps {stage_key}"[:31]


def source_gap_headers(stage_key: str = "") -> list[str]:
    base = [
        "RTM Row",
        "Item ID",
        "Section Page",
        "Description",
    ]
    if stage_key == "FSD":
        base.append("Section Category")
    base += [
        "Gap Type",
        "Broken Hop",
        "Match Status",
        "Why (from Reasoning)",
        "Evidence",
        "How to Fix",
        "How to Validate",
    ]
    return base


def source_gap_data_rows(entries: list[dict], stage_key: str = "") -> list[list]:
    rows = []
    for e in entries:
        row = [
            f"row {e['line_no']}",
            e["item_id"],
            e["section_page"],
            e["description"],
        ]
        if stage_key == "FSD":
            row.append(e.get("fsd_category", ""))
        row += [
            e["gap_type"],
            e.get("broken_hop", ""),
            e["match_status"],
            e["why"],
            e["evidence"],
            e["how_to_fix"],
            e["how_to_validate"],
        ]
        rows.append(row)
    return rows


def source_gap_col_widths(stage_key: str = "") -> list[int]:
    base = [8, 16, 22, 32]
    if stage_key == "FSD":
        base.append(16)
    base += [22, 18, 12, 38, 32, 44, 44]
    return base


def count_all_source_gaps(
    rows: list[dict],
    active_stages: list[str],
    inactive_stages: list[str],
) -> dict[str, int]:
    return {
        s: len(collect_source_gaps(rows, s, active_stages, inactive_stages))
        for s in active_stages
    }
