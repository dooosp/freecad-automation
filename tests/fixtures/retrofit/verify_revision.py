"""Present one valid STEP revision via the input stream and another at its logical name."""

import hashlib
import sys
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[3] / "scripts"))
from _bootstrap import init_freecad, read_input, respond

directory = Path(read_input()["directory"])
init_freecad()
from _retrofit_geometry import read_solid
from _shapes import import_shape

supplied = directory / "mount_plate.step"
logical = directory / "candidate_a.step"
supplied_volume = import_shape({"file": str(supplied)}).Volume
other_volume = import_shape({"file": str(logical)}).Volume
expected = hashlib.sha256(supplied.read_bytes()).hexdigest()
open_path = Path.open


def open_revision(path, *args, **kwargs):
    return open_path(supplied if path == logical else path, *args, **kwargs)


with patch.object(Path, "open", open_revision):
    digest, solid = read_solid(logical)
respond({
    "success": True,
    "expected_digest": expected,
    "digest": digest,
    "supplied_volume": supplied_volume,
    "other_volume": other_volume,
    "imported_volume": solid.Volume,
})
