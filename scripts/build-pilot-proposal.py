#!/usr/bin/env python3
"""Render the editable pilot proposal using the canonical offer and embedded Korean font.

Install: python3 -m pip install -r scripts/requirements-pilot-proposal.txt
Build:   python3 scripts/build-pilot-proposal.py
Check:   python3 scripts/build-pilot-proposal.py --check

The source supports headings, paragraphs, bold, inline code, lists, explicit
page markers, and :::offer / :::scope / :::note / :::exclusions / :::inquiry.
Numeric placeholders resolve exclusively from public/pilot/offer.json.
"""
from __future__ import annotations

import argparse
import hashlib
import io
import json
import re
from pathlib import Path
from xml.sax.saxutils import escape

from reportlab.lib import colors
from reportlab.lib.enums import TA_LEFT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import Flowable, PageBreak, Paragraph, SimpleDocTemplate, Spacer

ROOT = Path(__file__).resolve().parent.parent
SOURCE = ROOT / 'docs/sales/pilot-proposal.ko.md'
OFFER = ROOT / 'public/pilot/offer.json'
FONT = ROOT / 'scripts/assets/pilot-fonts/NanumGothic-Regular.ttf'
OUTPUT = ROOT / 'public/pilot/assets/pilot-proposal.ko.pdf'
INK = colors.HexColor('#102333')
MUTED = colors.HexColor('#49606e')
TEAL = colors.HexColor('#117c74')
PAPER = colors.HexColor('#fafbf9')
WIDTH = A4[0] - 84


def text_markup(text: str) -> str:
    """Escape source before allowing the proposal's small formatting vocabulary."""
    text = escape(text).replace('\\n', '<br/>')
    text = re.sub(r'\*\*(.+?)\*\*', r'<font color="#117c74">\1</font>', text)
    return re.sub(r'`(.+?)`', r'<font color="#117c74">\1</font>', text)


def styles() -> dict[str, ParagraphStyle]:
    common = dict(fontName='PilotKorean', textColor=INK, wordWrap='CJK', alignment=TA_LEFT)
    return {
        'title': ParagraphStyle('title', fontSize=25, leading=34, spaceAfter=18, **common),
        'heading': ParagraphStyle('heading', fontSize=12.5, leading=19, spaceBefore=15, spaceAfter=7, **common),
        'body': ParagraphStyle('body', fontSize=10.2, leading=16, spaceAfter=7, **common),
        'bullet': ParagraphStyle('bullet', fontSize=10.2, leading=16, leftIndent=11, firstLineIndent=-11, spaceAfter=7, **common),
        'small': ParagraphStyle('small', fontSize=8.8, leading=14, spaceAfter=4, **common),
        'note': ParagraphStyle('note', fontSize=9, leading=14, borderColor=colors.HexColor('#d9e7e2'), borderWidth=0.6,
                               borderPadding=10, backColor=colors.HexColor('#eef5f1'), spaceBefore=12, spaceAfter=8, **common),
    }


class OfferCard(Flowable):
    def __init__(self, offer: dict):
        super().__init__()
        self.offer = offer
        self.width = WIDTH
        self.height = 111

    def draw(self) -> None:
        c = self.canv
        c.setFillColor(INK)
        c.roundRect(0, 0, self.width, self.height, 9, fill=1, stroke=0)
        c.setFont('Helvetica-Bold', 9)
        c.setFillColor(colors.HexColor('#74d2c6'))
        c.drawString(18, 88, 'FREECAD AUTOMATION  /  PILOT SERVICE')
        c.setFont('Helvetica-Bold', 38)
        c.setFillColor(colors.white)
        price = f"{self.offer['price_krw']:,}"
        c.drawString(17, 43, price)
        c.setFont('PilotKorean', 12)
        x = 17 + pdfmetrics.stringWidth(price, 'Helvetica-Bold', 38) + 10
        c.drawString(x, 46, f"원 · {self.offer['tax_note']}")
        c.setFillColor(colors.HexColor('#c4d3d9'))
        c.setFont('PilotKorean', 9)
        c.drawString(18, 19, '고객별 적용 가능 범위와 일정을 확인한 뒤 최종 견적을 확정합니다.')


class ScopeStrip(Flowable):
    def __init__(self, offer: dict):
        super().__init__()
        self.scope = offer['scope']
        self.width = WIDTH
        self.height = 63

    def draw(self) -> None:
        c = self.canv
        s = self.scope
        values = [(f"{s['part_families']}개", '부품군'), (f"최대 {s['max_variants']}개", '입력 조합'),
                  (f"{s['revision_rounds']}회", '설정 수정'), (f"{s['support_hours']}시간", f"인계 후 {s['support_days_after_handoff']}일 지원")]
        for index, (value, label) in enumerate(values):
            x = index * self.width / 4
            if index:
                c.setStrokeColor(colors.HexColor('#dce5e6'))
                c.line(x - 10, 10, x - 10, 49)
            c.setFillColor(INK)
            c.setFont('PilotKorean', 16)
            c.drawString(x, 35, value)
            c.setFillColor(MUTED)
            c.setFont('PilotKorean', 8.8)
            c.drawString(x, 15, label)


def tokens(offer: dict) -> dict[str, str]:
    return {
        **{key: str(value) for key, value in offer['scope'].items()},
        'support_days': str(offer['scope']['support_days_after_handoff']),
        'price_krw': f"{offer['price_krw']:,}",
        'tax_note': offer['tax_note'],
        'supported_environment': offer['supported_environment'],
    }


def render() -> bytes:
    offer = json.loads(OFFER.read_text(encoding='utf-8'))
    source = SOURCE.read_text(encoding='utf-8')
    values = tokens(offer)
    source = re.sub(r'\{\{([a-z_]+)\}\}', lambda match: values[match.group(1)], source)
    pdfmetrics.registerFont(TTFont('PilotKorean', str(FONT)))
    style = styles()
    story: list = []
    page_count = 0
    for raw in source.splitlines():
        line = raw.strip()
        if line.startswith('<!-- page:'):
            page_count += 1
            if page_count > 1:
                story.append(PageBreak())
        elif not line or line.startswith('<!--'):
            continue
        elif line == ':::offer':
            story.extend([Spacer(1, 9), OfferCard(offer), Spacer(1, 12)])
        elif line == ':::scope':
            story.append(ScopeStrip(offer))
        elif line.startswith(':::note '):
            story.append(Paragraph(text_markup(line[8:]), style['note']))
        elif line == ':::exclusions':
            for exclusion in offer['exclusions']:
                # Keep punctuation portable in PDF readers and text extraction.
                story.append(Paragraph('- ' + text_markup(exclusion.replace('—', '-')), style['bullet']))
        elif line == ':::inquiry':
            url = escape(offer['inquiry_url'], {'"': '&quot;'})
            story.append(Paragraph(f'<link href="{url}" color="#117c74">GitHub에서 파일럿 적합성 문의 열기 ↗</link>', style['body']))
            story.append(Paragraph(text_markup(offer['inquiry_privacy_note']), style['small']))
        elif line.startswith('## '):
            story.append(Paragraph(text_markup(line[3:]), style['heading']))
        elif line.startswith('# '):
            story.append(Paragraph(text_markup(line[2:]), style['title']))
        elif line.startswith('- ') or re.match(r'^\d\. ', line):
            story.append(Paragraph(text_markup(line), style['bullet']))
        elif line.startswith(':::'):
            raise ValueError(f'Unknown directive: {line}')
        else:
            story.append(Paragraph(text_markup(line), style['body']))
    if page_count != 3:
        raise ValueError('Proposal must declare exactly three pages.')

    output = io.BytesIO()
    doc = SimpleDocTemplate(output, pagesize=A4, leftMargin=42, rightMargin=42, topMargin=58, bottomMargin=42,
                            title=offer['name'] + ' 고객 제안서', author='FreeCAD Automation',
                            subject=f"{offer['price_krw']:,}원 유료 파일럿 서비스 제안", pageCompression=1, invariant=1)

    def decorate(canvas, document) -> None:
        if document.page > page_count:
            raise ValueError('Proposal overflowed its three-page layout; shorten or rebalance the source.')
        canvas.saveState()
        canvas.setFillColor(PAPER)
        canvas.rect(0, 0, A4[0], A4[1], stroke=0, fill=1)
        canvas.setFillColor(TEAL)
        canvas.rect(42, A4[1] - 33, 18, 3, stroke=0, fill=1)
        canvas.setFillColor(MUTED)
        canvas.setFont('Helvetica', 8)
        canvas.drawString(68, A4[1] - 34, 'FREECAD AUTOMATION  /  CUSTOMER PROPOSAL')
        canvas.setStrokeColor(colors.HexColor('#dce5e6'))
        canvas.line(42, 32, A4[0] - 42, 32)
        canvas.setFillColor(MUTED)
        canvas.setFont('Helvetica', 7.8)
        canvas.drawString(42, 20, f"{offer['revision']}   |   github.com/dooosp/freecad-automation")
        canvas.linkURL(offer['repository_url'], (42, 17, 330, 28), relative=0)
        canvas.drawRightString(A4[0] - 42, 20, f'{document.page:02d} / {page_count:02d}')
        canvas.restoreState()

    doc.build(story, onFirstPage=decorate, onLaterPages=decorate)
    return output.getvalue()


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--check', action='store_true', help='Fail if the committed PDF differs from its source.')
    args = parser.parse_args()
    result = render()
    if args.check:
        if not OUTPUT.exists() or OUTPUT.read_bytes() != result:
            parser.exit(1, 'Proposal PDF is stale. Run scripts/build-pilot-proposal.py.\n')
        print('Proposal PDF matches the editable source and canonical offer.')
    else:
        OUTPUT.parent.mkdir(parents=True, exist_ok=True)
        OUTPUT.write_bytes(result)
        print(f'Built {OUTPUT.relative_to(ROOT)} ({len(result):,} bytes)')
    print('SHA256 ' + hashlib.sha256(result).hexdigest())
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
