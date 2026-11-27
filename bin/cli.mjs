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

export const PROBE_USER_AGENTS = {
  "Browser-Baseline":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  "OAI-SearchBot": "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko); compatible; OAI-SearchBot/1.0; +https://openai.com/searchbot",
  GPTBot: "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko); compatible; GPTBot/1.1; +https://openai.com/gptbot",
  "ChatGPT-User": "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko); compatible; ChatGPT-User/1.0; +https://openai.com/bot",
  ClaudeBot: "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; ClaudeBot/1.0; +claudebot@anthropic.com)",
  PerplexityBot: "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; PerplexityBot/1.0; +https://perplexity.ai/perplexitybot)",
  "Google-Extended": "Mozilla/5.0 (compatible; Google-Extended/1.0; +http://www.google.com/bot.html)",
  "Applebot-Extended": "Mozilla/5.0 (Applebot-Extended/0.3; +http://www.apple.com/go/applebot)",
};

export const PKG_VERSION = "0.3.1";

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

function normalizeUrlInput(targetUrl) {
  const normalized = String(targetUrl || "").trim();
  if (!normalized) throw new Error("Empty URL");
  const withProto = normalized.includes("://") ? normalized : `https://${normalized}`;
  const parsed = new URL(withProto);
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error(`Unsupported URL protocol: ${parsed.protocol}`);
  }
  if (!parsed.pathname) parsed.pathname = "/";
  return {
    parsed,
    origin: `${parsed.protocol}//${parsed.host}`,
    pageUrl: parsed.toString(),
  };
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

function stripVisibleText(html) {
  return String(html || "")
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function extractSchemaGraphFromHtml(html) {
  const src = String(html || "");
  const jsonLdBlocks = [];
  const ldRegex = /<script\b[^>]*type\s*=\s*["']?application\/ld\+json["']?[^>]*>([\s\S]*?)<\/script>/gi;
  let m;
  while ((m = ldRegex.exec(src)) !== null) {
    if (m[1] && m[1].trim()) jsonLdBlocks.push(m[1].trim());
  }

  const entities = [];
  const definedIds = new Set();
  const referencedIds = new Set();
  const sameAsUrls = new Set();
  let parseErrors = 0;

  function walk(node, isTopEntity = true) {
    if (!node) return;
    if (Array.isArray(node)) {
      for (const sub of node) walk(sub, isTopEntity);
      return;
    }
    if (typeof node !== "object") return;

    if (Array.isArray(node["@graph"])) {
      for (const sub of node["@graph"]) walk(sub, true);
    }

    const rawType = node["@type"];
    const types = typeof rawType === "string" ? [rawType] : Array.isArray(rawType) ? rawType.map(String) : [];
    const nodeId = typeof node["@id"] === "string" ? node["@id"].trim() : "";

    // Pure @id reference object (no @type and few keys)
    if (nodeId && types.length === 0 && Object.keys(node).length <= 2) {
      referencedIds.add(nodeId);
      return;
    }

    if (nodeId) definedIds.add(nodeId);

    if (types.length > 0) {
      const sameAsRaw = node.sameAs;
      const nodeSameAs = [];
      if (typeof sameAsRaw === "string" && sameAsRaw.trim()) {
        nodeSameAs.push(sameAsRaw.trim());
      } else if (Array.isArray(sameAsRaw)) {
        for (const u of sameAsRaw) {
          if (typeof u === "string" && u.trim()) nodeSameAs.push(u.trim());
        }
      }
      for (const u of nodeSameAs) sameAsUrls.add(u);

      entities.push({
        types,
        id: nodeId || null,
        name: typeof node.name === "string" ? node.name : typeof node.headline === "string" ? node.headline : null,
        url: typeof node.url === "string" ? node.url : null,
        sameAsCount: nodeSameAs.length,
      });
    }

    for (const [k, v] of Object.entries(node)) {
      if (k === "@graph" || k === "@context" || k === "@type" || k === "@id") continue;
      if (v && typeof v === "object") {
        walk(v, false);
      }
    }
  }

  for (const block of jsonLdBlocks) {
    try {
      walk(JSON.parse(block), true);
    } catch {
      parseErrors += 1;
    }
  }

  const allTypes = entities.flatMap((e) => e.types);
  const danglingIds = [...referencedIds].filter((ref) => ref.includes("#") && !definedIds.has(ref));

  return {
    blocks_count: jsonLdBlocks.length,
    parse_errors: parseErrors,
    entities,
    schema_types: allTypes,
    unique_types: [...new Set(allTypes)],
    defined_ids: [...definedIds],
    referenced_ids: [...referencedIds],
    dangling_ids: danglingIds,
    same_as_urls: [...sameAsUrls],
  };
}

export function inspectHtmlDocument(html) {
  const src = String(html || "");
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

  const stripped = stripVisibleText(src);
  const graph = extractSchemaGraphFromHtml(src);

  return {
    title,
    meta_description: metaDescription,
    meta_robots: metaRobots,
    canonical,
    visible_text_chars: stripped.length,
    schema_types: graph.schema_types,
    schema_ids: graph.defined_ids,
  };
}

export function parseLlmsTxtDocument(content) {
  const raw = String(content || "");
  const trimmed = raw.trim();
  const looksLikeHtml = /^<!doctype\s+html/i.test(trimmed) || /^<html\b/i.test(trimmed);
  const lines = raw.split(/\r?\n/);

  let h1Title = "";
  let blockquoteSummary = "";
  const sections = [];
  const links = [];

  let currentSection = "Root";
  const mdLinkRe = /^\s*[-*]\s+\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)(?:\s*(?::|—|–|-)\s*(.*))?$/;
  const bareLinkRe = /^\s*[-*]\s+([^:\n]+?):\s+(https?:\/\/[^\s)]+)(?:\s*(?:—|–|-)\s*(.*))?$/;

  for (const line of lines) {
    const t = line.trim();
    if (!h1Title && /^#\s+/.test(t) && !/^##/.test(t)) {
      h1Title = t.replace(/^#\s+/, "").trim();
      continue;
    }
    if (!blockquoteSummary && /^>\s+/.test(t)) {
      blockquoteSummary = t.replace(/^>\s+/, "").trim();
      continue;
    }
    if (/^##\s+/.test(t)) {
      currentSection = t.replace(/^##\s+/, "").trim();
      sections.push(currentSection);
      continue;
    }
    const lm = line.match(mdLinkRe) || line.match(bareLinkRe);
    if (lm) {
      links.push({
        section: currentSection,
        title: lm[1].replace(/^\*\*|\*\*$/g, "").trim(),
        url: lm[2].trim(),
        description: (lm[3] || "").trim(),
      });
    }
  }

  const issues = [];
  if (!trimmed) issues.push("Empty /llms.txt body");
  if (looksLikeHtml) issues.push("Response is an HTML document (SPA soft-200 fallback) instead of plain Markdown");
  if (!looksLikeHtml && trimmed) {
    if (!h1Title) issues.push("Missing required top-level '# Title' H1 heading");
    if (!blockquoteSummary) issues.push("Missing recommended '> Summary' blockquote description");
    if (sections.length === 0) issues.push("No '## Section' headings found");
    if (links.length === 0) issues.push("No Markdown list links ('- [Title](https://...): description') found");
  }

  return {
    valid_spec: !looksLikeHtml && Boolean(h1Title) && links.length > 0,
    is_html_fallback: looksLikeHtml,
    char_length: raw.length,
    h1_title: h1Title || null,
    blockquote_summary: blockquoteSummary || null,
    sections,
    links_count: links.length,
    links,
    issues,
  };
}

export function detectWafChallenge(status, headers, body) {
  const lower = String(body || "").slice(0, 8000).toLowerCase();
  const cfMitigated = (headers["cf-mitigated"] || "").toLowerCase();
  if (cfMitigated.includes("challenge")) return "cloudflare_challenge_header";
  if (
    (status === 403 || status === 429 || status === 503) &&
    (lower.includes("just a moment...") ||
      lower.includes("cf-browser-verification") ||
      lower.includes("challenge-platform") ||
      lower.includes("attention required! | cloudflare") ||
      lower.includes("access denied") ||
      lower.includes("bot verification"))
  ) {
    return "waf_or_bot_challenge";
  }
  if (status === 403) return "http_403_forbidden";
  if (status === 429) return "http_429_rate_limited";
  if (status === 401) return "http_401_unauthorized";
  return null;
}

async function fetchResource(urlStr, timeoutSec = 12, customUserAgent = null) {
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
        "User-Agent": customUserAgent || `Innflows-AI-Readiness-Audit/${PKG_VERSION} (+https://www.innflows.com)`,
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
    return { status: resp.status, finalUrl: finalUrl.toString(), headers, body };
  } catch {
    return { status: 0, finalUrl: urlStr, headers: {}, body: "" };
  } finally {
    clearTimeout(timer);
  }
}

export async function runAudit(targetUrl, timeoutSec = 12) {
  const { origin, pageUrl } = normalizeUrlInput(targetUrl);

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
    const parsedLlms = parseLlmsTxtDocument(llmsRes.body);
    if (parsedLlms.is_html_fallback) {
      checks.push({
        id: "llms_txt",
        name: "llms.txt Machine Summary",
        status: "warn",
        detail: "/llms.txt returns HTML fallback instead of plain Markdown",
      });
    } else {
      checks.push({
        id: "llms_txt",
        name: "llms.txt Machine Summary",
        status: "pass",
        detail: `/llms.txt present (${llmsRes.body.length} chars, ${parsedLlms.links_count} links)`,
      });
    }
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

export async function probeCrawlerAccess(targetUrl, timeoutSec = 12) {
  const { origin, pageUrl } = normalizeUrlInput(targetUrl);
  const robotsRes = await fetchResource(`${origin}/robots.txt`, timeoutSec);
  const robotsPosture = robotsRes.status === 200 && robotsRes.body ? parseRobotsRules(robotsRes.body) : {};

  const entries = Object.entries(PROBE_USER_AGENTS);
  const probeResults = await Promise.all(
    entries.map(async ([botName, ua]) => {
      const res = await fetchResource(pageUrl, timeoutSec, ua);
      const visibleChars = res.body ? stripVisibleText(res.body).length : 0;
      const wafReason = detectWafChallenge(res.status, res.headers, res.body);
      const robotsRule = botName === "Browser-Baseline" ? "n/a" : robotsPosture[botName] || "unknown";
      const silentBlock =
        botName !== "Browser-Baseline" &&
        robotsRule !== "blocked" &&
        (res.status !== 200 || Boolean(wafReason));

      return {
        agent: botName,
        robots_txt_posture: robotsRule,
        http_status: res.status,
        visible_text_chars: visibleChars,
        server_header: res.headers["server"] || null,
        waf_diagnosis: wafReason,
        silent_waf_block: silentBlock,
      };
    })
  );

  const baseline = probeResults.find((r) => r.agent === "Browser-Baseline");
  const silentBlockedAgents = probeResults.filter((r) => r.silent_waf_block).map((r) => r.agent);

  return {
    url: pageUrl,
    origin,
    robots_txt_status: robotsRes.status,
    baseline_status: baseline ? baseline.http_status : 0,
    baseline_visible_chars: baseline ? baseline.visible_text_chars : 0,
    silent_waf_blocks_detected: silentBlockedAgents.length > 0,
    silent_blocked_agents: silentBlockedAgents,
    probes: probeResults,
    platform: "https://www.innflows.com/platform/website-ai-audit",
  };
}

function classifyPathSection(pathname) {
  const seg = pathname.split("/").filter(Boolean)[0]?.toLowerCase() || "";
  if (!seg) return "Core Pages";
  if (["docs", "documentation", "guide", "guides", "reference", "api", "developers"].includes(seg)) return "Documentation";
  if (["platform", "product", "products", "features", "solutions", "integrations", "pricing"].includes(seg)) return "Product & Pricing";
  if (["blog", "research", "articles", "news", "insights", "resources"].includes(seg)) return "Research & Blog";
  return "Key Pages";
}

export async function inspectOrGenerateLlmsTxt(targetUrl, options = {}) {
  const mode = options.mode === "generate" ? "generate" : "validate";
  const maxLinks = Math.min(Math.max(Number(options.maxLinks || 20), 5), 50);
  const timeoutSec = Number(options.timeoutSec || 12);
  const { parsed, origin, pageUrl } = normalizeUrlInput(targetUrl);

  if (mode === "validate") {
    const llmsUrl = parsed.pathname.endsWith(".txt") ? pageUrl : `${origin}/llms.txt`;
    const [llmsRes, fullRes] = await Promise.all([
      fetchResource(llmsUrl, timeoutSec),
      fetchResource(`${origin}/llms-full.txt`, timeoutSec),
    ]);

    if (llmsRes.status !== 200 || !llmsRes.body) {
      return {
        mode: "validate",
        url: llmsUrl,
        origin,
        http_status: llmsRes.status,
        has_llms_full_txt: fullRes.status === 200 && fullRes.body.length > 80,
        valid_spec: false,
        issues: [`${llmsUrl} returned HTTP ${llmsRes.status}`],
        hint: "Run with mode='generate' (or CLI --generate) to synthesize a starter /llms.txt from your homepage and sitemap.xml.",
      };
    }

    const report = parseLlmsTxtDocument(llmsRes.body);
    const sampleLinks = report.links.slice(0, 8);
    const linkChecks = await Promise.all(
      sampleLinks.map(async (item) => {
        const r = await fetchResource(item.url, Math.min(timeoutSec, 8));
        return { url: item.url, title: item.title, http_status: r.status, ok: r.status >= 200 && r.status < 400 };
      })
    );
    const brokenLinks = linkChecks.filter((c) => !c.ok);
    if (brokenLinks.length > 0) {
      report.issues.push(`${brokenLinks.length}/${linkChecks.length} sampled links returned non-2xx/3xx status`);
    }

    return {
      mode: "validate",
      url: llmsUrl,
      origin,
      http_status: llmsRes.status,
      has_llms_full_txt: fullRes.status === 200 && fullRes.body.length > 80 && !parseLlmsTxtDocument(fullRes.body).is_html_fallback,
      ...report,
      sampled_link_checks: linkChecks,
      platform: "https://www.innflows.com/platform/website-ai-audit",
    };
  }

  // mode === "generate"
  const [homeRes, sitemapRes] = await Promise.all([
    fetchResource(pageUrl, timeoutSec),
    fetchResource(`${origin}/sitemap.xml`, timeoutSec),
  ]);

  const homeInfo = homeRes.body ? inspectHtmlDocument(homeRes.body) : { title: parsed.hostname, meta_description: "" };
  const candidateUrls = new Set([`${origin}/`]);

  if (sitemapRes.status === 200 && sitemapRes.body) {
    for (const m of sitemapRes.body.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi)) {
      try {
        const u = new URL(m[1].trim());
        if (u.origin === origin && !u.pathname.endsWith(".xml")) {
          candidateUrls.add(u.toString());
        }
      } catch {
        // ignore invalid URL
      }
      if (candidateUrls.size >= maxLinks * 3) break;
    }
  }

  if (homeRes.body && candidateUrls.size < maxLinks) {
    for (const m of homeRes.body.matchAll(/<a\b[^>]*href\s*=\s*["']([^"'#]+)["']/gi)) {
      try {
        const u = new URL(m[1].trim(), origin);
        if (u.origin === origin && (u.protocol === "https:" || u.protocol === "http:")) {
          candidateUrls.add(u.toString());
        }
      } catch {
        // ignore
      }
      if (candidateUrls.size >= maxLinks * 2) break;
    }
  }

  const selectedUrls = [...candidateUrls].slice(0, maxLinks);
  const pageSummaries = await Promise.all(
    selectedUrls.map(async (u) => {
      if (u === pageUrl && homeRes.body) {
        return {
          url: u,
          pathname: new URL(u).pathname,
          title: homeInfo.title || parsed.hostname,
          description: homeInfo.meta_description || "Official homepage",
          ok: homeRes.status === 200,
        };
      }
      const r = await fetchResource(u, Math.min(timeoutSec, 8));
      if (r.status !== 200 || !r.body) return { url: u, pathname: new URL(u).pathname, ok: false };
      const inf = inspectHtmlDocument(r.body);
      return {
        url: u,
        pathname: new URL(u).pathname,
        title: inf.title || new URL(u).pathname,
        description: inf.meta_description || "",
        ok: true,
      };
    })
  );

  const validPages = pageSummaries.filter((p) => p.ok);
  const grouped = new Map();
  for (const p of validPages) {
    const sec = classifyPathSection(p.pathname);
    if (!grouped.has(sec)) grouped.set(sec, []);
    grouped.get(sec).push(p);
  }

  const siteTitle = homeInfo.title ? homeInfo.title.split(/\s+[|\-–—]\s+/)[0].trim() : parsed.hostname;
  const summaryLine =
    homeInfo.meta_description || `Machine-readable index of ${siteTitle} (${origin}) for AI search engines and LLM agents.`;

  const mdLines = [`# ${siteTitle}`, "", `> ${summaryLine}`, ""];
  for (const [sec, items] of grouped.entries()) {
    mdLines.push(`## ${sec}`, "");
    for (const item of items) {
      const descSuffix = item.description ? `: ${item.description.replace(/\s+/g, " ").slice(0, 160)}` : "";
      mdLines.push(`- [${item.title}](${item.url})${descSuffix}`);
    }
    mdLines.push("");
  }

  return {
    mode: "generate",
    origin,
    pages_indexed: validPages.length,
    generated_markdown: mdLines.join("\n").trim() + "\n",
    platform: "https://www.innflows.com/platform/website-ai-audit",
  };
}

export async function inspectSchemaEntityGraph(targetUrl, timeoutSec = 12) {
  const { origin, pageUrl } = normalizeUrlInput(targetUrl);
  const page = await fetchResource(pageUrl, timeoutSec);
  if (page.status !== 200 || !page.body) {
    return {
      url: pageUrl,
      origin,
      http_status: page.status,
      error: `Target URL returned HTTP ${page.status}`,
    };
  }

  const info = inspectHtmlDocument(page.body);
  const graph = extractSchemaGraphFromHtml(page.body);

  const recommended = ["Organization", "WebSite"];
  const typeSet = new Set(graph.unique_types);
  const hasAppOrProductOrArticle =
    typeSet.has("SoftwareApplication") ||
    typeSet.has("WebApplication") ||
    typeSet.has("Product") ||
    typeSet.has("Article") ||
    typeSet.has("BlogPosting") ||
    typeSet.has("TechArticle");

  const missingCore = recommended.filter((t) => !typeSet.has(t));
  if (!hasAppOrProductOrArticle) {
    missingCore.push("SoftwareApplication | Product | Article");
  }

  const sampleSameAs = graph.same_as_urls.slice(0, 8);
  const sameAsChecks = await Promise.all(
    sampleSameAs.map(async (u) => {
      try {
        const r = await fetchResource(u, Math.min(timeoutSec, 8));
        return { url: u, http_status: r.status, reachable: r.status >= 200 && r.status < 405 };
      } catch {
        return { url: u, http_status: 0, reachable: false };
      }
    })
  );

  const starterTemplate =
    missingCore.length > 0
      ? {
          "@context": "https://schema.org",
          "@graph": [
            {
              "@type": "Organization",
              "@id": `${origin}/#organization`,
              name: info.title ? info.title.split(/\s+[|\-–—]\s+/)[0].trim() : new URL(origin).hostname,
              url: origin,
              sameAs: graph.same_as_urls.length > 0 ? graph.same_as_urls : [`https://github.com/YOUR_ORG`],
            },
            {
              "@type": "WebSite",
              "@id": `${origin}/#website`,
              url: origin,
              name: info.title || new URL(origin).hostname,
              publisher: { "@id": `${origin}/#organization` },
            },
          ],
        }
      : null;

  return {
    url: pageUrl,
    origin,
    http_status: page.status,
    blocks_count: graph.blocks_count,
    parse_errors: graph.parse_errors,
    unique_types: graph.unique_types,
    defined_ids: graph.defined_ids,
    dangling_id_references: graph.dangling_ids,
    entities: graph.entities,
    same_as_count: graph.same_as_urls.length,
    sampled_same_as_checks: sameAsChecks,
    missing_recommended_types: missingCore,
    suggested_json_ld_template: starterTemplate,
    platform: "https://www.innflows.com/platform/website-ai-audit",
  };
}

export async function compareWebsites(urls, timeoutSec = 12) {
  if (!Array.isArray(urls) || urls.length < 2) {
    throw new Error("Please provide at least 2 URLs to compare.");
  }
  const capped = urls.slice(0, 5);
  const reports = await Promise.all(capped.map((u) => runAudit(u, timeoutSec)));

  const rows = reports.map((r) => {
    const byId = Object.fromEntries((r.checks || []).map((c) => [c.id, c]));
    return {
      url: r.url,
      score: r.score ?? 0,
      passed: `${r.passed ?? 0}/${r.total ?? 0}`,
      ssr_status: byId.ssr_text?.detail || "n/a",
      json_ld: byId.json_ld?.detail || "n/a",
      ai_crawlers: byId.ai_crawlers?.detail || "n/a",
      llms_txt: byId.llms_txt?.detail || "n/a",
      sitemap_xml: byId.sitemap_xml?.detail || "n/a",
    };
  });

  const mdLines = [
    "| Website | Score | Passed | SSR HTML Text | Schema.org JSON-LD | AI Crawlers (robots.txt) | /llms.txt | /sitemap.xml |",
    "| :--- | :---: | :---: | :--- | :--- | :--- | :--- | :--- |",
    ...rows.map(
      (r) =>
        `| ${r.url} | **${r.score}/100** | ${r.passed} | ${r.ssr_status} | ${r.json_ld} | ${r.ai_crawlers} | ${r.llms_txt} | ${r.sitemap_xml} |`
    ),
  ];

  return {
    compared_count: rows.length,
    markdown_table: mdLines.join("\n"),
    results: rows,
    raw_reports: reports,
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

export function formatProbeText(probeReport) {
  const lines = [
    "",
    `AI Crawler Live HTTP & WAF Probe — ${probeReport.url}`,
    "=".repeat(78),
    `${"Agent".padEnd(20)} | ${"robots.txt".padEnd(15)} | ${"HTTP".padEnd(6)} | ${"SSR Chars".padEnd(10)} | Diagnosis`,
    "-".repeat(78),
  ];
  for (const p of probeReport.probes) {
    const diag = p.silent_waf_block
      ? `SILENT WAF BLOCK (${p.waf_diagnosis || `HTTP ${p.http_status}`})`
      : p.waf_diagnosis || "OK";
    lines.push(
      `${p.agent.padEnd(20)} | ${String(p.robots_txt_posture).padEnd(15)} | ${String(p.http_status).padEnd(6)} | ${String(p.visible_text_chars).padEnd(10)} | ${diag}`
    );
  }
  lines.push("-".repeat(78));
  lines.push(
    probeReport.silent_waf_blocks_detected
      ? `Result: WARN — Silent WAF/CDN blocks detected for: ${probeReport.silent_blocked_agents.join(", ")}`
      : "Result: PASS — Live HTTP responses match /robots.txt posture across all probed AI crawlers."
  );
  lines.push("");
  return lines.join("\n");
}

export const MCP_TOOLS = [
  {
    name: "audit_website_ai_readiness",
    description:
      "Run a comprehensive 9-check Generative Engine Optimization (GEO / AEO) technical readiness audit on a single public webpage URL. Use this first for an overall 0-100 readiness score covering HTTP reachability, noindex directives, initial SSR HTML text extractability, canonical/meta tags, Schema.org JSON-LD presence, /robots.txt AI crawler rules, /llms.txt, and /sitemap.xml. For live WAF/Cloudflare bot-blocking tests, deep llms.txt generation, or multi-site comparisons, use the specialized tools in this server.",
    inputSchema: {
      type: "object",
      properties: {
        url: {
          type: "string",
          description: "Public webpage URL to audit (e.g. https://www.innflows.com/platform).",
        },
        timeout_seconds: {
          type: "number",
          description: "Per-request HTTP timeout in seconds (default: 12, range: 3-30).",
          default: 12,
        },
      },
      required: ["url"],
    },
    annotations: {
      title: "Audit Website AI Readiness",
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
  },
  {
    name: "probe_ai_crawler_access",
    description:
      "Simulate live HTTP requests with real AI search crawler User-Agent headers (OAI-SearchBot, GPTBot, ChatGPT-User, ClaudeBot, PerplexityBot, Google-Extended, Applebot-Extended) alongside a browser baseline to detect silent WAF, CDN, or Cloudflare bot challenges that block AI retrievers even when /robots.txt allows them. Use this when diagnosing why AI search engines fail to fetch or cite an otherwise indexable page.",
    inputSchema: {
      type: "object",
      properties: {
        url: {
          type: "string",
          description: "Public webpage URL to probe across AI crawler User-Agents (e.g. https://www.innflows.com).",
        },
        timeout_seconds: {
          type: "number",
          description: "Per-request HTTP timeout in seconds (default: 12).",
          default: 12,
        },
      },
      required: ["url"],
    },
    annotations: {
      title: "Probe Live AI Crawler & WAF Access",
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
  },
  {
    name: "inspect_or_generate_llms_txt",
    description:
      "Validate an existing /llms.txt machine-readable index against the llmstxt.org Markdown specification (checking H1 title, summary blockquote, section headings, SPA HTML soft-200 fallbacks, and dead links) OR synthesize a ready-to-publish /llms.txt file from a website's homepage and /sitemap.xml. Set mode='validate' to audit a live /llms.txt, or mode='generate' to draft one.",
    inputSchema: {
      type: "object",
      properties: {
        url: {
          type: "string",
          description: "Website root URL or direct /llms.txt URL (e.g. https://www.innflows.com).",
        },
        mode: {
          type: "string",
          enum: ["validate", "generate"],
          description: "Operation mode: 'validate' inspects the live /llms.txt and samples link health; 'generate' crawls sitemap.xml and homepage metadata to draft a compliant Markdown /llms.txt.",
          default: "validate",
        },
        max_links: {
          type: "number",
          description: "Maximum same-origin URLs to include when mode='generate' (default: 20, max: 50).",
          default: 20,
        },
        timeout_seconds: {
          type: "number",
          description: "Per-request HTTP timeout in seconds (default: 12).",
          default: 12,
        },
      },
      required: ["url"],
    },
    annotations: {
      title: "Validate or Generate llms.txt",
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
  },
  {
    name: "inspect_schema_entity_graph",
    description:
      "Deeply inspect all Schema.org JSON-LD blocks on a webpage, extracting @type entities, @id node anchors, dangling internal #fragment @id references, and Organization.sameAs authority links (with live HTTP reachability checks). Also generates a starter @graph JSON-LD snippet when core GEO entities (Organization, WebSite, SoftwareApplication/Product/Article) are missing.",
    inputSchema: {
      type: "object",
      properties: {
        url: {
          type: "string",
          description: "Public webpage URL whose Schema.org JSON-LD entity graph should be analyzed.",
        },
        timeout_seconds: {
          type: "number",
          description: "Per-request HTTP timeout in seconds (default: 12).",
          default: 12,
        },
      },
      required: ["url"],
    },
    annotations: {
      title: "Inspect Schema.org JSON-LD Entity Graph",
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
  },
  {
    name: "compare_websites_ai_readiness",
    description:
      "Benchmark 2 to 5 public websites side by side across all GEO/AEO AI-readiness dimensions (overall score, SSR visible HTML characters, Schema.org JSON-LD types, /robots.txt AI crawler rules, /llms.txt, and /sitemap.xml) and return both a ready-to-share Markdown comparison table and structured JSON results. Use this for competitive GEO benchmarking.",
    inputSchema: {
      type: "object",
      properties: {
        urls: {
          type: "array",
          items: { type: "string" },
          minItems: 2,
          maxItems: 5,
          description: "List of 2 to 5 public webpage URLs to benchmark side by side.",
        },
        timeout_seconds: {
          type: "number",
          description: "Per-request HTTP timeout in seconds (default: 12).",
          default: 12,
        },
      },
      required: ["urls"],
    },
    annotations: {
      title: "Compare Websites AI Readiness",
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
  },
];

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
        tools: MCP_TOOLS,
      },
    };
  }

  if (method === "tools/call") {
    const toolName = params?.name;
    const args = params?.arguments || {};
    const timeoutSec = Number(args.timeout_seconds || 12);

    try {
      if (toolName === "audit_website_ai_readiness") {
        if (!args.url || typeof args.url !== "string") {
          return { jsonrpc: "2.0", id, error: { code: -32602, message: "Missing required string parameter: url" } };
        }
        const report = await auditFn(args.url, timeoutSec);
        return {
          jsonrpc: "2.0",
          id,
          result: {
            content: [{ type: "text", text: `${formatReportText(report)}\n${JSON.stringify(report, null, 2)}` }],
            isError: false,
          },
        };
      }

      if (toolName === "probe_ai_crawler_access") {
        if (!args.url || typeof args.url !== "string") {
          return { jsonrpc: "2.0", id, error: { code: -32602, message: "Missing required string parameter: url" } };
        }
        const report = await probeCrawlerAccess(args.url, timeoutSec);
        return {
          jsonrpc: "2.0",
          id,
          result: {
            content: [{ type: "text", text: `${formatProbeText(report)}\n${JSON.stringify(report, null, 2)}` }],
            isError: false,
          },
        };
      }

      if (toolName === "inspect_or_generate_llms_txt") {
        if (!args.url || typeof args.url !== "string") {
          return { jsonrpc: "2.0", id, error: { code: -32602, message: "Missing required string parameter: url" } };
        }
        const report = await inspectOrGenerateLlmsTxt(args.url, {
          mode: args.mode || "validate",
          maxLinks: args.max_links || 20,
          timeoutSec,
        });
        const textOut =
          report.mode === "generate" && report.generated_markdown
            ? `${report.generated_markdown}\n---\n${JSON.stringify({ origin: report.origin, pages_indexed: report.pages_indexed }, null, 2)}`
            : JSON.stringify(report, null, 2);
        return {
          jsonrpc: "2.0",
          id,
          result: {
            content: [{ type: "text", text: textOut }],
            isError: false,
          },
        };
      }

      if (toolName === "inspect_schema_entity_graph") {
        if (!args.url || typeof args.url !== "string") {
          return { jsonrpc: "2.0", id, error: { code: -32602, message: "Missing required string parameter: url" } };
        }
        const report = await inspectSchemaEntityGraph(args.url, timeoutSec);
        return {
          jsonrpc: "2.0",
          id,
          result: {
            content: [{ type: "text", text: JSON.stringify(report, null, 2) }],
            isError: false,
          },
        };
      }

      if (toolName === "compare_websites_ai_readiness") {
        if (!Array.isArray(args.urls) || args.urls.length < 2) {
          return { jsonrpc: "2.0", id, error: { code: -32602, message: "Parameter 'urls' must be an array of 2 to 5 URLs" } };
        }
        const report = await compareWebsites(args.urls, timeoutSec);
        return {
          jsonrpc: "2.0",
          id,
          result: {
            content: [{ type: "text", text: `${report.markdown_table}\n\n${JSON.stringify(report.results, null, 2)}` }],
            isError: false,
          },
        };
      }

      return {
        jsonrpc: "2.0",
        id,
        error: { code: -32601, message: `Unknown tool: ${toolName}` },
      };
    } catch (err) {
      return {
        jsonrpc: "2.0",
        id,
        result: {
          content: [{ type: "text", text: `Tool execution error: ${err.message || String(err)}` }],
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

function printHelp() {
  console.log(
    [
      `@innflows/ai-readiness-audit v${PKG_VERSION} — GEO & AEO Website AI-Readiness Toolkit`,
      "",
      "Usage:",
      "  npx @innflows/ai-readiness-audit <url> [--json] [--fail-under 80] [--timeout 12]",
      "  npx @innflows/ai-readiness-audit probe-crawlers <url> [--json]",
      "  npx @innflows/ai-readiness-audit llms-txt <url> [--generate] [--max-links 20] [--json]",
      "  npx @innflows/ai-readiness-audit schema-graph <url> [--json]",
      "  npx @innflows/ai-readiness-audit compare <url1> <url2> [url3...] [--json]",
      "  npx -y @innflows/ai-readiness-audit --mcp   # Start 5-tool MCP stdio server",
      "",
      "Maintained by Innflows GEO (https://www.innflows.com/platform/website-ai-audit)",
    ].join("\n")
  );
}

async function main() {
  const argv = process.argv.slice(2);
  const invokedAsMcp = (process.argv[1] || "").endsWith("ai-readiness-audit-mcp");
  if (invokedAsMcp || argv.includes("--mcp")) {
    startMcpStdioServer();
    return;
  }

  if (argv.includes("-v") || argv.includes("--version")) {
    console.log(PKG_VERSION);
    return;
  }

  if (argv.includes("-h") || argv.includes("--help") || argv.length === 0) {
    printHelp();
    process.exit(argv.length === 0 ? 1 : 0);
  }

  const jsonOut = argv.includes("--json");
  const getNumFlag = (flag, fallback) => {
    const idx = argv.indexOf(flag);
    return idx !== -1 && argv[idx + 1] ? Number(argv[idx + 1]) : fallback;
  };
  const timeoutSec = getNumFlag("--timeout", 12) || 12;
  const failUnder = getNumFlag("--fail-under", null);
  const maxLinks = getNumFlag("--max-links", 20) || 20;

  const valuedFlags = new Set(["--timeout", "--fail-under", "--max-links"]);
  const positional = [];
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (valuedFlags.has(a)) {
      i += 1;
      continue;
    }
    if (!a.startsWith("-")) positional.push(a);
  }

  const subcommands = new Set(["audit", "probe-crawlers", "llms-txt", "schema-graph", "compare"]);
  const cmd = subcommands.has(positional[0]) ? positional[0] : "audit";
  const targets = subcommands.has(positional[0]) ? positional.slice(1) : positional;

  if (cmd === "compare") {
    if (targets.length < 2) {
      console.error("Error: 'compare' requires 2 to 5 URLs.");
      process.exit(1);
    }
    const cmp = await compareWebsites(targets, timeoutSec);
    console.log(jsonOut ? JSON.stringify(cmp, null, 2) : `\n${cmp.markdown_table}\n`);
    return;
  }

  const targetUrl = targets[0];
  if (!targetUrl) {
    console.error("Error: missing <url> argument.");
    process.exit(1);
  }

  if (cmd === "probe-crawlers") {
    const res = await probeCrawlerAccess(targetUrl, timeoutSec);
    console.log(jsonOut ? JSON.stringify(res, null, 2) : formatProbeText(res));
    if (failUnder !== null && res.silent_waf_blocks_detected) process.exit(2);
    return;
  }

  if (cmd === "llms-txt") {
    const generate = argv.includes("--generate");
    const res = await inspectOrGenerateLlmsTxt(targetUrl, {
      mode: generate ? "generate" : "validate",
      maxLinks,
      timeoutSec,
    });
    if (jsonOut) {
      console.log(JSON.stringify(res, null, 2));
    } else if (generate) {
      process.stdout.write(res.generated_markdown);
    } else {
      console.log(JSON.stringify(res, null, 2));
    }
    return;
  }

  if (cmd === "schema-graph") {
    const res = await inspectSchemaEntityGraph(targetUrl, timeoutSec);
    console.log(JSON.stringify(res, null, 2));
    return;
  }

  const report = await runAudit(targetUrl, timeoutSec);
  if (jsonOut) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log(formatReportText(report));
  }
  if (failUnder !== null && !Number.isNaN(failUnder) && report.score < failUnder) {
    console.error(`CI Gate Failed: score ${report.score}/100 is below --fail-under ${failUnder}.`);
    process.exit(2);
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
