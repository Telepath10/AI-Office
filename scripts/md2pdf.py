#!/usr/bin/env python3
"""Convert a markdown file to a styled PDF via weasyprint.

Usage: md2pdf.py <input.md> <output.pdf> [--title "Title"]
"""
import argparse
import re
from pathlib import Path

import markdown
from weasyprint import CSS as WeasyCSS
from weasyprint import HTML

CSS = """
@page { size: A4; margin: 18mm 16mm 20mm 16mm;
  @bottom-center { content: counter(page) " / " counter(pages); font-size: 8.5pt; color: #888; font-family: Helvetica, Arial, sans-serif; }
  @top-right { content: string(doctitle); font-size: 8pt; color: #aaa; font-family: Helvetica, Arial, sans-serif; }
}
body { font-family: Helvetica, Arial, sans-serif; font-size: 10pt; line-height: 1.45; color: #1a1a1a; }
h1 { font-size: 17pt; color: #0b3d5c; border-bottom: 2.5pt solid #0b3d5c; padding-bottom: 5pt; margin: 0 0 12pt 0; string-set: doctitle content(); }
h2 { font-size: 13pt; color: #0b3d5c; margin-top: 16pt; border-bottom: 1pt solid #c9d6e0; padding-bottom: 3pt; }
h3 { font-size: 11pt; color: #333; margin-top: 12pt; }
h4 { font-size: 10pt; color: #444; margin-top: 10pt; }
p { margin: 5pt 0; }
ul, ol { margin: 5pt 0 5pt 14pt; padding: 0; }
li { margin: 2.5pt 0; }
code { font-family: Menlo, Monaco, monospace; font-size: 8.5pt; background: #f2f4f6; padding: 1pt 3pt; border-radius: 2pt; }
pre { background: #f2f4f6; border: 1pt solid #dde3e8; border-left: 3pt solid #0b3d5c; padding: 8pt 10pt; border-radius: 3pt; overflow-wrap: break-word; white-space: pre-wrap; }
pre code { background: none; padding: 0; }
table { border-collapse: collapse; width: 100%; margin: 8pt 0; font-size: 9pt; }
th { background: #0b3d5c; color: #fff; text-align: left; padding: 4pt 6pt; }
td { border: 0.5pt solid #c9d6e0; padding: 4pt 6pt; vertical-align: top; }
tr:nth-child(even) td { background: #f4f7f9; }
blockquote { border-left: 3pt solid #c9a227; background: #fdf8e8; margin: 6pt 0; padding: 6pt 10pt; color: #5a4a10; }
strong { color: #0b3d5c; }
a { color: #0b6ea8; text-decoration: none; }
hr { border: none; border-top: 1pt solid #dde3e8; margin: 12pt 0; }
.dot { display: inline-block; width: 7.5pt; height: 7.5pt; border-radius: 50%; margin: 0 2pt 0 0; vertical-align: 0; }
.tick { color: #27ae60; font-weight: bold; }
img.chart { display: block; max-width: 100%; max-height: 95mm; margin: 6pt auto 10pt auto; page-break-inside: avoid; }
h3 { page-break-after: avoid; }
table, blockquote { page-break-inside: avoid; }
"""

EMBED_RE = re.compile(r"!\[\[([^\]|]+\.(?:svg|png|jpe?g|gif|webp))(?:\|[^\]]*)?\]\]", re.I)
WIKILINK_RE = re.compile(r"\[\[([^\]|\\]+)(?:\\?\|([^\]]+))?\]\]")


DOTS = {"🔴": "#c0392b", "🟠": "#e67e22", "🟡": "#f1c40f", "🔵": "#3498db", "🟢": "#27ae60"}


TABLE_RE = re.compile(r"<table>(.*?)</table>", re.S)
ROW_RE = re.compile(r"<tr>(.*?)</tr>", re.S)
CELL_RE = re.compile(r"<(t[hd])([^>]*)>(.*?)</\1>", re.S)
TAG_RE = re.compile(r"<[^>]+>")
SHRINK_MAX_CHARS = 14  # columns whose longest cell is this short shrink to fit
LABEL_MAX_CHARS = 26  # first column of 2-column label/value tables


def _visible_len(html_cell):
    import html as _html
    return len(_html.unescape(TAG_RE.sub("", html_cell)).strip())


def shrink_narrow_columns(html_doc):
    """Give short columns (IDs, step numbers, severities, scores) only the width they need."""

    def fix_table(m):
        inner = m.group(1)
        rows = [CELL_RE.findall(r) for r in ROW_RE.findall(inner)]
        if not rows:
            return m.group(0)
        ncols = max(len(r) for r in rows)
        if ncols < 2:
            return m.group(0)
        widths = [0] * ncols
        for r in rows:
            for i, (_, _, content) in enumerate(r):
                widths[i] = max(widths[i], _visible_len(content))
        narrow = {i for i, w in enumerate(widths) if w <= SHRINK_MAX_CHARS}
        if ncols == 2 and widths[0] <= LABEL_MAX_CHARS:
            narrow = {0}  # label/value table: labels take only what they need, values get the rest
        if not narrow or len(narrow) == ncols:
            return m.group(0)

        def fix_row(rm):
            idx = {"i": -1}

            def fix_cell(cm):
                idx["i"] += 1
                tag, attrs, content = cm.group(1), cm.group(2), cm.group(3)
                if idx["i"] in narrow:
                    style = "width:1%; white-space:nowrap;"
                    if 'style="' in attrs:
                        attrs = attrs.replace('style="', f'style="{style} ', 1)
                    else:
                        attrs += f' style="{style}"'
                return f"<{tag}{attrs}>{content}</{tag}>"

            return "<tr>" + CELL_RE.sub(fix_cell, rm.group(1)) + "</tr>"

        return "<table>" + ROW_RE.sub(fix_row, inner) + "</table>"

    return TABLE_RE.sub(fix_table, html_doc)


def find_assets_root(input_path):
    """Nearest ancestor of the note that has an attachments/ folder (the client dir)."""
    for parent in Path(input_path).resolve().parents:
        if (parent / "attachments").is_dir():
            return parent
    return Path(input_path).resolve().parent


def obsidian_to_html_md(text, assets_root):
    """Obsidian syntax -> plain markdown/HTML for the PDF."""
    text = "\n".join(l for l in text.splitlines() if "PDF version:" not in l)

    def embed(m):
        src = (Path(assets_root) / m.group(1)).resolve()
        if not src.exists():
            return ""
        return f'<img class="chart" src="{src.as_uri()}">'

    text = EMBED_RE.sub(embed, text)
    for emoji, color in DOTS.items():
        text = text.replace(emoji, f'<span class="dot" style="background:{color}"></span>')
    text = text.replace("✅", '<span class="tick">✔</span>')
    text = WIKILINK_RE.sub(lambda m: m.group(2) or Path(m.group(1)).name, text)
    return text


def convert(input_path, output_path, title=None, assets_root=None):
    """Render a markdown file (frontmatter stripped) to a styled PDF."""
    with open(input_path, "r", encoding="utf-8") as f:
        text = f.read()

    # Strip YAML frontmatter if present
    if text.startswith("---"):
        parts = text.split("---", 2)
        if len(parts) >= 3:
            text = parts[2].lstrip("\n")

    text = obsidian_to_html_md(text, assets_root or find_assets_root(input_path))

    if title is None:
        for line in text.splitlines():
            if line.startswith("# "):
                title = line[2:].strip()
                break
    if title is None:
        title = "Report"

    body = markdown.markdown(text, extensions=["tables", "fenced_code", "sane_lists", "nl2br"])
    body = shrink_narrow_columns(body)
    html = f"""<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>{title}</title></head>
<body>{body}</body></html>"""

    HTML(string=html).write_pdf(output_path, stylesheets=[WeasyCSS(string=CSS)])
    print(f"PDF written: {output_path}")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("input")
    ap.add_argument("output")
    ap.add_argument("--title", default=None)
    args = ap.parse_args()
    convert(args.input, args.output, title=args.title)


if __name__ == "__main__":
    main()