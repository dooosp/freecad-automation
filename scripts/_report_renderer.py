"""Multi-page report renderer for FreeCAD Studio."""

import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
from matplotlib.backends.backend_pdf import PdfPages
import numpy as np
import os
import json
from datetime import datetime
from _report_styles import (
    STYLE_PROFESSIONAL, SEVERITY_COLORS, PAGE_WIDTH, PAGE_HEIGHT,
    MARGIN_TOP, MARGIN_BOTTOM, MARGIN_LEFT, MARGIN_RIGHT,
    CONTENT_WIDTH, CONTENT_HEIGHT, apply_style, get_score_color, get_font
)


def render_report(config, template, data, output_path):
    """Render a multi-page PDF report based on template configuration.

    Args:
        config: dict - TOML config data
        template: dict - Report template configuration
        data: dict - Analysis results (dfm, tolerance, cost, etc.)
        output_path: str - Output PDF file path

    Returns:
        str - Path to generated PDF
    """
    style = apply_style(template)
    metadata = template.get('_metadata', {})

    with PdfPages(output_path) as pdf:
        page_num = 0
        total_pages_estimate = _count_enabled_sections(template) + 2  # title + toc + sections

        # Title Block page
        if template.get('title_block'):
            page_num += 1
            fig = _new_page()
            render_title_block(fig, template, metadata, config, style)
            _render_footer(fig, page_num, total_pages_estimate, style)
            pdf.savefig(fig)
            plt.close(fig)

        # Revision History page (if enabled and has data)
        rev_hist = template.get('revision_history', {})
        if rev_hist.get('enabled'):
            page_num += 1
            fig = _new_page()
            render_revision_history(fig, template, metadata, style)
            _render_footer(fig, page_num, total_pages_estimate, style)
            pdf.savefig(fig)
            plt.close(fig)

        # Table of Contents
        toc = template.get('toc', template.get('table_of_contents', {}))
        if toc.get('enabled'):
            page_num += 1
            fig = _new_page()
            render_toc(fig, template, style)
            _render_footer(fig, page_num, total_pages_estimate, style)
            pdf.savefig(fig)
            plt.close(fig)

        # Content sections (ordered)
        sections_dict = template.get('sections', {})
        sections = []
        for section_id, section_config in sections_dict.items():
            if isinstance(section_config, dict):
                sections.append({
                    'id': section_id,
                    'order': section_config.get('order', 99),
                    'enabled': section_config.get('enabled', True),
                    'label': section_config.get('label', section_id),
                    'label_ko': section_config.get('label_ko', section_id),
                })

        sections = sorted(sections, key=lambda s: s.get('order', 99))

        section_renderers = {
            'model_summary': render_section_model,
            'drawing': render_section_drawing,
            'dfm': render_section_dfm,
            'tolerance': render_section_tolerance,
            'cost': render_section_cost,
            'bom': render_section_bom,
        }

        for section in sections:
            if not section.get('enabled', True):
                continue
            renderer = section_renderers.get(section['id'])
            if renderer:
                page_num += 1
                fig = _new_page()
                section_label = section.get('label_ko', section.get('label', section['id']))
                _render_section_header(fig, section_label, style)
                renderer(fig, config, data, style)
                _render_footer(fig, page_num, total_pages_estimate, style)
                pdf.savefig(fig)
                plt.close(fig)

        # Assumptions
        assumptions = template.get('assumptions', {})
        if assumptions.get('enabled'):
            page_num += 1
            fig = _new_page()
            render_assumptions(fig, template, config, style)
            _render_footer(fig, page_num, total_pages_estimate, style)
            pdf.savefig(fig)
            plt.close(fig)

        # Standards References
        standards = template.get('standards', template.get('standards_references', {}))
        if standards.get('enabled'):
            page_num += 1
            fig = _new_page()
            render_standards(fig, template, style)
            _render_footer(fig, page_num, total_pages_estimate, style)
            pdf.savefig(fig)
            plt.close(fig)

        # Disclaimer + Signature (can share a page)
        disclaimer = template.get('disclaimer', {})
        signature = template.get('signature', template.get('signature_area', {}))
        if disclaimer.get('enabled') or signature.get('enabled'):
            page_num += 1
            fig = _new_page()
            y_pos = 0.85
            if disclaimer.get('enabled'):
                y_pos = render_disclaimer(fig, template, style, y_pos)
            if signature.get('enabled'):
                render_signature_area(fig, template, style, y_pos - 0.1)
            _render_footer(fig, page_num, total_pages_estimate, style)
            pdf.savefig(fig)
            plt.close(fig)

    return output_path


# === Helper functions ===

def _new_page():
    """Create a new A4 landscape figure."""
    fig = plt.figure(figsize=(PAGE_WIDTH, PAGE_HEIGHT))
    fig.patch.set_facecolor('white')
    return fig

def _count_enabled_sections(template):
    """Count enabled sections for page estimation."""
    count = 0
    sections_dict = template.get('sections', {})
    for section_id, section_config in sections_dict.items():
        if isinstance(section_config, dict) and section_config.get('enabled', True):
            count += 1
    if template.get('assumptions', {}).get('enabled'):
        count += 1
    if template.get('standards', template.get('standards_references', {})).get('enabled'):
        count += 1
    if template.get('disclaimer', {}).get('enabled') or template.get('signature', template.get('signature_area', {})).get('enabled'):
        count += 1
    return count

def _render_section_header(fig, title, style):
    """Render section header bar at top of page."""
    # Header bar background
    ax = fig.add_axes([MARGIN_LEFT/PAGE_WIDTH, (PAGE_HEIGHT - MARGIN_TOP)/PAGE_HEIGHT,
                       CONTENT_WIDTH/PAGE_WIDTH, 0.04])
    ax.set_xlim(0, 1)
    ax.set_ylim(0, 1)
    ax.fill_between([0, 1], 0, 1, color=style['header_color'], alpha=0.9)
    ax.text(0.02, 0.5, title, fontsize=12, fontweight='bold', color='white',
            va='center', ha='left')
    ax.axis('off')

def _render_footer(fig, page_num, total_pages, style):
    """Render page footer with page numbers."""
    fig.text(0.5, 0.02, f'Page {page_num}',
             ha='center', va='bottom', fontsize=8, color='#999999')
    fig.text(0.95, 0.02, 'FreeCAD Studio',
             ha='right', va='bottom', fontsize=7, color='#bbbbbb')


# === Section renderers ===

def render_title_block(fig, template, metadata, config, style):
    """Render title block / cover page."""
    tb = template.get('title_block', {})

    # Company header area
    y = 0.82
    if tb.get('show_logo', tb.get('show_logo_placeholder')):
        fig.text(0.08, y + 0.06, '[LOGO]', fontsize=16, color='#cccccc',
                fontweight='bold', va='center')

    company = tb.get('company_name') or metadata.get('company_name', '')
    if company:
        fig.text(0.5, y + 0.06, company, fontsize=14, fontweight='bold',
                ha='center', va='center', color=style['header_color'])

    # Title
    part_name = metadata.get('part_name', config.get('name', 'Engineering Report'))
    fig.text(0.5, y - 0.05, 'Engineering Analysis Report', fontsize=18,
            fontweight='bold', ha='center', va='center', color=style['header_color'])

    fig.text(0.5, y - 0.12, metadata.get('part_name', part_name), fontsize=14,
            ha='center', va='center', color=style['accent_color'])

    # Info table
    info_fields = tb.get('fields', ['part_name', 'date'])
    field_labels = {
        'part_name': ('Part Name', '부품명'),
        'drawing_number': ('Drawing No.', '도면번호'),
        'revision': ('Revision', '리비전'),
        'date': ('Date', '일자'),
        'author': ('Author', '작성자'),
        'reviewer': ('Reviewer', '검토자'),
        'approver': ('Approver', '승인자'),
    }

    lang = template.get('language', 'en')
    y_table = y - 0.25
    for i, field in enumerate(info_fields):
        labels = field_labels.get(field, (field, field))
        label = labels[1] if lang == 'ko' else labels[0]
        value = metadata.get(field, '')
        if field == 'date' and not value:
            value = datetime.now().strftime('%Y-%m-%d')

        row_y = y_table - i * 0.045
        fig.text(0.3, row_y, label, fontsize=10, fontweight='bold',
                ha='right', va='center', color=style['header_color'])
        fig.text(0.33, row_y, ':', fontsize=10, ha='center', va='center')
        fig.text(0.36, row_y, str(value), fontsize=10,
                ha='left', va='center', color='#333333')


def render_revision_history(fig, template, metadata, style):
    """Render revision history table."""
    _render_section_header(fig, '개정 이력 / Revision History', style)

    ax = fig.add_axes([MARGIN_LEFT/PAGE_WIDTH, 0.15, CONTENT_WIDTH/PAGE_WIDTH, 0.65])
    ax.axis('off')

    headers = ['Rev', 'Date', 'Author', 'Description']
    revisions = metadata.get('revisions', [
        {'rev': 'A', 'date': datetime.now().strftime('%Y-%m-%d'),
         'author': metadata.get('author', ''), 'description': 'Initial release'}
    ])

    table_data = [[r.get('rev', ''), r.get('date', ''), r.get('author', ''),
                   r.get('description', '')] for r in revisions[:10]]

    if table_data:
        table = ax.table(cellText=table_data, colLabels=headers, loc='upper center',
                        cellLoc='center', colWidths=[0.1, 0.2, 0.2, 0.5])
        _style_table(table, style)


def render_toc(fig, template, style):
    """Render table of contents."""
    _render_section_header(fig, '목차 / Table of Contents', style)

    sections_dict = template.get('sections', {})
    sections = []
    for section_id, section_config in sections_dict.items():
        if isinstance(section_config, dict):
            sections.append({
                'id': section_id,
                'order': section_config.get('order', 99),
                'enabled': section_config.get('enabled', True),
                'label': section_config.get('label', section_id),
                'label_ko': section_config.get('label_ko', section_id),
            })

    sections = sorted(sections, key=lambda s: s.get('order', 99))
    lang = template.get('language', 'en')

    y = 0.75
    page_offset = 2  # title + toc pages
    for section in sections:
        if not section.get('enabled', True):
            continue
        label = section.get('label_ko' if lang == 'ko' else 'label', section['id'])
        page_offset += 1
        fig.text(0.12, y, f"{section.get('order', '?')}.", fontsize=11, fontweight='bold',
                color=style['header_color'])
        fig.text(0.16, y, label, fontsize=11, color='#333333')
        fig.text(0.88, y, str(page_offset), fontsize=11, ha='right', color='#666666')
        # Dotted line
        fig.text(0.5, y - 0.005, '·' * 80, fontsize=6, ha='center', color='#cccccc')
        y -= 0.05


def render_section_model(fig, config, data, style):
    """Render model summary section."""
    ax = fig.add_axes([MARGIN_LEFT/PAGE_WIDTH, 0.1, CONTENT_WIDTH/PAGE_WIDTH, 0.7])
    ax.axis('off')

    name = config.get('name', 'Unknown')
    shapes = config.get('shapes', [])
    mfg = config.get('manufacturing', {})

    info = [
        ['Part Name', name],
        ['Process', mfg.get('process', 'N/A')],
        ['Material', mfg.get('material', 'N/A')],
        ['Total Features', str(len(shapes))],
    ]

    # Add model data if available
    model_data = data.get('model', {})
    if model_data:
        if model_data.get('volume'):
            info.append(['Volume', f"{model_data['volume']:.1f} mm³"])
        if model_data.get('faces'):
            info.append(['Faces', str(model_data['faces'])])

    table = ax.table(cellText=info, colLabels=['Property', 'Value'],
                    loc='upper center', cellLoc='left', colWidths=[0.3, 0.7])
    _style_table(table, style)


def render_section_drawing(fig, config, data, style):
    """Render drawing section (placeholder or QA info)."""
    ax = fig.add_axes([MARGIN_LEFT/PAGE_WIDTH, 0.1, CONTENT_WIDTH/PAGE_WIDTH, 0.7])
    ax.axis('off')

    qa = data.get('qa', {})
    if qa:
        info = [
            ['QA Score', f"{qa.get('score', 'N/A')}"],
            ['Weight Profile', qa.get('weightProfile', 'N/A')],
            ['Drawing File', qa.get('file', 'N/A')],
        ]
        table = ax.table(cellText=info, colLabels=['Metric', 'Value'],
                        loc='upper center', cellLoc='left', colWidths=[0.3, 0.7])
        _style_table(table, style)
    else:
        ax.text(0.5, 0.5, 'Drawing data not available', ha='center', va='center',
               fontsize=12, color='#999999')


def render_section_dfm(fig, config, data, style):
    """Render DFM analysis section."""
    dfm = data.get('dfm', {})
    if not dfm:
        ax = fig.add_axes([MARGIN_LEFT/PAGE_WIDTH, 0.1, CONTENT_WIDTH/PAGE_WIDTH, 0.7])
        ax.axis('off')
        ax.text(0.5, 0.5, 'DFM data not available', ha='center', fontsize=12, color='#999999')
        return

    # Score display
    score = dfm.get('score', 0)
    score_color = get_score_color(score)
    fig.text(0.5, 0.72, f"DFM Score: {score}/100", fontsize=16, fontweight='bold',
            ha='center', color=score_color)
    fig.text(0.5, 0.68, f"Process: {dfm.get('process', 'N/A')}", fontsize=10,
            ha='center', color='#666666')

    # Checks table
    checks = dfm.get('checks', [])
    if checks:
        ax = fig.add_axes([MARGIN_LEFT/PAGE_WIDTH, 0.08, CONTENT_WIDTH/PAGE_WIDTH, 0.55])
        ax.axis('off')

        table_data = []
        for check in checks:
            severity = check.get('severity', 'info')
            table_data.append([
                check.get('code', ''),
                severity.upper(),
                check.get('message', '')[:60],
                check.get('recommendation', '')[:50],
            ])

        table = ax.table(cellText=table_data,
                        colLabels=['Code', 'Severity', 'Finding', 'Recommendation'],
                        loc='upper center', cellLoc='left',
                        colWidths=[0.1, 0.1, 0.4, 0.4])
        _style_table(table, style)

    # Summary
    summary = dfm.get('summary', {})
    fig.text(0.15, 0.05, f"Errors: {summary.get('errors', 0)}  |  Warnings: {summary.get('warnings', 0)}  |  Info: {summary.get('info', 0)}",
            fontsize=9, color='#666666')


def render_section_tolerance(fig, config, data, style):
    """Render tolerance analysis section."""
    tol = data.get('tolerance', {})
    if not tol:
        ax = fig.add_axes([MARGIN_LEFT/PAGE_WIDTH, 0.1, CONTENT_WIDTH/PAGE_WIDTH, 0.7])
        ax.axis('off')
        ax.text(0.5, 0.5, 'Tolerance data not available', ha='center', fontsize=12, color='#999999')
        return

    fits = tol.get('fits', [])
    if fits:
        ax = fig.add_axes([MARGIN_LEFT/PAGE_WIDTH, 0.45, CONTENT_WIDTH/PAGE_WIDTH, 0.35])
        ax.axis('off')
        ax.set_title('Fit Pairs', fontsize=10, fontweight='bold', loc='left')

        table_data = [[f.get('bore', ''), f.get('shaft', ''), f.get('spec', ''),
                       f.get('fit_type', ''), f"{f.get('min_clearance', 0):.3f}",
                       f"{f.get('max_clearance', 0):.3f}"]
                      for f in fits]
        table = ax.table(cellText=table_data,
                        colLabels=['Bore', 'Shaft', 'Spec', 'Fit Type', 'Min Clear.', 'Max Clear.'],
                        loc='upper center', cellLoc='center',
                        colWidths=[0.15, 0.15, 0.15, 0.15, 0.15, 0.15])
        _style_table(table, style)

    # Monte Carlo histogram
    mc = tol.get('monte_carlo', {})
    if mc and mc.get('histogram'):
        ax2 = fig.add_axes([MARGIN_LEFT/PAGE_WIDTH + 0.05, 0.08, 0.4, 0.32])
        hist_data = mc['histogram']
        ax2.bar(range(len(hist_data)), hist_data, color=style['accent_color'], alpha=0.7)
        ax2.set_title('Monte Carlo Distribution', fontsize=9)
        ax2.set_xlabel('Dimension Bin', fontsize=8)
        ax2.set_ylabel('Frequency', fontsize=8)

        if mc.get('cpk') is not None:
            fig.text(0.7, 0.25, f"Cpk = {mc['cpk']:.2f}", fontsize=12,
                    fontweight='bold', color=style['accent_color'])


def render_section_cost(fig, config, data, style):
    """Render cost analysis section."""
    cost = data.get('cost', {})
    if not cost:
        ax = fig.add_axes([MARGIN_LEFT/PAGE_WIDTH, 0.1, CONTENT_WIDTH/PAGE_WIDTH, 0.7])
        ax.axis('off')
        ax.text(0.5, 0.5, 'Cost data not available', ha='center', fontsize=12, color='#999999')
        return

    # Summary
    fig.text(0.15, 0.72, f"Total Cost: ₩{cost.get('total_cost', 0):,.0f}",
            fontsize=14, fontweight='bold', color=style['header_color'])
    fig.text(0.55, 0.72, f"Unit Cost: ₩{cost.get('unit_cost', 0):,.0f}",
            fontsize=14, fontweight='bold', color=style['accent_color'])

    # Breakdown table
    breakdown = cost.get('breakdown', {})
    if breakdown:
        ax = fig.add_axes([MARGIN_LEFT/PAGE_WIDTH, 0.35, 0.4, 0.32])
        ax.axis('off')

        total = sum(breakdown.values()) or 1
        table_data = [[k.replace('_', ' ').title(), f"₩{v:,.0f}", f"{v/total*100:.1f}%"]
                      for k, v in breakdown.items() if v > 0]
        if table_data:
            table = ax.table(cellText=table_data,
                            colLabels=['Category', 'Amount', '%'],
                            loc='upper center', cellLoc='center',
                            colWidths=[0.4, 0.35, 0.25])
            _style_table(table, style)

    # Batch curve
    batch_curve = cost.get('batch_curve', [])
    if batch_curve:
        ax2 = fig.add_axes([0.55, 0.1, 0.38, 0.5])
        quantities = [b.get('quantity', 0) for b in batch_curve]
        unit_costs = [b.get('unit_cost', 0) for b in batch_curve]
        ax2.plot(quantities, unit_costs, 'o-', color=style['accent_color'], linewidth=2)
        ax2.set_title('Batch Price Curve', fontsize=9)
        ax2.set_xlabel('Quantity', fontsize=8)
        ax2.set_ylabel('Unit Cost (₩)', fontsize=8)
        ax2.grid(True, alpha=0.3)


def render_section_bom(fig, config, data, style):
    """Render BOM (Bill of Materials) section."""
    ax = fig.add_axes([MARGIN_LEFT/PAGE_WIDTH, 0.1, CONTENT_WIDTH/PAGE_WIDTH, 0.7])
    ax.axis('off')

    shapes = config.get('shapes', [])
    material = config.get('manufacturing', {}).get('material', 'N/A')

    if shapes:
        table_data = []
        for i, shape in enumerate(shapes, 1):
            dims = ''
            if shape.get('type') == 'cylinder':
                dims = f"R{shape.get('radius', '?')} × H{shape.get('height', '?')}"
            elif shape.get('type') == 'box':
                dims = f"{shape.get('width', '?')} × {shape.get('depth', '?')} × {shape.get('height', '?')}"
            table_data.append([str(i), shape.get('id', f'part_{i}'), shape.get('type', 'N/A'),
                              material, dims, '1'])

        table = ax.table(cellText=table_data,
                        colLabels=['No.', 'Part ID', 'Type', 'Material', 'Dimensions', 'Qty'],
                        loc='upper center', cellLoc='center',
                        colWidths=[0.06, 0.2, 0.14, 0.14, 0.3, 0.06])
        _style_table(table, style)
    else:
        ax.text(0.5, 0.5, 'No shape data available for BOM', ha='center', fontsize=12, color='#999999')


def render_assumptions(fig, template, config, style):
    """Render analysis assumptions section."""
    _render_section_header(fig, '분석 가정 / Analysis Assumptions', style)

    assumptions = template.get('assumptions', {})
    mfg = config.get('manufacturing', {})

    items = []
    show_fields = assumptions.get('show', [])

    if 'process' in show_fields or assumptions.get('show_process', True):
        items.append(['Manufacturing Process', mfg.get('process', 'machining')])
    if 'material' in show_fields or assumptions.get('show_material', True):
        items.append(['Material', mfg.get('material', 'SS304')])
    if 'batch_size' in show_fields or assumptions.get('show_batch_size', True):
        items.append(['Batch Size', str(config.get('batch_size', 100))])
    if 'standard_version' in show_fields or assumptions.get('show_standard_version', True):
        items.append(['Standard', 'KS (Korean Standards)'])

    # Shop profile info
    profile = config.get('shop_profile')
    if profile:
        items.append(['Shop Profile', profile.get('name', 'N/A')])

    if items:
        ax = fig.add_axes([MARGIN_LEFT/PAGE_WIDTH, 0.2, CONTENT_WIDTH/PAGE_WIDTH, 0.55])
        ax.axis('off')
        table = ax.table(cellText=items, colLabels=['Parameter', 'Value'],
                        loc='upper center', cellLoc='left', colWidths=[0.4, 0.6])
        _style_table(table, style)


def render_standards(fig, template, style):
    """Render standards references section."""
    _render_section_header(fig, '참조 표준 / Standards References', style)

    standards_cfg = template.get('standards', template.get('standards_references', {}))
    standards = standards_cfg.get('standards', [])

    # Handle tags format (simple array of strings)
    if not standards and 'tags' in standards_cfg:
        standards = [{'code': tag, 'version': '', 'title': ''} for tag in standards_cfg['tags']]

    if standards:
        ax = fig.add_axes([MARGIN_LEFT/PAGE_WIDTH, 0.2, CONTENT_WIDTH/PAGE_WIDTH, 0.55])
        ax.axis('off')

        table_data = [[s.get('code', ''), s.get('version', ''), s.get('title', '')]
                      for s in standards]
        table = ax.table(cellText=table_data,
                        colLabels=['Standard Code', 'Version', 'Title'],
                        loc='upper center', cellLoc='left',
                        colWidths=[0.25, 0.2, 0.55])
        _style_table(table, style)
    else:
        fig.text(0.5, 0.5, 'No standards referenced', ha='center', fontsize=12, color='#999999')


def render_disclaimer(fig, template, style, y_start=0.85):
    """Render disclaimer text. Returns y position after rendering."""
    _render_section_header(fig, '면책 조항 / Disclaimer', style)

    disclaimer = template.get('disclaimer', {})
    lang = template.get('language', 'en')

    text = disclaimer.get(f'text_{lang}', disclaimer.get('text',
        disclaimer.get('text_ko',
        'This report is automatically generated. Final decisions should be reviewed by a qualified engineer.')))

    fig.text(0.5, y_start - 0.18, text, fontsize=10, ha='center', va='top',
            color='#666666', style='italic',
            wrap=True,
            bbox=dict(boxstyle='round,pad=0.5', facecolor='#f8f9fa', edgecolor='#dee2e6'))

    return y_start - 0.3


def render_signature_area(fig, template, style, y_start=0.45):
    """Render signature area with role boxes."""
    sig = template.get('signature', template.get('signature_area', {}))
    roles = sig.get('roles', ['author', 'reviewer', 'approver'])

    role_labels = {
        'author': ('Author', '작성자'),
        'reviewer': ('Reviewer', '검토자'),
        'approver': ('Approver', '승인자'),
    }

    lang = template.get('language', 'en')
    n = len(roles)
    box_width = min(0.25, 0.8 / n)
    start_x = 0.5 - (n * box_width) / 2

    for i, role in enumerate(roles):
        x = start_x + i * box_width
        labels = role_labels.get(role, (role.title(), role.title()))
        label = labels[1] if lang == 'ko' else labels[0]

        # Role label
        fig.text(x + box_width/2, y_start, label, fontsize=10, fontweight='bold',
                ha='center', va='bottom', color=style['header_color'])

        # Signature line
        fig.plot([x + 0.02, x + box_width - 0.02], [y_start - 0.04, y_start - 0.04],
                color='#333333', linewidth=0.8, transform=fig.transFigure, clip_on=False)

        # Date field
        if sig.get('show_date', sig.get('show_date_field', True)):
            fig.text(x + box_width/2, y_start - 0.07, 'Date: ____/____/____',
                    fontsize=8, ha='center', color='#999999')


def _style_table(table, style):
    """Apply professional styling to a matplotlib table."""
    table.auto_set_font_size(False)
    table.set_fontsize(8)

    for key, cell in table.get_celld().items():
        row, col = key
        cell.set_edgecolor('#dee2e6')
        cell.set_linewidth(0.5)

        if row == 0:  # Header
            cell.set_facecolor(style['header_color'])
            cell.set_text_props(color='white', fontweight='bold')
            cell.set_height(0.06)
        else:
            if row % 2 == 0:
                cell.set_facecolor('#f8f9fa')
            else:
                cell.set_facecolor('white')
            cell.set_height(0.05)
