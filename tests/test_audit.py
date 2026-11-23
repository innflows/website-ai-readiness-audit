import unittest
from ai_readiness_audit import inspect_html_document, parse_robots_rules


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

    def test_html_inspector_extracts_text_and_json_ld(self) -> None:
        html = """<!doctype html>
        <html><head>
          <title>Innflows GEO Platform</title>
          <meta name="description" content="Generative Engine Optimization platform">
          <meta name="robots" content="index, follow">
          <link rel="canonical" href="https://www.innflows.com/platform">
          <script type="application/ld+json">
            {"@context":"https://schema.org","@type":"Organization","@id":"https://www.innflows.com/#organization","name":"Innflows"}
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


if __name__ == "__main__":
    unittest.main()
