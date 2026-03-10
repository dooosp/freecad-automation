#!/usr/bin/env python3

import json
import os
import sys

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
PARENT_DIR = os.path.dirname(SCRIPT_DIR)
if PARENT_DIR not in sys.path:
    sys.path.insert(0, PARENT_DIR)

from _bootstrap import read_input, respond, respond_error, safe_filename_component
from reporting.review_templates import build_markdown_sections


def _write_pdf(path, title, markdown_text):
    try:
        import matplotlib
        matplotlib.use("Agg")
        import matplotlib.pyplot as plt
        from matplotlib.backends.backend_pdf import PdfPages

        wrapped_text = markdown_text.replace("# ", "").replace("## ", "")
        with PdfPages(path) as pdf:
            fig = plt.figure(figsize=(11.69, 8.27))
            ax = fig.add_axes([0.05, 0.05, 0.9, 0.9])
            ax.axis("off")
            ax.set_title(title, loc="left", fontsize=16, fontweight="bold")
            ax.text(0.0, 0.95, wrapped_text[:5000], va="top", ha="left", fontsize=9, family="monospace")
            pdf.savefig(fig)
            plt.close(fig)
        return
    except ImportError:
        pass

    def pdf_escape(value):
        return str(value).replace("\\", "\\\\").replace("(", "\\(").replace(")", "\\)")

    lines = [title] + markdown_text.splitlines()
    lines = [line[:110] for line in lines[:40]]
    text_commands = ["BT", "/F1 12 Tf", "50 780 Td", f"({pdf_escape(lines[0])}) Tj"]
    y_offset = 0
    for line in lines[1:]:
        y_offset += 16
        text_commands.append(f"0 -16 Td ({pdf_escape(line)}) Tj")
    text_commands.append("ET")
    content = "\n".join(text_commands).encode("latin-1", errors="replace")

    objects = [
        b"1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj\n",
        b"2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj\n",
        b"3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >> endobj\n",
        f"4 0 obj << /Length {len(content)} >> stream\n".encode("latin-1") + content + b"\nendstream endobj\n",
        b"5 0 obj << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> endobj\n",
    ]

    pdf = bytearray(b"%PDF-1.4\n")
    offsets = [0]
    for obj in objects:
        offsets.append(len(pdf))
        pdf.extend(obj)
    xref_offset = len(pdf)
    pdf.extend(f"xref\n0 {len(offsets)}\n".encode("latin-1"))
    pdf.extend(b"0000000000 65535 f \n")
    for offset in offsets[1:]:
        pdf.extend(f"{offset:010d} 00000 n \n".encode("latin-1"))
    pdf.extend(
        (
            f"trailer << /Size {len(offsets)} /Root 1 0 R >>\n"
            f"startxref\n{xref_offset}\n%%EOF\n"
        ).encode("latin-1")
    )

    with open(path, "wb") as handle:
        handle.write(pdf)


def main():
    try:
        payload = read_input()
        output_dir = payload.get("output_dir") or os.path.join(os.path.dirname(os.path.dirname(__file__)), "..", "output")
        output_dir = os.path.abspath(output_dir)
        os.makedirs(output_dir, exist_ok=True)

        context = payload.get("context") or {}
        part = context.get("part") or {}
        stem = safe_filename_component(payload.get("output_stem") or part.get("name") or "review_pack", default="review_pack")

        markdown_text = build_markdown_sections(payload)
        summary = {
            "part": part,
            "geometry_summary": (payload.get("geometry_intelligence") or {}).get("metrics") or {},
            "review_priorities": (payload.get("review_priorities") or {}).get("records") or [],
            "recommended_actions": (payload.get("review_priorities") or {}).get("recommended_actions") or [],
        }

        json_path = os.path.join(output_dir, f"{stem}_review_pack.json")
        markdown_path = os.path.join(output_dir, f"{stem}_review_pack.md")
        pdf_path = os.path.join(output_dir, f"{stem}_review_pack.pdf")

        with open(json_path, "w", encoding="utf-8") as handle:
            json.dump(summary, handle, ensure_ascii=False, indent=2)
            handle.write("\n")
        with open(markdown_path, "w", encoding="utf-8") as handle:
            handle.write(markdown_text)

        _write_pdf(pdf_path, f"Review Pack: {part.get('name', stem)}", markdown_text)

        respond({
            "success": True,
            "summary": summary,
            "artifacts": {
                "json": json_path,
                "markdown": markdown_path,
                "pdf": pdf_path,
            },
        })
    except Exception as exc:
        respond_error(str(exc))


if __name__ == "__main__":
    main()
