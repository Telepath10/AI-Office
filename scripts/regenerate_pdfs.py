#!/usr/bin/env python3
"""Regenerate PDF attachments for a client's published Obsidian notes.

Scan the Obsidian vault for published notes that carry a
"PDF version:" wikilink and re-render the corresponding PDF in
<slug>/attachments/ from the CURRENT markdown, so PDFs never go stale.

Usage:
  regenerate_pdfs.py <slug> [--vault ~/Documents/Obsidian/Office]

This is meant to run right AFTER vault_publish_note so the attachments
reflect the freshly published markdown.
"""
import argparse
import re
import sys
import os
from pathlib import Path

from md2pdf import convert

PDF_LINK_RE = re.compile(r"\[\[attachments/([^\]|]+\.pdf)(?:\|[^\]]+)?\]\]")


def vault_path(vault_arg):
    return Path(vault_arg).expanduser() if vault_arg else Path.home() / "Documents/Obsidian/Office"


def find_notes(client_dir, vault):
    """Yield (note_path, pdf_name) for every published note advertising a PDF."""
    found = []
    for md in client_dir.rglob("*.md"):
        if md.name == "index.md":
            continue
        try:
            text = md.read_text(encoding="utf-8")
        except OSError:
            continue
        m = PDF_LINK_RE.search(text)
        if m:
            found.append((md, m.group(1)))
    return found


def main():
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("slug", help="client slug, e.g. nailaara")
    ap.add_argument("--vault", default=None, help="absolute vault path (default ~/Documents/Obsidian/Office)")
    ap.add_argument("--dry-run", action="store_true", help="print what would be regenerated without writing")
    args = ap.parse_args()

    vault = vault_path(args.vault)
    client_dir = vault / args.slug
    if not client_dir.is_dir():
        print(f"ERROR: {client_dir} does not exist", file=sys.stderr)
        sys.exit(1)

    attachments_dir = client_dir / "attachments"
    updated = skipped = missing_src = missing_out = 0

    for note_path, pdf_name in find_notes(client_dir, vault):
        out = attachments_dir / pdf_name
        if not out.resolve().is_relative_to(attachments_dir.resolve()):
            print(f"WARNING: skipping {pdf_name!r} from {note_path.name}: output path escapes {attachments_dir}", file=sys.stderr)
            skipped += 1
            continue
        if not note_path.exists():
            print(f"SKIP: source note missing {note_path}")
            missing_src += 1
            continue
        if not out.parent.exists():
            print(f"SKIP: attachments dir missing {out.parent} (mkdir <slug>/attachments/)")
            missing_out += 1
            continue
        print(f"-> {note_path.name}  =>  {out.relative_to(vault)}")
        if not args.dry_run:
            convert(str(note_path), str(out), assets_root=str(client_dir))
            updated += 1
        else:
            updated += 1

    print(f"\n{args.slug}: {updated} PDF(s) up to date" + (" (dry-run)" if args.dry_run else ""))
    if skipped + missing_src + missing_out:
        print(f"skipped: {skipped}, missing source: {missing_src}, missing dir: {missing_out}")


if __name__ == "__main__":
    main()