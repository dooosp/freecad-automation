from copy import deepcopy
from html.parser import HTMLParser
from unittest import TestCase

from incoming_inspection.report import render_diff, render_review


class ReportLinks(HTMLParser):
    def __init__(self, document):
        super().__init__()
        self.links = []
        self.ids = []
        self.feed(document)

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        if "id" in attrs:
            self.ids.append(attrs["id"])
        if tag == "a" and "href" in attrs:
            self.links.append(attrs["href"])


def review_fixture():
    common = {
        "characteristic": "H1",
        "drawing_ref": "도면 1 / B-2",
        "unit": "mm",
        "lower": "9.90",
        "upper": "10.10",
    }
    outside = {
        **common,
        "sample": "S2",
        "measured_value": "10.20",
        "measured_unit": "mm",
        "measured_mm": "10.20",
        "deviation_mm": "0.1",
        "supplier_result": "pass",
        "computed_result": "out_of_tolerance",
        "reasons": ["above_upper_limit", "supplier_result_mismatch"],
        "source_rows": [1],
    }
    missing = {
        **common,
        "sample": "S3",
        "measured_mm": None,
        "supplier_result": None,
        "computed_result": "missing",
        "reasons": ["missing_measurement"],
        "source_rows": [],
    }
    return {
        "schema_version": 1,
        "rule_version": "1",
        "identity": {"part": "BRACKET", "revision": "B", "lot": "L42", "supplier": "A"},
        "supplier_source": "operator",
        "inputs": {
            "requirements": {"sha256": "1" * 64, "path": "inputs/requirements.json"},
            "mapping": {"sha256": "2" * 64, "path": "inputs/mapping.json"},
            "measurements": {"sha256": "3" * 64, "path": "inputs/measurements.csv"},
        },
        "requirements": {
            "part": "BRACKET",
            "revision": "B",
            "characteristics": [{
                "id": "H1",
                "drawing_ref": "도면 1 / B-2",
                "unit": "mm",
                "lower": "9.90",
                "upper": "10.10",
                "samples": ["S2", "S3"],
            }],
        },
        "source": {
            "headers": ["측정값", "비고"],
            "rows": [{"row": 1, "cells": ["10.20", '확인, 필요\n<script>alert("x")</script>']}],
        },
        "results": [outside, missing],
        "unmatched_rows": [],
    }


class ReportTest(TestCase):
    def assert_local_links_resolve(self, document):
        links = ReportLinks(document)
        for link in links.links:
            self.assertTrue(link.startswith("#"), link)
            self.assertIn(link[1:], links.ids)
        self.assertEqual(len(links.ids), len(set(links.ids)))
        return links

    def test_review_links_measurement_to_original_and_missing_to_requirement(self):
        html = render_review(review_fixture())
        links = self.assert_local_links_resolve(html)
        self.assertIn("#source-row-1", links.links)
        self.assertIn("#requirement-1", links.links)
        self.assertIn("공급사 판정과 불일치", html)
        self.assertIn("상한 초과 0.1 mm", html)
        self.assertIn("도면 1 / B-2", html)
        self.assertIn("담당자 입력", html)

    def test_review_preserves_korean_headers_multiline_cells_and_escapes_html(self):
        html = render_review(review_fixture())
        self.assertIn("측정값", html)
        self.assertIn("확인, 필요\n&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;", html)
        self.assertNotIn("<script", html)

    def test_diff_displays_both_measurements_and_resolves_both_embedded_sources(self):
        before = review_fixture()
        after = deepcopy(before)
        revised = after["results"][0]
        revised.update({
            "measured_value": "10.02",
            "measured_mm": "10.02",
            "deviation_mm": None,
            "computed_result": "in_tolerance",
            "reasons": [],
        })
        after["source"]["rows"][0]["cells"][0] = "10.02"
        comparison = {
            "schema_version": 1,
            "mode": "comparison",
            "reasons": [],
            "inputs": {"before": "a" * 64, "after": "b" * 64},
            "before": before,
            "after": after,
            "changes": [{
                "characteristic": "H1",
                "sample": "S2",
                "kind": "changed",
                "before": before["results"][0],
                "after": revised,
            }, {
                "characteristic": "H1",
                "sample": "S3",
                "kind": "unresolved",
                "before": before["results"][1],
                "after": after["results"][1],
            }],
            "unmatched_changes": [],
        }
        html = render_diff(comparison)
        links = self.assert_local_links_resolve(html)
        for side in ("before", "after"):
            self.assertIn(f"#{side}-source-row-1", links.links)
            self.assertIn(f"#{side}-requirement-1", links.links)
        for value in ("10.20 mm", "10.02 mm", "미해결"):
            self.assertIn(value, html)

    def test_diff_displays_recheck_reason(self):
        comparison = {
            "schema_version": 1,
            "mode": "full_review_required",
            "reasons": ["requirements_changed"],
            "inputs": {"before": "a" * 64, "after": "b" * 64},
            "before": review_fixture(),
            "after": review_fixture(),
            "changes": [],
            "unmatched_changes": [],
        }
        html = render_diff(comparison)
        self.assert_local_links_resolve(html)
        self.assertIn("전체 재검토", html)
        self.assertIn("구매자 검사 기준 변경", html)
