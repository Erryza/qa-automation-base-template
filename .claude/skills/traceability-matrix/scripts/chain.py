#!/usr/bin/env python3
"""Reusable PMO RTM chaining engine — project-agnostic helpers.

Import in project mappers (projects/<name>/build_rtm_input.py) instead of
hand-rolling chain logic.  All project-specific parsing stays in the mapper;
this module only provides generic building blocks.

Dynamic chain model (PMO branching)
-----------------------------------
The PMO traceability model has a branch at FSD:

  BRD → UREQ → FSD → TSD → JIRA
                FSD → Test Case   (direct — not via TSD/JIRA)

When both TSD and Test Case are active, evaluate **both** branches from FSD.
A missing TSD link does not imply a missing Test Case link, and vice versa.

Index-then-verify (workflow — implemented in projects/<name>/)
--------------------------------------------------------------
1. Build indexes from target documents (sections, images, JIRA keys, test IDs).
2. Sample 20-30 source rows; catalog citation styles (see SKILL.md categories A-J).
3. Extract explicit cited IDs via priority-ordered extractors (project-specific).
4. Verify: chain.classify(cited_id, id in index) -> MATCH or GAP.

This module provides chaining/rollup helpers only. Citation regex and document
index builders live in scripts/citations.py and scripts/docindex.py.
Run scripts/validate_citations.py before RTM sign-off. WOI is the reference
implementation under projects/woi-universal-p2/.

Key concepts
------------
- active_stages  : ordered list of stages the project has provided.
- inactive_stages: the rest — always documented as GAP with standard prefix.
- Broken chain   : a required trace hop where FROM is populated but TO is blank on
  the same row (see ``trace_hops()`` for the hop list — includes FSD→Test Case).
- Row unit       : one row per item in the most-downstream active stage, tracing
  backward through active stages (leaf-driven).  Items in upstream active stages
  that are not referenced by any leaf get one orphan row each.
"""
from __future__ import annotations

# ── Stage order ───────────────────────────────────────────────────────────────

STAGE_ORDER: list[str] = ["BRD", "UREQ", "FSD", "TSD", "JIRA", "Test Case"]

# Explicit trace hops — FSD branches to TSD and Test Case independently.
# Do NOT add FSD→JIRA, TSD→Test Case, or other inferred hops.
TRACE_HOPS: list[tuple[str, str]] = [
    ("BRD", "UREQ"),
    ("UREQ", "FSD"),
    ("FSD", "TSD"),
    ("TSD", "JIRA"),
    ("FSD", "Test Case"),
]

_ALIASES: dict[str, str] = {
    "TESTCASE":  "Test Case",
    "TC":        "Test Case",
    "TESTCASE":  "Test Case",
    "TEST_CASE": "Test Case",
}


def parse_active_stages(spec: str) -> list[str]:
    """Parse a comma-separated stage spec into an ordered active-stage list.

    Examples::

        parse_active_stages("FSD,TSD,JIRA,Test Case")
        # -> ["FSD", "TSD", "JIRA", "Test Case"]

        parse_active_stages("all")
        # -> all 6 stages

    Rules:
    - Unknown stage names raise ValueError.
    - Output is always in PMO chain order regardless of input order.
    - Duplicates are silently de-duplicated.
    """
    if spec.strip().lower() == "all":
        return list(STAGE_ORDER)
    raw = [s.strip() for s in spec.split(",") if s.strip()]
    active: set[str] = set()
    for name in raw:
        canonical = _ALIASES.get(name.upper().replace(" ", "").replace("-", ""), name)
        if canonical not in STAGE_ORDER:
            raise ValueError(
                f"Unknown stage: {name!r}. Valid stages: {', '.join(STAGE_ORDER)}"
            )
        active.add(canonical)
    return [s for s in STAGE_ORDER if s in active]


def inactive_stages(active: list[str]) -> list[str]:
    """Return stages not in the active list, in PMO chain order."""
    return [s for s in STAGE_ORDER if s not in active]


def trace_hops(active: list[str]) -> list[tuple[str, str]]:
    """Return (from_stage, to_stage) hops to evaluate for the given active stages.

    Uses the PMO branching model (``TRACE_HOPS``).  Only hops where **both**
    stages are in *active* are returned.
    """
    active_set = set(active)
    return [(a, b) for a, b in TRACE_HOPS if a in active_set and b in active_set]


def downstream_hops(stage: str, active: list[str]) -> list[tuple[str, str]]:
    """Hops where *stage* is the upstream (from) side."""
    return [(a, b) for a, b in trace_hops(active) if a == stage]


def upstream_hops(stage: str, active: list[str]) -> list[tuple[str, str]]:
    """Hops where *stage* is the downstream (to) side."""
    return [(a, b) for a, b in trace_hops(active) if b == stage]


def hop_label(frm: str, to: str) -> str:
    return f"{frm} → {to}"


# ── Column constants ──────────────────────────────────────────────────────────

PMO_COLUMNS: list[str] = [
    "BRD ID", "BRD Section Page", "Business Requirement Description", "BRD PIC",
    "UREQ ID", "UREQ Section Page", "UREQ Description", "UREQ PIC",
    "FSD ID", "FSD Section Page", "Functional Specification Description", "FSD PIC",
    "TSD ID", "TSD Section Page", "Technical Description", "TSD PIC",
    "Jira Task ID", "Jira Task Development Description", "JIRA PIC",
    "Test Case ID", "Test Case Description", "Test Case PIC",
]
AUDIT_COLUMNS: list[str] = [
    "Match Status", "Confidence", "Evidence", "Reasoning", "Auditor Verdict",
]
ALL_COLUMNS: list[str] = PMO_COLUMNS + AUDIT_COLUMNS


def blank_row() -> dict:
    """Return a 27-column dict of empty strings (all PMO + audit columns)."""
    return {c: "" for c in ALL_COLUMNS}


# ── Classification ────────────────────────────────────────────────────────────

def classify(cited_id: str | None, exists_in_target: bool) -> str:
    """Return 'MATCH' when cited_id is non-blank and exists in target; else 'GAP'."""
    if cited_id and exists_in_target:
        return "MATCH"
    return "GAP"


# ── Inactive-stage reasoning prefix (locked) ──────────────────────────────────

def standard_inactive_reasoning(active: list[str]) -> str:
    """Build the standard 'source: <stage> not provided' prefix for inactive stages.

    Example for active = ["FSD", "TSD", "JIRA", "Test Case"]::

        "GAP: source: BRD not provided; GAP: source: UREQ not provided"

    Returns an empty string when all 6 stages are active.
    """
    parts = [f"GAP: source: {s} not provided" for s in STAGE_ORDER if s not in active]
    return "; ".join(parts)


# ── JIRA description rule (locked) ───────────────────────────────────────────

def jira_dev_description(jira_row: dict, max_len: int = 500) -> str:
    """Return Jira Task Development Description using the locked rule.

    Rule (locked across all projects):
      1. JIRA export Description (trimmed) if non-blank.
      2. JIRA export Summary as fallback when Description is blank or absent.

    This is source text selection only — not link inference.
    """
    desc = (jira_row.get("Description") or "").strip()
    if desc:
        return desc[:max_len]
    return ((jira_row.get("Summary") or "").strip())[:max_len]


# ── Reasoning assembly ────────────────────────────────────────────────────────

def assemble_reasoning(
    inactive_prefix: str,
    pic_notes: list[str],
    match_notes: list[str],
    gap_notes: list[str],
    max_len: int = 800,
) -> str:
    """Join all reasoning parts into a single Reasoning cell value.

    Order: inactive_prefix -> PIC notes -> MATCH notes -> GAP notes.
    Parts are separated by '. '; empty parts are omitted.
    """
    parts = [inactive_prefix] + pic_notes + match_notes + gap_notes
    return ". ".join(p for p in parts if p)[:max_len]


# ── Status / confidence rollup ────────────────────────────────────────────────

def rollup_status(statuses: set[str]) -> tuple[str, str]:
    """Return (overall_status, confidence) from a set of per-stage statuses.

    Rules (per SKILL.md):
    - All MATCH                         -> MATCH, High
    - At least one MATCH or PARTIAL     -> PARTIAL, Medium
    - All GAP                           -> GAP, n/a
    """
    if statuses == {"MATCH"}:
        return "MATCH", "High"
    if "MATCH" in statuses or "PARTIAL" in statuses:
        return "PARTIAL", "Medium"
    return "GAP", "n/a"
