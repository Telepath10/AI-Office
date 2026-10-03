#!/usr/bin/env python3
"""Crawl4AI single-page scrape — returns LLM-optimized markdown + metadata as JSON."""

import argparse
import asyncio
import json
import sys

from crawl4ai import AsyncWebCrawler, BrowserConfig, CrawlerRunConfig, CacheMode
from crawl4ai.markdown_generation_strategy import DefaultMarkdownGenerator
from crawl4ai.content_filter_strategy import PruningContentFilter


def parse_args():
    p = argparse.ArgumentParser(description="Crawl4AI single-page scrape")
    p.add_argument("--url", required=True, help="Target URL")
    p.add_argument("--css-selector", default=None, help="CSS selector to extract")
    p.add_argument("--wait-for", default=None, help="Wait condition (e.g. css:.loaded)")
    p.add_argument("--screenshot", action="store_true", help="Capture screenshot")
    p.add_argument("--cache-bypass", action="store_true", help="Bypass cache")
    return p.parse_args()


async def scrape(url, css_selector=None, wait_for=None, screenshot=False, cache_bypass=False):
    browser_cfg = BrowserConfig(headless=True, verbose=False)
    run_cfg = CrawlerRunConfig(
        cache_mode=CacheMode.BYPASS if cache_bypass else CacheMode.ENABLED,
        css_selector=css_selector,
        wait_for=wait_for,
        screenshot=screenshot,
        word_count_threshold=10,
        markdown_generator=DefaultMarkdownGenerator(
            content_filter=PruningContentFilter(
                threshold=0.48, threshold_type="fixed", min_word_threshold=0
            )
        ),
    )

    async with AsyncWebCrawler(config=browser_cfg) as crawler:
        result = await crawler.arun(url=url, config=run_cfg)

        if not result.success:
            return {"url": url, "success": False, "error_message": result.error_message}

        out = {
            "url": result.url,
            "success": True,
            "markdown": result.markdown.raw_markdown if result.markdown else "",
            "fit_markdown": result.markdown.fit_markdown if result.markdown else "",
            "cleaned_html": result.cleaned_html or "",
            "title": result.metadata.get("title", "") if result.metadata else "",
            "links": [],
            "media": [],
        }

        if result.links:
            out["links"] = [
                {"text": lnk.get("text", ""), "href": lnk.get("href", "")}
                for lnk in (result.links.get("internal", []) + result.links.get("external", []))
            ]

        if result.media:
            out["media"] = [
                {"type": m.get("type", ""), "src": m.get("src", ""), "alt": m.get("alt", "")}
                for m in result.media.get("images", [])
            ]

        if screenshot and result.screenshot:
            out["screenshot_base64_length"] = len(result.screenshot)

        return out


def main():
    args = parse_args()
    try:
        out = asyncio.run(scrape(
            args.url,
            css_selector=args.css_selector,
            wait_for=args.wait_for,
            screenshot=args.screenshot,
            cache_bypass=args.cache_bypass,
        ))
        print(json.dumps(out, ensure_ascii=False))
    except Exception as e:
        print(json.dumps({"url": args.url, "success": False, "error_message": str(e)}))
        sys.exit(1)


if __name__ == "__main__":
    main()
