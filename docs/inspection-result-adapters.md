# Inspection Result Adapters

Inspection-result adapters normalize externally completed result sources against an exact human-released inspection plan. Their output is an untrusted candidate for later human review and quarantine—not inspection evidence.

## Registry

The built-in registry is closed and versioned. v1 registers only `plan-result-csv-v1` version `1.0`, media type `text/csv`, extension `.csv`, and inspection-plan schema `1.0`. There is no adapter path, URL, plugin, eval, macro, network, archive, or dynamic-import mechanism.

## Native CSV v1

The exact columns, in order, are:

`plan_id,plan_sha256,plan_release_record_id,plan_release_record_sha256,plan_item_id,package_slug,revision,characteristic_id,control_material_notice,measured_value,measured_unit,result,completion_status,final_status,inspector_reference,reviewer_reference,source_file_sha256,method_used,equipment_reference,measurement_completed_at,remarks`

Every row must preserve the released `plan_id`, `plan_item_id`, package slug, revision, and `characteristic_id`. Required completion fields are measured value/unit, reported result (`pass`, `fail`, or `not_accepted`), completion/final status, inspector/reviewer references, and the external source record fingerprint declared by the submitting system. The generated control notice is retained as lineage; it does not make the file evidence.

UTF-8 without BOM and LF/CRLF are accepted. CSV quoting supports commas and embedded newlines. Duplicate/blank/unknown headers, row-width mismatch, formulas, locale decimal commas, NaN/Infinity, duplicates, missing required items, unexpected items, and unsupported repeated samples fail closed or are retained as blockers.

## Submission metadata

The companion JSON explicitly supplies package/revision/part/plan bindings, release-record binding, source organization/type/record ID, sanitized filename, inspection method, completion status/time, inspector identity, origin, confidentiality, redaction, optional overall result, and notes. It is human/source-system input, not authorization and not evidence.

## Units and result calculation

Raw values and units are always retained. Known compatible units are normalized deterministically; `in` and `inch` convert to `mm` using exactly 25.4. Values are not rounded before inclusive-limit evaluation. Unsupported aliases, incompatible dimensions, decimal commas, non-finite values, and overflow are rejected.

The adapter never overwrites `reported_result`. It emits a separate `computed_result` and `result_consistency`. Reported pass/computed fail blocks. Reported fail/computed pass requires review. Missing authoritative numeric limits, textual rules, or unresolved dependencies remain `unable_to_determine`.

## Trust boundary and next step

The highest output status is `ready_for_quarantine_review`. The output explicitly records that no evidence was created, authorized, attached, superseded, or used to regenerate readiness. A human must prepare the additional evidence-envelope review, authorization, provenance/custody, confidentiality, and attachment fields before the existing quarantine-first lifecycle can begin.

Unsupported formats include QIF, XLSX, generic CMM CSV, vendor exports, repeated samples/SPC, and supplier/machine/lab-specific formats. A future adapter requires a genuine sample, privacy/licensing review, a bounded versioned contract, and a separate change.
