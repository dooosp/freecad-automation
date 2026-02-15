#!/usr/bin/env python3
"""Regression: TechDraw probe scripts must be import-safe for pytest collection."""

from pathlib import Path
import importlib.util


def test_test_techdraw_api_module_import_safe():
    root = Path(__file__).resolve().parents[1]
    script_path = root / "scripts" / "test_techdraw_api.py"

    spec = importlib.util.spec_from_file_location("fcad_test_techdraw_api", script_path)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)

    assert hasattr(module, "run")
    assert callable(module.run)
