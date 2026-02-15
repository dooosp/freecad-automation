#!/usr/bin/env python3
"""Engineering report generator for FreeCAD Studio.

Supports two modes:
1. Legacy mode (no template): 2-page matplotlib report (existing behavior)
2. Template mode (_report_template key): Multi-page professional report
"""

import sys
import json
import os
from datetime import datetime

# Add scripts directory to path for local imports
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from _bootstrap import log, read_input, respond, respond_error, safe_filename_component

def main():
    try:
        config = read_input()

        template_config = config.get('_report_template')

        if template_config:
            # Template mode: multi-page professional report
            result = generate_template_report(config, template_config)
        else:
            # Legacy mode: existing 2-page report
            result = generate_legacy_report(config)

        respond(result)

    except Exception as e:
        import traceback
        respond_error(str(e), traceback.format_exc())

def generate_template_report(config, template_config):
    """Generate multi-page report using template."""
    from _report_renderer import render_report

    # Load template
    template = template_config.get('template', {})
    if template_config.get('template_path'):
        template_path = template_config['template_path']
        if os.path.exists(template_path):
            with open(template_path, encoding='utf-8') as f:
                template = json.load(f)

    # Inject metadata into template for renderer
    template['_metadata'] = template_config.get('metadata', {})

    # Collect analysis data
    data = {
        'model': config.get('model_result', {}),
        'qa': config.get('qa_result', {}),
        'dfm': config.get('dfm_results') or config.get('dfm_result', {}),
        'tolerance': config.get('tolerance_results', {}),
        'cost': config.get('cost_result', {}),
    }

    # Determine output path
    name = config.get('name', 'report')
    output_stem = safe_filename_component(name, default="report")
    output_dir = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'output')
    os.makedirs(output_dir, exist_ok=True)
    output_path = os.path.join(output_dir, f'{output_stem}_report.pdf')

    render_report(config, template, data, output_path)

    file_size = os.path.getsize(output_path)
    log(f"  PDF exported: {output_path} ({file_size} bytes)")

    return {'success': True, 'pdf_path': output_path, 'path': output_path, 'size_bytes': file_size}

def generate_legacy_report(config):
    """Generate legacy 2-page report (existing behavior)."""
    model_name = config.get("name", "unnamed")
    output_stem = safe_filename_component(model_name, default="unnamed")
    log(f"Engineering Report: {model_name}")

    import matplotlib
    matplotlib.use('Agg')
    import matplotlib.pyplot as plt
    from matplotlib.backends.backend_pdf import PdfPages
    import numpy as np

    export_dir = config.get("export", {}).get("directory", ".")
    os.makedirs(export_dir, exist_ok=True)
    pdf_path = os.path.join(export_dir, f"{output_stem}_report.pdf")

    tolerance = config.get("tolerance_results", {})
    mc = config.get("monte_carlo_results", None)
    fem = config.get("fem_results", None)
    bom = config.get("bom", [])
    dfm = config.get("dfm_results", None)
    pairs = tolerance.get("pairs", [])
    stack = tolerance.get("stack_up", {})

    # Choose layout based on DFM data presence
    has_dfm = dfm and dfm.get("checks") is not None

    with PdfPages(pdf_path) as pdf:
        fig = plt.figure(figsize=(11.69, 8.27))  # A4 landscape (inches)
        fig.suptitle(f"Engineering Report: {model_name}", fontsize=14, fontweight='bold', y=0.97)

        # Subtitle with date
        fig.text(0.5, 0.94, f"Generated: {datetime.now().strftime('%Y-%m-%d %H:%M')}",
                 ha='center', fontsize=8, color='#666')

        # Layout: 2x2 (no DFM) or 3x2 (with DFM)
        # Top-left: Tolerance table | Top-right: MC histogram
        # Bottom-left: FEM summary  | Bottom-right: BOM table
        # (DFM page 2: DFM Score + DFM Details)

        # --- Section 1: Tolerance Analysis Table (top-left) ---
        ax1 = fig.add_axes([0.05, 0.52, 0.43, 0.38])
        ax1.set_title("Tolerance Analysis", fontsize=10, fontweight='bold', loc='left')
        ax1.axis('off')

        if pairs:
            col_labels = ["Pair", "Spec", "Fit", "Clearance (mm)", "Status"]
            table_data = []
            for pr in pairs:
                pair_name = f"{pr.get('shaft_part','?')}/{pr.get('bore_part','?')}"
                cl = f"{pr.get('clearance_min', 0):+.3f} ~ {pr.get('clearance_max', 0):+.3f}"
                table_data.append([pair_name, pr.get('spec', '?'), pr.get('fit_type', '?'), cl, pr.get('status', '?')])

            tbl = ax1.table(cellText=table_data, colLabels=col_labels,
                            loc='upper left', cellLoc='center')
            tbl.auto_set_font_size(False)
            tbl.set_fontsize(7)
            tbl.scale(1, 1.3)
            for (r, c), cell in tbl.get_celld().items():
                if r == 0:
                    cell.set_facecolor('#2c3e50')
                    cell.set_text_props(color='white', fontweight='bold')
                else:
                    cell.set_facecolor('#ecf0f1' if r % 2 == 0 else 'white')

            # Stack-up summary below table
            if stack.get("chain_length", 0) > 0:
                summary = (f"Stack-up: Worst ±{stack.get('worst_case_mm', 0)/2:.4f}mm  "
                           f"RSS(3σ) ±{stack.get('rss_3sigma_mm', 0)/2:.4f}mm  "
                           f"Success: {stack.get('success_rate_pct', 0):.1f}%")
                ax1.text(0, -0.05, summary, fontsize=7, color='#2c3e50',
                         transform=ax1.transAxes)
        else:
            ax1.text(0.5, 0.5, "No tolerance data", ha='center', va='center',
                     fontsize=10, color='#999')

        # --- Section 2: Monte Carlo Histogram (top-right) ---
        ax2 = fig.add_axes([0.55, 0.52, 0.40, 0.38])

        if mc and mc.get("histogram"):
            hist = mc["histogram"]
            edges = hist["edges"]
            counts = hist["counts"]
            centers = [(edges[i] + edges[i+1]) / 2 for i in range(len(counts))]
            widths = [edges[i+1] - edges[i] for i in range(len(counts))]

            colors = ['#e74c3c' if c < 0 else '#2ecc71' for c in centers]
            ax2.bar(centers, counts, width=widths, color=colors, edgecolor='white', linewidth=0.5)
            ax2.axvline(x=0, color='red', linestyle='--', linewidth=1, alpha=0.7)
            ax2.set_title(f"Monte Carlo (N={mc.get('num_samples', '?')}, {mc.get('distribution', '?')})",
                          fontsize=10, fontweight='bold', loc='left')
            ax2.set_xlabel("Gap (mm)", fontsize=8)
            ax2.set_ylabel("Count", fontsize=8)
            ax2.tick_params(labelsize=7)

            # Cpk annotation
            cpk = mc.get("cpk", 0)
            cpk_color = '#2ecc71' if cpk >= 1.33 else '#f39c12' if cpk >= 1.0 else '#e74c3c'
            ax2.text(0.98, 0.95, f"Cpk = {cpk}", transform=ax2.transAxes,
                     fontsize=11, fontweight='bold', color=cpk_color,
                     ha='right', va='top',
                     bbox=dict(boxstyle='round,pad=0.3', facecolor='white', edgecolor=cpk_color))
            ax2.text(0.98, 0.82, f"Fail: {mc.get('fail_rate_pct', 0)}%",
                     transform=ax2.transAxes, fontsize=8, ha='right', va='top', color='#666')
        else:
            ax2.set_title("Monte Carlo Simulation", fontsize=10, fontweight='bold', loc='left')
            ax2.axis('off')
            ax2.text(0.5, 0.5, "No MC data\n(use --monte-carlo)", ha='center', va='center',
                     fontsize=10, color='#999')

        # --- Section 3: FEM Summary (bottom-left) ---
        ax3 = fig.add_axes([0.05, 0.08, 0.43, 0.38])
        ax3.set_title("FEM Analysis", fontsize=10, fontweight='bold', loc='left')
        ax3.axis('off')

        if fem:
            fem_data = [
                ["Max von Mises Stress", f"{fem.get('von_mises', {}).get('max', '?')} MPa"],
                ["Max Displacement", f"{fem.get('displacement', {}).get('max', '?')} mm"],
                ["Safety Factor", f"{fem.get('safety_factor', '?')}"],
                ["Yield Strength", f"{fem.get('yield_strength', '?')} MPa"],
                ["Solver", fem.get('solver', '?')],
            ]
            tbl3 = ax3.table(cellText=fem_data, colLabels=["Metric", "Value"],
                             loc='upper left', cellLoc='left')
            tbl3.auto_set_font_size(False)
            tbl3.set_fontsize(8)
            tbl3.scale(1, 1.4)
            for (r, c), cell in tbl3.get_celld().items():
                if r == 0:
                    cell.set_facecolor('#2c3e50')
                    cell.set_text_props(color='white', fontweight='bold')
                elif c == 0:
                    cell.set_text_props(fontweight='bold')
        else:
            ax3.text(0.5, 0.5, "No FEM data\n(use --fem)", ha='center', va='center',
                     fontsize=10, color='#999')

        # --- Section 4: BOM Table (bottom-right) ---
        ax4 = fig.add_axes([0.55, 0.08, 0.40, 0.38])
        ax4.set_title("Bill of Materials", fontsize=10, fontweight='bold', loc='left')
        ax4.axis('off')

        if bom:
            bom_data = []
            for i, item in enumerate(bom[:8]):
                bom_data.append([
                    str(i + 1),
                    item.get("id", "?"),
                    item.get("material", "-"),
                    item.get("dimensions", "-"),
                    str(item.get("count", 1)),
                ])
            tbl4 = ax4.table(cellText=bom_data,
                             colLabels=["#", "Part", "Material", "Dims", "Qty"],
                             loc='upper left', cellLoc='center')
            tbl4.auto_set_font_size(False)
            tbl4.set_fontsize(7)
            tbl4.scale(1, 1.3)
            for (r, c), cell in tbl4.get_celld().items():
                if r == 0:
                    cell.set_facecolor('#2c3e50')
                    cell.set_text_props(color='white', fontweight='bold')
                else:
                    cell.set_facecolor('#ecf0f1' if r % 2 == 0 else 'white')
            if len(bom) > 8:
                ax4.text(0, -0.05, f"... +{len(bom) - 8} more items",
                         fontsize=7, color='#999', transform=ax4.transAxes)
        else:
            ax4.text(0.5, 0.5, "No BOM data", ha='center', va='center',
                     fontsize=10, color='#999')

        # Footer
        fig.text(0.5, 0.02, f"Generated by fcad | {model_name} | {datetime.now().strftime('%Y-%m-%d')}",
                 ha='center', fontsize=7, color='#999')

        pdf.savefig(fig)
        plt.close(fig)

        # --- DFM Page (page 2, only if dfm_results present) ---
        if has_dfm:
            fig2 = plt.figure(figsize=(11.69, 8.27))
            fig2.suptitle(f"DFM Analysis: {model_name}", fontsize=14, fontweight='bold', y=0.97)
            fig2.text(0.5, 0.94,
                      f"Process: {dfm.get('process', '?')} | Material: {dfm.get('material', '?')}",
                      ha='center', fontsize=9, color='#666')

            # Left: DFM Score gauge
            ax_score = fig2.add_axes([0.05, 0.52, 0.40, 0.38])
            score = dfm.get("score", 0)
            score_color = '#2ecc71' if score >= 80 else '#f39c12' if score >= 50 else '#e74c3c'
            ax_score.barh([0], [score], color=score_color, height=0.5, edgecolor='white')
            ax_score.barh([0], [100], color='#ecf0f1', height=0.5, edgecolor='#ccc', zorder=0)
            ax_score.set_xlim(0, 100)
            ax_score.set_yticks([])
            ax_score.set_title("DFM Score", fontsize=10, fontweight='bold', loc='left')
            ax_score.text(score / 2, 0, f"{score}/100", ha='center', va='center',
                          fontsize=14, fontweight='bold', color='white')

            # Summary counts below score
            summary = dfm.get("summary", {})
            summary_text = (f"Errors: {summary.get('errors', 0)}  |  "
                            f"Warnings: {summary.get('warnings', 0)}  |  "
                            f"Info: {summary.get('info', 0)}")
            ax_score.text(0, -0.15, summary_text, fontsize=9, color='#333',
                          transform=ax_score.transAxes)

            # Right: DFM Check details table
            ax_detail = fig2.add_axes([0.50, 0.52, 0.46, 0.38])
            ax_detail.set_title("DFM Checks", fontsize=10, fontweight='bold', loc='left')
            ax_detail.axis('off')

            checks = dfm.get("checks", [])
            if checks:
                # Show top 8 checks max
                display_checks = checks[:8]
                col_labels = ["Code", "Severity", "Message"]
                table_data = []
                for c in display_checks:
                    msg = c.get("message", "")
                    if len(msg) > 60:
                        msg = msg[:57] + "..."
                    table_data.append([
                        c.get("code", "?"),
                        c.get("severity", "?"),
                        msg,
                    ])
                tbl = ax_detail.table(cellText=table_data, colLabels=col_labels,
                                      loc='upper left', cellLoc='left',
                                      colWidths=[0.12, 0.12, 0.76])
                tbl.auto_set_font_size(False)
                tbl.set_fontsize(7)
                tbl.scale(1, 1.3)
                for (r, c_idx), cell in tbl.get_celld().items():
                    if r == 0:
                        cell.set_facecolor('#2c3e50')
                        cell.set_text_props(color='white', fontweight='bold')
                    elif c_idx == 1:
                        sev = table_data[r - 1][1]
                        color = '#e74c3c' if sev == 'error' else '#f39c12' if sev == 'warning' else '#3498db'
                        cell.set_text_props(color=color, fontweight='bold')
                if len(checks) > 8:
                    ax_detail.text(0, -0.05, f"... +{len(checks) - 8} more checks",
                                   fontsize=7, color='#999', transform=ax_detail.transAxes)
            else:
                ax_detail.text(0.5, 0.5, "No DFM issues found",
                               ha='center', va='center', fontsize=10, color='#2ecc71')

            # Bottom: Recommendations
            ax_rec = fig2.add_axes([0.05, 0.08, 0.90, 0.38])
            ax_rec.set_title("Recommendations", fontsize=10, fontweight='bold', loc='left')
            ax_rec.axis('off')

            recs = [c.get("recommendation", "") for c in checks if c.get("recommendation")]
            if recs:
                rec_text = "\n".join(f"  {i+1}. {r}" for i, r in enumerate(recs[:6]))
                ax_rec.text(0, 0.95, rec_text, fontsize=8, va='top', color='#333',
                            transform=ax_rec.transAxes, family='monospace')
            else:
                ax_rec.text(0.5, 0.5, "Design is manufacturing-ready",
                            ha='center', va='center', fontsize=11, color='#2ecc71')

            fig2.text(0.5, 0.02,
                      f"Generated by fcad | {model_name} | {datetime.now().strftime('%Y-%m-%d')}",
                      ha='center', fontsize=7, color='#999')

            pdf.savefig(fig2)
            plt.close(fig2)

    file_size = os.path.getsize(pdf_path)
    log(f"  PDF exported: {pdf_path} ({file_size} bytes)")

    return {
        "success": True,
        "path": pdf_path,
        "size_bytes": file_size,
    }

if __name__ == '__main__':
    main()
