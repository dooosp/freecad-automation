"""Render portable Korean HTML from review and comparison documents."""

from collections import Counter
from html import escape


STATUSES = {
    "out_of_tolerance": ("범위 밖", "outside"),
    "cannot_evaluate": ("판정 불가", "blocked"),
    "missing": ("측정 누락", "blocked"),
    "in_tolerance": ("범위 내", "inside"),
}

REASONS = {
    "part_mismatch": "부품 번호 불일치",
    "revision_mismatch": "도면 개정 불일치",
    "lot_mismatch": "로트 불일치",
    "supplier_mismatch": "공급사 불일치",
    "unknown_characteristic": "기준에 없는 특성",
    "unexpected_sample": "요구 목록에 없는 표본",
    "missing_measurement": "필수 표본의 측정 행 없음",
    "duplicate_measurement": "동일 특성·표본으로 제출된 행이 여러 개",
    "invalid_requirement_unit": "사용할 수 없는 기준 단위",
    "invalid_limits": "한계값 누락 또는 형식·순서 오류",
    "invalid_measurement": "측정값 누락 또는 숫자 형식 오류",
    "invalid_measurement_unit": "측정 단위 누락 또는 형식 오류",
    "below_lower_limit": "하한 미달",
    "above_upper_limit": "상한 초과",
    "supplier_result_mismatch": "공급사 판정과 불일치",
    "identity_changed": "검토 건 식별 정보 변경",
    "requirements_changed": "구매자 검사 기준 변경",
    "mapping_changed": "CSV 열 매핑 변경",
    "rule_version_changed": "판정 규칙 버전 변경",
}

CHANGE_TYPES = {"added": "추가", "removed": "삭제", "changed": "변경", "unresolved": "미해결"}

STYLES = """
:root {
    color-scheme: light;
    font: 15px/1.55 system-ui, -apple-system, BlinkMacSystemFont, "Noto Sans KR", sans-serif;
    color: #17253a;
    background: #f3f5f8;
}
* { box-sizing: border-box; }
body { margin: 0; }
a { color: #174e97; text-underline-offset: .23em; }
a:focus-visible, [tabindex]:focus-visible { outline: 2px solid #2266bd; outline-offset: 3px; }
.banner { border-top: 6px solid #3768b1; background: #142943; color: #fff; }
.wrap { max-width: 82rem; padding-inline: clamp(1rem, 4vw, 3rem); margin-inline: auto; }
.banner .wrap { padding-block: 2.3rem 2rem; }
h1 { font-size: clamp(1.7rem, 4vw, 2.55rem); letter-spacing: -.025em; line-height: 1.3; margin: 0 0 1.15rem; }
nav .wrap { display: flex; gap: .5rem 1.3rem; flex-wrap: wrap; padding-block: .8rem; }
nav { background: #e5ecf5; border-bottom: 1px solid #cedaea; }
main { padding-block: 1.3rem 3rem; }
section { margin-bottom: 1.2rem; padding: clamp(1rem, 3vw, 1.6rem); border: 1px solid #d7dfe8; border-radius: .6rem; background: #fff; }
h2 { margin: 0 0 .8rem; font-size: 1.28rem; }
h3 { margin: 1.1rem 0 .45rem; font-size: 1rem; }
dl { margin: 0; }
dt { color: #495975; font-size: .85rem; }
dd { margin: 0; overflow-wrap: anywhere; }
.identity, .counts { display: flex; flex-wrap: wrap; gap: .7rem 1.7rem; }
.identity dt { color: #bed0e7; }
.identity dd { font-size: 1.05rem; font-weight: 650; }
.counts { margin-bottom: 1rem; }
.counts div { border-left: 3px solid #c4d4ea; padding-left: .65rem; }
.counts dd { font-size: 1.35rem; font-weight: 650; font-variant-numeric: tabular-nums; }
.compare-identities { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 18rem), 1fr)); gap: .65rem 1rem; margin-bottom: 1rem; }
.compare-identities > div { background: #1e3654; border-radius: .5rem; padding: 1rem; }
.compare-identities h2 { font-size: 1rem; margin-bottom: .6rem; }
.compare-identities .identity { gap: .5rem 1.05rem; }
.table-scroll { overflow: auto; }
table { width: 100%; border-collapse: collapse; text-align: left; }
thead { background: #edf2f8; color: #273d5a; }
th, td { padding: .65rem .8rem; border-bottom: 1px solid #dce3ec; vertical-align: top; }
thead th { white-space: nowrap; font-size: .85rem; }
tbody th { font-weight: 650; }
tr:target > * { background: #fff3c0; }
.num { white-space: nowrap; font-variant-numeric: tabular-nums; }
.source-cell { white-space: pre-wrap; overflow-wrap: anywhere; min-width: 6rem; }
.narrow { white-space: nowrap; }
.secondary { display: block; margin-top: .15rem; font-size: .85rem; color: #495975; }
.status { display: inline-block; border-radius: .3rem; padding: .12rem .4rem; font-weight: 650; white-space: nowrap; }
.inside { background: #e3f1e8; color: #185637; }
.outside { background: #fbe8e5; color: #8c2c28; }
.blocked { background: #fff1d9; color: #664408; }
.notes { margin: .3rem 0 0; padding-left: 1.15rem; }
.notice { background: #fff7e6; border-left: 4px solid #99701a; padding: .85rem 1rem; margin: 0 0 1rem; }
.notice p, .empty { margin-block: .1rem; }
.hash { font-size: .8rem; overflow-wrap: anywhere; }
@media print {
    :root, .banner, nav { background: #fff; }
    .banner, .identity dt { color: #17253a; }
    .compare-identities > div { background: #fff; border: 1px solid #d7dfe8; }
    .wrap { padding-inline: .3rem; }
    nav { display: none; }
    tr { break-inside: avoid; }
}
"""


def _text(value):
    return "—" if value is None or value == "" else escape(str(value))


def _page(title, heading, body, links):
    navigation = "".join(f'<a href="#{anchor}">{label}</a>' for anchor, label in links)
    return f"""<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{title}</title>
<style>{STYLES}</style>
</head>
<body>
<header class="banner"><div class="wrap"><h1>{title}</h1>{heading}</div></header>
<nav aria-label="보고서 목차"><div class="wrap">{navigation}</div></nav>
<main class="wrap">{body}</main>
</body>
</html>
"""


def _table(label, headings, rows):
    header = "".join(f'<th scope="col">{_text(item)}</th>' for item in headings)
    return (
        '<div class="table-scroll" tabindex="0">'
        f'<table aria-label="{_text(label)}"><thead><tr>{header}</tr></thead>'
        f'<tbody>{"".join(rows)}</tbody></table></div>'
    )


def _section(anchor, title, content):
    return f'<section id="{anchor}"><h2>{title}</h2>{content}</section>'


def _identity(review):
    identity = review["identity"]
    supplier_source = "CSV 열 대조" if review["supplier_source"] == "csv" else "담당자 입력"
    return f"""<dl class="identity">
<div><dt>부품 번호</dt><dd>{_text(identity["part"])}</dd></div>
<div><dt>도면 개정</dt><dd>{_text(identity["revision"])}</dd></div>
<div><dt>로트</dt><dd>{_text(identity["lot"])}</dd></div>
<div><dt>공급사 · {supplier_source}</dt><dd>{_text(identity["supplier"])}</dd></div>
</dl>"""


def _reasons(codes):
    if not codes:
        return ""
    items = "".join(f"<li>{_text(REASONS.get(code, code))}</li>" for code in codes)
    return f'<ul class="notes">{items}</ul>'


def _status(value):
    label, style = STATUSES.get(value, (value, "blocked"))
    return f'<span class="status {style}">{_text(label)}</span>'


def _quantity(value, unit):
    if value is None or value == "":
        return "—"
    return _quantity_text(_text(value), unit)


def _quantity_text(text, unit):
    return f"{text} {_text(unit)}" if unit else text


def _limits(item):
    bounds = f'{_text(item["lower"])} – {_text(item["upper"])}'
    return _quantity_text(bounds, item["unit"])


def _measurement(item):
    value, unit = item.get("measured_value"), item.get("measured_unit")
    if value is None or value == "":
        return _quantity(item["measured_mm"], "mm")
    quantity = _quantity(value, unit)
    if item["measured_mm"] is not None and unit != "mm":
        quantity += f'<span class="secondary">{_quantity(item["measured_mm"], "mm")}</span>'
    return quantity


def _source_links(rows, prefix):
    return ", ".join(f'<a href="#{prefix}source-row-{_text(row)}">원본 {_text(row)}행</a>' for row in rows)


def _deviation(item):
    amount = item.get("deviation_mm")
    if amount is None:
        return ""
    direction = "상한 초과" if "above_upper_limit" in item["reasons"] else "하한 미달"
    return f'<span class="secondary">{direction} {_quantity(amount, "mm")}</span>'


def _requirement_anchors(review, prefix):
    return {
        item["id"]: f"{prefix}requirement-{index}"
        for index, item in enumerate(review["requirements"]["characteristics"], start=1)
    }


def _result_links(result, prefix, requirement_anchors):
    sources = _source_links(result["source_rows"], prefix)
    anchor = requirement_anchors[result["characteristic"]]
    requirement = f'<a href="#{anchor}">검사 기준</a>'
    return f"{sources} · {requirement}" if sources else requirement


def _result_tables(review, prefix=""):
    anchors = _requirement_anchors(review, prefix)
    counts = Counter(row["computed_result"] for row in review["results"])
    counts_html = "".join(
        f"<div><dt>{label}</dt><dd>{counts[code]}</dd></div>"
        for code, (label, _) in STATUSES.items()
    )
    unmatched_count = len(review["unmatched_rows"])
    counts_html += f"<div><dt>대조 제외 행</dt><dd>{unmatched_count}</dd></div>"
    order = {status: index for index, status in enumerate(STATUSES)}
    ordered_results = sorted(
        review["results"],
        key=lambda row: (order.get(row["computed_result"], len(order)), not bool(row["reasons"])),
    )
    rows = [
        f"""<tr>
<th scope="row">{_text(row["characteristic"])}<span class="secondary">{_text(row["sample"])}</span></th>
<td class="num">{_limits(row)}</td>
<td class="num">{_measurement(row)}{_deviation(row)}</td>
<td>{_text(row["supplier_result"])}</td>
<td>{_status(row["computed_result"])}{_reasons(row["reasons"])}</td>
<td>{_result_links(row, prefix, anchors)}</td>
</tr>"""
        for row in ordered_results
    ]
    results = _table(
        "구매자 기준 판정", ["특성 · 표본", "허용 범위", "측정값", "공급사 판정", "재계산 결과", "확인 근거"],
        rows,
    )
    unmatched = ""
    if unmatched_count:
        unmatched_rows = [
            f"""<tr>
<th scope="row">{_source_links([row["row"]], prefix)}</th>
<td>{_text(row["characteristic"])}</td>
<td>{_text(row["sample"])}</td>
<td>{_reasons(row["reasons"])}</td>
</tr>"""
            for row in review["unmatched_rows"]
        ]
        unmatched = "<h3>대조 제외 행</h3>" + _table(
            "대조 제외 행", ["CSV 행", "특성", "표본", "사유"], unmatched_rows,
        )
    return f'<dl class="counts">{counts_html}</dl>{results}{unmatched}'


def _evidence(review, prefix=""):
    anchors = _requirement_anchors(review, prefix)
    requirement_rows = [
        f"""<tr id="{anchors[item["id"]]}">
<th scope="row">{_text(item["id"])}</th><td>{_text(item["drawing_ref"])}</td>
<td class="num">{_limits(item)}</td><td>{", ".join(_text(sample) for sample in item["samples"])}</td>
</tr>"""
        for item in review["requirements"]["characteristics"]
    ]
    requirements = _table(
        "구매자 검사 기준", ["특성", "도면 위치", "허용 범위", "필수 표본"], requirement_rows,
    )
    source = review["source"]
    source_rows = []
    for row in source["rows"]:
        cells = "".join(f'<td class="source-cell">{escape(cell)}</td>' for cell in row["cells"])
        number = _text(row["row"])
        source_rows.append(
            f'<tr id="{prefix}source-row-{number}"><th scope="row">{number}</th>{cells}</tr>'
        )
    original_rows = _table("CSV 원본 행", ["행", *source["headers"]], source_rows)
    if not source_rows:
        original_rows = '<p class="empty">제출된 측정 행이 없습니다.</p>'
    inputs = review["inputs"]
    inputs_rows = [
        f'<tr><th scope="row">{label}</th><td>{_text(inputs[key]["path"])}</td>'
        f'<td><code class="hash">{_text(inputs[key]["sha256"])}</code></td></tr>'
        for key, label in (("requirements", "검사 기준"), ("mapping", "열 매핑"), ("measurements", "CSV"))
    ]
    provenance = _table("입력 파일", ["입력", "보관 경로", "SHA-256"], inputs_rows)
    return (
        f"<h3>구매자 검사 기준</h3>{requirements}<h3>CSV 원본 행</h3>{original_rows}"
        f'<h3>입력 파일</h3><p>판정 규칙 버전 {_text(review["rule_version"])}</p>{provenance}'
    )


def render_review(review):
    """Return a self-contained report showing findings and their source rows."""
    results = _section("results", "구매자 기준 판정", _result_tables(review))
    evidence = _section("evidence", "검사 근거", _evidence(review))
    return _page(
        "협력사 검사성적서 검토", _identity(review), results + evidence,
        [("results", "판정 결과"), ("evidence", "검사 근거")],
    )


def _comparison_cell(row, prefix, anchors, *, unmatched):
    if row is None:
        return "—"
    if unmatched:
        return _source_links([row["row"]], prefix) + _reasons(row["reasons"])
    supplier = _text(row["supplier_result"])
    return (
        f'{_status(row["computed_result"])} <span class="num">{_measurement(row)}</span>'
        f'{_deviation(row)}<span class="secondary">허용 범위 {_limits(row)} · 공급사 판정 {supplier}</span>'
        f'{_reasons(row["reasons"])}'
        f'<span class="secondary">{_result_links(row, prefix, anchors)}</span>'
    )


def _comparison_table(comparison, *, unmatched=False):
    label = "대조 제외 행의 변경" if unmatched else "필수 항목의 변경"
    entries = comparison["unmatched_changes" if unmatched else "changes"]
    if not entries:
        return f'<h3>{label}</h3><p class="empty">변경 또는 미해결 항목이 없습니다.</p>'
    before_anchors = _requirement_anchors(comparison["before"], "before-")
    after_anchors = _requirement_anchors(comparison["after"], "after-")
    rows = []
    for entry in entries:
        item = (entry["after"] or entry["before"]) if unmatched else entry
        kind = _text(CHANGE_TYPES.get(entry["kind"], entry["kind"]))
        before = _comparison_cell(entry["before"], "before-", before_anchors, unmatched=unmatched)
        after = _comparison_cell(entry["after"], "after-", after_anchors, unmatched=unmatched)
        rows.append(
            f'<tr><th scope="row">{_text(item["characteristic"])}'
            f'<span class="secondary">{_text(item["sample"])}</span></th>'
            f'<td class="narrow">{kind}</td><td>{before}</td><td>{after}</td></tr>'
        )
    return f"<h3>{label}</h3>" + _table(label, ["특성 · 표본", "구분", "이전 제출", "새 제출"], rows)


def render_diff(comparison):
    """Return an offline comparison with separate anchors for both submissions."""
    before = comparison["before"]
    after = comparison["after"]
    heading = (
        f'<div class="compare-identities"><div><h2>이전 제출</h2>{_identity(before)}</div>'
        f'<div><h2>새 제출</h2>{_identity(after)}</div></div>'
    )
    mode = comparison["mode"]
    if mode == "comparison":
        result = _comparison_table(comparison) + _comparison_table(comparison, unmatched=True)
        title = "수정본 재검토 목록"
    else:
        title = "전체 재검토 필요" if mode == "full_review_required" else "별도 검토 건"
        explanation = (
            "새 제출의 모든 필수 항목을 다시 확인하세요."
            if mode == "full_review_required"
            else "두 제출의 검토 건 식별 정보가 다릅니다."
        )
        result = (
            f'<div class="notice"><p>{explanation}</p>{_reasons(comparison["reasons"])}</div>'
            f'<h3>새 제출의 판정 결과</h3>{_result_tables(after, "after-")}'
        )
    main = (
        _section("comparison", title, result)
        + _section("before-evidence", "이전 제출 근거", _evidence(before, "before-"))
        + _section("after-evidence", "새 제출 근거", _evidence(after, "after-"))
    )
    return _page(
        "협력사 검사성적서 비교", heading, main,
        [("comparison", "재검토 목록"), ("before-evidence", "이전 근거"), ("after-evidence", "새 근거")],
    )
