"""Read an actual single plate and render its supported orthographic silhouette."""
import math
import os
import struct
import sys
import zlib

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _bootstrap import init_freecad, read_input, respond, respond_error
from mvs_reference_projection import HEIGHT, PROFILE, WIDTH, feature_region, project_point


def _chunk(kind, data):
    return struct.pack('>I', len(data)) + kind + data + struct.pack('>I', zlib.crc32(kind+data))


def export_reference(data):
    FreeCAD = init_freecad()
    import Part

    shape = Part.Shape()
    shape.read(data['model_path'])
    if shape.isNull() or not shape.isValid() or len(shape.Solids) != 1:
        raise ValueError('Native CAD must be a valid single solid')
    box = shape.BoundBox
    actual = [box.XMin, box.YMin, box.ZMin, box.XMax, box.YMax, box.ZMax]
    if any(abs(a-b) > 1e-7 for a, b in zip(actual, [0, 0, 0, 142, 74, 4])):
        raise ValueError('Unsupported plate bounds; expected 142 x 74 x 4 at origin')
    cylinders = [face for face in shape.Faces if isinstance(face.Surface, Part.Cylinder)]
    expected_ids = {f'hole_{group}{i}' for group in ('H', 'P') for i in range(1, 5)}
    specs = {s['id']: s for s in data['config']['shapes'] if s['id'] in expected_ids}
    if set(specs) != expected_ids:
        raise ValueError('Missing expected hole IDs')
    holes, used = [], set()
    for feature_id, spec in sorted(specs.items()):
        x, y = spec['position'][:2]
        radius = spec['radius']
        matches = []
        for index, face in enumerate(cylinders):
            surface = face.Surface
            if (abs(surface.Center.x-x) < 1e-7 and abs(surface.Center.y-y) < 1e-7
                    and abs(surface.Radius-radius) < 1e-7):
                matches.append((index, face))
        if len(matches) != 1 or matches[0][0] in used:
            raise ValueError(f'Native hole does not match {feature_id}')
        index, face = matches[0]
        if (abs(abs(face.Surface.Axis.z)-1) > 1e-7 or
                abs(face.BoundBox.ZMin) > 1e-7 or abs(face.BoundBox.ZMax-4) > 1e-7):
            raise ValueError(f'{feature_id} is not a vertical through hole')
        used.add(index)
        holes.append({'feature_id': feature_id,
                      'center_mm': [round(face.Surface.Center.x, 9),
                                    round(face.Surface.Center.y, 9)],
                      'radius_mm': round(face.Surface.Radius, 9)})
    if len(cylinders) != 8 or len(shape.Faces) != 14:
        raise ValueError('Native plate must contain exactly eight through holes')
    # Ensure no unsupported outline, pocket, bevel or occluded surface is being flattened.
    supported = Part.makeBox(142, 74, 4)
    for hole in holes:
        supported = supported.cut(Part.makeCylinder(hole['radius_mm'], 4,
                                  FreeCAD.Vector(*hole['center_mm'], 0)))
    if shape.cut(supported).Volume > 1e-6 or supported.cut(shape).Volume > 1e-6:
        raise ValueError('Unsupported planar outline or hidden geometry')
    pixels = bytearray(WIDTH*HEIGHT)
    for v in range(50, 790):
        pixels[v*WIDTH+50:v*WIDTH+1470] = bytes([180])*1420
    features = []
    for hole in holes:
        x, y = hole['center_mm']
        u, v = project_point(x, y)
        radius = hole['radius_mm']*10
        for py in range(math.floor(v-radius), math.ceil(v+radius)):
            for px in range(math.floor(u-radius), math.ceil(u+radius)):
                if (px+.5-u)**2 + (py+.5-v)**2 <= radius**2:
                    pixels[py*WIDTH+px] = 0
        features.append({'feature_id': hole['feature_id'], 'display_name': hole['feature_id'],
                         'feature_type': 'hole',
                         'normalized_region': feature_region(x, y, hole['radius_mm'])})
    raw = b''.join(b'\0'+pixels[v*WIDTH:(v+1)*WIDTH] for v in range(HEIGHT))
    png = (b'\x89PNG\r\n\x1a\n'+_chunk(b'IHDR', struct.pack('>IIBBBBB', WIDTH, HEIGHT, 8, 0, 0, 0, 0))
           + _chunk(b'IDAT', zlib.compress(raw, 9)) + _chunk(b'IEND', b''))
    with open(data['image_path'], 'xb') as handle:
        handle.write(png)
    return {'success': True, 'profile': PROFILE, 'holes': holes, 'features': features,
            'freecad_version': '.'.join(FreeCAD.Version()[:3]), 'valid_shape': True}


# FreeCADCmd loads scripts as modules, so follow the repository's script protocol.
try:
    respond(export_reference(read_input()))
except Exception as exc:
    respond_error(str(exc))
