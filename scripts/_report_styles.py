"""Report styling constants and utilities for FreeCAD Studio reports."""

import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
from matplotlib import font_manager
from matplotlib.ft2font import FT2Font
import os


def contains_korean_text(value):
    """Return True when nested report input contains Hangul user text."""
    if isinstance(value, str):
        return any(
            '\u1100' <= char <= '\u11ff'
            or '\u3130' <= char <= '\u318f'
            or '\uac00' <= char <= '\ud7a3'
            for char in value
        )
    if isinstance(value, dict):
        return any(contains_korean_text(child) for child in value.values())
    if isinstance(value, (list, tuple)):
        return any(contains_korean_text(child) for child in value)
    return False

# Register user-installed fonts (Windows user fonts dir is not scanned by default)
_USER_FONT_DIR = os.path.join(os.path.expanduser('~'), 'AppData', 'Local',
                              'Microsoft', 'Windows', 'Fonts')
if os.path.isdir(_USER_FONT_DIR):
    for fname in os.listdir(_USER_FONT_DIR):
        if fname.lower().endswith(('.ttf', '.otf')):
            fpath = os.path.join(_USER_FONT_DIR, fname)
            try:
                font_manager.fontManager.addfont(fpath)
            except Exception:
                pass

# Professional color schemes
STYLE_PROFESSIONAL = {
    'header_bg': '#2c3e50',
    'header_text': '#ffffff',
    'accent': '#3498db',
    'text_primary': '#2c3e50',
    'text_secondary': '#7f8c8d',
    'table_header_bg': '#34495e',
    'table_header_text': '#ffffff',
    'table_stripe_even': '#f8f9fa',
    'table_stripe_odd': '#ffffff',
    'table_border': '#dee2e6',
    'success': '#27ae60',
    'warning': '#f39c12',
    'error': '#e74c3c',
    'info': '#3498db',
    'page_bg': '#ffffff',
}

# Page layout constants (A4 landscape in inches)
PAGE_WIDTH = 11.69
PAGE_HEIGHT = 8.27
MARGIN_TOP = 0.8
MARGIN_BOTTOM = 0.6
MARGIN_LEFT = 0.6
MARGIN_RIGHT = 0.6
CONTENT_WIDTH = PAGE_WIDTH - MARGIN_LEFT - MARGIN_RIGHT
CONTENT_HEIGHT = PAGE_HEIGHT - MARGIN_TOP - MARGIN_BOTTOM

# Severity colors for DFM
SEVERITY_COLORS = {
    'error': '#e74c3c',
    'warning': '#f39c12',
    'ok': '#27ae60',
    'info': '#3498db',
}

def get_font(language='en'):
    """Return appropriate font family for language."""
    available = {f.name for f in font_manager.fontManager.ttflist}
    if language == 'ko':
        # Try NanumGothic first
        ko_fonts = [
            'NanumGothic',
            'Nanum Gothic',
            'NanumBarunGothic',
            'Noto Sans KR',
            'Noto Sans CJK KR',
            'Malgun Gothic',
            'UnDotum',
            'AppleGothic',
            'IPAGothic',
        ]
        for font in ko_fonts:
            if font in available:
                return font
        # Fallback
        return 'sans-serif'
    return 'sans-serif'


def _font_supports_korean_text(font_family, *values):
    """Return True when an installed family covers the requested Hangul glyphs."""
    korean_codepoints = {
        ord(char)
        for value in values
        for char in _iter_text(value)
        if contains_korean_text(char)
    }
    if not korean_codepoints:
        return True
    try:
        font_path = font_manager.findfont(
            font_manager.FontProperties(family=[font_family]),
            fallback_to_default=False,
        )
        face = FT2Font(font_path)
        return all(face.get_char_index(codepoint) for codepoint in korean_codepoints)
    except Exception:
        return False


def _iter_text(value):
    if isinstance(value, str):
        yield from value
    elif isinstance(value, dict):
        for key, child in value.items():
            yield from _iter_text(key)
            yield from _iter_text(child)
    elif isinstance(value, (list, tuple)):
        for child in value:
            yield from _iter_text(child)

def apply_style(template=None, content=None):
    """Apply report style from template or defaults."""
    style = template.get('style', {}) if template else {}
    available = {f.name for f in font_manager.fontManager.ttflist}
    preferred_font = style.get('font')
    configured_language = str(template.get('language', 'en') if template else 'en').lower()
    font_language = 'ko' if configured_language.startswith('ko') or contains_korean_text(content) else 'en'
    font_family = (
        preferred_font
        if preferred_font in available and (
            font_language != 'ko'
            or _font_supports_korean_text(preferred_font, template, content)
        )
        else get_font(font_language)
    )

    plt.rcParams.update({
        'font.family': font_family,
        'pdf.fonttype': 42 if font_language == 'ko' else matplotlib.rcParamsDefault['pdf.fonttype'],
        'font.size': 9,
        'axes.titlesize': 11,
        'axes.labelsize': 9,
        'figure.facecolor': STYLE_PROFESSIONAL['page_bg'],
        'axes.facecolor': STYLE_PROFESSIONAL['page_bg'],
        'text.color': STYLE_PROFESSIONAL['text_primary'],
    })

    return {
        'header_color': style.get('header_color', STYLE_PROFESSIONAL['header_bg']),
        'accent_color': style.get('accent_color', STYLE_PROFESSIONAL['accent']),
        'font_family': font_family,
        'font_language': font_language,
        'font_support': (
            'fallback'
            if font_language == 'ko' and font_family == 'sans-serif'
            else 'native'
            if font_language == 'ko'
            else 'default'
        ),
        'page_size': style.get('page_size', 'A4'),
        'orientation': style.get('orientation', 'landscape'),
    }

def get_score_color(score):
    """Return color based on score value (0-100)."""
    if score >= 80:
        return SEVERITY_COLORS['ok']
    elif score >= 60:
        return SEVERITY_COLORS['warning']
    return SEVERITY_COLORS['error']
