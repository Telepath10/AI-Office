#!/usr/bin/env python3
"""Scrapling Spider framework crawl — concurrent multi-page with pause/resume."""

import argparse
import json
import os
import re
import sys
import time


def parse_args():
    p = argparse.ArgumentParser(description="Scrapling Spider framework crawl")
    p.add_argument("--url", required=True, help="Start URL")
    p.add_argument("--max-pages", type=int, default=20, help="Max pages (default 20)")
    p.add_argument("--concurrency", type=int, default=3, help="Concurrent requests (default 3)")
    p.add_argument("--pause-file", default=None, help="Touch this file to pause crawl")
    p.add_argument("--output-dir", required=True, help="Directory to save per-page .txt files")
    return p.parse_args()


def sanitize_filename(url):
    slug = re.sub(r"https?://", "", url)
    slug = re.sub(r"[^\w\-]", "_", slug)
    slug = re.sub(r"_+", "_", slug).strip("_")
    return slug[:120]


def should_pause(pause_file):
    if pause_file and os.path.exists(pause_file):
        return True
    return False


def crawl_with_fetcher(url, max_pages, concurrency, pause_file, output_dir):
    """Use Fetcher for fast HTTP-only crawling with domain boundary."""
    from urllib.parse import urlparse, urljoin
    from scrapling.fetchers import Fetcher

    os.makedirs(output_dir, exist_ok=True)
    parsed_base = urlparse(url)
    base_domain = parsed_base.netloc

    visited = set()
    queue = [url]
    pages = []
    i = 0

    while queue and len(pages) < max_pages:
        if pause_file and should_pause(pause_file):
            time.sleep(2)
            continue

        current_url = queue.pop(0)
        if current_url in visited:
            continue
        visited.add(current_url)

        try:
            page = Fetcher.get(current_url, stealthy_headers=True)
            status = page.status
        except Exception as e:
            pages.append({"url": current_url, "status": 0, "file": None, "error": str(e)})
            continue

        filename = f"page_{i:04d}.txt"
        filepath = os.path.join(output_dir, filename)
        text = page.get_all_text(strip=True) if hasattr(page, "get_all_text") else ""

        with open(filepath, "w", encoding="utf-8") as f:
            f.write(f"URL: {current_url}\nStatus: {status}\n\n{text}")

        pages.append({"url": current_url, "status": status, "file": filename})
        i += 1

        # Discover internal links
        for a in page.css("a[href]"):
            href = a.attrib.get("href", "")
            if not href:
                continue
            full_url = urljoin(current_url, href)
            parsed = urlparse(full_url)
            if parsed.netloc == base_domain and full_url not in visited:
                queue.append(full_url)

    return {
        "pages_crawled": len(pages),
        "pages": pages,
    }


def crawl_with_stealth(url, max_pages, concurrency, pause_file, output_dir):
    """Use StealthyFetcher for anti-bot-protected sites."""
    from urllib.parse import urlparse, urljoin
    from scrapling.fetchers import StealthyFetcher

    os.makedirs(output_dir, exist_ok=True)
    parsed_base = urlparse(url)
    base_domain = parsed_base.netloc

    visited = set()
    queue = [url]
    pages = []
    i = 0

    while queue and len(pages) < max_pages:
        if pause_file and should_pause(pause_file):
            time.sleep(2)
            continue

        current_url = queue.pop(0)
        if current_url in visited:
            continue
        visited.add(current_url)

        try:
            page = StealthyFetcher.fetch(current_url, headless=True, disable_resources=True)
            status = page.status
        except Exception as e:
            pages.append({"url": current_url, "status": 0, "file": None, "error": str(e)})
            continue

        filename = f"page_{i:04d}.txt"
        filepath = os.path.join(output_dir, filename)
        text = page.get_all_text(strip=True) if hasattr(page, "get_all_text") else ""

        with open(filepath, "w", encoding="utf-8") as f:
            f.write(f"URL: {current_url}\nStatus: {status}\n\n{text}")

        pages.append({"url": current_url, "status": status, "file": filename})
        i += 1

        for a in page.css("a[href]"):
            href = a.attrib.get("href", "")
            if not href:
                continue
            full_url = urljoin(current_url, href)
            parsed = urlparse(full_url)
            if parsed.netloc == base_domain and full_url not in visited:
                queue.append(full_url)

    return {
        "pages_crawled": len(pages),
        "pages": pages,
    }


def main():
    args = parse_args()
    try:
        out = crawl_with_fetcher(
            args.url, args.max_pages, args.concurrency,
            args.pause_file, args.output_dir,
        )
        print(json.dumps(out, ensure_ascii=False))
    except Exception as e:
        print(json.dumps({"pages_crawled": 0, "error_message": str(e)}))
        sys.exit(1)


if __name__ == "__main__":
    main()
