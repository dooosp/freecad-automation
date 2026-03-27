import csv
import json
import os
import re
from datetime import datetime, timezone


def utc_now_iso():
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


def normalize_header(value):
    text = str(value or "").strip().lower()
    text = re.sub(r"[^a-z0-9]+", "_", text)
    return text.strip("_")


def normalize_row(row):
    return {normalize_header(key): value for key, value in (row or {}).items()}


def read_records(path):
    if not path:
        return []

    ext = os.path.splitext(path)[1].lower()
    if ext == ".json":
        with open(path, encoding="utf-8") as handle:
            payload = json.load(handle)
        if isinstance(payload, list):
            return [normalize_row(item) if isinstance(item, dict) else {"value": item} for item in payload]
        if isinstance(payload, dict):
            if isinstance(payload.get("items"), list):
                return [normalize_row(item) for item in payload["items"]]
            return [normalize_row(payload)]
        return [{"value": payload}]

    if ext not in {".csv", ".tsv"}:
        raise ValueError(f"Unsupported input type for {path}")

    delimiter = "\t" if ext == ".tsv" else ","
    with open(path, encoding="utf-8-sig", newline="") as handle:
        reader = csv.DictReader(handle, delimiter=delimiter)
        if not reader.fieldnames:
            raise ValueError(f"Missing header row in {path}")
        return [normalize_row(row) for row in reader]


def pick_first(row, keys, default=None):
    for key in keys:
        value = row.get(normalize_header(key))
        if value is None:
            continue
        if isinstance(value, str):
            trimmed = value.strip()
            if trimmed:
                return trimmed
        elif value not in ("", None):
            return value
    return default


def coerce_float(value):
    if value in (None, "", "null", "None", "-"):
        return None
    if isinstance(value, (int, float)):
        return float(value)
    text = str(value).strip().replace(",", "")
    if not text:
        return None
    try:
        return float(text)
    except ValueError:
        return None


def coerce_int(value):
    number = coerce_float(value)
    if number is None:
        return None
    return int(number)


def build_identifier(prefix, explicit_value, index):
    explicit_text = str(explicit_value or "").strip()
    if explicit_text:
        return explicit_text
    return f"{prefix}-{index:03d}"


def basename_without_ext(path):
    if not path:
        return None
    return os.path.splitext(os.path.basename(path))[0]


def infer_revision(path_or_name):
    text = str(path_or_name or "")
    match = re.search(r"(?:^|[_-])rev(?:ision)?[_-]?([a-z0-9]+)$", text, re.IGNORECASE)
    if match:
        return match.group(1).upper()
    return None


def tokenize(text):
    return [token for token in re.split(r"[^a-z0-9]+", str(text or "").lower()) if token]


def summarize_source(path, count, warnings=None):
    return {
        "path": path,
        "record_count": count,
        "warnings": list(warnings or []),
    }
