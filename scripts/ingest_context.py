#!/usr/bin/env python3

import os

from _bootstrap import read_input, respond, respond_error
from adapters.common import basename_without_ext, infer_revision, summarize_source, utc_now_iso
from adapters.load_bom import load_bom_entries
from adapters.load_inspection import load_inspection_results
from adapters.load_quality import load_quality_issues


def _load_optional(path, loader):
    if not path:
        return [], []
    return loader(path)


def main():
    try:
        payload = read_input()
        model_path = payload.get("model")
        bom_path = payload.get("bom")
        inspection_path = payload.get("inspection")
        quality_path = payload.get("quality")

        if model_path and not os.path.isfile(model_path):
            respond_error(f"Model file not found: {model_path}")

        bom_entries, bom_warnings = _load_optional(bom_path, load_bom_entries)
        inspection_results, inspection_warnings = _load_optional(inspection_path, load_inspection_results)
        quality_issues, quality_warnings = _load_optional(quality_path, load_quality_issues)

        part_name = payload.get("part_name") or basename_without_ext(model_path) or "engineering_part"
        revision = payload.get("revision") or infer_revision(model_path) or infer_revision(part_name)
        material = payload.get("material")
        process = payload.get("process")

        if material is None and bom_entries:
            material = next((entry.get("material") for entry in bom_entries if entry.get("material")), None)
        if process is None and bom_entries:
            process = next((entry.get("process") for entry in bom_entries if entry.get("process")), None)

        warnings = [*bom_warnings, *inspection_warnings, *quality_warnings]
        source_files = [path for path in [model_path, bom_path, inspection_path, quality_path] if path]

        context = {
            "part": {
                "part_id": payload.get("part_id") or part_name,
                "name": part_name,
                "description": payload.get("description"),
                "revision": revision,
                "material": material,
                "process": process,
            },
            "geometry_source": {
                "path": model_path,
                "file_type": os.path.splitext(model_path)[1].lstrip(".").lower() if model_path else None,
                "revision": revision,
                "validated": bool(model_path),
                "model_metadata": payload.get("model_metadata"),
                "feature_hints": payload.get("feature_hints"),
            },
            "bom": bom_entries,
            "inspection_results": inspection_results,
            "quality_issues": quality_issues,
            "manufacturing_context": {
                "facility": payload.get("facility"),
                "supplier": payload.get("supplier"),
                "process_family": payload.get("process_family") or process,
                "notes": payload.get("manufacturing_notes"),
            },
            "metadata": {
                "created_at": utc_now_iso(),
                "source_files": source_files,
                "provenance": {
                    "ingest_command": "fcad ingest",
                    "model_supplied": bool(model_path),
                    "model_validated": bool(model_path),
                    "bom_supplied": bool(bom_path),
                    "inspection_supplied": bool(inspection_path),
                    "quality_supplied": bool(quality_path),
                },
                "warnings": warnings,
            },
        }

        ingest_log = {
            "created_at": context["metadata"]["created_at"],
            "sources": [
                summarize_source(bom_path, len(bom_entries), bom_warnings) if bom_path else None,
                summarize_source(inspection_path, len(inspection_results), inspection_warnings) if inspection_path else None,
                summarize_source(quality_path, len(quality_issues), quality_warnings) if quality_path else None,
            ],
            "warnings": warnings,
            "summary": {
                "bom_entries": len(bom_entries),
                "inspection_results": len(inspection_results),
                "quality_issues": len(quality_issues),
            },
        }
        ingest_log["sources"] = [item for item in ingest_log["sources"] if item]

        respond({
            "success": True,
            "context": context,
            "ingest_log": ingest_log,
        })
    except Exception as exc:
        respond_error(str(exc))


if __name__ == "__main__":
    main()
