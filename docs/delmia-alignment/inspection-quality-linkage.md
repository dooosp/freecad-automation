# Inspection / Quality Linkage Demo

This demo links inspection findings to manufacturing operations and CAD feature references using explicit heuristics. It is review guidance, not engineering truth.

## Files

- Script: [link_inspection_to_manufacturing.py](../../scripts/link_inspection_to_manufacturing.py)
- Context: [bracket_line_context.json](../../configs/examples/manufacturing/bracket_line_context.json)
- Inspection set: [bracket_inspection_records.json](../../configs/examples/manufacturing/bracket_inspection_records.json)
- Output JSON: `output/delmia-demo/inspection_quality_linkage_report.json`
- Output Markdown: `output/delmia-demo/inspection_quality_linkage_summary.md`

## Output Fields

- affected feature
- related operation
- possible manufacturing cause
- recommended action
- confidence
- evidence references

## How Matching Works

- Direct operation match if the record already names a routing step.
- Feature-reference match if the feature can be found in routing `cad_feature_refs`.
- Cause and action mapping through explicit keyword rules for holes, burrs, datum variation, and general routing review.
- Confidence scoring through visible additive rules instead of opaque AI reasoning.

## Run It

```bash
python3 scripts/link_inspection_to_manufacturing.py \
  --context configs/examples/manufacturing/bracket_line_context.json \
  --inspection configs/examples/manufacturing/bracket_inspection_records.json \
  --out-dir output/delmia-demo
```

## Safe Interpretation

- Treat the output as review guidance for manufacturing engineering and quality teams.
- Use the confidence score as a triage hint, not as proof.
- Do not present the report as a formal root-cause analysis or official DELMIA functionality.
