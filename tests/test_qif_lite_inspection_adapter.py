from pathlib import Path

from scripts.adapters.load_qif_lite_inspection import parse_qif_lite_xml


def test_parse_qif_lite_xml_maps_measured_features(tmp_path):
    xml_path = tmp_path / "supplier-qif-lite.xml"
    xml_path.write_text(
        """<?xml version="1.0"?>
<QIFDocument>
  <Inspection>
    <PackageId>quality-pass-bracket</PackageId>
    <InspectedPart>quality_pass_bracket_rev_a</InspectedPart>
    <InspectedAt>2026-07-01T09:00:00Z</InspectedAt>
    <SourceType>supplier_inspection_report</SourceType>
    <OverallResult>pass</OverallResult>
    <Inspector>Supplier QA</Inspector>
    <ReviewedBy>Incoming QA</ReviewedBy>
    <PartRevision>A</PartRevision>
    <Units>mm</Units>
    <Feature>
      <FeatureId>MOUNTING_HOLE_DIA</FeatureId>
      <NominalValue>6.0</NominalValue>
      <MeasuredValue>6.01</MeasuredValue>
      <ToleranceLower>-0.05</ToleranceLower>
      <ToleranceUpper>0.05</ToleranceUpper>
      <Result>pass</Result>
      <MeasurementMethod>CMM</MeasurementMethod>
    </Feature>
  </Inspection>
</QIFDocument>
""",
        encoding="utf-8",
    )

    report = parse_qif_lite_xml(
        xml_path,
        source_ref="docs/examples/quality-pass-bracket/inspection/supplier-qif-lite.xml",
    )

    assert report["schema_version"] == "1.0"
    assert report["adapter"] == "qif-lite"
    assert report["inspection_evidence"]["evidence_type"] == "inspection_evidence"
    assert report["inspection_evidence"]["package_id"] == "quality-pass-bracket"
    assert report["inspection_evidence"]["overall_result"] == "pass"
    assert report["inspection_evidence"]["measured_features"][0]["feature_id"] == "MOUNTING_HOLE_DIA"
    assert report["classification"]["attachment_ready_candidate"] is True


def test_parse_qif_lite_xml_rejects_when_only_feature_is_not_measured(tmp_path):
    xml_path = tmp_path / "supplier-qif-lite.xml"
    xml_path.write_text(
        """<?xml version="1.0"?>
<QIFDocument>
  <Inspection>
    <PackageId>quality-pass-bracket</PackageId>
    <InspectedPart>quality_pass_bracket_rev_a</InspectedPart>
    <InspectedAt>2026-07-01T09:00:00Z</InspectedAt>
    <SourceType>supplier_inspection_report</SourceType>
    <OverallResult>pass</OverallResult>
    <Units>mm</Units>
    <Feature>
      <FeatureId>MOUNTING_HOLE_DIA</FeatureId>
      <Result>not_measured</Result>
      <MeasurementMethod>CMM</MeasurementMethod>
    </Feature>
  </Inspection>
</QIFDocument>
""",
        encoding="utf-8",
    )

    report = parse_qif_lite_xml(
        xml_path,
        source_ref="docs/examples/quality-pass-bracket/inspection/supplier-qif-lite.xml",
    )

    assert report["classification"]["attachment_ready_candidate"] is False
    assert "missing_measured_features" in report["classification"]["rejection_reasons"]


def test_parse_qif_lite_xml_rejects_missing_required_metadata(tmp_path):
    xml_path = tmp_path / "supplier-qif-lite.xml"
    xml_path.write_text(
        """<?xml version="1.0"?>
<QIFDocument>
  <Inspection>
    <SourceType>supplier_inspection_report</SourceType>
    <OverallResult>pass</OverallResult>
    <Units>mm</Units>
    <Feature>
      <FeatureId>MOUNTING_HOLE_DIA</FeatureId>
      <MeasuredValue>6.01</MeasuredValue>
      <Result>pass</Result>
      <MeasurementMethod>CMM</MeasurementMethod>
    </Feature>
  </Inspection>
</QIFDocument>
""",
        encoding="utf-8",
    )

    report = parse_qif_lite_xml(
        xml_path,
        source_ref="docs/examples/quality-pass-bracket/inspection/supplier-qif-lite.xml",
    )

    assert report["classification"]["attachment_ready_candidate"] is False
    assert "missing_package_id" in report["classification"]["rejection_reasons"]
    assert "missing_inspected_part" in report["classification"]["rejection_reasons"]
    assert "missing_inspected_at" in report["classification"]["rejection_reasons"]
