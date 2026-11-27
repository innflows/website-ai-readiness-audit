#!/usr/bin/env python3
"""
website-ai-readiness-audit v0.3.0 — Zero-dependency GEO & AEO CLI toolkit.
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

VERSION = "0.3.0"

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

PROBE_USER_AGENTS = {
    "Browser-Baseline": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    "OAI-SearchBot": "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko); compatible; OAI-SearchBot/1.0; +https://openai.com/searchbot",
    "GPTBot": "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko); compatible; GPTBot/1.1; +https://openai.com/gptbot",
    "ChatGPT-User": "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko); compatible; ChatGPT-User/1.0; +https://openai.com/bot",
    "ClaudeBot": "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; ClaudeBot/1.0; +claudebot@anthropic.com)",
    "PerplexityBot": "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; PerplexityBot/1.0; +https://perplexity.ai/perplexitybot)",
    "Google-Extended": "Mozilla/5.0 (compatible; Google-Extended/1.0; +http://www.google.com/bot.html)",
    "Applebot-Extended": "Mozilla/5.0 (Applebot-Extended/0.3; +http://www.apple.com/go/applebot)",
}


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


def extract_schema_graph_from_html(html: str) -> dict[str, object]:
    parser = _HTMLInspector()
    parser.feed(html)
    entities: list[dict[str, object]] = []
    defined_ids: set[str] = set()
    referenced_ids: set[str] = set()
    same_as_urls: set[str] = set()
    parse_errors = 0

    def walk(node: object) -> None:
        if isinstance(node, list):
            for sub in node:
                walk(sub)
            return
        if not isinstance(node, dict):
            return
        if isinstance(node.get("@graph"), list):
            for sub in node["@graph"]:
                walk(sub)
        raw_t = node.get("@type")
        types = [raw_t] if isinstance(raw_t, str) else [str(x) for x in raw_t] if isinstance(raw_t, list) else []
        node_id = node.get("@id").strip() if isinstance(node.get("@id"), str) else ""
        if node_id and not types and len(node) <= 2:
            referenced_ids.add(node_id)
            return
        if node_id:
            defined_ids.add(node_id)
        if types:
            sa = node.get("sameAs")
            sa_list = [sa.strip()] if isinstance(sa, str) and sa.strip() else [x.strip() for x in sa if isinstance(x, str) and x.strip()] if isinstance(sa, list) else []
            for u in sa_list:
                same_as_urls.add(u)
            entities.append({
                "types": types,
                "id": node_id or None,
                "name": node.get("name") if isinstance(node.get("name"), str) else node.get("headline") if isinstance(node.get("headline"), str) else None,
                "sameAsCount": len(sa_list),
            })
        for k, v in node.items():
            if k in ("@graph", "@context", "@type", "@id"):
                continue
            if isinstance(v, (dict, list)):
                walk(v)

    for block in parser.json_ld_blocks:
        try:
            walk(json.loads(block))
        except json.JSONDecodeError:
            parse_errors += 1

    all_types = [t for e in entities for t in e["types"]]  # type: ignore[union-attr]
    dangling = sorted(r for r in referenced_ids if "#" in r and r not in defined_ids)
    return {
        "blocks_count": len(parser.json_ld_blocks),
        "parse_errors": parse_errors,
        "entities": entities,
        "schema_types": all_types,
        "unique_types": list(dict.fromkeys(all_types)),
        "defined_ids": sorted(defined_ids),
        "dangling_ids": dangling,
        "same_as_urls": sorted(same_as_urls),
    }


def inspect_html_document(html: str) -> dict[str, object]:
    parser = _HTMLInspector()
    parser.feed(html)
    visible_text = re.sub(r"\s+", " ", " ".join(parser.text_chunks)).strip()
    graph = extract_schema_graph_from_html(html)
    return {
        "title": parser.title.strip(),
        "meta_description": parser.meta_description,
        "meta_robots": parser.meta_robots,
        "canonical": parser.canonical,
        "visible_text_chars": len(visible_text),
        "schema_types": graph["schema_types"],
        "schema_ids": graph["defined_ids"],
    }


def parse_llms_txt_document(content: str) -> dict[str, object]:
    trimmed = content.strip()
    looks_html = bool(re.match(r"^(<!doctype\s+html|<html\b)", trimmed, flags=re.IGNORECASE))
    h1_title = ""
    blockquote = ""
    sections: list[str] = []
    links: list[dict[str, str]] = []
    current_sec = "Root"
    md_link_re = re.compile(r"^\s*[-*]\s+\[([^\]]+)\]\((https?://[^)\s]+)\)(?:\s*(?::|—|–|-)\s*(.*))?$")
    bare_link_re = re.compile(r"^\s*[-*]\s+([^:\n]+?):\s+(https?://[^\s)]+)(?:\s*(?:—|–|-)\s*(.*))?$")

    for line in content.splitlines():
        t = line.strip()
        if not h1_title and t.startswith("# ") and not t.startswith("##"):
            h1_title = t[2:].strip()
            continue
        if not blockquote and t.startswith("> "):
            blockquote = t[2:].strip()
            continue
        if t.startswith("## "):
            current_sec = t[3:].strip()
            sections.append(current_sec)
            continue
        m = md_link_re.match(line) or bare_link_re.match(line)
        if m:
            links.append({
                "section": current_sec,
                "title": m.group(1).strip("* ").strip(),
                "url": m.group(2).strip(),
                "description": (m.group(3) or "").strip(),
            })

    issues: list[str] = []
    if not trimmed:
        issues.append("Empty /llms.txt body")
    if looks_html:
        issues.append("Response is an HTML document (SPA soft-200 fallback) instead of plain Markdown")
    elif trimmed:
        if not h1_title:
            issues.append("Missing required top-level '# Title' H1 heading")
        if not links:
            issues.append("No Markdown list links found")

    return {
        "valid_spec": (not looks_html) and bool(h1_title) and len(links) > 0,
        "is_html_fallback": looks_html,
        "char_length": len(content),
        "h1_title": h1_title or None,
        "blockquote_summary": blockquote or None,
        "sections": sections,
        "links_count": len(links),
        "links": links,
        "issues": issues,
    }


def _fetch(url: str, timeout: int = 12, user_agent: str | None = None) -> tuple[int, dict[str, str], str]:
    req = urllib.request.Request(
        url,
        headers={
            "User-Agent": user_agent or f"Innflows-AI-Readiness-Audit/{VERSION} (+https://www.innflows.com)",
            "Accept": "text/html,text/plain,application/xml;q=0.9,*/*;q=0.8",
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            headers = {k.lower(): v for k, v in resp.headers.items()}
            body = resp.read(1_500_000).decode("utf-8", errors="replace")
            return resp.status, headers, body
    except urllib.error.HTTPError as e:
        headers = {k.lower(): v for k, v in e.headers.items()} if e.headers else {}
        try:
            body = e.read(64_000).decode("utf-8", errors="replace")
        except Exception:
            body = ""
        return e.code, headers, body
    except Exception:
        return 0, {}, ""


def detect_waf_challenge(status: int, headers: dict[str, str], body: str) -> str | None:
    lower = body[:8000].lower()
    if "challenge" in headers.get("cf-mitigated", "").lower():
        return "cloudflare_challenge_header"
    if status in (403, 429, 503) and any(
        tok in lower
        for tok in ("just a moment...", "cf-browser-verification", "challenge-platform", "access denied", "bot verification")
    ):
        return "waf_or_bot_challenge"
    if status == 403:
        return "http_403_forbidden"
    if status == 429:
        return "http_429_rate_limited"
    return None


def run_audit(target_url: str, timeout: int = 12) -> dict[str, object]:
    parsed = urllib.parse.urlparse(target_url if "://" in target_url else f"https://{target_url}")
    origin = f"{parsed.scheme}://{parsed.netloc}"
    page_url = urllib.parse.urlunparse(parsed._replace(path=parsed.path or "/"))

    checks: list[CheckResult] = []

    status, headers, html = _fetch(page_url, timeout=timeout)
    if status != 200 or not html:
        checks.append(CheckResult("http_status", "Target Page Reachability", "fail", f"HTTP status {status}"))
        return {"url": page_url, "origin": origin, "score": 0, "passed": 0, "total": len(checks), "checks": [asdict(c) for c in checks]}

    checks.append(CheckResult("http_status", "Target Page Reachability", "pass", "HTTP 200 OK"))
    info = inspect_html_document(html)

    robots_combined = f"{info['meta_robots']} {headers.get('x-robots-tag', '')}".lower()
    if "noindex" in robots_combined:
        checks.append(CheckResult("indexable", "Indexability Directive", "fail", f"Blocked by noindex ({robots_combined.strip()})"))
    else:
        checks.append(CheckResult("indexable", "Indexability Directive", "pass", "Page allows search indexing"))

    chars = int(info["visible_text_chars"])  # type: ignore[arg-type]
    if chars >= 1200:
        checks.append(CheckResult("ssr_text", "SSR HTML Text Extractability", "pass", f"{chars} visible characters in initial HTML"))
    elif chars >= 300:
        checks.append(CheckResult("ssr_text", "SSR HTML Text Extractability", "warn", f"Only {chars} visible characters in initial HTML (check client-only tabs)"))
    else:
        checks.append(CheckResult("ssr_text", "SSR HTML Text Extractability", "fail", f"Only {chars} visible characters in initial HTML (likely client-rendered shell)"))

    if info["canonical"]:
        checks.append(CheckResult("canonical", "Canonical URL", "pass", str(info["canonical"])))
    else:
        checks.append(CheckResult("canonical", "Canonical URL", "warn", "Missing <link rel='canonical'>"))

    if info["title"] and info["meta_description"]:
        checks.append(CheckResult("meta_tags", "Title & Meta Description", "pass", f"Title ({len(str(info['title']))} chars) & meta description present"))
    else:
        checks.append(CheckResult("meta_tags", "Title & Meta Description", "warn", "Missing <title> or <meta name='description'>"))

    stypes = list(info["schema_types"])  # type: ignore[arg-type]
    sids = list(info["schema_ids"])  # type: ignore[arg-type]
    if stypes:
        id_note = f" with @id ({len(sids)})" if sids else " (consider adding @id entity anchors)"
        checks.append(CheckResult("json_ld", "Schema.org JSON-LD", "pass", f"Detected {', '.join(dict.fromkeys(stypes))}{id_note}"))
    else:
        checks.append(CheckResult("json_ld", "Schema.org JSON-LD", "warn", "No application/ld+json structured data found"))

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

    l_status, _, l_body = _fetch(f"{origin}/llms.txt", timeout=timeout)
    if l_status == 200 and len(l_body.strip()) > 80:
        parsed_llms = parse_llms_txt_document(l_body)
        if parsed_llms["is_html_fallback"]:
            checks.append(CheckResult("llms_txt", "llms.txt Machine Summary", "warn", "/llms.txt returns HTML fallback instead of plain Markdown"))
        else:
            checks.append(CheckResult("llms_txt", "llms.txt Machine Summary", "pass", f"/llms.txt present ({len(l_body)} chars, {parsed_llms['links_count']} links)"))
    else:
        checks.append(CheckResult("llms_txt", "llms.txt Machine Summary", "warn", "/llms.txt not found or empty"))

    s_status, _, s_body = _fetch(f"{origin}/sitemap.xml", timeout=timeout)
    if s_status == 200 and "<loc>" in s_body:
        loc_count = len(re.findall(r"<loc>", s_body))
        checks.append(CheckResult("sitemap_xml", "XML Sitemap", "pass", f"/sitemap.xml present ({loc_count} URLs)"))
    else:
        checks.append(CheckResult("sitemap_xml", "XML Sitemap", "warn", f"/sitemap.xml missing or invalid (HTTP {s_status})"))

    passed = sum(1 for c in checks if c.status == "pass")
    score = round((passed / len(checks)) * 100)
    return {
        "url": page_url,
        "origin": origin,
        "score": score,
        "passed": passed,
        "total": len(checks),
        "checks": [asdict(c) for c in checks],
    }


def probe_crawler_access(target_url: str, timeout: int = 12) -> dict[str, object]:
    parsed = urllib.parse.urlparse(target_url if "://" in target_url else f"https://{target_url}")
    origin = f"{parsed.scheme}://{parsed.netloc}"
    page_url = urllib.parse.urlunparse(parsed._replace(path=parsed.path or "/"))
    r_status, _, r_body = _fetch(f"{origin}/robots.txt", timeout=timeout)
    posture = parse_robots_rules(r_body) if r_status == 200 and r_body else {}

    probes: list[dict[str, object]] = []
    silent_blocked: list[str] = []
    for bot_name, ua in PROBE_USER_AGENTS.items():
        st, hdrs, body = _fetch(page_url, timeout=timeout, user_agent=ua)
        chars = int(inspect_html_document(body)["visible_text_chars"]) if body else 0  # type: ignore[arg-type]
        waf = detect_waf_challenge(st, hdrs, body)
        rule = "n/a" if bot_name == "Browser-Baseline" else posture.get(bot_name, "unknown")
        silent = bot_name != "Browser-Baseline" and rule != "blocked" and (st != 200 or bool(waf))
        if silent:
            silent_blocked.append(bot_name)
        probes.append({
            "agent": bot_name,
            "robots_txt_posture": rule,
            "http_status": st,
            "visible_text_chars": chars,
            "waf_diagnosis": waf,
            "silent_waf_block": silent,
        })

    return {
        "url": page_url,
        "origin": origin,
        "robots_txt_status": r_status,
        "silent_waf_blocks_detected": len(silent_blocked) > 0,
        "silent_blocked_agents": silent_blocked,
        "probes": probes,
    }


def main() -> None:
    ap = argparse.ArgumentParser(
        description="Inspect website AI search readiness, live AI crawler WAF posture, llms.txt, and Schema.org entity graphs."
    )
    ap.add_argument("target", nargs="+", help="Subcommand (audit|probe-crawlers|schema-graph) + URL, or direct URL")
    ap.add_argument("--json", action="store_true", help="Print machine-readable JSON output")
    ap.add_argument("--timeout", type=int, default=12, help="Per-request timeout in seconds")
    ap.add_argument("--fail-under", type=int, default=None, help="Exit with code 2 if score < threshold")
    args = ap.parse_args()

    known_cmds = {"audit", "probe-crawlers", "schema-graph"}
    if args.target[0] in known_cmds:
        cmd = args.target[0]
        urls = args.target[1:]
    else:
        cmd = "audit"
        urls = args.target

    if not urls:
        ap.error("Missing target URL")

    if cmd == "probe-crawlers":
        res = probe_crawler_access(urls[0], timeout=args.timeout)
        print(json.dumps(res, indent=2, ensure_ascii=False))
        if args.fail_under is not None and res["silent_waf_blocks_detected"]:
            sys.exit(2)
        return

    if cmd == "schema-graph":
        st, _, html = _fetch(urls[0] if "://" in urls[0] else f"https://{urls[0]}", timeout=args.timeout)
        res = extract_schema_graph_from_html(html) if st == 200 else {"http_status": st}
        print(json.dumps(res, indent=2, ensure_ascii=False))
        return

    report = run_audit(urls[0], timeout=args.timeout)
    if args.json:
        print(json.dumps(report, indent=2, ensure_ascii=False))
    else:
        print(f"\nWebsite AI-Readiness Audit — {report['url']}")
        print("=" * 68)
        icons = {"pass": "[PASS]", "warn": "[WARN]", "fail": "[FAIL]"}
        for c in report["checks"]:  # type: ignore[union-attr]
            print(f"{icons.get(c['status'], '[INFO]'):6s} {c['name']:34s} {c['detail']}")
        print("-" * 68)
        print(f"Summary: {report.get('passed', 0)}/{report.get('total', len(report['checks']))} checks passed (Score: {report.get('score', 0)}/100).")
        print("Powered by Innflows GEO (https://www.innflows.com/platform/website-ai-audit)\n")

    if args.fail_under is not None and int(report.get("score", 0)) < args.fail_under:  # type: ignore[arg-type]
        sys.exit(2)


if __name__ == "__main__":
    main()
