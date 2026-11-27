import unittest
from ai_readiness_audit import (
    detect_waf_challenge,
    extract_schema_graph_from_html,
    inspect_html_document,
    parse_llms_txt_document,
    parse_robots_rules,
)


class TestAIReadinessAudit(unittest.TestCase):
    def test_robots_allows_and_blocks(self) -> None:
        txt = """
        User-agent: *
        Allow: /

        User-agent: GPTBot
        Disallow: /

        User-agent: OAI-SearchBot
        Allow: /
        """
        posture = parse_robots_rules(txt)
        self.assertEqual(posture["GPTBot"], "blocked")
        self.assertEqual(posture["OAI-SearchBot"], "allowed")
        self.assertEqual(posture["Googlebot"], "allowed")

    def test_html_inspector_and_schema_graph(self) -> None:
        html = """<!doctype html>
        <html><head>
          <title>Innflows GEO Platform</title>
          <meta name="description" content="Generative Engine Optimization platform">
          <meta name="robots" content="index, follow">
          <link rel="canonical" href="https://www.innflows.com/platform">
          <script type="application/ld+json">
            {
              "@context":"https://schema.org",
              "@graph":[
                {"@type":"Organization","@id":"https://www.innflows.com/#organization","name":"Innflows","sameAs":["https://github.com/innflows"]},
                {"@type":"WebSite","publisher":{"@id":"https://www.innflows.com/#organization"},"creator":{"@id":"https://www.innflows.com/#dangling"}}
              ]
            }
          </script>
        </head><body>
          <main><h1>AI Search Visibility Monitoring</h1><p>Track cited URLs across AI search engines.</p></main>
        </body></html>"""
        info = inspect_html_document(html)
        self.assertEqual(info["title"], "Innflows GEO Platform")
        self.assertEqual(info["canonical"], "https://www.innflows.com/platform")
        self.assertIn("Organization", info["schema_types"])
        self.assertIn("https://www.innflows.com/#organization", info["schema_ids"])
        self.assertGreater(info["visible_text_chars"], 40)

        graph = extract_schema_graph_from_html(html)
        self.assertEqual(graph["dangling_ids"], ["https://www.innflows.com/#dangling"])
        self.assertEqual(graph["same_as_urls"], ["https://github.com/innflows"])

    def test_llms_txt_and_waf_detection(self) -> None:
        md = "# Innflows\n> GEO & AEO platform\n## Docs\n- [Platform](https://www.innflows.com/platform): Overview\n"
        parsed = parse_llms_txt_document(md)
        self.assertTrue(parsed["valid_spec"])
        self.assertEqual(parsed["links_count"], 1)

        bad = parse_llms_txt_document("<!DOCTYPE html><html><body>SPA shell</body></html>")
        self.assertFalse(bad["valid_spec"])
        self.assertTrue(bad["is_html_fallback"])

        self.assertEqual(
            detect_waf_challenge(403, {"cf-mitigated": "challenge"}, "Just a moment..."),
            "cloudflare_challenge_header",
        )


if __name__ == "__main__":
    unittest.main()
