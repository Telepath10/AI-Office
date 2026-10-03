#!/usr/bin/env python3
"""Crawl4AI deep crawl — BFS/DFS/BestFirst full-site crawl, saves per-page markdown."""

import argparse
import asyncio
import json
import os
import re
import sys

from crawl4ai import AsyncWebCrawler, BrowserConfig, CrawlerRunConfig, CacheMode
from crawl4ai.content_scraping_strategy import LXMLWebScrapingStrategy
from crawl4ai.deep_crawling import BFSDeepCrawlStrategy, DFSDeepCrawlStrategy, BestFirstCrawlingStrategy
from crawl4ai.deep_crawling.scorers import KeywordRelevanceScorer


def parse_args():
    p = argparse.ArgumentParser(description="Crawl4AI deep crawl")
    p.add_argument("--url", required=True, help="Start URL")
    p.add_argument("--max-depth", type=int, default=2, help="Crawl depth (default 2)")
    p.add_argument("--max-pages", type=int, default=50, help="Max pages (default 50)")
    p.add_argument("--strategy", choices=["bfs", "dfs", "best-first"], default="bfs",
                    help="Crawl strategy (default bfs)")
    p.add_argument("--keywords", default=None, help="Comma-separated keywords for BestFirst scorer")
    p.add_argument("--output-dir", required=True, help="Directory to save per-page .md files")
    return p.parse_args()


def sanitize_filename(url):
    slug = re.sub(r"https?://", "", url)
    slug = re.sub(r"[^\w\-]", "_", slug)
    slug = re.sub(r"_+", "_", slug).strip("_")
    return slug[:120]


async def deep_crawl(url, max_depth, max_pages, strategy, keywords, output_dir):
    os.makedirs(output_dir, exist_ok=True)

    if strategy == "dfs":
        crawl_strategy = DFSDeepCrawlStrategy(
            max_depth=max_depth, include_external=False, max_pages=max_pages
        )
    elif strategy == "best-first" and keywords:
        kw_list = [k.strip() for k in keywords.split(",") if k.strip()]
        scorer = KeywordRelevanceScorer(keywords=kw_list, weight=0.7)
        crawl_strategy = BestFirstCrawlingStrategy(
            max_depth=max_depth, include_external=False, max_pages=max_pages, url_scorer=scorer
        )
    else:
        crawl_strategy = BFSDeepCrawlStrategy(
            max_depth=max_depth, include_external=False, max_pages=max_pages
        )

    run_cfg = CrawlerRunConfig(
        deep_crawl_strategy=crawl_strategy,
        scraping_strategy=LXMLWebScrapingStrategy(),
        cache_mode=CacheMode.BYPASS,
        word_count_threshold=10,
    )

    browser_cfg = BrowserConfig(headless=True, verbose=False)

    pages = []
    async with AsyncWebCrawler(config=browser_cfg) as crawler:
        results = await crawler.arun(url=url, config=run_cfg)

        for i, result in enumerate(results):
            if not result.success:
                continue

            filename = f"page_{i:04d}.md"
            filepath = os.path.join(output_dir, filename)
            md_content = result.markdown.raw_markdown if result.markdown else ""

            with open(filepath, "w", encoding="utf-8") as f:
                f.write(f"# {result.url}\n\n{md_content}")

            depth = result.metadata.get("depth", 0) if result.metadata else 0
            score = result.metadata.get("score", 0.0) if result.metadata else 0.0

            pages.append({
                "url": result.url,
                "depth": depth,
                "score": round(score, 4),
                "file": filename,
                "markdown_length": len(md_content),
            })

    return {
        "pages_crawled": len(pages),
        "strategy": strategy,
        "pages": pages,
    }


def main():
    args = parse_args()
    try:
        out = asyncio.run(deep_crawl(
            args.url, args.max_depth, args.max_pages,
            args.strategy, args.keywords, args.output_dir,
        ))
        print(json.dumps(out, ensure_ascii=False))
    except Exception as e:
        print(json.dumps({"pages_crawled": 0, "error_message": str(e)}))
        sys.exit(1)


if __name__ == "__main__":
    main()
