"""Actual OpenCascade geometry tests; skipped when FreeCAD is unavailable."""
import copy
from pathlib import Path
import sys
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
try:
    import FreeCAD
    import Part
except ImportError:
    Part = None


@unittest.skipUnless(Part, 'FreeCAD runtime required; no mock geometry')
class NamedAnchors(unittest.TestCase):
    def setUp(self):
        from _shapes import make_shape, boolean_op
        self.specs = [
            dict(id='plate', type='box', length=20, width=10, height=4),
            dict(id='boss1', type='cylinder', radius=2, height=8, position=[4,5,4]),
            dict(id='boss2', type='cylinder', radius=2, height=8, position=[16,5,4]),
            dict(id='hole', type='cylinder', radius=1, height=8, position=[10,5,-2]),
        ]
        self.config = dict(shapes=self.specs, final='final', operations=[
            dict(op='fuse', base='plate', tool='boss1', result='body'),
            dict(op='fuse', base='body', tool='boss2', result='body'),
            dict(op='cut', base='body', tool='hole', result='final'),
        ])
        self.source = {s['id']: make_shape(s) for s in self.specs}
        self.final = self.source['plate'].fuse(self.source['boss1']).fuse(self.source['boss2']).cut(self.source['hole'])

    def resolve(self, intent, final=None, source=None, circles=()):
        from _dimension_anchors import resolve_named_dimension
        return resolve_named_dimension(intent, self.config, source or self.source,
            self.final if final is None else final, intent.get('view', 'front'), circles)

    def test_plate_thickness_and_all_named_bosses(self):
        for intent, value in [
            (dict(id='THK', feature='plate', value_mm=4), 4),
            (dict(id='STANDOFF_HEIGHT', feature='boss1,boss2', value_mm=8), 8),
        ]:
            result = self.resolve(intent)
            self.assertEqual(result['status'], 'resolved', result)
            self.assertAlmostEqual(result['value_mm'], value)
            self.assertEqual(len(result['members']), len(intent['feature'].split(',')))
            self.assertEqual(result['bounds_uv'][3] - result['bounds_uv'][1], value)
            if intent['id'] == 'THK':
                self.assertEqual(result['bounds_uv'], [20,0,20,4])

    def test_unobserved_or_ambiguous_geometry_stays_unresolved(self):
        intent = dict(id='STANDOFF_HEIGHT', feature='boss1,boss2', value_mm=8)
        removed = self.final.cut(self.source['boss2'])
        covered = self.final.fuse(Part.makeBox(30,20,20, FreeCAD.Vector(-5,-5,-1)))
        extended = self.final.fuse(Part.makeCylinder(2,12,FreeCAD.Vector(4,5,4)))
        for final in (removed, covered, extended):
            self.assertNotEqual(self.resolve(intent, final)['status'], 'resolved')
        self.assertNotEqual(self.resolve({**intent, 'value_mm': 7})['status'], 'resolved')
        self.assertNotEqual(self.resolve({**intent, 'feature': 'missing'})['status'], 'resolved')
        self.assertNotEqual(self.resolve(dict(id='CONNECTOR_SLOT_POSITION', feature='plate', value_mm=4))['status'], 'resolved')
        self.assertNotEqual(self.resolve({**intent, 'view': 'top'})['status'], 'resolved')
        cap = self.final.fuse(Part.makeBox(20,10,3,FreeCAD.Vector(0,0,4)))
        self.assertNotEqual(self.resolve(dict(id='THK', feature='plate', value_mm=4), cap)['status'], 'resolved')

    def test_diameter_requires_named_final_surface_and_projected_locus(self):
        intent = dict(id='HOLE_DIA', feature='hole', style='diameter', value_mm=2, view='top')
        self.assertEqual(self.resolve(intent, circles=[(10,5,1)])['status'], 'resolved')
        self.assertNotEqual(self.resolve(intent, circles=[(4,5,1)])['status'], 'resolved')
        uncut = self.source['plate'].fuse(self.source['boss1']).fuse(self.source['boss2'])
        self.assertNotEqual(self.resolve(intent, uncut, circles=[(10,5,1)])['status'], 'resolved')
        # Replacing the cavity with an outward boss of the same radius is not a hole.
        filled = self.final.fuse(self.source['hole'])
        self.assertNotEqual(self.resolve(intent, filled, circles=[(10,5,1)])['status'], 'resolved')

    def test_retained_height_line_survives_a_partial_side_cut(self):
        intent = dict(id='STANDOFF_HEIGHT', feature='boss1,boss2', value_mm=8)
        final = self.final.cut(Part.makeCylinder(1,8,FreeCAD.Vector(5.8,6,-2)))
        result = self.resolve(intent, final)
        self.assertEqual(result['status'], 'resolved', result)

    def test_edge_treatment_preserves_lineage_but_requires_final_hole_faces(self):
        self.config['operations'].append(dict(op='chamfer', target='final', size=0.5, result='final'))
        intent = dict(id='HOLE_DIA', feature='hole', style='diameter', value_mm=2, view='top')
        self.assertEqual(self.resolve(intent, circles=[(10,5,1)])['status'], 'resolved')

    def test_translation_preserves_measurement_and_moves_anchors(self):
        intent = dict(id='THK', feature='plate', value_mm=4)
        before = self.resolve(intent)
        delta = FreeCAD.Vector(30,20,10)
        moved = {k: v.copy() for k,v in self.source.items()}
        for shape in moved.values():
            shape.translate(delta)
        final = self.final.copy()
        final.translate(delta)
        after = self.resolve(intent, final, moved)
        self.assertEqual(after['status'], 'resolved', after)
        self.assertAlmostEqual(after['value_mm'], before['value_mm'])
        for i, shift in enumerate((30,10,30,10)):
            self.assertAlmostEqual(after['bounds_uv'][i] - before['bounds_uv'][i], shift)


if __name__ == '__main__':
    unittest.main()
