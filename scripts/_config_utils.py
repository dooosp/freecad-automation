"""Helpers for config normalization and backward-compatible schema handling."""


def normalize_operation_spec(spec):
    """Return a copied operation spec with canonical ``op`` populated."""
    if not isinstance(spec, dict):
        return spec

    normalized = dict(spec)
    if normalized.get("op") is None and isinstance(normalized.get("type"), str):
        normalized["op"] = normalized["type"]
    return normalized


def normalize_config(value, parent_key=""):
    """Deep-copy config data and normalize operation arrays recursively."""
    if isinstance(value, list):
        if parent_key == "operations":
            return [normalize_operation_spec(item) for item in value]
        return [normalize_config(item) for item in value]

    if isinstance(value, dict):
        return {
            key: normalize_config(entry, key)
            for key, entry in value.items()
        }

    return value
