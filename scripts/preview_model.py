"""Create a disposable STL view of a selected CAD snapshot, without changing it."""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _bootstrap import read_input, respond, respond_error, init_freecad

try:
    request = read_input()
    source = request['file']
    if os.path.splitext(source)[1].lower() not in ('.step', '.stp', '.brep', '.brp'):
        respond_error('Unsupported 3D preview source format')
    init_freecad()
    import Part
    from _export import export_shape
    shape = Part.read(source)
    if shape.isNull():
        respond_error('The source has no geometry to display')
    export = export_shape(shape, request['output_path'], 'stl')
    respond({'success': True, 'export': export})
except Exception as error:
    respond_error(str(error))
