# SVG Post-Processor + QA Scorer 구현 계획

## 0. 목표

- `generate_drawing.py`는 **건드리지 않는다** (기존 패치 루프 탈출)
- SVG 품질 문제를 **후처리 규칙**으로 해결한다
- 품질을 **QA 점수로 수치화**해서 "개선이 누적"되게 만든다
- 두 스크립트 모두 **독립 실행 + fcad CLI 통합** 가능

---

## 실제 SVG 구조 (설계 전제)

### 페이지 레이아웃

```
A3 landscape: 420mm x 297mm
Drawing border: (15,15) → (405,282)

Cell grid (dashed rects):
  Top-Left:     x=15,  y=15,  w=195, h=116  → TOP view
  Top-Right:    x=210, y=15,  w=195, h=116  → ISO view
  Bottom-Left:  x=15,  y=131, w=195, h=116  → FRONT view
  Bottom-Right: x=210, y=131, w=195, h=116  → RIGHT view
```

### 뷰 식별자

- HTML 주석: `<!-- FRONT -->`, `<!-- TOP -->`, `<!-- RIGHT -->`, `<!-- ISO -->`
- 라벨 텍스트: `<text ... font-family="monospace" font-size="3.5">FRONT</text>`
  - FRONT → (18, 141), TOP → (18, 25), RIGHT → (213, 141), ISO → (213, 25)

### 클래스 체계 (실제 출력에서 확인됨)

| 클래스 | 용도 | 기본 stroke-width |
|--------|------|-------------------|
| `hard_visible` | 외형선 (굵은) | 0.7 |
| `outer_visible` | 외형선 (중간) | 0.50 |
| `smooth_visible` | 부드러운 가시선 | 0.35 |
| `hard_hidden` | 숨은선 (굵은) | 0.2, dash 3,1.5 |
| `outer_hidden` | 숨은선 (외곽) | 0.2, dash 3,1.5 |
| `smooth_hidden` | 숨은선 (부드러운) | 0.2, dash 3,1.5 |
| `iso_visible` | ISO 내부선 (얇은, 회색) | 0.13, #999 |
| `centerlines` | 중심선 | 0.18, dash 8,2,1.5,2 |
| `symmetry-axes` | 대칭축 | 0.13, dash 8,2,1.5,2 |
| `dimensions-{view}` | 치수선 (뷰별) | 0.18 |
| `datums-{view}` | 데이텀 (뷰별) | - |
| `chamfer-callouts` | 모따기 콜아웃 | - |
| `thread-callouts` | 나사산 콜아웃 | - |
| `ordinate-dimensions` | 좌표 치수 | - |
| `gdt-leader` | GD&T 리더선 + FCF | 0.25 |
| `general-notes` | 일반 주석 | font 2.0 |
| `revision-table` | 리비전 테이블 | - |
| `surface-finish` | 표면 거칠기 | 0.25 |
| `projection-symbol` | 투영법 기호 | - |

### GD&T FCF 구조 (중요 — 래퍼 없음)

```xml
<g class="gdt-leader" stroke="#000" stroke-width="0.25" fill="none">
  <polyline points="112.50,226.32 124.50,226.32 ..."/>
  <circle cx="112.50" cy="226.32" r="0.6" fill="#000"/>
</g>
<!-- 이하 rect + line + text가 느슨하게 이어짐 (부모 <g> 없음) -->
<rect x="124.5" y="223.3" width="60" height="6" fill="white" stroke="#000" stroke-width="0.3"/>
<line .../>  <!-- 셀 구분선들 -->
<text ...>⌖</text>
<text ...>⌀0.5 Ⓜ</text>
<text ...>A</text>
```

→ **하나의 FCF = `gdt-leader` <g> + 뒤따르는 rect + line + text 시퀀스**

---

## S1. SVG Post-Processor

### 파일

- `scripts/postprocess_svg.py` — 메인
- `scripts/svg_common.py` — 공용 유틸 (S2와 공유)

### CLI

```bash
python scripts/postprocess_svg.py input.svg -o output.svg [--profile ks] [--report report.json]

# 옵션
#   --profile ks     KS 표준 프로파일 (기본값)
#   --report FILE    적용된 변경 리포트 (JSON)
#   --dry-run        변경 없이 리포트만 출력
```

### 공용 모듈: `svg_common.py`

```python
"""S1/S2 공유 유틸리티"""
import xml.etree.ElementTree as ET
import re
from dataclasses import dataclass

# A3 landscape 고정
PAGE_W, PAGE_H = 420.0, 297.0

# 셀 레이아웃 (generate_drawing.py 출력 기준)
CELLS = {
    "top":   {"x": 15.0, "y": 15.0,  "w": 195.0, "h": 116.0},
    "iso":   {"x": 210.0,"y": 15.0,  "w": 195.0, "h": 116.0},
    "front": {"x": 15.0, "y": 131.0, "w": 195.0, "h": 116.0},
    "right": {"x": 210.0,"y": 131.0, "w": 195.0, "h": 116.0},
}

# 뷰 라벨 좌표 (monospace 3.5px, 셀 좌상단 근처)
VIEW_LABELS = {
    "front": (18.0, 141.0),
    "top":   (18.0, 25.0),
    "right": (213.0, 141.0),
    "iso":   (213.0, 25.0),
}

@dataclass
class BBox:
    x: float; y: float; w: float; h: float

    def contains(self, px, py) -> bool: ...
    def overlaps(self, other) -> bool: ...
    def area(self) -> float: ...

def load_svg(path: str) -> ET.ElementTree: ...
def write_svg(tree: ET.ElementTree, path: str): ...

def cell_bbox(view_name: str) -> BBox:
    """셀 이름 → BBox 반환. CELLS dict 기반."""

def classify_element_view(elem, tree) -> str | None:
    """요소가 속한 뷰를 추정.
    1) 부모/이전 형제의 <!-- VIEW --> 주석 탐색
    2) 요소 bbox 중심이 어느 셀에 속하는지 판정
    fallback: None
    """

def elem_bbox_approx(elem) -> BBox | None:
    """요소의 근사 bbox.
    - <path>: d 속성에서 숫자 추출 → min/max
    - <circle>: cx,cy,r → bbox
    - <line>: x1,y1,x2,y2
    - <rect>: x,y,width,height
    - <text>: x,y + len(text)*font_size*0.55 (근사)
    - <g>: 자식들의 bbox union
    """

def path_coords(d: str) -> list[tuple[float,float]]:
    """SVG path d 속성에서 (x,y) 좌표 추출 (M/L 위주)"""

def count_paths_in_group(g_elem) -> int:
    """<g> 내부 <path> 개수"""
```

### 룰 세트

#### P0 룰 (무조건 적용)

**Rule 1: ISO hidden 완전 제거**

```python
def remove_iso_hidden(tree) -> int:
    """ISO 셀 영역에 위치한 hidden 그룹 제거.

    대상 클래스: outer_hidden, hard_hidden, smooth_hidden, iso_hidden
    조건: 그룹의 첫 번째 path bbox 중심이 ISO 셀(210,15,195,116) 안에 있을 때

    구현:
    1. 모든 <g class="*_hidden"> 탐색
    2. 그룹 내 첫 path의 bbox 중심 계산
    3. ISO 셀 영역이면 부모에서 remove
    4. 제거된 그룹 수 반환

    반환: 제거된 그룹 수
    """
```

**Rule 2: Stroke Normalization 강제**

```python
STROKE_PROFILE_KS = {
    "hard_visible":   {"stroke-width": "0.7",  "stroke": "#000"},
    "outer_visible":  {"stroke-width": "0.50", "stroke": "#000"},
    "smooth_visible": {"stroke-width": "0.35", "stroke": "#000"},
    "outer_hidden":   {"stroke-width": "0.20", "stroke": "#333", "stroke-dasharray": "3,1.5"},
    "hard_hidden":    {"stroke-width": "0.20", "stroke": "#333", "stroke-dasharray": "3,1.5"},
    "smooth_hidden":  {"stroke-width": "0.20", "stroke": "#444", "stroke-dasharray": "3,1.5"},
    "centerlines":    {"stroke-width": "0.18", "stroke-dasharray": "8,2,1.5,2",
                       "vector-effect": "non-scaling-stroke"},
    "symmetry-axes":  {"stroke-width": "0.13", "stroke-dasharray": "8,2,1.5,2",
                       "vector-effect": "non-scaling-stroke"},
    "gdt-leader":     {"stroke-width": "0.25"},
    "dimensions-*":   {"stroke-width": "0.18",
                       "vector-effect": "non-scaling-stroke"},
}

def normalize_strokes(tree, profile=STROKE_PROFILE_KS) -> int:
    """모든 <g class="..."> 에 프로파일 속성 강제 적용.

    dimensions-* 는 dimensions-front, dimensions-top 등 와일드카드 매칭.
    반환: 수정된 그룹 수
    """
```

**Rule 3: Notes 자동 줄바꿈/행간 정리**

```python
NOTES_CONFIG = {
    "max_width_mm": 180.0,      # FRONT 셀 폭 - 좌우 패딩
    "line_height_mm": 4.0,      # 행간
    "font_size_mm": 2.0,        # 폰트 크기
    "char_width_factor": 0.55,  # monospace 근사 폭 = font_size * factor
    "start_x": 19.0,            # 시작 X
}

def rewrap_notes(tree, config=NOTES_CONFIG) -> int:
    """<g class="general-notes"> 내부 <text> 요소들을 재배치.

    1. general-notes 그룹 탐색
    2. 각 <text>의 텍스트 추출
    3. max_width 초과 시 <tspan>으로 줄바꿈
    4. y 좌표를 line_height 간격으로 재배치
    5. NOTES: 헤더는 font-size 2.5 유지

    반환: 재배치된 줄 수
    """
```

**Rule 4: 소수점 좌표 정리**

```python
def round_coordinates(tree, precision=2) -> int:
    """rect, line, circle, text, polyline 속성의 소수점을 N자리로 반올림.

    대상 속성: x, y, x1, y1, x2, y2, cx, cy, r, width, height, points
    <path d="...">의 좌표도 반올림

    목적: FCF의 `y="223.31840390126624"` 같은 부동소수점 노이즈 제거
    반환: 수정된 속성 수
    """
```

#### P1 룰 (가능하면 적용)

**Rule 5: ISO simplify (과다 내부선 제거)**

```python
def simplify_iso(tree, max_paths=600) -> int:
    """ISO 셀의 iso_visible, smooth_visible 그룹에서 path 수 초과 시 제거.

    1. ISO 셀 내 iso_visible 그룹: 무조건 제거 (얇은 회색 내부선)
    2. ISO 셀 내 smooth_visible 그룹: path 수 > max_paths 이면 제거
    3. hard_visible, outer_visible는 유지

    반환: 제거된 path 수
    """
```

**Rule 6: GD&T FCF 좌표 라운딩 + 리더 연결 검증**

```python
def audit_gdt(tree) -> dict:
    """GD&T 구조 검증 (수정은 최소, 주로 리포트).

    1. 각 gdt-leader 그룹 탐색
    2. 리더 polyline의 시작점(앵커)이 뷰 geometry 근처인지 확인
    3. 뒤따르는 FCF rect의 좌표를 precision=1로 반올림
    4. FCF가 셀 밖으로 나갔는지 검사

    반환: {"total": N, "anchored": N, "overflow": N, "rounded": N}
    """
```

### 실행 파이프라인

```python
def postprocess(input_path, output_path, profile="ks", dry_run=False):
    tree = load_svg(input_path)
    report = {}

    # P0 룰 (순서 중요)
    report["iso_hidden_removed"] = remove_iso_hidden(tree)
    report["strokes_normalized"] = normalize_strokes(tree)
    report["notes_rewrapped"] = rewrap_notes(tree)
    report["coords_rounded"] = round_coordinates(tree)

    # P1 룰
    report["iso_simplified"] = simplify_iso(tree)
    report["gdt_audit"] = audit_gdt(tree)

    if not dry_run:
        write_svg(tree, output_path)

    return report
```

### 실패 시 동작

- SVG 파싱 실패 → 에러 + 원본 유지 (덮어쓰기 금지)
- 개별 룰 실패 → 해당 룰만 skip + 경고, 나머지 룰 계속 적용
- `--report`에 모든 실패도 기록

---

## S2. Drawing QA Scorer

### 파일

- `scripts/qa_scorer.py` — 메인 (svg_common.py 공유)

### CLI

```bash
python scripts/qa_scorer.py input.svg [--json report.json] [--fail-under 80]

# 출력 예시:
# QA Score: 87/100
#   iso_hidden_count: 0 (0점 감점)
#   overflow_count: 1 (-10점)
#   text_overlap_pairs: 2 (-4점)
#   notes_overflow: false (0점 감점)
#   gdt_unanchored: 1 (-3점)
#   stroke_violations: 0 (0점 감점)
```

### 체크 항목 + 감점 기준

#### P0 지표 (핵심)

| 지표 | 측정 방법 | 감점 |
|------|-----------|------|
| `iso_hidden_count` | ISO 셀 내 `*_hidden` 그룹 수 | 1개당 -5 |
| `overflow_count` | 뷰 geometry가 셀 bbox 밖으로 나간 요소 수 | 1개당 -10 |
| `text_overlap_pairs` | 텍스트 bbox 간 IoU > 0.1인 쌍 수 | 1쌍당 -2 |
| `dim_overlap_pairs` | 치수 텍스트 vs 형상 path 겹침 쌍 수 | 1쌍당 -2 |
| `notes_overflow` | notes 텍스트가 셀/타이틀블록 영역 침범 여부 | -15 |

#### P1 지표 (보조)

| 지표 | 측정 방법 | 감점 |
|------|-----------|------|
| `gdt_unanchored` | leader polyline 길이가 0(시작=끝)인 FCF 수 | 1개당 -3 |
| `dense_iso` | ISO 셀 내 전체 path 수 > 800 | -5 |
| `stroke_violations` | 클래스별 stroke 규칙 불일치 수 | 1개당 -1 |
| `float_precision` | 소수점 6자리+ 좌표 수 | 10개당 -1 (max -5) |

### 스코어 계산

```python
def compute_score(metrics: dict) -> tuple[int, dict]:
    """100점 만점에서 감점.

    score = 100
    deductions = {}

    score -= metrics["iso_hidden_count"] * 5
    score -= metrics["overflow_count"] * 10
    score -= metrics["text_overlap_pairs"] * 2
    score -= metrics["dim_overlap_pairs"] * 2
    score -= 15 if metrics["notes_overflow"] else 0
    score -= metrics["gdt_unanchored"] * 3
    score -= 5 if metrics["dense_iso"] else 0
    score -= metrics["stroke_violations"] * 1
    score -= min(metrics["float_precision_count"] // 10, 5)

    return (max(score, 0), deductions)
    """
```

### 구현 함수

```python
def count_iso_hidden(tree) -> int:
    """ISO 셀 내 *_hidden 클래스 그룹 수"""

def detect_overflow(tree) -> list[dict]:
    """각 뷰별로 geometry 요소가 셀 밖으로 나갔는지 검사.

    1. 뷰별 셀 bbox 확인
    2. 해당 뷰의 path/circle/line 그룹들의 bbox 계산
    3. 셀 bbox 밖으로 나간 요소 목록 반환

    반환: [{"view": "front", "class": "hard_visible", "overflow_px": 12.3}, ...]
    """

def detect_text_overlaps(tree) -> list[tuple]:
    """모든 <text> 요소의 bbox를 계산하고 IoU > threshold인 쌍 반환.

    bbox 근사: x, y-font_size → x+len*font_size*0.55, y
    같은 그룹 내 텍스트끼리만 비교 (다른 뷰 간 겹침은 무시)

    반환: [(text1, text2, iou), ...]
    """

def check_notes_overflow(tree) -> bool:
    """general-notes 그룹의 마지막 텍스트 y가 title block 영역(y>247)을 침범하는지"""

def count_gdt_unanchored(tree) -> int:
    """gdt-leader polyline에서 시작점==끝점인 경우 (앵커 없음) 카운트"""

def count_stroke_violations(tree, profile) -> int:
    """클래스별 stroke 속성이 프로파일과 불일치하는 그룹 수"""

def count_float_precision(tree, threshold=5) -> int:
    """소수점 N자리 이상인 좌표 속성 수"""
```

### JSON 리포트 형식

```json
{
  "file": "ks_flange_drawing.svg",
  "score": 87,
  "timestamp": "2026-02-12T18:00:00",
  "metrics": {
    "iso_hidden_count": 0,
    "overflow_count": 1,
    "text_overlap_pairs": 2,
    "dim_overlap_pairs": 0,
    "notes_overflow": false,
    "gdt_unanchored": 1,
    "dense_iso": false,
    "stroke_violations": 0,
    "float_precision_count": 45
  },
  "deductions": {
    "overflow_count": -10,
    "text_overlap_pairs": -4,
    "gdt_unanchored": -3
  },
  "details": {
    "overflows": [
      {"view": "front", "class": "gdt-leader", "overflow_px": 3.2}
    ],
    "overlaps": [
      {"text1": "⌀0.5 Ⓜ", "text2": "0.05", "iou": 0.12}
    ]
  }
}
```

---

## S3. fcad CLI 통합

### 변경 파일

- `bin/fcad.js` — `draw` 명령에 후처리/QA 단계 추가

### 파이프라인

```
fcad draw config.toml
  ├─ Step 1: generate_drawing.py → output/{name}_drawing.svg (기존)
  ├─ Step 2: postprocess_svg.py → output/{name}_drawing.svg (덮어쓰기)
  └─ Step 3: qa_scorer.py → output/{name}_qa.json + stdout 점수
```

### CLI 옵션 추가

```bash
fcad draw config.toml                    # 기본: generate + postprocess + score
fcad draw config.toml --raw              # postprocess 스킵 (디버깅용)
fcad draw config.toml --fail-under 85    # 점수 미달 시 exit 1
fcad draw config.toml --no-score         # QA 스킵
```

### fcad.js 수정 범위

```javascript
// bin/fcad.js draw 핸들러 (기존 ~line 123-176)
// generate 완료 후 추가:

if (!opts.raw) {
  // Step 2: Post-process
  const ppResult = execSync(
    `python3 scripts/postprocess_svg.py "${svgPath}" -o "${svgPath}" --report "${qaDir}/${name}_pp.json"`,
    { cwd: projectRoot }
  );
}

if (!opts.noScore) {
  // Step 3: QA Score
  const qaResult = execSync(
    `python3 scripts/qa_scorer.py "${svgPath}" --json "${qaDir}/${name}_qa.json"` +
    (opts.failUnder ? ` --fail-under ${opts.failUnder}` : ''),
    { cwd: projectRoot }
  );
  console.log(qaResult.toString());
}
```

---

## 구현 순서

| 순서 | 작업 | 산출물 | 의존성 |
|------|------|--------|--------|
| 1 | `scripts/svg_common.py` | 공용 유틸 | 없음 |
| 2a | `scripts/postprocess_svg.py` P0 룰 4종 | 후처리 스크립트 | svg_common |
| 2b | `scripts/qa_scorer.py` P0 지표 5종 | QA 스코어러 | svg_common |
| 3 | P1 룰/지표 추가 | 확장 | 2a, 2b |
| 4 | `bin/fcad.js` 통합 | CLI 파이프라인 | 2a, 2b |
| 5 | 6종 SVG 일괄 실행 + 점수 기록 | 베이스라인 | 4 |

**2a, 2b는 병렬 구현 가능** (svg_common만 먼저 완성)

---

## 검증 방법

### 단위 검증

```bash
# Post-processor 단독 실행
python scripts/postprocess_svg.py output/ks_flange_drawing.svg -o /tmp/clean.svg --report /tmp/pp.json

# QA 스코어러 단독 실행
python scripts/qa_scorer.py output/ks_flange_drawing.svg --json /tmp/qa.json

# Dry-run (변경 없이 리포트만)
python scripts/postprocess_svg.py output/ks_flange_drawing.svg --dry-run --report /tmp/pp.json
```

### 일괄 검증

```bash
# 6종 전체 후처리 + QA
for svg in output/ks_*_drawing.svg; do
  name=$(basename "$svg" _drawing.svg)
  python scripts/postprocess_svg.py "$svg" -o "output/${name}_clean.svg" --report "output/${name}_pp.json"
  python scripts/qa_scorer.py "output/${name}_clean.svg" --json "output/${name}_qa.json"
done
```

### 성공 기준

- 후처리 후 ISO 뷰에 hidden line 0개
- 후처리 전/후 QA 점수 비교: **최소 10점 이상 개선**
- `--fail-under 80` 통과하는 SVG가 4종 이상 (6종 중)
- 기존 테스트 (`node tests/test-runner.js`) 통과 유지

---

## 미래 확장 (이번 범위 밖)

- TechDraw 하이브리드 (투영을 TechDraw View 객체로 전환)
- 제조 패키지 생성기 (critical dims list + inspection checklist)
- CI 자동 비교 (PR마다 점수 diff)
