# Inspection plans and supplier checksheets

`fcad inspection-plan` creates generated control material for engineering and
quality review. Its canonical JSON is the only source of truth; optional CSV and
Markdown files are deterministic views of that JSON.

```bash
fcad inspection-plan \
  --review-pack output/review_pack.json \
  --scope full \
  --out output/inspection-plan/inspection_plan.json \
  --checksheet-out output/inspection-plan/inspection_checksheet.csv \
  --request-out output/inspection-plan/supplier_inspection_request.md \
  --result-template-out output/inspection-plan/inspection_result_template.csv \
  --generated-at 2026-07-12T00:00:00Z
```

Use `--scope delta --revision-impact <revision_impact_report.json>` for exact
revision-linked future inspection work. Missing authority remains explicit;
values are not inferred from CAD geometry or advisory documents.

The generated plan can reach only `ready_for_human_release`. Engineering and
quality review and a separate human release are required before supplier/lab
use. The blank template is not inspection evidence. A completed external file
is still untrusted and must enter quarantine, structural validation, semantic
validation, separate authorization, and attachment through the existing
inspection-evidence onboarding workflow.

