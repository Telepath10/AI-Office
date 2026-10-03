#!/usr/bin/env python3
"""Dependency-free SVG charts for audit deliverables.

SVGs render in Obsidian (image embed) and in weasyprint PDFs. Stdlib only.
"""
import math
from xml.sax.saxutils import escape

FONT = "Helvetica, Arial, sans-serif"
INK = "#1a1a1a"
MUTED = "#6b7785"
GRID = "#e3e8ed"
NAVY = "#0b3d5c"

RATING_COLORS = {"good": "#27ae60", "needs_work": "#f39c12", "critical": "#c0392b"}
SEVERITY_COLORS = {"critical": "#c0392b", "high": "#e67e22", "medium": "#f1c40f", "low": "#3498db"}
SEVERITY_LABELS = {"critical": "Critical", "high": "High", "medium": "Medium", "low": "Low"}
EFFORT_LABELS = {"quick": "Quick fix", "moderate": "Moderate", "project": "Project"}


def rating(score):
    if score >= 80:
        return "good"
    if score >= 50:
        return "needs_work"
    return "critical"


def _svg(w, h, body):
    return (
        f'<svg xmlns="http://www.w3.org/2000/svg" width="{w}" height="{h}" viewBox="0 0 {w} {h}" '
        f'font-family="{FONT}">\n<rect width="{w}" height="{h}" fill="#ffffff"/>\n{body}\n</svg>\n'
    )


def _text(x, y, s, size=12, fill=INK, anchor="start", weight="normal"):
    return (
        f'<text x="{x:.1f}" y="{y:.1f}" font-size="{size}" fill="{fill}" text-anchor="{anchor}" '
        f'font-weight="{weight}">{escape(str(s))}</text>'
    )


def _arc(cx, cy, r, a0, a1):
    """Arc path from angle a0 to a1 (degrees, 180 = left, 0 = right, measured on the upper half)."""
    x0, y0 = cx + r * math.cos(math.radians(a0)), cy - r * math.sin(math.radians(a0))
    x1, y1 = cx + r * math.cos(math.radians(a1)), cy - r * math.sin(math.radians(a1))
    large = 1 if abs(a0 - a1) > 180 else 0
    return f"M {x0:.2f} {y0:.2f} A {r} {r} 0 {large} 1 {x1:.2f} {y1:.2f}"


def gauge(score, label="Overall score"):
    """Semicircle score gauge 0-100."""
    w, h, cx, cy, r = 360, 210, 180, 170, 130
    score = max(0, min(100, round(score)))
    color = RATING_COLORS[rating(score)]
    parts = [f'<path d="{_arc(cx, cy, r, 180, 0)}" fill="none" stroke="{GRID}" stroke-width="26" stroke-linecap="round"/>']
    if score > 0:
        end = 180 - 180 * score / 100
        parts.append(f'<path d="{_arc(cx, cy, r, 180, end)}" fill="none" stroke="{color}" stroke-width="26" stroke-linecap="round"/>')
    parts.append(_text(cx, cy - 22, score, 54, color, "middle", "bold"))
    parts.append(_text(cx, cy + 4, "out of 100", 13, MUTED, "middle"))
    parts.append(_text(cx, 22, label, 15, NAVY, "middle", "bold"))
    parts.append(_text(cx - r, cy + 28, "0", 11, MUTED, "middle"))
    parts.append(_text(cx + r, cy + 28, "100", 11, MUTED, "middle"))
    return _svg(w, h + 20, "\n".join(parts))


def category_bars(items, title="Score by area"):
    """items: list of (label, score). Horizontal bars coloured by rating."""
    label_w, bar_w, row_h, top = 210, 330, 30, 40
    w = label_w + bar_w + 60
    h = top + row_h * len(items) + 30
    parts = [_text(12, 24, title, 15, NAVY, weight="bold")]
    for frac in (0, 50, 80, 100):
        x = label_w + bar_w * frac / 100
        parts.append(f'<line x1="{x:.1f}" y1="{top - 6}" x2="{x:.1f}" y2="{top + row_h * len(items)}" stroke="{GRID}" stroke-width="1"/>')
        parts.append(_text(x, top + row_h * len(items) + 16, frac, 10, MUTED, "middle"))
    for i, (label, score) in enumerate(items):
        y = top + i * row_h
        color = RATING_COLORS[rating(score)]
        parts.append(_text(label_w - 10, y + 18, label, 12, INK, "end"))
        parts.append(f'<rect x="{label_w}" y="{y + 5}" width="{bar_w}" height="18" rx="3" fill="#f4f7f9"/>')
        parts.append(f'<rect x="{label_w}" y="{y + 5}" width="{max(2, bar_w * score / 100):.1f}" height="18" rx="3" fill="{color}"/>')
        parts.append(_text(label_w + bar_w + 8, y + 19, score, 12, INK, weight="bold"))
    return _svg(w, h, "\n".join(parts))


def severity_donut(counts, title="Problems found by severity"):
    """counts: dict severity -> int."""
    w, h, cx, cy, r, sw = 420, 230, 115, 125, 70, 30
    total = sum(counts.get(s, 0) for s in SEVERITY_COLORS)
    parts = [_text(12, 24, title, 15, NAVY, weight="bold")]
    if total == 0:
        parts.append(f'<circle cx="{cx}" cy="{cy}" r="{r}" fill="none" stroke="{GRID}" stroke-width="{sw}"/>')
    else:
        circ = 2 * math.pi * r
        offset = 0.0
        for sev, color in SEVERITY_COLORS.items():
            n = counts.get(sev, 0)
            if not n:
                continue
            seg = circ * n / total
            parts.append(
                f'<circle cx="{cx}" cy="{cy}" r="{r}" fill="none" stroke="{color}" stroke-width="{sw}" '
                f'stroke-dasharray="{seg:.2f} {circ - seg:.2f}" stroke-dashoffset="{-offset:.2f}" '
                f'transform="rotate(-90 {cx} {cy})"/>'
            )
            offset += seg
    parts.append(_text(cx, cy + 4, total, 30, INK, "middle", "bold"))
    parts.append(_text(cx, cy + 22, "total", 11, MUTED, "middle"))
    for i, (sev, color) in enumerate(SEVERITY_COLORS.items()):
        y = 70 + i * 32
        parts.append(f'<rect x="240" y="{y}" width="16" height="16" rx="3" fill="{color}"/>')
        parts.append(_text(266, y + 13, f"{SEVERITY_LABELS[sev]}: {counts.get(sev, 0)}", 13))
    return _svg(w, h, "\n".join(parts))


def effort_matrix(cells, title="Effort vs impact"):
    """cells: dict (severity, effort) -> count. Quick wins (high impact, quick) highlighted."""
    sevs = list(SEVERITY_COLORS)
    efforts = list(EFFORT_LABELS)
    left, top, cw, ch = 110, 78, 120, 46
    w = left + cw * len(efforts) + 20
    h = top + ch * len(sevs) + 40
    parts = [_text(12, 24, title, 15, NAVY, weight="bold")]
    parts.append(_text(left + cw * len(efforts) / 2, 50, "Effort to fix →", 11, MUTED, "middle"))
    for j, e in enumerate(efforts):
        parts.append(_text(left + cw * j + cw / 2, top - 4, EFFORT_LABELS[e], 12, INK, "middle", "bold"))
    for i, s in enumerate(sevs):
        y = top + i * ch
        parts.append(_text(left - 10, y + ch / 2 + 4, SEVERITY_LABELS[s], 12, SEVERITY_COLORS[s], "end", "bold"))
        for j, e in enumerate(efforts):
            x = left + j * cw
            n = cells.get((s, e), 0)
            quick_win = e == "quick" and s in ("critical", "high")
            fill = "#e8f6ee" if quick_win else "#f7f9fb"
            stroke = RATING_COLORS["good"] if quick_win else GRID
            parts.append(f'<rect x="{x + 2}" y="{y + 2}" width="{cw - 4}" height="{ch - 4}" rx="4" fill="{fill}" stroke="{stroke}" stroke-width="{2 if quick_win else 1}"/>')
            parts.append(_text(x + cw / 2, y + ch / 2 + 6, n if n else "–", 16 if n else 13, INK if n else MUTED, "middle", "bold" if n else "normal"))
    parts.append(_text(left, h - 12, "Green cells = quick wins (big problems, small effort)", 11, RATING_COLORS["good"]))
    return _svg(w, h, "\n".join(parts))


def metric_bars(metrics, title="Key measurements vs targets"):
    """metrics: list of {label, value, unit, good, poor, lower_is_better (default True)}."""
    label_w, bar_w, row_h, top = 170, 330, 40, 44
    w = label_w + bar_w + 120
    h = top + row_h * len(metrics) + 34
    parts = [_text(12, 24, title, 15, NAVY, weight="bold")]
    for i, m in enumerate(metrics):
        y = top + i * row_h
        good, poor, val = float(m["good"]), float(m["poor"]), float(m["value"])
        lower = m.get("lower_is_better", True)
        scale = max(poor * 1.5, val * 1.05, good * 2) if lower else max(good * 1.2, val * 1.05)
        def X(v):
            return label_w + bar_w * min(v, scale) / scale
        parts.append(_text(label_w - 10, y + 18, m["label"], 12, INK, "end"))
        bands = [(0, good, "#e8f6ee"), (good, poor, "#fdf2e0"), (poor, scale, "#fbe7e5")] if lower else \
                [(0, poor, "#fbe7e5"), (poor, good, "#fdf2e0"), (good, scale, "#e8f6ee")]
        for a, b, c in bands:
            parts.append(f'<rect x="{X(a):.1f}" y="{y + 4}" width="{max(0, X(b) - X(a)):.1f}" height="20" fill="{c}"/>')
        status = ("good" if val <= good else "needs_work" if val <= poor else "critical") if lower else \
                 ("good" if val >= good else "needs_work" if val >= poor else "critical")
        parts.append(f'<rect x="{label_w}" y="{y + 9}" width="{max(2, X(val) - label_w):.1f}" height="10" rx="2" fill="{RATING_COLORS[status]}"/>')
        parts.append(f'<line x1="{X(good):.1f}" y1="{y + 1}" x2="{X(good):.1f}" y2="{y + 27}" stroke="{RATING_COLORS["good"]}" stroke-width="2" stroke-dasharray="3 2"/>')
        unit = m.get("unit", "")
        parts.append(_text(label_w + bar_w + 8, y + 18, f'{m["value"]}{unit}', 12, INK, weight="bold"))
        parts.append(_text(label_w + bar_w + 8, y + 32, f'target {"≤" if lower else "≥"} {m["good"]}{unit}', 10, MUTED))
    parts.append(_text(label_w, h - 10, "Dashed line = target. Green = good, amber = needs work, red = poor.", 11, MUTED))
    return _svg(w, h, "\n".join(parts))
