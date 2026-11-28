import json
import unittest

from incoming_inspection.ingest import load_measurements, load_requirements


MAPPING = {
    "part": "부품",
    "revision": "개정",
    "lot": "로트",
    "sample": "표본",
    "characteristic": "특성",
    "value": "측정값",
    "unit": "단위",
    "supplier_result": "판정",
}
HEADER = "부품,개정,로트,표본,특성,측정값,단위,판정,메모\r\n"
ROW = 'P,B,L42,S1,H1, 10.10 ,mm,합격,"쉼표,\r\n다음 줄"\r\n'


def encode_json(value):
    return json.dumps(value, ensure_ascii=False).encode()


class MeasurementInputTests(unittest.TestCase):
    def test_preserves_raw_headers_and_cells_with_logical_row_numbers(self):
        data = ("\ufeff" + HEADER + ROW + "\r\n" + ROW).encode()
        headers, rows, supplier_source = load_measurements(data, encode_json(MAPPING))
        self.assertEqual(headers, [*MAPPING.values(), "메모"])
        self.assertEqual([row["row"] for row in rows], [1, 2])
        self.assertEqual(rows[0]["cells"][-1], "쉼표,\r\n다음 줄")
        self.assertEqual(rows[0]["cells"][5], " 10.10 ")
        self.assertEqual(rows[0]["value"], "10.10")
        self.assertEqual(rows[0]["supplier_result"], "합격")
        self.assertIsNone(rows[0]["supplier"])
        self.assertEqual(supplier_source, "operator")

    def test_missing_and_empty_optional_supplier_are_distinct(self):
        mapping = {**MAPPING, "supplier": "메모"}
        _, rows, supplier_source = load_measurements(
            (HEADER + "P,B,L42,S1,H1,10.10,mm,합격,\r\n").encode(),
            encode_json(mapping),
        )
        self.assertEqual(rows[0]["supplier"], "")
        self.assertEqual(supplier_source, "csv")

    def test_header_only_means_zero_measurements(self):
        _, rows, supplier_source = load_measurements(HEADER.encode(), encode_json(MAPPING))
        self.assertEqual(rows, [])
        self.assertEqual(supplier_source, "operator")

    def test_compact_measurements_preserve_the_unit_printed_on_the_value_header(self):
        mapping = {field: name for field, name in MAPPING.items() if field != "unit"}
        for unit in ("mm", "in", "inch"):
            with self.subTest(unit=unit):
                header = f"실측({unit})"
                mapping["value"] = header
                data = (",".join(mapping.values()) + "\nP,B,L42,S1,H1,10.10,합격\n").encode()
                headers, rows, supplier_source = load_measurements(data, encode_json(mapping))
                self.assertEqual(headers[5], header)
                self.assertEqual(rows[0]["unit"], unit)
                self.assertEqual(rows[0]["cells"][5], "10.10")
                self.assertEqual(supplier_source, "operator")

    def test_missing_unit_mapping_cannot_supply_an_unlabelled_or_ambiguous_unit(self):
        mapping = {field: name for field, name in MAPPING.items() if field != "unit"}
        for header in ("실측", "실측(um)", "실측(inch/mm)", "실측(mm)(in)", "실측(in)[mm]"):
            with self.subTest(header=header), self.assertRaisesRegex(ValueError, "unit"):
                mapping["value"] = header
                load_measurements((",".join(mapping.values()) + "\n").encode(), encode_json(mapping))

    def test_header_only_retains_mapped_supplier_source(self):
        mapping = {**MAPPING, "supplier": "메모"}
        _, rows, supplier_source = load_measurements(HEADER.encode(), encode_json(mapping))
        self.assertEqual(rows, [])
        self.assertEqual(supplier_source, "csv")

    def test_rejects_ambiguous_or_missing_csv_columns(self):
        for header, message in (
            (HEADER.replace("메모", "측정값"), "duplicate CSV header"),
            (HEADER.replace("측정값", "새측정값"), "mapped CSV column"),
        ):
            with self.subTest(header=header), self.assertRaisesRegex(ValueError, message):
                load_measurements(header.encode(), encode_json(MAPPING))

    def test_rejects_csv_that_cannot_be_read_as_a_rectangular_table(self):
        for data in (HEADER + "P,B,L42\n", HEADER + 'P,B,L42,S1,H1,"10.10'):
            with self.subTest(data=data), self.assertRaisesRegex(ValueError, "CSV row 1"):
                load_measurements(data.encode(), encode_json(MAPPING))

    def test_rejects_competing_mapping_targets_and_unknown_fields(self):
        for mapping, message in (
            ({**MAPPING, "supplier": "판정"}, "multiple fields"),
            ({**MAPPING, "suplier": "메모"}, "unknown mapping field"),
        ):
            with self.subTest(mapping=mapping), self.assertRaisesRegex(ValueError, message):
                load_measurements(HEADER.encode(), encode_json(mapping))

    def test_rejects_non_utf8_input_and_duplicate_json_keys(self):
        with self.assertRaisesRegex(ValueError, "UTF-8"):
            load_measurements(b"\xff", encode_json(MAPPING))
        with self.assertRaisesRegex(ValueError, "duplicate JSON key"):
            load_measurements(HEADER.encode(), b'{"part":"a","part":"b"}')


class RequirementsInputTests(unittest.TestCase):
    def test_preserves_numeric_limits_without_binary_float_rounding(self):
        document = b'''{
          "part":"P", "revision":"B",
          "characteristics":[{
            "id":"H1", "drawing_ref":"D-1", "unit":"mm",
            "lower":9.9000000000000000001, "upper":"10.10", "samples":["S1"]
          }]
        }'''
        loaded = load_requirements(document)
        limit = loaded["characteristics"][0]
        self.assertEqual(limit["lower"], "9.9000000000000000001")
        self.assertEqual(limit["upper"], "10.10")

    def test_retains_missing_and_unsupported_limits_for_review(self):
        char = {"id": "H1", "drawing_ref": "D-1", "upper": "unknown", "samples": ["S1"]}
        loaded = load_requirements(encode_json({"part": "P", "revision": "B", "characteristics": [char]}))
        self.assertEqual(loaded["characteristics"][0], {**char, "lower": None, "unit": None})

    def test_rejects_duplicate_required_sample_and_characteristic_ids(self):
        char = {"id": "H1", "drawing_ref": "D-1", "samples": ["S1"]}
        for chars, message in (
            ([char, char], "duplicate characteristic id"),
            ([{**char, "samples": ["S1", " S1 "]}], "duplicate sample id"),
        ):
            document = {"part": "P", "revision": "B", "characteristics": chars}
            with self.subTest(chars=chars), self.assertRaisesRegex(ValueError, message):
                load_requirements(encode_json(document))

    def test_rejects_ambiguous_structure(self):
        char = {"id": "H1", "drawing_ref": "D-1", "unit": "mm", "lower": True, "samples": ["S1"]}
        document = {"part": "P", "revision": "B", "characteristics": [char]}
        with self.assertRaisesRegex(ValueError, "lower"):
            load_requirements(encode_json(document))
        with self.assertRaisesRegex(ValueError, "characteristics"):
            load_requirements(encode_json({**document, "characteristics": []}))
