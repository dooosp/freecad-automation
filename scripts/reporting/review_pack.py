#!/usr/bin/env python3

import json
import os
import sys
import textwrap
from datetime import datetime

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
PARENT_DIR = os.path.dirname(SCRIPT_DIR)
if PARENT_DIR not in sys.path:
    sys.path.insert(0, PARENT_DIR)

from _bootstrap import read_input, respond, respond_error, safe_filename_component
from reporting.review_templates import build_markdown_sections, build_review_pack_data


def _write_pdf(path, title, markdown_text, generated_at=None):
    # Wrap and paginate the complete derived view. Truncating the source can
    # hide recommendations and the final missing-evidence boundary.
    lines = []
    for line in markdown_text.splitlines():
        plain = line.lstrip("# ") if line.startswith("#") else line
        lines.extend(textwrap.wrap(plain, width=112, replace_whitespace=False) or [""])
    pages = [lines[index:index + 38] for index in range(0, len(lines), 38)] or [[""]]
    try:
        import matplotlib
        matplotlib.use("Agg")
        import matplotlib.pyplot as plt
        from matplotlib.backends.backend_pdf import PdfPages

        pdf_metadata = None
        if generated_at:
            fixed_time = datetime.fromisoformat(str(generated_at).replace("Z", "+00:00"))
            pdf_metadata = {
                "CreationDate": fixed_time,
                "ModDate": fixed_time,
            }
        with PdfPages(path, metadata=pdf_metadata) as pdf:
            for index, page in enumerate(pages, 1):
                fig = plt.figure(figsize=(11.69, 8.27))
                fig.text(0.06, 0.96, textwrap.fill(title, width=80), va="top", fontsize=14, fontweight="bold")
                fig.text(0.06, 0.87, "\n".join(page), va="top", fontsize=9, family="monospace", linespacing=1.3)
                fig.text(0.94, 0.03, f"{index} / {len(pages)}", ha="right", fontsize=8)
                pdf.savefig(fig)
                plt.close(fig)
        return
    except ImportError:
        pass

    def pdf_escape(value):
        return str(value).replace("\\", "\\\\").replace("(", "\\(").replace(")", "\\)")

    page_ids = [4 + index * 2 for index in range(len(pages))]
    kids = " ".join(f"{page_id} 0 R" for page_id in page_ids)
    objects = [
        b"1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj\n",
        f"2 0 obj << /Type /Pages /Kids [{kids}] /Count {len(pages)} >> endobj\n".encode("ascii"),
        b"3 0 obj << /Type /Font /Subtype /Type1 /BaseFont /Courier >> endobj\n",
    ]
    for index, (page_id, page) in enumerate(zip(page_ids, pages), 1):
        page_lines = textwrap.wrap(title, width=112) + [f"Page {index} / {len(pages)}", ""] + page
        text_commands = ["BT", "/F1 9 Tf", "50 558 Td"]
        for line_index, line in enumerate(page_lines):
            if line_index:
                text_commands.append("0 -12 Td")
            text_commands.append(f"({pdf_escape(line)}) Tj")
        text_commands.append("ET")
        content = "\n".join(text_commands).encode("latin-1", errors="replace")
        objects.extend([
            f"{page_id} 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 842 595] /Contents {page_id + 1} 0 R /Resources << /Font << /F1 3 0 R >> >> >> endobj\n".encode("ascii"),
            f"{page_id + 1} 0 obj << /Length {len(content)} >> stream\n".encode("ascii") + content + b"\nendstream endobj\n",
        ])

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

        summary = build_review_pack_data(payload)
        markdown_text = build_markdown_sections(summary)
        json_path = payload.get("output_json_path") or os.path.join(output_dir, f"{stem}_review_pack.json")
        markdown_path = payload.get("output_markdown_path") or os.path.join(output_dir, f"{stem}_review_pack.md")
        pdf_path = payload.get("output_pdf_path") or os.path.join(output_dir, f"{stem}_review_pack.pdf")
        os.makedirs(os.path.dirname(json_path), exist_ok=True)
        os.makedirs(os.path.dirname(markdown_path), exist_ok=True)
        os.makedirs(os.path.dirname(pdf_path), exist_ok=True)

        with open(json_path, "w", encoding="utf-8") as handle:
            json.dump(summary, handle, ensure_ascii=False, indent=2)
            handle.write("\n")
        with open(markdown_path, "w", encoding="utf-8") as handle:
            handle.write(markdown_text)

        _write_pdf(
            pdf_path,
            f"Review Pack: {part.get('name', stem)}",
            markdown_text,
            summary.get("generated_at") if payload.get("revision_lineage") else None,
        )

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
