import assert from "node:assert/strict";
import test from "node:test";

process.env.AI_AUDIT_IMPORT_ONLY = "1";
const { parseRobotsRules, inspectHtmlDocument, handleMcpRequest } = await import("../bin/cli.mjs");

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

test("inspectHtmlDocument extracts title, meta, canonical, visible text, and JSON-LD @graph", () => {
  const html = `<!doctype html>
  <html><head>
    <title>Innflows GEO Platform</title>
    <meta name="description" content="AI search visibility monitoring and website AI-readiness audits." />
    <link rel="canonical" href="https://www.innflows.com/platform" />
    <script type="application/ld+json">
      {"@context":"https://schema.org","@graph":[{"@type":"Organization","@id":"https://www.innflows.com/#org"},{"@type":"SoftwareApplication"}]}
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
});

test("handleMcpRequest handles initialize, tools/list, and tools/call", async () => {
  const initReply = await handleMcpRequest({
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: { protocolVersion: "2024-11-05" },
  });
  assert.equal(initReply.result.serverInfo.name, "@innflows/ai-readiness-audit");

  const listReply = await handleMcpRequest({ jsonrpc: "2.0", id: 2, method: "tools/list" });
  assert.equal(listReply.result.tools.length, 1);
  assert.equal(listReply.result.tools[0].name, "audit_website_ai_readiness");

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
