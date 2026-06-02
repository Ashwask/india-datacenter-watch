#!/usr/bin/env python3
"""Check every cited source URL across the project.

Collects URLs from:
  - data/datacenters.csv      (source column)
  - web/impact_data.js        (url fields)
  - web/response_data.js      (url fields — actions + partners)
  - web/index.html            (article/source links, minus CDN assets)

Classifies each:
  OK       2xx / 3xx
  BLOCKED  401/403/405/429/503 — likely bot protection (warn, not fail)
  DEAD     404/410, DNS / connection failure (FAIL)
  ERROR    timeout / other (warn)

Also reports how many citations come from aggregator domains (source-quality skew).

Exit code: non-zero only if any DEAD links are found (so CI flags genuinely broken
sources without failing on sites that merely block bots).

Usage:
  python3 scripts/check_links.py [--timeout 12] [--workers 16] [--warn-only]
"""
from __future__ import annotations

import argparse
import csv
import re
import ssl
import sys
import urllib.request
import urllib.error
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from urllib.parse import urlparse

ROOT = Path(__file__).resolve().parent.parent
UA = ("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/124.0 Safari/537.36")

# Third-party listing aggregators (vs. primary operator / regulator / news sources).
AGGREGATORS = {"baxtel.com", "datacentermap.com", "datacenters.com", "cloudscene.com"}
# Asset/CDN domains we don't treat as citations.
ASSET_DOMAINS = {"unpkg.com", "cdn.jsdelivr.net", "basemaps.cartocdn.com"}

URL_RE = re.compile(r'https?://[^\s"\'<>)]+')


def host(url: str) -> str:
    return urlparse(url).netloc.replace("www.", "")


def collect() -> dict[str, list[str]]:
    """Return {url: [sources that cite it]}."""
    found: dict[str, set[str]] = {}

    def add(url: str, origin: str):
        url = url.strip().rstrip(".,);")
        if not url.startswith("http"):
            return
        if host(url) in ASSET_DOMAINS:
            return
        found.setdefault(url, set()).add(origin)

    csv_path = ROOT / "data" / "datacenters.csv"
    if csv_path.exists():
        for r in csv.DictReader(csv_path.open(newline="", encoding="utf-8")):
            add(r.get("source", ""), "datacenters.csv")

    for fn in ("web/impact_data.js", "web/response_data.js"):
        p = ROOT / fn
        if p.exists():
            for m in re.finditer(r'url:\s*"([^"]+)"', p.read_text(encoding="utf-8")):
                add(m.group(1), fn)

    html = ROOT / "web" / "index.html"
    if html.exists():
        for m in re.finditer(r'href="(https?://[^"]+)"', html.read_text(encoding="utf-8")):
            add(m.group(1), "index.html")

    return {u: sorted(v) for u, v in found.items()}


def _open(url: str, timeout: int, ctx=None):
    req = urllib.request.Request(url, method="GET", headers={
        "User-Agent": UA, "Accept": "*/*", "Accept-Language": "en",
    })
    return urllib.request.urlopen(req, timeout=timeout, context=ctx)


def check(url: str, timeout: int) -> tuple[str, int | str]:
    try:
        with _open(url, timeout) as resp:
            resp.read(1)
            return ("OK", resp.status)
    except urllib.error.HTTPError as e:
        if e.code in (401, 403, 405, 429, 503):
            return ("BLOCKED", e.code)
        if e.code in (404, 410):
            return ("DEAD", e.code)
        return ("ERROR", e.code)
    except (urllib.error.URLError, TimeoutError, ConnectionError) as e:
        reason = getattr(e, "reason", e)
        s = str(reason).lower()
        # TLS chain issues (common on Indian .gov.in / .nic.in sites): the page is
        # live in a browser, only Python's strict cert verification fails. Retry
        # without verification to confirm it actually serves, then flag as TLS.
        if "certificate" in s or "ssl" in s or isinstance(reason, ssl.SSLError):
            try:
                with _open(url, timeout, ctx=ssl._create_unverified_context()) as resp:
                    resp.read(1)
                    return ("TLS", resp.status)
            except urllib.error.HTTPError as e2:
                return ("TLS" if e2.code in (401, 403, 405, 429, 503) else "DEAD", e2.code)
            except Exception:  # noqa: BLE001
                return ("DEAD", "tls+unreachable")
        if "timed out" in s or "timeout" in s:
            return ("ERROR", "timeout")
        return ("DEAD", str(reason)[:60])
    except Exception as e:  # noqa: BLE001
        return ("ERROR", str(e)[:60])


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--timeout", type=int, default=12)
    ap.add_argument("--workers", type=int, default=16)
    ap.add_argument("--warn-only", action="store_true", help="never exit non-zero")
    args = ap.parse_args()

    urls = collect()
    if not urls:
        print("No URLs found.")
        return 0
    print(f"Checking {len(urls)} unique source URLs…\n")

    results: dict[str, tuple[str, int | str]] = {}
    with ThreadPoolExecutor(max_workers=args.workers) as ex:
        for url, res in zip(urls, ex.map(lambda u: check(u, args.timeout), urls)):
            results[url] = res

    buckets: dict[str, list[str]] = {"OK": [], "BLOCKED": [], "TLS": [], "DEAD": [], "ERROR": []}
    for url, (status, code) in results.items():
        buckets[status].append(f"{code}\t{url}")

    for status in ("DEAD", "ERROR", "TLS", "BLOCKED", "OK"):
        rows = buckets[status]
        icon = {"OK": "✓", "BLOCKED": "▲", "TLS": "⚿", "DEAD": "✗", "ERROR": "…"}[status]
        print(f"{icon} {status}: {len(rows)}")
        if status in ("DEAD", "ERROR", "TLS", "BLOCKED"):
            for row in sorted(rows):
                print(f"    {row}")

    # Source-quality skew.
    agg = {}
    for url in urls:
        h = host(url)
        if h in AGGREGATORS:
            agg[h] = agg.get(h, 0) + 1
    total = len(urls)
    agg_total = sum(agg.values())
    print(f"\nAggregator-sourced URLs: {agg_total}/{total} "
          f"({round(100 * agg_total / total)}%) — {agg or 'none'}")

    dead = len(buckets["DEAD"])
    print(f"\nSummary: {len(buckets['OK'])} OK · {len(buckets['BLOCKED'])} blocked · "
          f"{len(buckets['TLS'])} tls-only · {len(buckets['ERROR'])} transient · {dead} dead")

    if dead and not args.warn_only:
        print(f"\nFAIL: {dead} dead link(s). Fix or replace the source(s) above.")
        return 1
    print("\nNo dead links." if not dead else "\n(warn-only: not failing)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
