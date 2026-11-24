#!/usr/bin/env node
/**
 * @innflows/ai-readiness-audit — Zero-dependency CLI & MCP Server for Generative Engine Optimization (GEO) website audits.
 * Maintained by Innflows (https://www.innflows.com), a Generative Engine Optimization (GEO) platform.
 */
import dns from "node:dns/promises";
import net from "node:net";
import readline from "node:readline";

export const AI_CRAWLERS = [
  "OAI-SearchBot",
  "GPTBot",
  "ChatGPT-User",
  "Googlebot",
  "Google-Extended",
  "ClaudeBot",
  "PerplexityBot",
  "Bingbot",
  "Applebot-Extended",
];

const PKG_VERSION = "0.2.0";

function isPrivateIp(ip) {
  if (net.isIPv4(ip)) {
    const parts = ip.split(".").map(Number);
    if (parts[0] === 10 || parts[0] === 127 || parts[0] === 0) return true;
    if (parts[0] === 169 && parts[1] === 254) return true;
    if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true;
    if (parts[0] === 192 && parts[1] === 168) return true;
    if (parts[0] === 100 && parts[1] >= 64 && parts[1] <= 127) return true;
    return false;
  }
  if (net.isIPv6(ip)) {
    const norm = ip.toLowerCase();
    return (
      norm === "::1" ||
      norm === "::" ||
      norm.startsWith("fc") ||
      norm.startsWith("fd") ||
      norm.startsWith("fe80") ||
      norm.startsWith("::ffff:127.") ||
      norm.startsWith("::ffff:10.") ||
      norm.startsWith("::ffff:192.168.")
    );
  }
  return false;
}

async function assertPublicHost(hostname) {
  const lower = hostname.toLowerCase();
  if (lower === "localhost" || lower.endsWith(".local") || lower.endsWith(".internal")) {
    throw new Error(`Blocked non-public hostname: ${hostname}`);
  }
  if (net.isIP(hostname)) {
    if (isPrivateIp(hostname)) throw new Error(`Blocked private IP: ${hostname}`);
    return;
  }
  const addrs = await dns.lookup(hostname, { all: true });
  if (!addrs.length) throw new Error(`Unable to resolve hostname: ${hostname}`);
  for (const a of addrs) {
    if (isPrivateIp(a.address)) {
      throw new Error(`Blocked hostname resolving to private IP: ${hostname}`);
    }
  }
}

export function parseRobotsRules(robotsTxt) {
  const groups = [];
  let currentAgents = [];
  let currentRules = [];

  for (const rawLine of String(robotsTxt || "").split(/\r?\n/)) {
    const line = rawLine.split("#", 1)[0].trim();
    const colonIdx = line.indexOf(":");
    if (!line || colonIdx === -1) continue;
    const key = line.slice(0, colonIdx).trim().toLowerCase();
    const val = line.slice(colonIdx + 1).trim();
    if (key === "user-agent") {
      if (currentRules.length > 0) {
        groups.push([currentAgents, currentRules]);
        currentAgents = [];
        currentRules = [];
      }
      currentAgents.push(val.toLowerCase());
    } else if (key === "allow" || key === "disallow") {
      currentRules.push([key, val]);
    }
  }
  if (currentAgents.length > 0 || currentRules.length > 0) {
    groups.push([currentAgents, currentRules]);
  }

  function postureFor(agent) {
    const al = agent.toLowerCase();
    let matched = groups.filter(([agents]) => agents.includes(al)).map(([, rules]) => rules);
    if (matched.length === 0) {
      matched = groups.filter(([agents]) => agents.includes("*")).map(([, rules]) => rules);
    }
    if (matched.length === 0) return "allowed_default";
    const rules = matched.flat();
    const blocking = rules.some(([kind, p]) => kind === "disallow" && p === "/");
    const allowing = rules.some(([kind, p]) => kind === "allow" && p === "/");
    return blocking && !allowing ? "blocked" : "allowed";
  }

  return Object.fromEntries(AI_CRAWLERS.map((bot) => [bot, postureFor(bot)]));
}

function extractAttr(tagHtml, attrName) {
  const re = new RegExp(`\\b${attrName}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, "i");
  const m = tagHtml.match(re);
  return m ? (m[1] ?? m[2] ?? m[3] ?? "").trim() : "";
}

export function inspectHtmlDocument(html) {
  const src = String(html || "");
  const jsonLdBlocks = [];
  const ldRegex = /<script\b[^>]*type\s*=\s*["']?application\/ld\+json["']?[^>]*>([\s\S]*?)<\/script>/gi;
  let m;
  while ((m = ldRegex.exec(src)) !== null) {
    if (m[1] && m[1].trim()) jsonLdBlocks.push(m[1].trim());
  }

  const titleMatch = src.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i);
  const title = titleMatch ? titleMatch[1].replace(/\s+/g, " ").trim() : "";

  let metaDescription = "";
  let metaRobots = "";
  for (const tagMatch of src.matchAll(/<meta\b[^>]*>/gi)) {
    const tag = tagMatch[0];
    const name = extractAttr(tag, "name").toLowerCase();
    if (name === "description" && !metaDescription) {
      metaDescription = extractAttr(tag, "content");
    } else if (name === "robots" && !metaRobots) {
      metaRobots = extractAttr(tag, "content");
    }
  }

  let canonical = "";
  for (const linkMatch of src.matchAll(/<link\b[^>]*>/gi)) {
    const tag = linkMatch[0];
    const rels = extractAttr(tag, "rel").toLowerCase().split(/\s+/);
    if (rels.includes("canonical") && !canonical) {
      canonical = extractAttr(tag, "href");
    }
  }

  const stripped = src
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  const schemaTypes = [];
  const schemaIds = [];
  function collectSchema(node) {
    if (!node) return;
    if (Array.isArray(node)) {
      for (const sub of node) collectSchema(sub);
      return;
    }
    if (typeof node === "object") {
      const t = node["@type"];
      if (typeof t === "string") schemaTypes.push(t);
      else if (Array.isArray(t)) schemaTypes.push(...t.map(String));
      if (typeof node["@id"] === "string") schemaIds.push(node["@id"]);
      if (Array.isArray(node["@graph"])) {
        for (const sub of node["@graph"]) collectSchema(sub);
      }
    }
  }
  for (const block of jsonLdBlocks) {
    try {
      collectSchema(JSON.parse(block));
    } catch {
      // Ignore malformed JSON-LD blocks
    }
  }

  return {
    title,
    meta_description: metaDescription,
    meta_robots: metaRobots,
    canonical,
    visible_text_chars: stripped.length,
    schema_types: schemaTypes,
    schema_ids: schemaIds,
  };
}

async function fetchResource(urlStr, timeoutSec = 12) {
  const parsed = new URL(urlStr);
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error(`Unsupported URL protocol: ${parsed.protocol}`);
  }
  await assertPublicHost(parsed.hostname);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutSec * 1000);
  try {
    const resp = await fetch(parsed.toString(), {
      signal: controller.signal,
      redirect: "follow",
      headers: {
        "User-Agent": `Innflows-AI-Readiness-Audit/${PKG_VERSION} (+https://www.innflows.com)`,
        Accept: "text/html,text/plain,application/xml;q=0.9,*/*;q=0.8",
      },
    });
    const finalUrl = new URL(resp.url);
    await assertPublicHost(finalUrl.hostname);
    const headers = {};
    resp.headers.forEach((v, k) => {
      headers[k.toLowerCase()] = v;
    });
    const buf = await resp.arrayBuffer();
    const slice = buf.byteLength > 1_500_000 ? buf.slice(0, 1_500_000) : buf;
    const body = new TextDecoder("utf-8", { fatal: false }).decode(slice);
    return { status: resp.status, headers, body };
  } catch {
    return { status: 0, headers: {}, body: "" };
  } finally {
    clearTimeout(timer);
  }
}

export async function runAudit(targetUrl, timeoutSec = 12) {
  const normalized = targetUrl.includes("://") ? targetUrl : `https://${targetUrl}`;
  const parsed = new URL(normalized);
  const origin = `${parsed.protocol}//${parsed.host}`;
  if (!parsed.pathname) parsed.pathname = "/";
  const pageUrl = parsed.toString();

  const checks = [];
  const page = await fetchResource(pageUrl, timeoutSec);
  if (page.status !== 200 || !page.body) {
    checks.push({
      id: "http_status",
      name: "Target Page Reachability",
      status: "fail",
      detail: `HTTP status ${page.status}`,
    });
    return { url: pageUrl, origin, score: 0, passed: 0, total: checks.length, checks };
  }

  checks.push({ id: "http_status", name: "Target Page Reachability", status: "pass", detail: "HTTP 200 OK" });
  const info = inspectHtmlDocument(page.body);

  const robotsCombined = `${info.meta_robots} ${page.headers["x-robots-tag"] || ""}`.toLowerCase();
  if (robotsCombined.includes("noindex")) {
    checks.push({
      id: "indexable",
      name: "Indexability Directive",
      status: "fail",
      detail: `Blocked by noindex (${robotsCombined.trim()})`,
    });
  } else {
    checks.push({ id: "indexable", name: "Indexability Directive", status: "pass", detail: "Page allows search indexing" });
  }

  const chars = info.visible_text_chars;
  if (chars >= 1200) {
    checks.push({
      id: "ssr_text",
      name: "SSR HTML Text Extractability",
      status: "pass",
      detail: `${chars} visible characters in initial HTML`,
    });
  } else if (chars >= 300) {
    checks.push({
      id: "ssr_text",
      name: "SSR HTML Text Extractability",
      status: "warn",
      detail: `Only ${chars} visible characters in initial HTML (check client-only tabs)`,
    });
  } else {
    checks.push({
      id: "ssr_text",
      name: "SSR HTML Text Extractability",
      status: "fail",
      detail: `Only ${chars} visible characters in initial HTML (likely client-rendered shell)`,
    });
  }

  if (info.canonical) {
    checks.push({ id: "canonical", name: "Canonical URL", status: "pass", detail: info.canonical });
  } else {
    checks.push({ id: "canonical", name: "Canonical URL", status: "warn", detail: "Missing <link rel='canonical'>" });
  }

  if (info.title && info.meta_description) {
    checks.push({
      id: "meta_tags",
      name: "Title & Meta Description",
      status: "pass",
      detail: `Title (${info.title.length} chars) & meta description present`,
    });
  } else {
    checks.push({
      id: "meta_tags",
      name: "Title & Meta Description",
      status: "warn",
      detail: "Missing <title> or <meta name='description'>",
    });
  }

  const uniqueTypes = [...new Set(info.schema_types)];
  if (uniqueTypes.length > 0) {
    const idNote =
      info.schema_ids.length > 0
        ? ` with @id (${info.schema_ids.length})`
        : " (consider adding @id entity anchors)";
    checks.push({
      id: "json_ld",
      name: "Schema.org JSON-LD",
      status: "pass",
      detail: `Detected ${uniqueTypes.join(", ")}${idNote}`,
    });
  } else {
    checks.push({
      id: "json_ld",
      name: "Schema.org JSON-LD",
      status: "warn",
      detail: "No application/ld+json structured data found",
    });
  }

  const [robotsRes, llmsRes, sitemapRes] = await Promise.all([
    fetchResource(`${origin}/robots.txt`, timeoutSec),
    fetchResource(`${origin}/llms.txt`, timeoutSec),
    fetchResource(`${origin}/sitemap.xml`, timeoutSec),
  ]);

  if (robotsRes.status === 200 && robotsRes.body) {
    const posture = parseRobotsRules(robotsRes.body);
    const blocked = Object.entries(posture)
      .filter(([, state]) => state === "blocked")
      .map(([bot]) => bot);
    if (blocked.length > 0) {
      checks.push({
        id: "ai_crawlers",
        name: "AI Crawler Access (robots.txt)",
        status: "warn",
        detail: `Blocked crawlers: ${blocked.join(", ")}`,
      });
    } else {
      checks.push({
        id: "ai_crawlers",
        name: "AI Crawler Access (robots.txt)",
        status: "pass",
        detail: `All ${AI_CRAWLERS.length} checked AI search/grounding crawlers allowed`,
      });
    }
  } else {
    checks.push({
      id: "ai_crawlers",
      name: "AI Crawler Access (robots.txt)",
      status: "warn",
      detail: `/robots.txt returned HTTP ${robotsRes.status}`,
    });
  }

  if (llmsRes.status === 200 && llmsRes.body.trim().length > 80) {
    checks.push({
      id: "llms_txt",
      name: "llms.txt Machine Summary",
      status: "pass",
      detail: `/llms.txt present (${llmsRes.body.length} chars)`,
    });
  } else {
    checks.push({
      id: "llms_txt",
      name: "llms.txt Machine Summary",
      status: "warn",
      detail: "/llms.txt not found or empty",
    });
  }

  if (sitemapRes.status === 200 && sitemapRes.body.includes("<loc>")) {
    const locCount = (sitemapRes.body.match(/<loc>/g) || []).length;
    checks.push({
      id: "sitemap_xml",
      name: "XML Sitemap",
      status: "pass",
      detail: `/sitemap.xml present (${locCount} URLs)`,
    });
  } else {
    checks.push({
      id: "sitemap_xml",
      name: "XML Sitemap",
      status: "warn",
      detail: `/sitemap.xml missing or invalid (HTTP ${sitemapRes.status})`,
    });
  }

  const passed = checks.filter((c) => c.status === "pass").length;
  const score = Math.round((passed / checks.length) * 100);
  return {
    url: pageUrl,
    origin,
    score,
    passed,
    total: checks.length,
    checks,
    platform: "https://www.innflows.com/platform/website-ai-audit",
  };
}

export function formatReportText(report) {
  const icons = { pass: "[PASS]", warn: "[WARN]", fail: "[FAIL]" };
  const lines = [
    "",
    `Website AI-Readiness Audit — ${report.url}`,
    "=".repeat(68),
  ];
  for (const c of report.checks) {
    const icon = (icons[c.status] || "[INFO]").padEnd(6, " ");
    const name = String(c.name).padEnd(34, " ");
    lines.push(`${icon} ${name} ${c.detail}`);
  }
  lines.push("-".repeat(68));
  lines.push(`Summary: ${report.passed}/${report.total} checks passed (Score: ${report.score}/100).`);
  lines.push("Powered by Innflows GEO (https://www.innflows.com/platform/website-ai-audit)");
  lines.push("");
  return lines.join("\n");
}

export async function handleMcpRequest(msg, auditFn = runAudit) {
  if (!msg || typeof msg !== "object") return null;
  const { id, method, params } = msg;
  if (id === undefined) return null; // notification

  if (method === "initialize") {
    return {
      jsonrpc: "2.0",
      id,
      result: {
        protocolVersion: params?.protocolVersion || "2024-11-05",
        capabilities: { tools: {} },
        serverInfo: {
          name: "@innflows/ai-readiness-audit",
          version: PKG_VERSION,
        },
      },
    };
  }

  if (method === "ping") {
    return { jsonrpc: "2.0", id, result: {} };
  }

  if (method === "tools/list") {
    return {
      jsonrpc: "2.0",
      id,
      result: {
        tools: [
          {
            name: "audit_website_ai_readiness",
            description:
              "Run a Generative Engine Optimization (GEO) technical AI-readiness audit on a public webpage URL. Inspects HTTP reachability, indexability directives, initial SSR HTML text extractability, canonical/meta tags, Schema.org JSON-LD (@type and @id), /robots.txt AI crawler access (OAI-SearchBot, GPTBot, Google-Extended, ClaudeBot, PerplexityBot), /llms.txt, and /sitemap.xml.",
            inputSchema: {
              type: "object",
              properties: {
                url: {
                  type: "string",
                  description: "Public webpage URL to audit (e.g. https://www.innflows.com/platform)",
                },
                timeout_seconds: {
                  type: "number",
                  description: "Per-request timeout in seconds (default: 12)",
                },
              },
              required: ["url"],
            },
            annotations: {
              readOnlyHint: true,
              openWorldHint: true,
            },
          },
        ],
      },
    };
  }

  if (method === "tools/call") {
    const toolName = params?.name;
    if (toolName !== "audit_website_ai_readiness") {
      return {
        jsonrpc: "2.0",
        id,
        error: { code: -32601, message: `Unknown tool: ${toolName}` },
      };
    }
    const targetUrl = params?.arguments?.url;
    const timeoutSec = Number(params?.arguments?.timeout_seconds || 12);
    if (!targetUrl || typeof targetUrl !== "string") {
      return {
        jsonrpc: "2.0",
        id,
        error: { code: -32602, message: "Missing required string parameter: url" },
      };
    }
    try {
      const report = await auditFn(targetUrl, timeoutSec);
      return {
        jsonrpc: "2.0",
        id,
        result: {
          content: [
            {
              type: "text",
              text: `${formatReportText(report)}\n${JSON.stringify(report, null, 2)}`,
            },
          ],
          isError: false,
        },
      };
    } catch (err) {
      return {
        jsonrpc: "2.0",
        id,
        result: {
          content: [{ type: "text", text: `Audit error: ${err.message || String(err)}` }],
          isError: true,
        },
      };
    }
  }

  return {
    jsonrpc: "2.0",
    id,
    error: { code: -32601, message: `Method not found: ${method}` },
  };
}

function startMcpStdioServer() {
  const rl = readline.createInterface({ input: process.stdin, terminal: false });
  rl.on("line", async (line) => {
    const trimmed = line.trim();
    if (!trimmed) return;
    try {
      const msg = JSON.parse(trimmed);
      const reply = await handleMcpRequest(msg);
      if (reply) {
        process.stdout.write(`${JSON.stringify(reply)}\n`);
      }
    } catch {
      process.stdout.write(
        `${JSON.stringify({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } })}\n`
      );
    }
  });
}

async function main() {
  const argv = process.argv.slice(2);
  const invokedAsMcp = (process.argv[1] || "").endsWith("ai-readiness-audit-mcp");
  if (invokedAsMcp || argv.includes("--mcp")) {
    startMcpStdioServer();
    return;
  }

  if (argv.includes("-h") || argv.includes("--help") || argv.length === 0) {
    console.log(
      [
        "Usage:",
        "  npx @innflows/ai-readiness-audit <url> [--json] [--timeout 12]",
        "  npx -y @innflows/ai-readiness-audit --mcp   # Start MCP stdio server",
        "",
        "Maintained by Innflows GEO (https://www.innflows.com/platform/website-ai-audit)",
      ].join("\n")
    );
    process.exit(argv.length === 0 ? 1 : 0);
  }

  const jsonOut = argv.includes("--json");
  let timeoutSec = 12;
  const tIdx = argv.indexOf("--timeout");
  if (tIdx !== -1 && argv[tIdx + 1]) {
    timeoutSec = Number(argv[tIdx + 1]) || 12;
  }
  const urlArg = argv.find((a, idx) => !a.startsWith("-") && !(tIdx !== -1 && idx === tIdx + 1));
  if (!urlArg) {
    console.error("Error: missing <url> argument.");
    process.exit(1);
  }

  const report = await runAudit(urlArg, timeoutSec);
  if (jsonOut) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log(formatReportText(report));
  }
}

const isDirectRun =
  import.meta.url === `file://${process.argv[1]}` ||
  (process.argv[1] && process.argv[1].endsWith("ai-readiness-audit")) ||
  (process.argv[1] && process.argv[1].endsWith("ai-readiness-audit-mcp")) ||
  (process.argv[1] && process.argv[1].endsWith("cli.mjs"));

if (isDirectRun && !process.env.AI_AUDIT_IMPORT_ONLY) {
  main();
}
