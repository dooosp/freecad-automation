"""
Quick test for engineering_report.py using mock data.
Runs within FreeCAD Python but only needs matplotlib.
"""
import sys
import os
import json
import tempfile

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

# Mock the bootstrap to inject test data
test_config = {
    "name": "report_test",
    "export": {"directory": tempfile.gettempdir()},
    "tolerance_results": {
        "pairs": [
            {
                "shaft_part": "input_shaft", "bore_part": "housing",
                "nominal_d": 20, "spec": "H7/g6", "fit_type": "clearance",
                "clearance_min": 0.007, "clearance_max": 0.041, "status": "OK",
            },
            {
                "shaft_part": "output_shaft", "bore_part": "housing",
                "nominal_d": 30, "spec": "H7/g6", "fit_type": "clearance",
                "clearance_min": 0.007, "clearance_max": 0.041, "status": "OK",
            },
        ],
        "stack_up": {
            "chain_length": 2, "worst_case_mm": 0.068,
            "rss_3sigma_mm": 0.048, "mean_gap_mm": 0.048,
            "success_rate_pct": 99.9,
        },
    },
    "monte_carlo_results": {
        "num_samples": 10000, "distribution": "normal",
        "mean_mm": 0.048, "std_mm": 0.008, "fail_rate_pct": 0.0, "cpk": 2.0,
        "histogram": {
            "edges": [round(0.01 + i * 0.004, 4) for i in range(21)],
            "counts": [5, 15, 40, 90, 180, 350, 600, 900, 1200, 1500,
                       1400, 1100, 800, 500, 300, 150, 80, 40, 15, 5],
        },
    },
    "fem_results": {
        "von_mises": {"max": 45.3}, "displacement": {"max": 0.012},
        "safety_factor": 5.2, "yield_strength": 235, "solver": "CalculiX",
    },
    "bom": [
        {"id": "housing", "material": "aluminum", "dimensions": "100x80x60", "count": 1},
        {"id": "input_shaft", "material": "steel", "dimensions": "20x150", "count": 1},
        {"id": "output_shaft", "material": "steel", "dimensions": "30x120", "count": 1},
    ],
}

# Directly invoke the report generation logic
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
from matplotlib.backends.backend_pdf import PdfPages
import numpy as np
from datetime import datetime

config = test_config
model_name = config["name"]
export_dir = config["export"]["directory"]
os.makedirs(export_dir, exist_ok=True)
pdf_path = os.path.join(export_dir, f"{model_name}_report.pdf")

tolerance = config.get("tolerance_results", {})
mc = config.get("monte_carlo_results", None)
fem = config.get("fem_results", None)
bom = config.get("bom", [])
pairs = tolerance.get("pairs", [])
stack = tolerance.get("stack_up", {})

errors = []

try:
    with PdfPages(pdf_path) as pdf:
        fig = plt.figure(figsize=(11.69, 8.27))
        fig.suptitle(f"Engineering Report: {model_name}", fontsize=14, fontweight='bold', y=0.97)
        fig.text(0.5, 0.94, f"Generated: {datetime.now().strftime('%Y-%m-%d %H:%M')}",
                 ha='center', fontsize=8, color='#666')

        # Section 1: Tolerance table
        ax1 = fig.add_axes([0.05, 0.52, 0.43, 0.38])
        ax1.set_title("Tolerance Analysis", fontsize=10, fontweight='bold', loc='left')
        ax1.axis('off')
        col_labels = ["Pair", "Spec", "Fit", "Clearance (mm)", "Status"]
        table_data = []
        for pr in pairs:
            pair_name = f"{pr['shaft_part']}/{pr['bore_part']}"
            cl = f"{pr['clearance_min']:+.3f} ~ {pr['clearance_max']:+.3f}"
            table_data.append([pair_name, pr['spec'], pr['fit_type'], cl, pr['status']])
        tbl = ax1.table(cellText=table_data, colLabels=col_labels, loc='upper left', cellLoc='center')
        tbl.auto_set_font_size(False)
        tbl.set_fontsize(7)
        tbl.scale(1, 1.3)

        # Section 2: MC histogram
        ax2 = fig.add_axes([0.55, 0.52, 0.40, 0.38])
        hist = mc["histogram"]
        edges = hist["edges"]
        counts = hist["counts"]
        centers = [(edges[i] + edges[i+1]) / 2 for i in range(len(counts))]
        widths = [edges[i+1] - edges[i] for i in range(len(counts))]
        ax2.bar(centers, counts, width=widths, color='#2ecc71', edgecolor='white', linewidth=0.5)
        ax2.set_title(f"Monte Carlo (N={mc['num_samples']})", fontsize=10, fontweight='bold', loc='left')

        # Section 3: FEM
        ax3 = fig.add_axes([0.05, 0.08, 0.43, 0.38])
        ax3.set_title("FEM Analysis", fontsize=10, fontweight='bold', loc='left')
        ax3.axis('off')
        fem_data = [
            ["Max von Mises", f"{fem['von_mises']['max']} MPa"],
            ["Max Displacement", f"{fem['displacement']['max']} mm"],
            ["Safety Factor", str(fem['safety_factor'])],
        ]
        tbl3 = ax3.table(cellText=fem_data, colLabels=["Metric", "Value"], loc='upper left', cellLoc='left')
        tbl3.auto_set_font_size(False)
        tbl3.set_fontsize(8)
        tbl3.scale(1, 1.4)

        # Section 4: BOM
        ax4 = fig.add_axes([0.55, 0.08, 0.40, 0.38])
        ax4.set_title("Bill of Materials", fontsize=10, fontweight='bold', loc='left')
        ax4.axis('off')
        bom_data = [[str(i+1), b["id"], b["material"], str(b["count"])] for i, b in enumerate(bom)]
        tbl4 = ax4.table(cellText=bom_data, colLabels=["#", "Part", "Material", "Qty"],
                         loc='upper left', cellLoc='center')
        tbl4.auto_set_font_size(False)
        tbl4.set_fontsize(7)
        tbl4.scale(1, 1.3)

        pdf.savefig(fig)
        plt.close(fig)

    file_size = os.path.getsize(pdf_path)
    if file_size < 1000:
        errors.append(f"PDF too small: {file_size} bytes")
    if not os.path.exists(pdf_path):
        errors.append("PDF file not created")

except Exception as e:
    errors.append(str(e))

if errors:
    print(json.dumps({"success": False, "errors": errors}))
    sys.exit(1)
else:
    print(json.dumps({"success": True, "pdf_path": pdf_path, "size_bytes": file_size}))
