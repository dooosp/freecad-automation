#!/usr/bin/env python3
"""Regression: TechDraw probe scripts must be import-safe for pytest collection."""

from pathlib import Path
import importlib.util


def _load_script_module(script_name):
    root = Path(__file__).resolve().parents[1]
    script_path = root / "scripts" / script_name

    spec = importlib.util.spec_from_file_location(f"fcad_{script_name}", script_path)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


def test_test_techdraw_api_module_import_safe():
    module = _load_script_module("test_techdraw_api.py")
    assert hasattr(module, "run")
    assert callable(module.run)


def test_test_techdraw_hlr_module_import_safe():
    module = _load_script_module("test_techdraw_hlr.py")
    assert hasattr(module, "run")
    assert callable(module.run)


def test_test_techdraw_projectex_module_import_safe():
    module = _load_script_module("test_techdraw_projectex.py")
    assert hasattr(module, "run")
    assert callable(module.run)
