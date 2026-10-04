"""Print export contracts; these tests do not import or launch Qt/FreeCAD."""

import importlib
import io
import json
from pathlib import Path
import sys
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'scripts'))

SVG = ('<svg xmlns="http://www.w3.org/2000/svg" width="420mm" height="297mm" '
       'viewBox="0 0 840 594"><path d="M 40 40 H 240" stroke="black"/></svg>')


def fake_qt(events, fail=None):
    """Model the file ownership and painter boundary, without a GUI runtime."""
    class File:
        def __init__(self, path):
            self.path = path
            self.handle = None

        def open(self, _mode):
            self.handle = open(self.path, 'wb')
            self.handle.write(b'%PDF-1.4\n')
            events.append('open')
            return True

        def close(self):
            events.append('close')
            if self.handle:
                self.handle.close()

    class Writer:
        def __init__(self, device):
            self.device = device

        def setResolution(self, value):
            events.append(('dpi', value))

        def setTitle(self, _value):
            pass

        def setCreator(self, _value):
            pass

        def setPageLayout(self, layout):
            events.append(('layout', layout.values, layout.mode))
            return fail != 'layout'

        def __del__(self):
            events.append('writer_released')

    class Painter:
        def begin(self, writer):
            self.writer = writer
            events.append('begin')
            return fail != 'begin'

        def scale(self, x, y):
            events.append(('scale', x, y))

        def end(self):
            events.append('end')
            self.writer = None
            return fail != 'end'

    class Renderer:
        def __init__(self, svg):
            events.append(('source', svg))

        def isValid(self):
            return fail != 'invalid'

        def render(self, painter, rectangle):
            events.append(('render', rectangle))
            if fail == 'render':
                raise RuntimeError('Rendering failed')
            painter.writer.device.handle.write(b'vector drawing\n%%EOF\n')

    class Layout:
        Orientation = SimpleNamespace(Portrait='portrait')
        Unit = SimpleNamespace(Millimeter='mm')
        Mode = SimpleNamespace(FullPageMode='full')

        def __init__(self, *values):
            self.values = values

        def setMode(self, value):
            self.mode = value

    class PageSize:
        Unit = SimpleNamespace(Millimeter='mm')
        SizeMatchPolicy = SimpleNamespace(ExactMatch='exact')

        def __init__(self, *values):
            self.values = values

    return SimpleNamespace(
        QFile=File, QIODevice=SimpleNamespace(OpenModeFlag=SimpleNamespace(WriteOnly=2)),
        QPdfWriter=Writer, QPainter=Painter, QSvgRenderer=Renderer,
        QPageLayout=Layout, QPageSize=PageSize,
        QGuiApplication=SimpleNamespace(instance=lambda: object()),
        QByteArray=bytes, QSizeF=lambda *args: args,
        QMarginsF=lambda *args: args, QRectF=lambda *args: args,
    )


class TestDrawingPdf(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        try:
            cls.module = importlib.import_module('drawing_pdf')
        except ModuleNotFoundError:
            cls.module = None

    def setUp(self):
        self.assertIsNotNone(self.module, 'The drawing PDF export helper is not implemented')

    def test_accepts_supported_physical_sheets_without_rewriting_svg(self):
        for width, height in [(841, 1189), (594, 841), (420, 594), (297, 420), (210, 297)]:
            for w, h in [(width, height), (height, width)]:
                with self.subTest(width=w, height=h):
                    svg = f'<svg width="{w}mm" height="{h}mm" viewBox="-2 4 {w * 2} {h * 2}"/>'
                    source, actual_width, actual_height = self.module.validate_print_svg(svg)
                    self.assertEqual(source, svg.encode('utf-8'))
                    self.assertEqual((actual_width, actual_height), (w, h))

    def test_rejects_missing_nonphysical_and_unsupported_page_dimensions(self):
        for value in ['', '420', '420px', '100%', '0mm', '-420mm', 'NaNmm', 'infmm',
                      '1e999mm', '421mm', '420.01mm', '11890mm']:
            with self.subTest(value=value), self.assertRaises(ValueError):
                self.module.validate_print_svg(SVG.replace('420mm', value))
        with self.assertRaises(ValueError):
            self.module.validate_print_svg(SVG.replace(' width="420mm"', ''))

    def test_rejects_missing_nonfinite_degenerate_or_distorted_viewbox(self):
        for value in ['', '0 0 840', '0 0 840 594 1', '0 0 0 594', '0 0 -840 594',
                      'nan 0 840 594', '0 inf 840 594', '0 0 1e999 594',
                      '0 0 420 594', '0 0 840 0', '0,,0,840,594']:
            with self.subTest(value=value), self.assertRaises(ValueError):
                self.module.validate_print_svg(SVG.replace('0 0 840 594', value))
        with self.assertRaises(ValueError):
            self.module.validate_print_svg(SVG.replace(' viewBox="0 0 840 594"', ''))

    def test_rejects_finite_viewbox_values_outside_safe_coordinate_range(self):
        for value in ['1e308 0 840 594', '0 -1e308 840 594',
                      '1000001 0 840 594', '0 -1000001 840 594',
                      '0 0 8400000 5940000', '0 0 8.4e307 5.94e307',
                      '0 0 0.000000840 0.000000594']:
            with self.subTest(value=value), self.assertRaises(ValueError):
                self.module.validate_print_svg(SVG.replace('0 0 840 594', value))

    def test_allows_normalized_and_large_bounded_viewbox_coordinates(self):
        for value in ['0 0 1.4141414141414141 1',
                      '-1000000 1000000 840 594',
                      '0 0 840000 594000', '0 0 0.00000420 0.00000297']:
            with self.subTest(value=value):
                source = SVG.replace('0 0 840 594', value)
                self.assertEqual(self.module.validate_print_svg(source)[0], source.encode('utf-8'))

    def test_reuses_existing_external_resource_boundary(self):
        for child in [
            '<image href="file:///private/file.png"/>',
            '<use href="https://example.invalid/source.svg#x"/>',
            '<style>@import url(https://example.invalid/styles.css);</style>',
            '<rect fill="url(https://example.invalid/source.svg)"/>',
            '<script>run()</script>', '<foreignObject/>',
        ]:
            with self.subTest(child=child), self.assertRaises(ValueError):
                self.module.validate_print_svg(SVG.replace('</svg>', child + '</svg>'))
        with self.assertRaises(ValueError):
            self.module.validate_print_svg('<!DOCTYPE svg [<!ENTITY secret "x">]>' + SVG)

    def test_rejects_raster_filters_animation_and_active_effects(self):
        for child in [
            '<image/>', '<image href="#local"/>', '<filter/>', '<feGaussianBlur/>',
            '<mask/>', '<animate/>', '<animateTransform/>', '<animateMotion/>',
            '<set/>', '<discard/>', '<video/>', '<rect onload="run()"/>',
            '<rect filter="url(#fx)"/>', '<rect mask="url(#m)"/>',
            '<style>rect { filter: blur(1px); }</style>',
            '<rect style="mix-blend-mode:multiply"/>',
            '<style>rect { animation: spin 2s; }</style>',
            '<style>@keyframes spin {}</style>',
            '<rect style="f\\69lter:blur(1px)"/>',
            '<defs><pattern id="hatch"><path d="M 0 0 H 3"/></pattern></defs>'
            '<rect fill="url(#hatch)"/>',
        ]:
            with self.subTest(child=child), self.assertRaises(ValueError):
                self.module.validate_print_svg(SVG.replace('</svg>', child + '</svg>'))

    def test_allows_vector_clipping_gradients_and_unused_template_hatch(self):
        child = ('<defs><pattern id="unused"><path d="M 0 0 H 3"/></pattern>'
                 '<clipPath id="clip"><circle r="2"/></clipPath>'
                 '<linearGradient id="gradient"><stop offset="0" stop-color="red"/></linearGradient></defs>'
                 '<rect clip-path="url(#clip)" fill="url(#gradient)" style="stroke:black;stroke-width:0.5"/>')
        svg = SVG.replace('</svg>', child + '</svg>')
        self.assertEqual(self.module.validate_print_svg(svg)[0], svg.encode('utf-8'))

    def test_vector_paint_uses_physical_millimetres_and_closes_output(self):
        events = []
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory) / 'drawing.pdf'
            with patch.object(self.module, '_load_qt', return_value=fake_qt(events)):
                result = self.module.export_drawing_pdf(SVG, str(output))
            self.assertEqual(result, {'success': True, 'physical_width_mm': 420.0,
                                     'physical_height_mm': 297.0, 'page_box_tolerance_mm': 0.2})
            self.assertTrue(output.read_bytes().startswith(b'%PDF-1.4'))
        self.assertIn(('source', SVG.encode('utf-8')), events)
        self.assertIn(('scale', 300 / 25.4, 300 / 25.4), events)
        self.assertIn(('render', (0, 0, 420.0, 297.0)), events)
        layout = next(event for event in events if isinstance(event, tuple) and event[0] == 'layout')
        self.assertEqual(layout[1][0].values, ((420.0, 297.0), 'mm', 'Drawing SVG sheet', 'exact'))
        self.assertEqual(layout[1][2], (0, 0, 0, 0))
        self.assertEqual(layout[2], 'full')
        self.assertLess(events.index('end'), events.index('writer_released'))
        self.assertLess(events.index('writer_released'), events.index('close'))

    def test_render_failures_close_devices_before_removing_partial_output(self):
        for failure in ['invalid', 'layout', 'begin', 'render', 'end']:
            with self.subTest(failure=failure), tempfile.TemporaryDirectory() as directory:
                events = []
                output = Path(directory) / 'drawing.pdf'
                real_unlink = Path.unlink

                def unlink_after_close(path, *args, **kwargs):
                    if 'open' in events:
                        self.assertIn('close', events)
                        self.assertLess(events.index('writer_released'), events.index('close'))
                    return real_unlink(path, *args, **kwargs)

                with patch.object(self.module, '_load_qt', return_value=fake_qt(events, failure)), \
                        patch.object(Path, 'unlink', unlink_after_close), self.assertRaises((ValueError, RuntimeError)):
                    self.module.export_drawing_pdf(SVG, str(output))
                self.assertFalse(output.exists())
                if 'begin' in events:
                    self.assertIn('end', events)

    def test_invalid_svg_is_rejected_without_loading_qt_or_creating_output(self):
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory) / 'drawing.pdf'
            with patch.object(self.module, '_load_qt', side_effect=AssertionError('Qt was loaded')), self.assertRaises(ValueError):
                self.module.export_drawing_pdf(SVG.replace('420mm', '420px'), str(output))
            self.assertFalse(output.exists())

    def test_missing_qt_is_an_explicit_failure_without_output(self):
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory) / 'drawing.pdf'
            with patch.object(self.module, '_load_qt', side_effect=RuntimeError('QtSvg support unavailable')), self.assertRaisesRegex(RuntimeError, 'QtSvg'):
                self.module.export_drawing_pdf(SVG, str(output))
            self.assertFalse(output.exists())

    def test_existing_destination_is_preserved(self):
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory) / 'drawing.pdf'
            output.write_bytes(b'existing saved artifact')
            with patch.object(self.module, '_load_qt', side_effect=AssertionError('Qt was loaded')), self.assertRaises(FileExistsError):
                self.module.export_drawing_pdf(SVG, str(output))
            self.assertEqual(output.read_bytes(), b'existing saved artifact')

    def test_cli_emits_one_json_error_for_invalid_requests(self):
        for raw in ['invalid', 'null', '[]', '{}', '{"svg":3,"output_path":"x"}',
                    json.dumps({'svg': SVG, 'output_path': ''})]:
            with self.subTest(raw=raw), patch('sys.stdin', io.StringIO(raw)), \
                    patch('sys.stdout', new_callable=io.StringIO) as stdout:
                code = self.module.main()
                result = json.loads(stdout.getvalue())
                self.assertNotEqual(code, 0)
                self.assertFalse(result['success'])
                self.assertIsInstance(result['error'], str)

    def test_cli_emits_only_success_json_with_fake_vector_renderer(self):
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory) / 'drawing.pdf'
            raw = json.dumps({'svg': SVG, 'output_path': str(output)})
            with patch('sys.stdin', io.StringIO(raw)), patch('sys.stdout', new_callable=io.StringIO) as stdout, \
                    patch.object(self.module, '_load_qt', return_value=fake_qt([])):
                code = self.module.main()
                result = json.loads(stdout.getvalue())
            self.assertEqual(code, 0)
            self.assertTrue(result['success'])
            self.assertEqual(result['physical_width_mm'], 420)
            self.assertTrue(output.exists())


if __name__ == '__main__':
    unittest.main()
