"""Paint a final SVG sheet to a separate vector PDF at its physical scale.

Qt rounds PDF page boxes to integer points: nominal ISO sheet dimensions have
up to 0.2 mm page-box tolerance. Drawing coordinates still use physical mm;
never fit to the rounded device rectangle or reapply the drawing's scale label.
The caller owns path containment and supplies a fresh private output filename.
"""

from contextlib import redirect_stdout
import importlib
import json
import math
from pathlib import Path
import re
import sys
from types import SimpleNamespace
import xml.etree.ElementTree as ET

from _report_drawing_sheet import validate_drawing_svg

_QT_APPLICATION = None
_DPI = 300
# Bound Qt's coordinate transform while allowing normalized (unit) viewBoxes
# and generated sheet coordinates. Width/height are positive within this range;
# origins may be negative but have the same maximum absolute coordinate.
_VIEWBOX_MIN_SIZE = 1e-6
_VIEWBOX_MAX_COORDINATE = 1e6
_NUMBER = r'[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?'
_SHEETS = ((841, 1189), (594, 841), (420, 594), (297, 420), (210, 297))
_VECTOR_TAGS = {
    'svg', 'g', 'defs', 'symbol', 'use', 'title', 'desc', 'metadata', 'style',
    'path', 'rect', 'line', 'polyline', 'polygon', 'circle', 'ellipse',
    'text', 'tspan', 'textpath', 'clippath', 'lineargradient', 'radialgradient',
    'stop', 'pattern', 'a',
}
_EFFECT = re.compile(r'(?:^|[;{\s])(?:filter|mask|mix-blend-mode|isolation|animation(?:-[\w-]+)?|transition(?:-[\w-]+)?)\s*:', re.I)


def _physical_mm(value):
    if not isinstance(value, str) or not re.fullmatch(r'\s*' + _NUMBER + r'mm\s*', value):
        raise ValueError('Drawing PDF requires explicit physical width and height in mm.')
    number = float(value.strip()[:-2])
    if not math.isfinite(number) or number <= 0:
        raise ValueError('Drawing PDF physical dimensions must be finite and positive.')
    return number


def validate_print_svg(svg):
    """Return unchanged UTF-8 source and physical mm for the supported subset."""
    svg_bytes = validate_drawing_svg(svg)
    root = ET.fromstring(svg_bytes)
    width = _physical_mm(root.get('width'))
    height = _physical_mm(root.get('height'))
    short, long = sorted((width, height))
    if not any(abs(short - w) <= 1e-6 and abs(long - h) <= 1e-6 for w, h in _SHEETS):
        raise ValueError('Drawing PDF supports nominal A0, A1, A2, A3 or A4 sheets only.')
    separator = r'(?:\s*,\s*|\s+)'
    viewbox = root.get('viewBox', '')
    if not re.fullmatch(r'\s*' + _NUMBER + (separator + _NUMBER) * 3 + r'\s*', viewbox):
        raise ValueError('Drawing PDF requires an explicit four-number viewBox.')
    bounds = [float(value) for value in re.findall(_NUMBER, viewbox)]
    if not all(math.isfinite(value) for value in bounds) or min(bounds[2:]) <= 0:
        raise ValueError('Drawing PDF viewBox must have finite positive dimensions.')
    if (any(abs(value) > _VIEWBOX_MAX_COORDINATE for value in bounds)
            or min(bounds[2:]) < _VIEWBOX_MIN_SIZE):
        raise ValueError('Drawing PDF viewBox exceeds the supported coordinate range.')
    if not math.isclose(width / height, bounds[2] / bounds[3], rel_tol=1e-8, abs_tol=0):
        raise ValueError('Drawing PDF physical dimensions and viewBox must have the same aspect ratio.')

    pattern_ids = {node.get('id') for node in root.iter() if node.tag.rsplit('}', 1)[-1].lower() == 'pattern'}
    for node in root.iter():
        tag = node.tag.rsplit('}', 1)[-1].lower()
        if tag not in _VECTOR_TAGS or (node.tag.startswith('{') and not node.tag.startswith('{http://www.w3.org/2000/svg}')):
            raise ValueError('Drawing PDF contains unsupported raster, active, animated or non-vector SVG content.')
        for name in node.attrib:
            local_name = name.rsplit('}', 1)[-1].lower()
            if local_name.startswith('on') or local_name in {'filter', 'mask'}:
                raise ValueError('Drawing PDF does not support SVG effects or event handlers.')
        css = node.get('style', '')
        if tag == 'style':
            css += ' ' + ''.join(node.itertext())
        css = re.sub(r'/\*.*?\*/', '', css, flags=re.S)
        if '\\' in css or '@' in css or _EFFECT.search(css):
            raise ValueError('Drawing PDF does not support escaped CSS, stylesheet directives or dynamic effects.')
        references = ' '.join(node.attrib.values()) + ' ' + css
        for match in re.finditer(r'url\s*\((.*?)\)', references, re.I | re.S):
            reference = match.group(1).strip(' \t\r\n\"\'')
            if reference.startswith('#') and reference[1:] in pattern_ids:
                raise ValueError('Drawing PDF does not support pattern fills that may rasterize.')
        if any(name.rsplit('}', 1)[-1].lower() == 'href' and value.lstrip('#') in pattern_ids
               for name, value in node.attrib.items()):
            raise ValueError('Drawing PDF does not support rendered pattern references.')
    return svg_bytes, width, height


def _load_qt():
    for binding in ('PySide6', 'PySide2'):
        try:
            core = importlib.import_module(binding + '.QtCore')
            gui = importlib.import_module(binding + '.QtGui')
            svg = importlib.import_module(binding + '.QtSvg')
            return SimpleNamespace(
                **{name: getattr(core, name) for name in ('QByteArray', 'QFile', 'QIODevice', 'QMarginsF', 'QRectF', 'QSizeF')},
                **{name: getattr(gui, name) for name in ('QGuiApplication', 'QPageLayout', 'QPageSize', 'QPainter', 'QPdfWriter')},
                QSvgRenderer=svg.QSvgRenderer,
            )
        except (ImportError, AttributeError):
            continue
    raise RuntimeError('Drawing PDF requires FreeCAD Python with PySide QtSvg and Qt PDF support.')


def _enum(owner, group, name):
    return getattr(getattr(owner, group, owner), name)


def _render_pdf(svg_bytes, width, height, output):
    qt = _load_qt()
    global _QT_APPLICATION
    _QT_APPLICATION = qt.QGuiApplication.instance() or qt.QGuiApplication(['fcad-drawing-pdf', '-platform', 'offscreen'])
    renderer = qt.QSvgRenderer(qt.QByteArray(svg_bytes))
    if not renderer.isValid():
        raise ValueError('Drawing PDF SVG cannot be rendered by the available QtSvg runtime.')
    device = qt.QFile(str(output))
    painter = writer = None
    started = False
    try:
        if not device.open(_enum(qt.QIODevice, 'OpenModeFlag', 'WriteOnly')):
            raise RuntimeError('Cannot open drawing PDF output.')
        writer = qt.QPdfWriter(device)
        writer.setResolution(_DPI)
        writer.setTitle('Drawing sheet')
        writer.setCreator('FreeCAD automation vector drawing export')
        size = qt.QPageSize(qt.QSizeF(width, height), _enum(qt.QPageSize, 'Unit', 'Millimeter'),
                           'Drawing SVG sheet', _enum(qt.QPageSize, 'SizeMatchPolicy', 'ExactMatch'))
        layout = qt.QPageLayout(size, _enum(qt.QPageLayout, 'Orientation', 'Portrait'),
                               qt.QMarginsF(0, 0, 0, 0), _enum(qt.QPageLayout, 'Unit', 'Millimeter'))
        layout.setMode(_enum(qt.QPageLayout, 'Mode', 'FullPageMode'))
        if not writer.setPageLayout(layout):
            raise RuntimeError('Cannot apply drawing PDF physical page layout.')
        painter = qt.QPainter()
        started = painter.begin(writer)
        if not started:
            raise RuntimeError('Cannot start drawing PDF vector painter.')
        painter.scale(_DPI / 25.4, _DPI / 25.4)
        renderer.render(painter, qt.QRectF(0, 0, width, height))
    finally:
        try:
            if painter is not None:
                ended = painter.end()
                if started and ended is False and sys.exc_info()[0] is None:
                    raise RuntimeError('Cannot finish drawing PDF vector painter.')
        finally:
            # QPdfWriter has no close(). Release both wrappers before closing its
            # explicit device so failed output can also be removed on Windows.
            painter = None
            writer = None
            device.close()


def export_drawing_pdf(svg, output_path):
    """Export to a fresh caller-owned staging path; remove it on any failure."""
    if not isinstance(output_path, str) or not output_path.strip():
        raise ValueError('Drawing PDF requires a non-empty output_path string.')
    source, width, height = validate_print_svg(svg)
    output = Path(output_path)
    # Never truncate or remove a previous artifact, even for a malformed request.
    with output.open('xb'):
        pass
    try:
        _render_pdf(source, width, height, output)
        with output.open('rb') as stream:
            header = stream.read(5)
            stream.seek(max(0, output.stat().st_size - 32))
            trailer = stream.read()
        if header != b'%PDF-' or not trailer.rstrip().endswith(b'%%EOF'):
            raise RuntimeError('Drawing PDF output was not completed.')
    except BaseException:
        output.unlink(missing_ok=True)
        raise
    return {'success': True, 'physical_width_mm': width, 'physical_height_mm': height,
            'page_box_tolerance_mm': 0.2}


def main():
    try:
        request = json.load(sys.stdin)
        if not isinstance(request, dict):
            raise ValueError('Drawing PDF input must be a JSON object.')
        with redirect_stdout(sys.stderr):
            result = export_drawing_pdf(request.get('svg'), request.get('output_path'))
        code = 0
    except Exception as error:
        result = {'success': False, 'error': str(error)}
        code = 1
    print(json.dumps(result))
    return code


if __name__ == '__main__':
    sys.exit(main())
