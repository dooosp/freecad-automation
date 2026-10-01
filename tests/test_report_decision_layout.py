import copy
import importlib.util
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))


@unittest.skipUnless(importlib.util.find_spec('matplotlib') and shutil.which('pdftotext'), 'matplotlib and Poppler required')
class TestDecisionSummaryLayout(unittest.TestCase):
    def test_bounded_summary_preserves_items_and_marks_continuation(self):
        import matplotlib
        matplotlib.use('Agg')
        import matplotlib.pyplot as plt
        from engineering_report import _render_executive_summary_page
        from _report_renderer import render_decision_summary_page

        summary = {
            'overall_status': 'incomplete', 'config_name': 'quality_pass_bracket',
            'report_summary_json': '/tracked/artifacts/quality_pass_bracket_report_summary.json',
            'input_config': '/tracked/job/inputs/a_very_long_input_config_name_that_needs_wrapping.json',
            'git_commit': 'a' * 40, 'git_branch': 'codex/studio-drawing-output-consistency',
            'missing_optional_artifacts': [f'missing_artifact_{i}' for i in range(12)],
            'top_risks': ['Review the drawing evidence carefully before approving this manufacturing change because the quality record is incomplete.'],
            'recommended_actions': ['Add a required linear dimension intent for overall length from a declared datum or edge. ' * 5] * 3,
        }
        artifacts = [{'label': f'Output artifact {i}', 'status': 'available',
                      'path': f'/tracked/artifacts/quality_pass_bracket_output_{i}_long_filename.json'} for i in range(8)]
        original = copy.deepcopy(summary)
        for mode in ('legacy', 'template'):
            with self.subTest(mode=mode), tempfile.TemporaryDirectory() as output:
                fig = plt.figure(figsize=(11.69, 8.27))
                try:
                    if mode == 'legacy':
                        _render_executive_summary_page(fig, 'quality_pass_bracket', summary, artifacts)
                    else:
                        render_decision_summary_page(fig, {'name': 'quality_pass_bracket'}, summary, artifacts, {})
                    fig.canvas.draw()
                    renderer = fig.canvas.get_renderer()
                    risks = next(ax for ax in fig.axes if ax.get_title(loc='left') == 'Top Risks')
                    self.assertEqual(sum(text.get_text().startswith('- ') for text in risks.texts), 1,
                                     'wrapping one risk must not create additional bullet items')
                    for ax in fig.axes:
                        bounds = ax.get_window_extent(renderer)
                        for text in ax.texts:
                            box = text.get_window_extent(renderer)
                            self.assertGreaterEqual(box.ymin, bounds.ymin - 1, text.get_text())
                            self.assertLessEqual(box.xmax, bounds.xmax + 1, text.get_text())
                    path = Path(output) / 'summary.pdf'
                    fig.savefig(path)
                    extracted = ' '.join(subprocess.check_output(['pdftotext', str(path), '-'], text=True).split())
                    self.assertIn('... See canonical JSON.', extracted)
                    self.assertIn('quality_pass_bracket_report_summary.json', extracted)
                    self.assertIn('Optional missing', extracted)
                    self.assertEqual(summary, original)
                finally:
                    plt.close(fig)


if __name__ == '__main__':
    unittest.main()
