import os

from adapters.common import tokenize, unique_list


def build_source_ref(path, row_index):
    filename = os.path.basename(path) if path else "inline"
    return f"{filename}#row:{row_index}"


def collect_raw_tokens(*values):
    tokens = []
    for value in values:
        tokens.extend(tokenize(value))
    return unique_list(tokens)


def build_evidence_refs(path, row_index, row, field_map, diagnostics, token_values):
    return {
        "source_ref": build_source_ref(path, row_index),
        "source_provenance": {
            "path": path,
            "row": row_index,
            "field_map": dict(field_map or {}),
            "available_columns": sorted((row or {}).keys()),
        },
        "raw_tokens": collect_raw_tokens(*token_values),
        "data_quality_flags": unique_list([item.get("code") for item in diagnostics or [] if item.get("code")]),
        "ingest_diagnostics": list(diagnostics or []),
    }


def warning_messages(diagnostics):
    return [item["message"] for item in diagnostics or [] if item.get("message")]
