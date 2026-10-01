import importlib.util
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest
import xml.etree.ElementTree as ET

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'scripts'))

SVG = '''<svg xmlns="http://www.w3.org/2000/svg" width="297mm" height="210mm" viewBox="0 0 297 210">
<rect x="20" y="20" width="110" height="70" fill="red"/>
<circle cx="200" cy="80" r="25" fill="blue"/>
<text x="40" y="120" font-size="12">8.0 mm</text></svg>'''


class TestReportDrawingSheet(unittest.TestCase):
    @unittest.skipUnless((importlib.util.find_spec('PySide6') or importlib.util.find_spec('PySide2')) and shutil.which('pdftoppm'), 'FreeCAD QtSvg and Poppler required')
    def test_actual_sheet_pixels_are_embedded_in_legacy_and_template_reports(self):
        from engineering_report import generate_legacy_report, generate_template_report
        from PIL import Image
        for mode in ('legacy', 'template'):
            with self.subTest(mode=mode), tempfile.TemporaryDirectory() as output:
                config = {
                    'name': 'sheet_probe', '_report_output_dir': output,
                    '_decision_summary': {'overall_status': 'incomplete'},
                    '_drawing_sheet': {'svg': SVG, 'scale': '1:2', 'views': ['front', 'top']},
                }
                if mode == 'legacy':
                    result = generate_legacy_report(config)
                else:
                    result = generate_template_report(config, {'template': {'sections': {'model_summary': {'enabled': True}}}})
                pdf = result['path']
                text = subprocess.check_output(['pdftotext', pdf, '-'], text=True)
                self.assertEqual(text.count('\f'), 3, 'append one actual sheet to the two existing pages')
                normalized = ' '.join(text.split())
                self.assertIn('Drawing sheet', normalized)
                self.assertIn('Source SVG scale: 1:2', normalized)
                print_note = 'Report reproduction is not to scale; use original SVG for scaled printing.'
                self.assertIn(print_note, normalized)
                self.assertIn('Dimension edits are annotations; they do not change 3D geometry.', normalized)
                bbox = ET.fromstring(subprocess.check_output(['pdftotext', '-bbox', pdf, '-']))
                page = bbox.findall('.//{*}page')[2]
                words = page.findall('{*}word')
                start = next(index for index, word in enumerate(words) if word.text == 'Report')
                note = words[start:start + len(print_note.split())]
                self.assertEqual(' '.join(word.text for word in note), print_note)
                self.assertLess(max(float(word.get('yMax')) for word in note),
                                float(page.get('height')) * 0.09, 'print-scale note must fit above the sheet image')
                self.assertGreater(min(float(word.get('xMin')) for word in note), 0)
                self.assertLess(max(float(word.get('xMax')) for word in note), float(page.get('width')))
                prefix = str(Path(output) / 'sheet')
                subprocess.run(['pdftoppm', '-f', '3', '-singlefile', '-r', '72', '-png', pdf, prefix], check=True)
                pixels = Image.open(prefix + '.png').convert('RGB')
                red = sum(r > 180 and g < 80 and b < 80 for r, g, b in pixels.getdata())
                blue = sum(b > 180 and r < 80 and g < 80 for r, g, b in pixels.getdata())
                self.assertGreater(red, 1000, 'actual red rectangle must be embedded, not a placeholder')
                self.assertGreater(blue, 500, 'actual blue circle must be embedded')

    def test_external_resources_and_dtd_are_rejected_before_rendering(self):
        from _report_drawing_sheet import validate_drawing_svg
        for svg in [
            '<!DOCTYPE svg [<!ENTITY x SYSTEM "file:///tmp/private">]><svg xmlns="http://www.w3.org/2000/svg">&x;</svg>',
            '<svg xmlns="http://www.w3.org/2000/svg"><image href="file:///tmp/private.png"/></svg>',
            '<svg xmlns="http://www.w3.org/2000/svg"><style>@import url(https://example.invalid/a.css);</style></svg>',
            '<svg xmlns="http://www.w3.org/2000/svg"><rect fill="url(https://example.invalid/a.svg)"/></svg>',
        ]:
            with self.subTest(svg=svg), self.assertRaises(ValueError):
                validate_drawing_svg(svg)
        self.assertEqual(validate_drawing_svg(SVG), SVG.encode('utf-8'))


if __name__ == '__main__':
    unittest.main()
