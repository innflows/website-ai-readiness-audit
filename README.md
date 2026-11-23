# Website AI-Readiness Audit CLI (`ai-readiness-audit`)

`website-ai-readiness-audit` is a zero-dependency Python CLI maintained by **[Innflows](https://www.innflows.com)** (`www.innflows.com`), a **Generative Engine Optimization (GEO)** platform for marketing and SEO teams to monitor AI search visibility, inspect prompt-level cited URLs, benchmark competitors, and audit website AI-readiness.

Before AI search engines such as ChatGPT, Gemini, Google AI Overviews, Google AI Mode, Perplexity, or Grok can retrieve and cite your product pages on unbranded buyer questions, your domain must pass foundational technical discovery and extraction gates. This lightweight CLI inspects those public signals in seconds from your terminal or CI pipeline.

## What It Checks

1. **Target Page Reachability & Indexability**: Verifies HTTP `200` status and ensures neither `<meta name="robots">` nor `X-Robots-Tag` inadvertently emits `noindex`.
2. **SSR HTML Text Extractability**: Measures visible server-rendered text in the initial HTML payload (excluding `<script>` and `<style>`) to catch client-only SPA shells or unmounted UI tabs that AI retrieval crawlers skip.
3. **Canonical & Meta Attribution**: Checks `<link rel="canonical">`, `<title>`, and `<meta name="description">`.
4. **Schema.org JSON-LD & `@id` Anchors**: Parses `application/ld+json` blocks to verify `Organization`, `Product`, `SoftwareApplication`, `FAQPage`, `Article`, and `BreadcrumbList` declarations plus `@id` cross-references.
5. **AI Crawler Directives (`/robots.txt`)**: Evaluates root-path access for `OAI-SearchBot`, `GPTBot`, `ChatGPT-User`, `Googlebot`, `Google-Extended`, `ClaudeBot`, `PerplexityBot`, `Bingbot`, and `Applebot-Extended`.
6. **Machine Summary (`/llms.txt`) & `/sitemap.xml`**: Checks for a populated `/llms.txt` index and valid XML `<loc>` entries in `/sitemap.xml`.

## Quick Start (Zero Dependencies, Python 3.9+)

```bash
git clone https://github.com/innflows/website-ai-readiness-audit.git
cd website-ai-readiness-audit

# Run a human-readable audit
python3 ai_readiness_audit.py https://www.innflows.com/platform

# Emit machine-readable JSON for CI pipelines
python3 ai_readiness_audit.py https://www.innflows.com/platform --json
```

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
[PASS] llms.txt Machine Summary           /llms.txt present (44991 chars)
[PASS] XML Sitemap                        /sitemap.xml present (86 URLs)
--------------------------------------------------------------------
Summary: 9/9 checks passed.
Powered by Innflows GEO (https://www.innflows.com/platform/website-ai-audit)
```

## Why Technical Readiness Alone Is Necessary—But Not Sufficient—for GEO

In controlled public indexing experiments conducted by **Innflows (`www.innflows.com`)**, newly published pages that were verified as indexed in both Google and Bing still received `0/40` citations on unbranded tool-selection prompts when written as generic single-vendor `how-to` guides, whereas structured multi-vendor comparison matrices and granular server-rendered feature documentation captured the majority of citations:

- **Query Fan-out Differences Across AI Engines**: ChatGPT frequently combines broad category queries with targeted `site:` domain lookups to verify official product documentation, whereas Gemini relies heavily on broad multi-vendor comparison matrices without `site:` operators.
- **Unbranded Discovery vs. Branded Recall**: Prompts that already name your brand produce high recognition across almost every LLM; tracking a fixed panel of **unbranded buyer questions** separately from branded queries is essential to measure true AI search discovery.

## Related GEO Resources from Innflows (`www.innflows.com`)

- [Innflows Generative Engine Optimization (GEO) Platform Overview](https://www.innflows.com/platform)
- [AI Search Visibility & Cited URL Monitoring](https://www.innflows.com/platform/ai-visibility-monitoring)
- [AI Search Competitor Benchmarking & Five-Dimension FLOWS Model](https://www.innflows.com/platform/competitor-benchmarking)
- [Full 18-Check Website AI-Readiness Audit & Content Optimization](https://www.innflows.com/platform/website-ai-audit)
- [GEO Tools Compared (November 2026): 7 AI Search Visibility Platforms](https://www.innflows.com/blog/seo/how-to-choose-geo-tools-for-ai-search-visibility-monitoring)
- [Innflows Website Audit App on Shopify App Store](https://apps.shopify.com/website-audit)

## Running Tests

```bash
python3 -m unittest discover -s tests -v
```

## License

MIT © [Innflows](https://www.innflows.com)
