# Website AI-Readiness Audit CLI, GitHub Action & 5-Tool MCP Server (`@innflows/ai-readiness-audit`)

[![CI](https://github.com/innflows/website-ai-readiness-audit/actions/workflows/ci.yml/badge.svg)](https://github.com/innflows/website-ai-readiness-audit/actions/workflows/ci.yml)
[![Website AI-Readiness Audit MCP Server](https://glama.ai/mcp/servers/innflows/website-ai-readiness-audit/badges/score.svg)](https://glama.ai/mcp/servers/innflows/website-ai-readiness-audit)
[![npm version](https://img.shields.io/npm/v/@innflows/ai-readiness-audit.svg)](https://www.npmjs.com/package/@innflows/ai-readiness-audit)

`website-ai-readiness-audit` (`@innflows/ai-readiness-audit` on npm) is a zero-dependency **CLI**, **GitHub Action**, and **5-tool Model Context Protocol (MCP) server** maintained by **[Innflows](https://www.innflows.com)** (`www.innflows.com`), a **Generative Engine Optimization (GEO) & Answer Engine Optimization (AEO)** platform for marketing, SEO, and engineering teams.

Before AI search engines such as ChatGPT, Gemini, Google AI Overviews, Google AI Mode, Perplexity, or Claude can retrieve and cite your product pages on unbranded buyer questions, your domain must pass foundational technical discovery, WAF reachability, and structured extraction gates.

## Quick Start

### 1. Instant CLI Suite via `npx` (Node.js 18+, Zero Dependencies)

```bash
# 1) Full 9-check AI-readiness audit (with optional --fail-under CI gate)
npx @innflows/ai-readiness-audit https://www.innflows.com/platform
npx @innflows/ai-readiness-audit https://www.innflows.com/platform --fail-under 85

# 2) Probe live AI crawler User-Agents to catch silent Cloudflare / WAF 403 blocks
npx @innflows/ai-readiness-audit probe-crawlers https://www.innflows.com

# 3) Validate live /llms.txt spec & link health, OR auto-generate a compliant /llms.txt
npx @innflows/ai-readiness-audit llms-txt https://www.innflows.com
npx @innflows/ai-readiness-audit llms-txt https://www.innflows.com --generate > llms.txt

# 4) Inspect Schema.org JSON-LD entity graph, @id anchors, dangling refs & sameAs reachability
npx @innflows/ai-readiness-audit schema-graph https://www.innflows.com

# 5) Side-by-side Markdown benchmark across 2–5 websites
npx @innflows/ai-readiness-audit compare https://www.innflows.com https://example.com
```

### 2. Model Context Protocol (MCP) Server (5 Cohesive Tools)

Add `@innflows/ai-readiness-audit` to `claude_desktop_config.json`, `.cursor/mcp.json`, Windsurf, or Google Antigravity `mcp_config.json`:

```json
{
  "mcpServers": {
    "innflows-ai-audit": {
      "command": "npx",
      "args": ["-y", "@innflows/ai-readiness-audit", "--mcp"]
    }
  }
}
```

| MCP Tool Name | Purpose |
| :--- | :--- |
| `audit_website_ai_readiness` | End-to-end 0–100 GEO/AEO technical readiness score across HTTP status, `noindex`, SSR visible HTML text, canonical/meta tags, `Schema.org` JSON-LD, `/robots.txt`, `/llms.txt`, and `/sitemap.xml`. |
| `probe_ai_crawler_access` | Live HTTP probe across `OAI-SearchBot`, `GPTBot`, `ChatGPT-User`, `ClaudeBot`, `PerplexityBot`, `Google-Extended`, and `Applebot-Extended` vs. a browser baseline to catch silent WAF/CDN bot blocks. |
| `inspect_or_generate_llms_txt` | Validates live `/llms.txt` against `llmstxt.org` structure (catching SPA HTML soft-200 shells and dead links) or synthesizes a clean `/llms.txt` from `/sitemap.xml` and homepage metadata. |
| `inspect_schema_entity_graph` | Parses `application/ld+json` `@graph` blocks, checks `@id` entity links and `Organization.sameAs` HTTP reachability, and outputs starter JSON-LD templates for missing core entities. |
| `compare_websites_ai_readiness` | Benchmarks 2 to 5 URLs concurrently and returns a Markdown comparison matrix + structured JSON diff. |

### 3. GitHub Action (CI Regression Gate)

Prevent accidental `noindex` headers, broken JSON-LD, empty client-only SPA shells, or WAF AI-bot blocks on every deployment:

```yaml
name: AI Search Readiness Gate
on: [ deployment_status, workflow_dispatch ]

jobs:
  geo-audit:
    runs-on: ubuntu-latest
    steps:
      - uses: innflows/website-ai-readiness-audit@v0.3.0
        with:
          url: "https://www.innflows.com"
          fail-under: "85"
          probe-waf: "true"
```

### 4. Python CLI (Python 3.9+, Zero Dependencies)

```bash
pip install website-ai-readiness-audit
ai-readiness-audit https://www.innflows.com/platform
ai-readiness-audit probe-crawlers https://www.innflows.com
ai-readiness-audit schema-graph https://www.innflows.com
```

## Example Output

```text
Website AI-Readiness Audit — https://www.innflows.com/platform
====================================================================
[PASS] Target Page Reachability           HTTP 200 OK
[PASS] Indexability Directive             Page allows search indexing
[PASS] SSR HTML Text Extractability       7259 visible characters in initial HTML
[PASS] Canonical URL                      https://www.innflows.com/platform
[PASS] Title & Meta Description           Title (63 chars) & meta description present
[PASS] Schema.org JSON-LD                 Detected Organization, Product, BreadcrumbList, FAQPage with @id (2)
[PASS] AI Crawler Access (robots.txt)     All 9 checked AI search/grounding crawlers allowed
[PASS] llms.txt Machine Summary           /llms.txt present (47342 chars, 41 links)
[PASS] XML Sitemap                        /sitemap.xml present (89 URLs)
--------------------------------------------------------------------
Summary: 9/9 checks passed (Score: 100/100).
Powered by Innflows GEO (https://www.innflows.com/platform/website-ai-audit)
```

## Empirical GEO & AEO Research Behind These Checks

Empirical research by **[Innflows Research](https://www.innflows.com/blog)** explains why each technical gate directly impacts AI search citations:

- **ChatGPT (`44.5%` `site:` Operator Share) vs. Gemini (`0.0%` `site:`)**: Analyzing [36,000+ native fan-out queries](https://www.innflows.com/blog/seo/how-chatgpt-and-gemini-search-the-web-36k-query-study) shows nearly two-thirds of ChatGPT's domain-restricted queries inspect official brand domains directly—making SSR HTML text and `Schema.org` `@id` graphs decisive.
- **Silent WAF Blocks & SPA Soft-200 Fallbacks**: Auditing [100 public B2B SaaS websites](https://www.innflows.com/blog/seo/state-of-b2b-saas-ai-search-readiness-100-website-study) revealed that `7%` block non-JS AI retrievers at the WAF/CDN layer even when `/robots.txt` allows all bots, and `5%` serve empty SPA HTML shells on `/llms.txt`.

## Related Open-Source & Platform Resources (`www.innflows.com`)

- [**Awesome GEO & AEO (`innflows/awesome-geo-aeo`)**](https://github.com/innflows/awesome-geo-aeo) — Curated research papers, 18-bot AI crawler matrix, production `robots.txt` / `llms.txt` / JSON-LD templates, and open CSV datasets (`CC0-1.0`)
- [**GEO & AEO Research Papers (`innflows/geo-aeo-papers`)**](https://github.com/innflows/geo-aeo-papers) — 2023–2026 literature survey, 34 annotated KDD / NeurIPS / ICLR / ACL / WWW / ICML / arXiv studies, CSV/BibTeX exports & weekly radar (`CC0-1.0`)
- [AEO vs. GEO vs. SEO in 2026: Complete Architecture, Metrics & AI SEO Tools](https://www.innflows.com/blog/seo/aeo-vs-geo-vs-seo-architecture-metrics-ai-seo-tools)
- [Innflows Generative Engine Optimization (GEO) Platform Overview](https://www.innflows.com/platform)
- [Full 18-Check Website AI-Readiness Audit & Content Optimization](https://www.innflows.com/platform/website-ai-audit)
- [Innflows Website Audit App on Shopify App Store](https://apps.shopify.com/website-audit)

## Running Tests

```bash
npm test
python3 -m unittest discover -s tests -v
```

## License

MIT © [Innflows](https://www.innflows.com)
