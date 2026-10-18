"""URL imports refresh their bytes without requiring a FreeCAD installation."""

import importlib.util
import io
from pathlib import Path
import sys
import types
import urllib.error
import urllib.request

import pytest


ROOT = Path(__file__).resolve().parents[1]


class DownloadResponse(io.BytesIO):
    def __init__(self, content, *, content_length=None):
        super().__init__(content)
        self.headers = {
            "Content-Length": str(len(content) if content_length is None else content_length),
        }

    def info(self):
        return self.headers


@pytest.fixture
def shapes(monkeypatch, tmp_path):
    # Only the CAD import boundary is replaced; _fetch_url/import_shape run as shipped.
    monkeypatch.setitem(sys.modules, "FreeCAD", types.SimpleNamespace(Vector=object))
    monkeypatch.setitem(sys.modules, "Part", types.SimpleNamespace(read=lambda path: Path(path).read_bytes()))
    spec = importlib.util.spec_from_file_location("shapes_url_cache_test", ROOT / "scripts" / "_shapes.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    monkeypatch.setattr(module, "__file__", str(tmp_path / "scripts" / "_shapes.py"))
    return module


def serve_responses(monkeypatch, *responses):
    pending = iter(responses)
    requests = []

    def urlopen(request, data=None, *, timeout=None):
        requests.append({"url": getattr(request, "full_url", request), "timeout": timeout})
        response = next(pending)
        if isinstance(response, Exception):
            raise response
        return response

    monkeypatch.setattr(urllib.request, "urlopen", urlopen)
    return requests


def test_same_url_import_reads_new_revision(shapes, monkeypatch):
    url = "https://cad.example/part.step"
    serve_responses(monkeypatch, DownloadResponse(b"revision A"), DownloadResponse(b"revision B"))

    assert shapes.import_shape({"url": url}) == b"revision A"
    assert shapes.import_shape({"url": url}) == b"revision B"


def test_download_has_a_bounded_network_timeout(shapes, monkeypatch, tmp_path):
    requests = serve_responses(monkeypatch, DownloadResponse(b"revision A"))
    shapes._fetch_url("https://cad.example/part.step", tmp_path / "cache")

    assert len(requests) == 1
    assert requests[0]["timeout"] is not None
    assert 0 < requests[0]["timeout"] <= 60


def test_failed_refresh_preserves_cached_bytes_without_returning_them(shapes, monkeypatch, tmp_path):
    class InterruptedResponse(DownloadResponse):
        def read(self, size=-1):
            if self.tell() > 0:
                raise TimeoutError("download interrupted")
            return super().read(size)

    cache_dir = tmp_path / "cache"
    url = "https://cad.example/part.step"
    serve_responses(monkeypatch, DownloadResponse(b"revision A"), InterruptedResponse(b"partial B"))
    cached_path = Path(shapes._fetch_url(url, cache_dir))

    with pytest.raises(TimeoutError, match="download interrupted"):
        shapes._fetch_url(url, cache_dir)

    assert cached_path.read_bytes() == b"revision A"
    assert list(cache_dir.iterdir()) == [cached_path]


def test_unavailable_remote_does_not_return_cached_bytes(shapes, monkeypatch, tmp_path):
    cache_dir = tmp_path / "cache"
    url = "https://cad.example/part.step"
    serve_responses(monkeypatch, DownloadResponse(b"revision A"), urllib.error.URLError("offline"))
    cached_path = Path(shapes._fetch_url(url, cache_dir))

    with pytest.raises(urllib.error.URLError, match="offline"):
        shapes._fetch_url(url, cache_dir)

    assert cached_path.read_bytes() == b"revision A"
    assert list(cache_dir.iterdir()) == [cached_path]


def test_incomplete_refresh_does_not_publish_partial_bytes(shapes, monkeypatch, tmp_path):
    cache_dir = tmp_path / "cache"
    url = "https://cad.example/part.step"
    serve_responses(monkeypatch, DownloadResponse(b"revision A"), DownloadResponse(b"partial B", content_length=100))
    cached_path = Path(shapes._fetch_url(url, cache_dir))

    with pytest.raises(urllib.error.ContentTooShortError):
        shapes._fetch_url(url, cache_dir)

    assert cached_path.read_bytes() == b"revision A"
    assert list(cache_dir.iterdir()) == [cached_path]


@pytest.mark.parametrize("extension", ["step", "stp", "brep", "iges", "igs", "STEP"])
def test_supported_cad_url_suffix_is_preserved(shapes, monkeypatch, tmp_path, extension):
    requests = serve_responses(monkeypatch, DownloadResponse(b"downloaded CAD bytes"))
    url = f"https://cad.example/part.{extension}?version=2"

    cached_path = Path(shapes._fetch_url(url, tmp_path / "cache"))

    assert cached_path.suffix == f".{extension.lower()}"
    assert cached_path.read_bytes() == b"downloaded CAD bytes"
    assert requests[0]["url"] == url


def test_url_without_suffix_defaults_to_step(shapes, monkeypatch, tmp_path):
    serve_responses(monkeypatch, DownloadResponse(b"downloaded CAD bytes"))
    cached_path = Path(shapes._fetch_url("https://cad.example/download?id=part", tmp_path / "cache"))

    assert cached_path.suffix == ".step"
    assert cached_path.read_bytes() == b"downloaded CAD bytes"
