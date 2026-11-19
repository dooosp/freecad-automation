"""Read buyer requirements and supplier measurement records."""

from __future__ import annotations

import csv
import io
import json
from decimal import Decimal, InvalidOperation


REQUIRED_FIELDS = (
    "part",
    "revision",
    "lot",
    "sample",
    "characteristic",
    "value",
    "unit",
)
OPTIONAL_FIELDS = ("supplier_result", "supplier")


def _decode(data: bytes, label: str) -> str:
    try:
        return data.decode("utf-8-sig")
    except UnicodeDecodeError as error:
        raise ValueError(f"{label} must be UTF-8") from error


def _unique_object(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise ValueError(f"duplicate JSON key {key!r}")
        result[key] = value
    return result


def _reject_constant(value):
    raise ValueError(f"invalid JSON number {value!r}")


def _load_object(data: bytes, label: str) -> dict:
    raw = _decode(data, label)
    try:
        document = json.loads(
            raw,
            object_pairs_hook=_unique_object,
            parse_int=Decimal,
            parse_float=Decimal,
            parse_constant=_reject_constant,
        )
    except (ValueError, InvalidOperation, RecursionError) as error:
        raise ValueError(f"{label}: {error}") from error
    if not isinstance(document, dict):
        raise ValueError(f"{label} must be a JSON object")
    return document


def _required_text(value, label: str) -> str:
    if not isinstance(value, str) or not value.strip():
        raise ValueError(f"{label} must be a nonempty string")
    return value.strip()


def _optional_text(value, label: str) -> str | None:
    if value is None or isinstance(value, str):
        return value
    raise ValueError(f"{label} must be a string or null")


def _limit(value, label: str) -> str | None:
    if isinstance(value, Decimal):
        return str(value)
    return _optional_text(value, label)


def _nonempty_list(value, label: str) -> list:
    if not isinstance(value, list) or not value:
        raise ValueError(f"{label} must be a nonempty array")
    return value


def load_requirements(data: bytes) -> dict:
    """Read the criteria, preserving missing bounds and unsupported units for review."""
    document = _load_object(data, "requirements")
    part = _required_text(document.get("part"), "requirements.part")
    revision = _required_text(document.get("revision"), "requirements.revision")
    characteristics = []
    seen = set()
    for index, entry in enumerate(
        _nonempty_list(document.get("characteristics"), "requirements.characteristics"), start=1
    ):
        label = f"requirements.characteristics[{index}]"
        if not isinstance(entry, dict):
            raise ValueError(f"{label} must be a JSON object")
        characteristic = _required_text(entry.get("id"), f"{label}.id")
        if characteristic in seen:
            raise ValueError(f"{label} has duplicate characteristic id {characteristic!r}")
        seen.add(characteristic)
        samples = [
            _required_text(sample, f"{label}.samples")
            for sample in _nonempty_list(entry.get("samples"), f"{label}.samples")
        ]
        if len(set(samples)) != len(samples):
            raise ValueError(f"{label} has a duplicate sample id")
        characteristics.append({
            "id": characteristic,
            "drawing_ref": _required_text(entry.get("drawing_ref"), f"{label}.drawing_ref"),
            "unit": _optional_text(entry.get("unit"), f"{label}.unit"),
            "lower": _limit(entry.get("lower"), f"{label}.lower"),
            "upper": _limit(entry.get("upper"), f"{label}.upper"),
            "samples": samples,
        })
    return {"part": part, "revision": revision, "characteristics": characteristics}


def _load_mapping(data: bytes) -> dict:
    mapping = _load_object(data, "mapping")
    for field, header in mapping.items():
        if field not in REQUIRED_FIELDS and field not in OPTIONAL_FIELDS:
            raise ValueError(f"unknown mapping field {field!r}")
        _required_text(header, f"mapping.{field}")
    for field in REQUIRED_FIELDS:
        if field not in mapping:
            raise ValueError(f"missing mapping field {field!r}")
    if len(set(mapping.values())) != len(mapping):
        raise ValueError("mapping targets the same CSV column from multiple fields")
    return mapping


def load_measurements(data: bytes, mapping_data: bytes) -> tuple[list[str], list[dict], str]:
    """Return raw headers, logically indexed records, and the supplier field source."""
    mapping = _load_mapping(mapping_data)
    reader = csv.reader(io.StringIO(_decode(data, "measurements"), newline=""), strict=True)
    try:
        headings = next(reader, [])
    except csv.Error as error:
        raise ValueError(f"invalid CSV header: {error}") from error
    if not headings or any(not heading.strip() for heading in headings):
        raise ValueError("CSV must have a header with no empty column names")
    if len(set(headings)) != len(headings):
        raise ValueError("duplicate CSV header")

    headings_by_field = {}
    for field, heading in mapping.items():
        if heading not in headings:
            raise ValueError(f"mapped CSV column {heading!r} for {field!r} is missing")
        headings_by_field[field] = headings.index(heading)

    rows = []
    try:
        for cells in reader:
            if not cells:
                continue
            number = len(rows) + 1
            if len(cells) != len(headings):
                raise ValueError(
                    f"CSV row {number} has {len(cells)} fields, expected {len(headings)}"
                )
            mapped = {
                field: cells[headings_by_field[field]].strip()
                for field in headings_by_field
            }
            for field in OPTIONAL_FIELDS:
                mapped.setdefault(field, None)
            rows.append({"row": number, "cells": cells, **mapped})
    except csv.Error as error:
        raise ValueError(f"invalid CSV row {len(rows) + 1}: {error}") from error
    supplier_source = "csv" if "supplier" in mapping else "operator"
    return headings, rows, supplier_source
