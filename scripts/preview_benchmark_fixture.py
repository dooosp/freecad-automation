"""Bounded, synthetic FreeCAD solids for the saved-preview benchmark only."""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _bootstrap import read_input, respond, respond_error, init_freecad

try:
    request = read_input()
    directory = request["output_directory"]
    os.makedirs(directory, exist_ok=True)
    init_freecad()
    import FreeCAD
    import Part

    fixtures = []
    total_bytes = 0
    for count in (1, 64, 256):
        solids = [Part.makeBox(8, 6, 4, FreeCAD.Vector((i % 16) * 12, (i // 16) * 10, 0))
                  for i in range(count)]
        shape = Part.makeCompound(solids)
        path = os.path.join(directory, "boxes_%d.step" % count)
        shape.exportStep(path)
        size = os.path.getsize(path)
        total_bytes += size
        if total_bytes > 64 * 1024 * 1024:
            respond_error("Benchmark STEP fixtures exceed the 64 MiB aggregate bound")
        fixtures.append({"solids": len(shape.Solids), "faces": len(shape.Faces),
                         "step_path": path, "source_bytes": size})
    respond({"success": True, "freecad_version": ".".join(FreeCAD.Version()[:3]),
             "fixtures": fixtures, "total_source_bytes": total_bytes})
except Exception as error:
    respond_error(str(error))
