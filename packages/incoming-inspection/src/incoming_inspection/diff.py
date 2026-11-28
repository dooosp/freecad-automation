"""Compare two saved inspection reviews using their recorded inputs and evidence."""

import re
from collections import defaultdict, deque
from decimal import Decimal, InvalidOperation

_IDENTITY_FIELDS = ("part", "revision", "lot", "supplier")
_RESULT_STATUSES = ("in_tolerance", "out_of_tolerance", "missing", "cannot_evaluate")


def _nonempty_text(value):
    return isinstance(value, str) and bool(value.strip())


def _text_or_null(value):
    return value is None or isinstance(value, str)


def _reasons(value):
    return isinstance(value, list) and all(_nonempty_text(reason) for reason in value)


def _decimal(text):
    if text is None:
        return None
    try:
        if not isinstance(text, str):
            raise InvalidOperation
        number = Decimal(text)
        if not number.is_finite():
            raise InvalidOperation
        return number
    except InvalidOperation:
        raise ValueError("measured_mm must be a finite decimal string or null") from None


def _validate_inputs(review):
    for name in ("requirements", "mapping", "measurements"):
        item = review["inputs"][name]
        digest = item["sha256"]
        if not isinstance(digest, str) or re.fullmatch(r"[a-f0-9]{64}", digest) is None:
            raise ValueError(f"{name} has an invalid SHA-256 digest")
        if not _nonempty_text(item["path"]):
            raise ValueError(f"{name} has an invalid path")


def _requirement_pairs(definition, identity):
    if any(definition[field] != identity[field] for field in ("part", "revision")):
        raise ValueError("requirements identity disagrees with the review")
    characteristics = definition["characteristics"]
    if not isinstance(characteristics, list) or not characteristics:
        raise ValueError("missing requirements")
    pairs = set()
    seen_ids = set()
    for item in characteristics:
        characteristic = item["id"]
        samples = item["samples"]
        if (not _nonempty_text(characteristic) or characteristic in seen_ids
                or not _nonempty_text(item["drawing_ref"])
                or not all(_text_or_null(item[field]) for field in ("unit", "lower", "upper"))
                or not isinstance(samples, list) or not samples
                or not all(_nonempty_text(sample) for sample in samples)
                or len(samples) != len(set(samples))):
            raise ValueError("invalid or duplicated requirement")
        seen_ids.add(characteristic)
        pairs.update((characteristic, sample) for sample in samples)
    return pairs


def _source_rows(source):
    headers = source["headers"]
    records = source["rows"]
    if (not isinstance(headers, list) or not headers
            or not all(_nonempty_text(header) for header in headers)
            or len(headers) != len(set(headers)) or not isinstance(records, list)):
        raise ValueError("invalid CSV source table")
    rows = {}
    for record in records:
        number, cells = record["row"], record["cells"]
        if (type(number) is not int or number < 1 or number in rows
                or not isinstance(cells, list) or len(cells) != len(headers)
                or not all(isinstance(cell, str) for cell in cells)):
            raise ValueError("invalid or duplicated CSV source row")
        rows[number] = tuple(cells)
    return rows


def _index_results(results, expected_pairs, remaining_rows):
    if not isinstance(results, list):
        raise ValueError("results must be a list")
    indexed = {}
    for result in results:
        key = (result["characteristic"], result["sample"])
        if key in indexed or key not in expected_pairs:
            raise ValueError("duplicate or unknown characteristic and sample in results")
        status = result["computed_result"]
        if (status not in _RESULT_STATUSES
                or not _reasons(result["reasons"])
                or not _nonempty_text(result["drawing_ref"])
                or not all(_text_or_null(result[field]) for field in (
                    "unit", "lower", "upper", "supplier_result", "measured_value",
                    "measured_unit", "deviation_mm",
                ))):
            raise ValueError("invalid result")
        measured = _decimal(result["measured_mm"])
        refs = result["source_rows"]
        if (not isinstance(refs, list) or
                any(type(ref) is not int or ref not in remaining_rows for ref in refs)
                or len(refs) != len(set(refs))):
            raise ValueError("invalid or reused result source rows")
        if status == "missing":
            if refs or measured is not None:
                raise ValueError("missing result contains measurement evidence")
        elif status == "cannot_evaluate":
            if not refs:
                raise ValueError("unevaluable result lacks measurement evidence")
        elif len(refs) != 1 or measured is None:
            raise ValueError("evaluated result needs one source row and a normalized measurement")
        remaining_rows.difference_update(refs)
        indexed[key] = result
    if set(indexed) != expected_pairs:
        raise ValueError("results omit a required characteristic and sample")
    return indexed


def _group_unmatched(records, remaining_rows):
    if not isinstance(records, list):
        raise ValueError("unmatched_rows must be a list")
    grouped = defaultdict(list)
    for entry in records:
        ref = entry["row"]
        key = (entry["characteristic"], entry["sample"])
        if (type(ref) is not int or ref not in remaining_rows
                or not all(isinstance(value, str) for value in key) or not _reasons(entry["reasons"])):
            raise ValueError("invalid or reused unmatched source row")
        remaining_rows.remove(ref)
        grouped[key].append(entry)
    return grouped


def _validated_indexes(review, label):
    try:
        if type(review["schema_version"]) is not int or review["schema_version"] != 1:
            raise ValueError("unsupported review schema version")
        if not _nonempty_text(review["rule_version"]):
            raise ValueError("missing review rule version")
        identity = review["identity"]
        if not all(_nonempty_text(identity[field]) for field in _IDENTITY_FIELDS):
            raise ValueError("invalid review identity")
        if review["supplier_source"] not in ("csv", "operator"):
            raise ValueError("invalid supplier source")
        _validate_inputs(review)
        pairs = _requirement_pairs(review["requirements"], identity)
        rows = _source_rows(review["source"])
        remaining_rows = set(rows)
        expected = _index_results(review["results"], pairs, remaining_rows)
        unmatched = _group_unmatched(review["unmatched_rows"], remaining_rows)
        if remaining_rows:
            raise ValueError("review omits entries for CSV source rows")
        return expected, unmatched, rows
    except (KeyError, TypeError, ValueError) as error:
        raise ValueError(f"invalid {label} review: {error}") from None


def _result_signature(result, rows):
    status = result["computed_result"]
    raw_evidence = ()
    if status == "cannot_evaluate":
        raw_evidence = tuple(sorted(rows[ref] for ref in result["source_rows"]))
    return (
        status, _decimal(result["measured_mm"]), result["supplier_result"],
        tuple(sorted(result["reasons"])), raw_evidence,
    )


def _result_changes(before_results, after_results, before_rows, after_rows):
    changes = []
    for key in sorted(before_results):
        before, after = before_results[key], after_results[key]
        before_status, after_status = before["computed_result"], after["computed_result"]
        if before_status == "missing" and after_status != "missing":
            kind = "added"
        elif before_status != "missing" and after_status == "missing":
            kind = "removed"
        elif _result_signature(before, before_rows) != _result_signature(after, after_rows):
            kind = "changed"
        elif after_status != "in_tolerance" or after["reasons"]:
            kind = "unresolved"
        else:
            continue
        characteristic, sample = key
        changes.append({
            "characteristic": characteristic, "sample": sample, "kind": kind,
            "before": before, "after": after,
        })
    return changes


def _entry_signature(entry, rows):
    return (rows[entry["row"]], tuple(sorted(entry["reasons"])))


def _unmatched_changes(before_grouped, after_grouped, before_rows, after_rows):
    changes = []
    for key in sorted(before_grouped.keys() | after_grouped.keys()):
        after_queue = defaultdict(deque)
        for entry in after_grouped.get(key, ()):
            after_queue[_entry_signature(entry, after_rows)].append(entry)

        removed = []
        for before in before_grouped.get(key, ()):
            matches = after_queue.get(_entry_signature(before, before_rows))
            if matches:
                changes.append({"kind": "unresolved", "before": before, "after": matches.popleft()})
            else:
                removed.append(before)
        added = [entry for queue in after_queue.values() for entry in queue]

        # Match only a unique replacement. More than one candidate makes attribution ambiguous.
        if len(removed) == 1 and len(added) == 1:
            changes.append({"kind": "changed", "before": removed[0], "after": added[0]})
        else:
            changes.extend({"kind": "removed", "before": entry, "after": None} for entry in removed)
            changes.extend({"kind": "added", "before": None, "after": entry} for entry in added)
    return changes


def compare_reviews(before: dict, after: dict) -> dict:
    """Classify events across two submissions, preserving evidence on each side."""
    before_results, before_unmatched, before_rows = _validated_indexes(before, "before")
    after_results, after_unmatched, after_rows = _validated_indexes(after, "after")
    result = {
        "schema_version": 1, "mode": "comparison", "reasons": [],
        "before": before, "after": after, "changes": [], "unmatched_changes": [],
    }
    identity_changes = [field for field in _IDENTITY_FIELDS
                        if before["identity"][field] != after["identity"][field]]
    if identity_changes:
        result.update(mode="separate_case", reasons=["identity_changed"])
        if identity_changes == ["revision"]:
            result["full_review_required"] = True
        return result
    reasons = [
        f"{name}_changed" for name in ("requirements", "mapping")
        if before["inputs"][name]["sha256"] != after["inputs"][name]["sha256"]
    ]
    if before["requirements"] != after["requirements"] and "requirements_changed" not in reasons:
        reasons.insert(0, "requirements_changed")
    if before["rule_version"] != after["rule_version"]:
        reasons.append("rule_version_changed")
    if reasons:
        return {**result, "mode": "full_review_required", "reasons": reasons}

    result["changes"] = _result_changes(before_results, after_results, before_rows, after_rows)
    result["unmatched_changes"] = _unmatched_changes(
        before_unmatched, after_unmatched, before_rows, after_rows,
    )
    return result
