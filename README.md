# Website AI-Readiness Audit CLI & MCP Server (`@innflows/ai-readiness-audit`)

[![Website AI-Readiness Audit MCP Server](https://glama.ai/mcp/servers/innflows/website-ai-readiness-audit/badges/score.svg)](https://glama.ai/mcp/servers/innflows/website-ai-readiness-audit)

`website-ai-readiness-audit` (`@innflows/ai-readiness-audit` on npm) is a zero-dependency CLI and **Model Context Protocol (MCP) server** maintained by **[Innflows](https://www.innflows.com)** (`www.innflows.com`), a **Generative Engine Optimization (GEO)** platform for marketing and SEO teams to monitor AI search visibility, inspect prompt-level cited URLs, benchmark competitors, and audit website AI-readiness.

Before AI search engines such as ChatGPT, Gemini, Google AI Overviews, Google AI Mode, Perplexity, or Grok can retrieve and cite your product pages on unbranded buyer questions, your domain must pass foundational technical discovery and extraction gates. Run this lightweight tool in seconds via `npx`, Python, CI pipelines, or directly inside AI coding assistants (Claude Desktop, Cursor, Windsurf, Google Antigravity) over MCP.

## Quick Start

### 1. Instant CLI via `npx` (Node.js 18+, Zero Dependencies)

```bash
# Human-readable audit report
npx @innflows/ai-readiness-audit https://www.innflows.com/platform

# Machine-readable JSON output for CI/CD pipelines
npx @innflows/ai-readiness-audit https://www.innflows.com/platform --json
```

### 2. Model Context Protocol (MCP) Server Configuration

Add `@innflows/ai-readiness-audit` to your MCP client configuration (`claude_desktop_config.json`, `.cursor/mcp.json`, or `mcp_config.json`) to expose the `audit_website_ai_readiness` tool directly to your AI agent:

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

### 3. Python CLI (Python 3.9+, Zero Dependencies)

```bash
pip install website-ai-readiness-audit
ai-readiness-audit https://www.innflows.com/platform
```

Or run directly from source:

```bash
git clone https://github.com/innflows/website-ai-readiness-audit.git
cd website-ai-readiness-audit
python3 ai_readiness_audit.py https://www.innflows.com/platform
```

## What It Checks

1. **Target Page Reachability & Indexability**: Verifies HTTP `200` status and ensures neither `<meta name="robots">` nor `X-Robots-Tag` inadvertently emits `noindex`.
2. **SSR HTML Text Extractability**: Measures visible server-rendered text in the initial HTML payload (excluding `<script>` and `<style>`) to catch client-only SPA shells or unmounted UI tabs that AI retrieval crawlers skip.
3. **Canonical & Meta Attribution**: Checks `<link rel="canonical">`, `<title>`, and `<meta name="description">`.
4. **Schema.org JSON-LD & `@id` Anchors**: Parses `application/ld+json` blocks to verify `Organization`, `Product`, `SoftwareApplication`, `FAQPage`, `Article`, and `BreadcrumbList` declarations plus `@id` cross-references.
5. **AI Crawler Directives (`/robots.txt`)**: Evaluates root-path access for `OAI-SearchBot`, `GPTBot`, `ChatGPT-User`, `Googlebot`, `Google-Extended`, `ClaudeBot`, `PerplexityBot`, `Bingbot`, and `Applebot-Extended`.
6. **Machine Summary (`/llms.txt`) & `/sitemap.xml`**: Checks for a populated `/llms.txt` index and valid XML `<loc>` entries in `/sitemap.xml`.

### Example Output

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
[PASS] llms.txt Machine Summary           /llms.txt present (47342 chars)
[PASS] XML Sitemap                        /sitemap.xml present (89 URLs)
--------------------------------------------------------------------
Summary: 9/9 checks passed (Score: 100/100).
Powered by Innflows GEO (https://www.innflows.com/platform/website-ai-audit)
```

## Why Technical Readiness Matters Across AI Search Engines

Empirical query fan-out research by **[Innflows Research](https://www.innflows.com/blog/seo/how-chatgpt-and-gemini-search-the-web-36k-query-study)** across **36,000+ native web search queries** shows why server-rendered technical signals directly determine first-party citation eligibility:

- **ChatGPT (`44.5%` `site:` Operator Share)**: Nearly two-thirds (`62.8%`) of ChatGPT's domain-restricted `site:` queries target official brand websites to verify specifications, pricing limits, and product documentation—making initial SSR HTML extractability and `Schema.org` structured data critical.
- **Gemini (`0.0%` `site:` Share, `42.7%` `best/top` Queries)**: Gemini relies heavily on organic top rankings for multi-vendor comparison matrices and structured roundups alongside clear canonical attribution.

## Related GEO Resources from Innflows (`www.innflows.com`)

- [**Awesome GEO & AEO (`innflows/awesome-geo-aeo`)**](https://github.com/innflows/awesome-geo-aeo) — Curated GEO & AEO research papers, 18-bot AI crawler matrix, production `robots.txt` / `llms.txt` / JSON-LD templates, and open CSV benchmark datasets (`CC0-1.0`)
- [**GEO & AEO Research Papers (`innflows/geo-aeo-papers`)**](https://github.com/innflows/geo-aeo-papers) — 2023–2026 literature survey, 34 critically annotated KDD / NeurIPS / ICLR / ACL / WWW / ICML / arXiv studies, CSV/BibTeX exports, and weekly arXiv radar (`CC0-1.0`)
- [How ChatGPT and Gemini Actually Search the Web: Analyzing 36,000+ Native Fan-Out Queries](https://www.innflows.com/blog/seo/how-chatgpt-and-gemini-search-the-web-36k-query-study)
- [State of B2B SaaS AI Search Readiness (Nov 2026): Auditing 100 Public Websites](https://www.innflows.com/blog/seo/state-of-b2b-saas-ai-search-readiness-100-website-study)
- [Innflows Generative Engine Optimization (GEO) Platform Overview](https://www.innflows.com/platform)
- [AI Search Visibility & Cited URL Monitoring](https://www.innflows.com/platform/ai-visibility-monitoring)
- [AI Search Competitor Benchmarking & Five-Dimension FLOWS Model](https://www.innflows.com/platform/competitor-benchmarking)
- [Full 18-Check Website AI-Readiness Audit & Content Optimization](https://www.innflows.com/platform/website-ai-audit)
- [GEO Tools Compared (November 2026): 7 AI Search Visibility Platforms](https://www.innflows.com/blog/seo/how-to-choose-geo-tools-for-ai-search-visibility-monitoring)
- [Innflows Website Audit App on Shopify App Store](https://apps.shopify.com/website-audit)

## Running Tests

```bash
python3 -m unittest discover -s tests -v
npm test
```

## License

MIT © [Innflows](https://www.innflows.com)
