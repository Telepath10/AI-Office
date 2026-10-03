#!/usr/bin/env python3
"""Scrapling single-page fetch — HTTP / Stealth / Dynamic with anti-bot bypass."""

import argparse
import json
import sys


def parse_args():
    p = argparse.ArgumentParser(description="Scrapling single-page fetch")
    p.add_argument("--url", required=True, help="Target URL")
    p.add_argument("--mode", choices=["http", "stealth", "dynamic"], default="stealth",
                    help="Fetch mode (default stealth)")
    p.add_argument("--solve-cloudflare", action="store_true", help="Auto-solve Cloudflare Turnstile")
    p.add_argument("--disable-resources", action="store_true", help="Block images/fonts/etc")
    p.add_argument("--proxy", default=None, help="Proxy URL (e.g. http://user:pass@host:port)")
    p.add_argument("--css-selector", default=None, help="Extract matching elements as text")
    return p.parse_args()


def extract_meta(page):
    meta = {}
    for tag in page.css("meta"):
        name = tag.attrib.get("name", "") or tag.attrib.get("property", "")
        content = tag.attrib.get("content", "")
        if name and content:
            meta[name] = content
    title_tag = page.css("title")
    meta["title"] = title_tag[0].text.strip() if title_tag else ""
    return meta


def extract_links(page):
    links = []
    for a in page.css("a[href]"):
        text = a.text.strip() if a.text else ""
        href = a.attrib.get("href", "")
        if href:
            links.append({"text": text, "href": href})
    return links


def fetch_http(url, css_selector=None, disable_resources=False, proxy=None):
    from scrapling.fetchers import Fetcher

    kwargs = {}
    if proxy:
        kwargs["proxy"] = proxy
    if disable_resources:
        kwargs["disable_resources"] = True

    page = Fetcher.get(url, **kwargs)

    out = {
        "url": url,
        "status": page.status,
        "text": page.get_all_text(strip=True) if css_selector is None else "",
        "html": page.html_content if css_selector is None else "",
        "title": "",
        "links": [],
        "meta": {},
    }

    if css_selector:
        elements = page.css(css_selector)
        out["text"] = "\n".join(el.get_all_text(strip=True) for el in elements)

    out["title"] = (page.css("title")[0].text.strip() if page.css("title") else "")
    out["links"] = extract_links(page)
    out["meta"] = extract_meta(page)

    return out


def fetch_stealth(url, css_selector=None, solve_cloudflare=False,
                  disable_resources=False, proxy=None):
    from scrapling.fetchers import StealthyFetcher

    kwargs = {"headless": True}
    if solve_cloudflare:
        kwargs["solve_cloudflare"] = True
    if disable_resources:
        kwargs["disable_resources"] = True
    if proxy:
        kwargs["proxy"] = proxy

    page = StealthyFetcher.fetch(url, **kwargs)

    out = {
        "url": url,
        "status": page.status,
        "text": page.get_all_text(strip=True) if css_selector is None else "",
        "html": page.html_content if css_selector is None else "",
        "title": "",
        "links": [],
        "meta": {},
    }

    if css_selector:
        elements = page.css(css_selector)
        out["text"] = "\n".join(el.get_all_text(strip=True) for el in elements)

    out["title"] = (page.css("title")[0].text.strip() if page.css("title") else "")
    out["links"] = extract_links(page)
    out["meta"] = extract_meta(page)

    return out


def fetch_dynamic(url, css_selector=None, proxy=None):
    from scrapling.fetchers import DynamicFetcher

    kwargs = {"headless": True}
    if proxy:
        kwargs["proxy"] = proxy

    page = DynamicFetcher.fetch(url, **kwargs)

    out = {
        "url": url,
        "status": page.status,
        "text": page.get_all_text(strip=True) if css_selector is None else "",
        "html": page.html_content if css_selector is None else "",
        "title": "",
        "links": [],
        "meta": {},
    }

    if css_selector:
        elements = page.css(css_selector)
        out["text"] = "\n".join(el.get_all_text(strip=True) for el in elements)

    out["title"] = (page.css("title")[0].text.strip() if page.css("title") else "")
    out["links"] = extract_links(page)
    out["meta"] = extract_meta(page)

    return out


def main():
    args = parse_args()
    try:
        if args.mode == "http":
            out = fetch_http(args.url, args.css_selector, args.disable_resources, args.proxy)
        elif args.mode == "stealth":
            out = fetch_stealth(args.url, args.css_selector, args.solve_cloudflare,
                                args.disable_resources, args.proxy)
        else:
            out = fetch_dynamic(args.url, args.css_selector, args.proxy)

        print(json.dumps(out, ensure_ascii=False))
    except Exception as e:
        print(json.dumps({"url": args.url, "status": 0, "error_message": str(e)}))
        sys.exit(1)


if __name__ == "__main__":
    main()
