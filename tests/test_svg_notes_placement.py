"""Keep drawing notes legible inside the title block and expose omissions."""

from pathlib import Path
import sys
import unittest
import xml.etree.ElementTree as ET

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
from _general_notes import estimate_notes_height, render_general_notes_svg
from svg_common import TITLEBLOCK_Y, local_tag, elem_bbox_approx
from svg_repair import rebuild_notes


def notes_drawing(notes):
    y = 282 - 10 - estimate_notes_height(notes, max_width=212)
    svg, _ = render_general_notes_svg(notes, 19, y, max_width=212)
    return ET.ElementTree(ET.fromstring('<svg>' + svg + '</svg>'))


def labels(tree):
    return [node for node in tree.getroot().iter() if local_tag(node) == 'text']


class TestNotesPlacement(unittest.TestCase):
    def test_normal_notes_are_not_moved_across_the_title_block_border(self):
        tree = notes_drawing([
            'UNLESS OTHERWISE SPECIFIED:',
            'TOLERANCES PER KS B 0401 CLASS m',
            'SURFACE FINISH Ra 6.3',
            'REMOVE ALL BURRS AND SHARP EDGES.',
        ])
        original_text = [node.text for node in labels(tree)]
        original_y = [float(node.get('y')) for node in labels(tree)]
        result = rebuild_notes(tree)
        actual_y = [float(node.get('y')) for node in labels(tree)]
        self.assertGreaterEqual(min(actual_y) - 3, TITLEBLOCK_Y)
        self.assertLessEqual(max(actual_y), 268)
        self.assertEqual(actual_y, original_y)
        self.assertEqual([node.text for node in labels(tree)], original_text)
        self.assertFalse(result['summary']['truncated'])

    def test_existing_nine_line_capacity_is_preserved(self):
        tree = notes_drawing([f'Instruction {number}' for number in range(8)])
        original = [node.text for node in labels(tree)]
        result = rebuild_notes(tree)
        self.assertEqual([node.text for node in labels(tree)], original)
        self.assertEqual(result['summary']['lines_rendered'], 9)
        self.assertFalse(result['summary']['truncated'])
        self.assertLessEqual(max(float(node.get('y')) for node in labels(tree)), 268)
        self.assertGreaterEqual(min(elem_bbox_approx(node).y for node in labels(tree)), TITLEBLOCK_Y)
        self.assertEqual(len({node.get('x') for node in labels(tree)}), 2)

    def test_notes_that_exceed_capacity_still_report_truncation(self):
        tree = notes_drawing([f'Instruction {number}' for number in range(12)])
        result = rebuild_notes(tree)
        self.assertEqual(result['summary']['lines_total'], 13)
        self.assertEqual(result['summary']['lines_rendered'], 9)
        self.assertTrue(result['summary']['truncated'])
        self.assertTrue(any(risk['severity'] == 'error' for risk in result['risks']))
        self.assertTrue(any(node.get('data-notes-overflow') == 'true' for node in labels(tree)))
        self.assertGreaterEqual(min(elem_bbox_approx(node).y for node in labels(tree)), TITLEBLOCK_Y)
        again = rebuild_notes(tree)
        self.assertTrue(again['summary']['truncated'], 'reprocessing cannot erase an omission warning')

    def test_long_unbroken_text_is_wrapped_without_horizontal_overflow(self):
        tree = notes_drawing(['X' * 320])
        result = rebuild_notes(tree)
        self.assertFalse(result['summary']['truncated'])
        self.assertEqual(''.join(node.text or '' for node in labels(tree)).count('X'), 320)
        for node in labels(tree):
            bbox = elem_bbox_approx(node)
            self.assertLessEqual(bbox.x + bbox.w, 200)

    def test_no_notes_does_not_change_the_svg(self):
        tree = ET.ElementTree(ET.fromstring('<svg><text>Existing label</text></svg>'))
        before = ET.tostring(tree.getroot())
        result = rebuild_notes(tree)
        self.assertEqual(ET.tostring(tree.getroot()), before)
        self.assertEqual(result['summary']['lines_rendered'], 0)


if __name__ == '__main__':
    unittest.main()
