import builtins
from pathlib import Path
import shutil
import subprocess
import sys

import pytest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))
from reporting.review_pack import _write_pdf


@pytest.mark.parametrize("fallback", [False, True])
def test_review_pdf_keeps_long_actions_and_final_evidence_boundary(tmp_path, monkeypatch, fallback):
    if not shutil.which("pdftotext"):
        pytest.skip("Poppler text extraction is not installed")
    if fallback:
        original_import = builtins.__import__

        def without_matplotlib(name, *args, **kwargs):
            if name == "matplotlib" or name.startswith("matplotlib."):
                raise ImportError("Exercise dependency-free PDF rendering")
            return original_import(name, *args, **kwargs)

        monkeypatch.setattr(builtins, "__import__", without_matplotlib)
    else:
        pytest.importorskip("matplotlib")

    source = "## Actions\n" + "Review the mounting geometry carefully. " * 12 + "LONG_ACTION_END\n"
    source += "\n".join(f"Review item {index}: " + "retain this context " * 12 for index in range(100))
    source += "\nFINAL_REQUIRED_BOUNDARY: physical inspection evidence remains missing.\n"
    path = tmp_path / "review.pdf"
    _write_pdf(path, "Audit review", source)
    text = subprocess.check_output(["pdftotext", str(path), "-"], text=True)
    assert "LONG_ACTION_END" in text
    assert "FINAL_REQUIRED_BOUNDARY" in text
    assert "physical inspection evidence remains missing" in text
    assert text.count("\f") > 1
