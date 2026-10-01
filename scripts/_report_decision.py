"""Bounded text helpers for the existing executive-summary grid."""

import os
import textwrap
from matplotlib.font_manager import FontProperties

CONTINUATION = '... See canonical JSON.'


def format_items(items, fallback='None', limit=5):
    values = [str(item) for item in items] if isinstance(items, list) and items else [fallback]
    return values[:limit] + ([CONTINUATION] if len(values) > limit else [])


def compact_path(value, max_length=56):
    text = str(value or 'n/a').replace('\\', '/')
    if len(text) <= max_length:
        return text
    parts = [part for part in text.split('/') if part]
    compact = '.../' + '/'.join(parts[-2:])
    return compact if len(compact) <= max_length else '...' + text[-(max_length - 3):]


def _wrap(ax, text, width, fontsize, fraction=1, prefix=''):
    renderer = ax.figure.canvas.get_renderer()
    available = ax.get_window_extent(renderer).width * fraction
    properties = FontProperties(size=fontsize)
    while width > len(prefix) + 1:
        lines = textwrap.wrap(str(text), width=width, initial_indent=prefix,
                              subsequent_indent=' ' * len(prefix)) or [prefix]
        if all(renderer.get_text_width_height_descent(line, properties, False)[0] <= available for line in lines):
            return lines
        width -= 1
    return [prefix + '...']


def render_rows(ax, rows, label_x=0.0, value_x=0.32, wrap_width=36):
    height = ax.get_position().height * ax.figure.get_figheight() * 72
    row_height = 0.95 * height / max(1, len(rows))
    max_lines = max(1, int(row_height / 9))
    for index, (label, value) in enumerate(rows):
        y = 0.95 - index * row_height / height
        rendered = compact_path(value) if label == 'Input' else str(value if value not in (None, '') else 'n/a')
        lines = _wrap(ax, rendered, wrap_width, 8, fraction=1 - value_x)
        if len(lines) > max_lines:
            lines = lines[:max_lines]
            lines[-1] = lines[-1][:-3].rstrip() + '...'
        ax.text(label_x, y, label, fontsize=8, fontweight='bold', va='top', color='#2c3e50')
        for offset, line in enumerate(lines):
            ax.text(value_x, y - offset * 9 / height, line, fontsize=8, va='top', color='#333333')


def render_block(fig, title, items, rect, bullets=True, fontsize=8):
    ax = fig.add_axes(rect)
    ax.axis('off')
    ax.set_title(title, fontsize=10, fontweight='bold', loc='left')
    height = rect[3] * fig.get_figheight() * 72
    line_height = fontsize * 1.5
    capacity = max(2, int(0.95 * height / line_height))
    width = 34 if rect[2] <= 0.22 else 48
    lines = []
    for item in items:
        prefix = '- ' if bullets and item != CONTINUATION else ''
        lines.extend(_wrap(ax, item, width, fontsize, prefix=prefix))
    if len(lines) > capacity:
        lines = lines[:capacity - 1] + [CONTINUATION]
    for index, line in enumerate(lines):
        ax.text(0, 0.95 - index * line_height / height, line,
                fontsize=fontsize, va='top', color='#333333')


def render_outputs(fig, artifacts):
    items = []
    for artifact in artifacts or []:
        label = artifact.get('label') or artifact.get('key') or 'artifact'
        items.append(f"{label} [{artifact.get('status', 'unknown')}] {compact_path(artifact.get('path'), 44)}")
    render_block(fig, 'Generated Outputs', format_items(items, 'No artifact references available.'),
                 [0.73, 0.20, 0.22, 0.25], bullets=False, fontsize=7)


def render_json_reference(fig, model_name, summary):
    filename = os.path.basename(summary.get('report_summary_json') or f'{model_name}_report_summary.json')
    ax = fig.add_axes([0.05, 0.055, 0.90, 0.07])
    ax.axis('off')
    lines = _wrap(ax, f'Full evidence and omitted text: {filename} (canonical JSON).', 120, 7)
    height = 0.07 * fig.get_figheight() * 72
    for index, line in enumerate(lines):
        ax.text(0, 0.95 - index * 9 / height, line, fontsize=7, va='top', color='#666666')
