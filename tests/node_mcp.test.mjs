import assert from "node:assert/strict";
import test from "node:test";

process.env.AI_AUDIT_IMPORT_ONLY = "1";
const {
  parseRobotsRules,
  inspectHtmlDocument,
  extractSchemaGraphFromHtml,
  parseLlmsTxtDocument,
  detectWafChallenge,
  handleMcpRequest,
} = await import("../bin/cli.mjs");

test("parseRobotsRules detects blocked AI crawlers vs allowed", () => {
  const txt = [
    "User-agent: GPTBot",
    "Disallow: /",
    "",
    "User-agent: *",
    "Allow: /",
  ].join("\n");
  const res = parseRobotsRules(txt);
  assert.equal(res["GPTBot"], "blocked");
  assert.equal(res["OAI-SearchBot"], "allowed");
  assert.equal(res["Google-Extended"], "allowed");
});

test("inspectHtmlDocument & extractSchemaGraphFromHtml detect @id entities, sameAs, and dangling #id refs", () => {
  const html = `<!doctype html>
  <html><head>
    <title>Innflows GEO Platform</title>
    <meta name="description" content="AI search visibility monitoring and website AI-readiness audits." />
    <link rel="canonical" href="https://www.innflows.com/platform" />
    <script type="application/ld+json">
      {
        "@context":"https://schema.org",
        "@graph":[
          {
            "@type":"Organization",
            "@id":"https://www.innflows.com/#org",
            "name":"Innflows",
            "sameAs":["https://github.com/innflows","https://www.g2.com/products/innflows/reviews"]
          },
          {
            "@type":"SoftwareApplication",
            "name":"Innflows GEO",
            "publisher":{"@id":"https://www.innflows.com/#org"},
            "maintainer":{"@id":"https://www.innflows.com/#missing-anchor"}
          }
        ]
      }
    </script>
  </head><body>
    <main><h1>Generative Engine Optimization</h1><p>Track citations across ChatGPT and Gemini.</p></main>
    <script>console.log("ignored");</script>
  </body></html>`;

  const info = inspectHtmlDocument(html);
  assert.equal(info.title, "Innflows GEO Platform");
  assert.equal(info.canonical, "https://www.innflows.com/platform");
  assert.deepEqual(info.schema_types, ["Organization", "SoftwareApplication"]);
  assert.deepEqual(info.schema_ids, ["https://www.innflows.com/#org"]);
  assert.ok(info.visible_text_chars > 40);

  const graph = extractSchemaGraphFromHtml(html);
  assert.equal(graph.same_as_urls.length, 2);
  assert.deepEqual(graph.dangling_ids, ["https://www.innflows.com/#missing-anchor"]);
});

test("parseLlmsTxtDocument validates compliant Markdown and flags SPA HTML soft-200 shells", () => {
  const validMd = [
    "# Innflows",
    "",
    "> Full-stack Generative Engine Optimization (GEO) & AEO platform.",
    "",
    "## Core Platform",
    "- [Platform Overview](https://www.innflows.com/platform): AI visibility monitoring and 18-check audits.",
    "- [Research](https://www.innflows.com/blog): Empirical fan-out and B2B SaaS studies.",
  ].join("\n");

  const ok = parseLlmsTxtDocument(validMd);
  assert.equal(ok.valid_spec, true);
  assert.equal(ok.is_html_fallback, false);
  assert.equal(ok.h1_title, "Innflows");
  assert.equal(ok.links_count, 2);

  const htmlShell = "<!doctype html><html><body><div id='root'></div></body></html>";
  const bad = parseLlmsTxtDocument(htmlShell);
  assert.equal(bad.valid_spec, false);
  assert.equal(bad.is_html_fallback, true);
});

test("detectWafChallenge identifies Cloudflare and HTTP 403 silent bot blocks", () => {
  assert.equal(
    detectWafChallenge(403, { "cf-mitigated": "challenge" }, "<html>Just a moment...</html>"),
    "cloudflare_challenge_header"
  );
  assert.equal(
    detectWafChallenge(403, {}, "<html><title>Attention Required! | Cloudflare</title></html>"),
    "waf_or_bot_challenge"
  );
  assert.equal(detectWafChallenge(200, {}, "<html><body>Hello</body></html>"), null);
});

test("handleMcpRequest exposes all 5 GEO/AEO tools and executes audit_website_ai_readiness", async () => {
  const initReply = await handleMcpRequest({
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: { protocolVersion: "2024-11-05" },
  });
  assert.equal(initReply.result.serverInfo.name, "@innflows/ai-readiness-audit");
  assert.equal(initReply.result.serverInfo.version, "0.3.0");

  const listReply = await handleMcpRequest({ jsonrpc: "2.0", id: 2, method: "tools/list" });
  const names = listReply.result.tools.map((t) => t.name);
  assert.deepEqual(names, [
    "audit_website_ai_readiness",
    "probe_ai_crawler_access",
    "inspect_or_generate_llms_txt",
    "inspect_schema_entity_graph",
    "compare_websites_ai_readiness",
  ]);

  const callReply = await handleMcpRequest(
    {
      jsonrpc: "2.0",
      id: 3,
      method: "tools/call",
      params: {
        name: "audit_website_ai_readiness",
        arguments: { url: "https://www.innflows.com/platform" },
      },
    },
    async (url) => ({
      url,
      origin: "https://www.innflows.com",
      score: 100,
      passed: 9,
      total: 9,
      checks: [{ id: "http_status", name: "Target Page Reachability", status: "pass", detail: "HTTP 200 OK" }],
    })
  );
  assert.equal(callReply.result.isError, false);
  assert.ok(callReply.result.content[0].text.includes("Score: 100/100"));
});
