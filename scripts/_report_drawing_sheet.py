"""Embed a generated SVG sheet using the QtSvg shipped with FreeCAD."""

import io
import math
import re
import xml.etree.ElementTree as ET

_QT_APPLICATION = None


def validate_drawing_svg(svg):
    if not isinstance(svg, str) or not svg.strip():
        raise ValueError('Drawing report requires a non-empty SVG sheet.')
    if re.search(r'<!DOCTYPE|<!ENTITY|<\?xml-stylesheet', svg, re.IGNORECASE):
        raise ValueError('Drawing SVG must not contain DTDs or external stylesheets.')
    try:
        root = ET.fromstring(svg)
    except ET.ParseError as error:
        raise ValueError('Drawing report SVG is invalid.') from error
    if root.tag.rsplit('}', 1)[-1] != 'svg':
        raise ValueError('Drawing report source must be SVG.')
    for element in root.iter():
        tag = element.tag.rsplit('}', 1)[-1].lower()
        if tag in {'script', 'foreignobject'}:
            raise ValueError('Drawing SVG contains unsupported active content.')
        for name, value in element.attrib.items():
            if name.rsplit('}', 1)[-1].lower() in {'href', 'src', 'base'} and not value.strip().startswith('#'):
                raise ValueError('Drawing SVG must not reference external resources.')
        css = ' '.join(element.attrib.values())
        if tag == 'style':
            css += ' ' + ''.join(element.itertext())
        css = re.sub(r'/\*.*?\*/', '', css, flags=re.DOTALL)
        if re.search(r'@import', css, re.IGNORECASE):
            raise ValueError('Drawing SVG must not import stylesheets.')
        for match in re.finditer(r'url\s*\((.*?)\)', css, re.IGNORECASE | re.DOTALL):
            if not match.group(1).strip(' \t\r\n\"\'').startswith('#'):
                raise ValueError('Drawing SVG must not reference external resources.')
    return svg.encode('utf-8')


def render_drawing_sheet(fig, sheet):
    """Render the actual sheet into a bounded 300dpi image, preserving aspect ratio."""
    svg_bytes = validate_drawing_svg(sheet.get('svg'))
    try:
        from PySide6.QtCore import QByteArray, QBuffer, QIODevice, QRectF
        from PySide6.QtGui import QGuiApplication, QImage, QPainter
        from PySide6.QtSvg import QSvgRenderer
    except ImportError:
        try:
            from PySide2.QtCore import QByteArray, QBuffer, QIODevice, QRectF
            from PySide2.QtGui import QGuiApplication, QImage, QPainter
            from PySide2.QtSvg import QSvgRenderer
        except ImportError as error:
            raise RuntimeError('Drawing report PDF requires FreeCAD Python with PySide QtSvg support.') from error
    global _QT_APPLICATION
    _QT_APPLICATION = QGuiApplication.instance() or QGuiApplication(['fcad-report', '-platform', 'offscreen'])
    renderer = QSvgRenderer(QByteArray(svg_bytes))
    bounds = renderer.viewBoxF()
    if not renderer.isValid() or bounds.width() <= 0 or bounds.height() <= 0:
        raise ValueError('Drawing report SVG has no renderable sheet bounds.')
    ratio = bounds.width() / bounds.height()
    if not math.isfinite(ratio) or ratio <= 0:
        raise ValueError('Drawing report SVG has invalid sheet dimensions.')
    # The report page is A4 landscape. Cap pixels independently of SVG dimensions.
    max_width, max_height = 3508, 2481
    if ratio >= max_width / max_height:
        width, height = max_width, max(1, round(max_width / ratio))
    else:
        width, height = max(1, round(max_height * ratio)), max_height
    image = QImage(width, height, QImage.Format_ARGB32)
    image.fill(0xffffffff)
    painter = QPainter(image)
    try:
        renderer.render(painter, QRectF(0, 0, width, height))
    finally:
        painter.end()
    buffer = QBuffer()
    buffer.open(QIODevice.WriteOnly)
    if not image.save(buffer, 'PNG'):
        raise RuntimeError('Drawing sheet rasterization failed.')
    from matplotlib import image as mpimg
    pixels = mpimg.imread(io.BytesIO(bytes(buffer.data())), format='png')
    fig.suptitle('Drawing sheet', fontsize=14, fontweight='bold', y=0.975)
    views = ', '.join(str(value) for value in sheet.get('views', []))
    fig.text(0.5, 0.94, f"Source SVG scale: {sheet.get('scale', 'auto')} | Views: {views}",
             ha='center', fontsize=8, color='#666666')
    fig.text(0.5, 0.92, 'Report reproduction is not to scale; use original SVG for scaled printing.',
             ha='center', fontsize=7, color='#666666')
    ax = fig.add_axes([0.025, 0.05, 0.95, 0.86])
    ax.imshow(pixels, interpolation='none')
    ax.axis('off')
    fig.text(0.5, 0.02, 'Dimension edits are annotations; they do not change 3D geometry.',
             ha='center', fontsize=7, color='#666666')


def append_drawing_sheet(pdf, sheet):
    if not sheet:
        return
    import matplotlib.pyplot as plt
    fig = plt.figure(figsize=(11.69, 8.27))
    try:
        render_drawing_sheet(fig, sheet)
        pdf.savefig(fig, dpi=300)
    finally:
        plt.close(fig)
