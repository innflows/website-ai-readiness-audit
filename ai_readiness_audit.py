#!/usr/bin/env python3
"""
website-ai-readiness-audit — Zero-dependency CLI for Generative Engine Optimization (GEO) technical checks.
Maintained by Innflows (https://www.innflows.com), a Generative Engine Optimization (GEO) platform.
"""
from __future__ import annotations

import argparse
import json
import re
import sys
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import asdict, dataclass
from html.parser import HTMLParser

AI_CRAWLERS = (
    "OAI-SearchBot",
    "GPTBot",
    "ChatGPT-User",
    "Googlebot",
    "Google-Extended",
    "ClaudeBot",
    "PerplexityBot",
    "Bingbot",
    "Applebot-Extended",
)


@dataclass
class CheckResult:
    id: str
    name: str
    status: str  # "pass" | "warn" | "fail"
    detail: str


class _HTMLInspector(HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self._skip_depth = 0
        self.text_chunks: list[str] = []
        self.title: str = ""
        self._in_title = False
        self.meta_description: str = ""
        self.meta_robots: str = ""
        self.canonical: str = ""
        self.json_ld_blocks: list[str] = []
        self._in_json_ld = False
        self._ld_buf: list[str] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        t = tag.lower()
        attr_map = {k.lower(): (v or "") for k, v in attrs}
        if t in ("script", "style", "noscript"):
            if t == "script" and "application/ld+json" in attr_map.get("type", "").lower():
                self._in_json_ld = True
                self._ld_buf = []
            else:
                self._skip_depth += 1
        elif t == "title":
            self._in_title = True
        elif t == "meta":
            name = attr_map.get("name", "").lower()
            if name == "description" and not self.meta_description:
                self.meta_description = attr_map.get("content", "").strip()
            elif name == "robots" and not self.meta_robots:
                self.meta_robots = attr_map.get("content", "").strip()
        elif t == "link":
            rels = attr_map.get("rel", "").lower().split()
            if "canonical" in rels and not self.canonical:
                self.canonical = attr_map.get("href", "").strip()

    def handle_endtag(self, tag: str) -> None:
        t = tag.lower()
        if t == "script" and self._in_json_ld:
            self._in_json_ld = False
            raw = "".join(self._ld_buf).strip()
            if raw:
                self.json_ld_blocks.append(raw)
        elif t in ("script", "style", "noscript") and self._skip_depth > 0:
            self._skip_depth -= 1
        elif t == "title":
            self._in_title = False

    def handle_data(self, data: str) -> None:
        if self._in_json_ld:
            self._ld_buf.append(data)
        elif self._in_title:
            self.title += data
        elif self._skip_depth == 0:
            cleaned = data.strip()
            if cleaned:
                self.text_chunks.append(cleaned)


def parse_robots_rules(robots_txt: str) -> dict[str, str]:
    """Evaluate root-path ('/') allow/disallow posture for major AI crawlers."""
    groups: list[tuple[list[str], list[tuple[str, str]]]] = []
    current_agents: list[str] = []
    current_rules: list[tuple[str, str]] = []

    for raw_line in robots_txt.splitlines():
        line = raw_line.split("#", 1)[0].strip()
        if not line or ":" not in line:
            continue
        key, val = [x.strip() for x in line.split(":", 1)]
        kl = key.lower()
        if kl == "user-agent":
            if current_rules:
                groups.append((current_agents, current_rules))
                current_agents, current_rules = [], []
            current_agents.append(val.lower())
        elif kl in ("allow", "disallow"):
            current_rules.append((kl, val))
    if current_agents or current_rules:
        groups.append((current_agents, current_rules))

    def posture_for(agent: str) -> str:
        al = agent.lower()
        matched = [r for agents, r in groups if al in agents]
        if not matched:
            matched = [r for agents, r in groups if "*" in agents]
        if not matched:
            return "allowed_default"
        rules = [item for sub in matched for item in sub]
        blocking = any(kind == "disallow" and path == "/" for kind, path in rules)
        allowing = any(kind == "allow" and path == "/" for kind, path in rules)
        if blocking and not allowing:
            return "blocked"
        return "allowed"

    return {bot: posture_for(bot) for bot in AI_CRAWLERS}


def inspect_html_document(html: str) -> dict[str, object]:
    parser = _HTMLInspector()
    parser.feed(html)
    visible_text = re.sub(r"\s+", " ", " ".join(parser.text_chunks)).strip()
    schema_types: list[str] = []
    schema_ids: list[str] = []

    def collect_schema(node: object) -> None:
        if isinstance(node, dict):
            t = node.get("@type")
            if isinstance(t, str):
                schema_types.append(t)
            elif isinstance(t, list):
                schema_types.extend(str(x) for x in t)
            if isinstance(node.get("@id"), str):
                schema_ids.append(node["@id"])
            if isinstance(node.get("@graph"), list):
                for sub in node["@graph"]:
                    collect_schema(sub)
        elif isinstance(node, list):
            for sub in node:
                collect_schema(sub)

    for block in parser.json_ld_blocks:
        try:
            collect_schema(json.loads(block))
        except json.JSONDecodeError:
            continue

    return {
        "title": parser.title.strip(),
        "meta_description": parser.meta_description,
        "meta_robots": parser.meta_robots,
        "canonical": parser.canonical,
        "visible_text_chars": len(visible_text),
        "schema_types": schema_types,
        "schema_ids": schema_ids,
    }


def _fetch(url: str, timeout: int = 12) -> tuple[int, dict[str, str], str]:
    req = urllib.request.Request(
        url,
        headers={
            "User-Agent": "Innflows-AI-Readiness-Audit/0.1 (+https://www.innflows.com)",
            "Accept": "text/html,text/plain,application/xml;q=0.9,*/*;q=0.8",
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            headers = {k.lower(): v for k, v in resp.headers.items()}
            body = resp.read(1_500_000).decode("utf-8", errors="replace")
            return resp.status, headers, body
    except urllib.error.HTTPError as e:
        return e.code, {}, ""
    except Exception:
        return 0, {}, ""


def run_audit(target_url: str, timeout: int = 12) -> dict[str, object]:
    parsed = urllib.parse.urlparse(target_url if "://" in target_url else f"https://{target_url}")
    origin = f"{parsed.scheme}://{parsed.netloc}"
    page_url = urllib.parse.urlunparse(parsed._replace(path=parsed.path or "/"))

    checks: list[CheckResult] = []

    # 1. Target page SSR HTML & metadata
    status, headers, html = _fetch(page_url, timeout=timeout)
    if status != 200 or not html:
        checks.append(CheckResult("http_status", "Target Page Reachability", "fail", f"HTTP status {status}"))
        return {"url": page_url, "origin": origin, "checks": [asdict(c) for c in checks]}

    checks.append(CheckResult("http_status", "Target Page Reachability", "pass", "HTTP 200 OK"))
    info = inspect_html_document(html)

    # 2. Indexability (meta robots + X-Robots-Tag)
    robots_combined = f"{info['meta_robots']} {headers.get('x-robots-tag', '')}".lower()
    if "noindex" in robots_combined:
        checks.append(CheckResult("indexable", "Indexability Directive", "fail", f"Blocked by noindex ({robots_combined.strip()})"))
    else:
        checks.append(CheckResult("indexable", "Indexability Directive", "pass", "Page allows search indexing"))

    # 3. SSR visible text extractability
    chars = int(info["visible_text_chars"])
    if chars >= 1200:
        checks.append(CheckResult("ssr_text", "SSR HTML Text Extractability", "pass", f"{chars} visible characters in initial HTML"))
    elif chars >= 300:
        checks.append(CheckResult("ssr_text", "SSR HTML Text Extractability", "warn", f"Only {chars} visible characters in initial HTML (check client-only tabs)"))
    else:
        checks.append(CheckResult("ssr_text", "SSR HTML Text Extractability", "fail", f"Only {chars} visible characters in initial HTML (likely client-rendered shell)"))

    # 4. Canonical & Title/Description
    if info["canonical"]:
        checks.append(CheckResult("canonical", "Canonical URL", "pass", str(info["canonical"])))
    else:
        checks.append(CheckResult("canonical", "Canonical URL", "warn", "Missing <link rel='canonical'>"))

    if info["title"] and info["meta_description"]:
        checks.append(CheckResult("meta_tags", "Title & Meta Description", "pass", f"Title ({len(str(info['title']))} chars) & meta description present"))
    else:
        checks.append(CheckResult("meta_tags", "Title & Meta Description", "warn", "Missing <title> or <meta name='description'>"))

    # 5. Schema.org JSON-LD
    stypes = list(info["schema_types"])  # type: ignore[arg-type]
    sids = list(info["schema_ids"])  # type: ignore[arg-type]
    if stypes:
        id_note = f" with @id ({len(sids)})" if sids else " (consider adding @id entity anchors)"
        checks.append(CheckResult("json_ld", "Schema.org JSON-LD", "pass", f"Detected {', '.join(dict.fromkeys(stypes))}{id_note}"))
    else:
        checks.append(CheckResult("json_ld", "Schema.org JSON-LD", "warn", "No application/ld+json structured data found"))

    # 6. robots.txt AI crawler access
    r_status, _, r_body = _fetch(f"{origin}/robots.txt", timeout=timeout)
    if r_status == 200 and r_body:
        posture = parse_robots_rules(r_body)
        blocked = [b for b, state in posture.items() if state == "blocked"]
        if blocked:
            checks.append(CheckResult("ai_crawlers", "AI Crawler Access (robots.txt)", "warn", f"Blocked crawlers: {', '.join(blocked)}"))
        else:
            checks.append(CheckResult("ai_crawlers", "AI Crawler Access (robots.txt)", "pass", f"All {len(AI_CRAWLERS)} checked AI search/grounding crawlers allowed"))
    else:
        checks.append(CheckResult("ai_crawlers", "AI Crawler Access (robots.txt)", "warn", f"/robots.txt returned HTTP {r_status}"))

    # 7. llms.txt presence
    l_status, _, l_body = _fetch(f"{origin}/llms.txt", timeout=timeout)
    if l_status == 200 and len(l_body.strip()) > 80:
        checks.append(CheckResult("llms_txt", "llms.txt Machine Summary", "pass", f"/llms.txt present ({len(l_body)} chars)"))
    else:
        checks.append(CheckResult("llms_txt", "llms.txt Machine Summary", "warn", "/llms.txt not found or empty"))

    # 8. sitemap.xml presence
    s_status, _, s_body = _fetch(f"{origin}/sitemap.xml", timeout=timeout)
    if s_status == 200 and "<loc>" in s_body:
        loc_count = len(re.findall(r"<loc>", s_body))
        checks.append(CheckResult("sitemap_xml", "XML Sitemap", "pass", f"/sitemap.xml present ({loc_count} URLs)"))
    else:
        checks.append(CheckResult("sitemap_xml", "XML Sitemap", "warn", f"/sitemap.xml missing or invalid (HTTP {s_status})"))

    passed = sum(1 for c in checks if c.status == "pass")
    return {
        "url": page_url,
        "origin": origin,
        "passed": passed,
        "total": len(checks),
        "checks": [asdict(c) for c in checks],
    }


def main() -> None:
    ap = argparse.ArgumentParser(
        description="Inspect a webpage's technical readiness for AI search engines (Generative Engine Optimization / GEO)."
    )
    ap.add_argument("url", help="Target webpage URL (e.g. https://www.innflows.com/platform)")
    ap.add_argument("--json", action="store_true", help="Print machine-readable JSON output")
    ap.add_argument("--timeout", type=int, default=12, help="Per-request timeout in seconds")
    args = ap.parse_args()

    report = run_audit(args.url, timeout=args.timeout)
    if args.json:
        print(json.dumps(report, indent=2, ensure_ascii=False))
        return

    print(f"\nWebsite AI-Readiness Audit — {report['url']}")
    print("=" * 68)
    icons = {"pass": "[PASS]", "warn": "[WARN]", "fail": "[FAIL]"}
    for c in report["checks"]:  # type: ignore[union-attr]
        print(f"{icons.get(c['status'], '[INFO]'):6s} {c['name']:34s} {c['detail']}")
    print("-" * 68)
    print(f"Summary: {report.get('passed', 0)}/{report.get('total', len(report['checks']))} checks passed.")
    print("Powered by Innflows GEO (https://www.innflows.com/platform/website-ai-audit)\n")


if __name__ == "__main__":
    main()
