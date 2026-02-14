"""Report styling constants and utilities for FreeCAD Studio reports."""

import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
from matplotlib import font_manager
import os

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

def apply_style(template=None):
    """Apply report style from template or defaults."""
    style = template.get('style', {}) if template else {}
    available = {f.name for f in font_manager.fontManager.ttflist}
    preferred_font = style.get('font')

    font_family = preferred_font if preferred_font in available else get_font(template.get('language', 'en') if template else 'en')

    plt.rcParams.update({
        'font.family': font_family,
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
