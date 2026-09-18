# FreeCAD–MVS 품질보증 연동 Implementation Plan

> **실행자:** `superpowers:executing-plans`로 아래 작업을 순서대로 수행한다. 새 하위 에이전트는 만들지 않는다. 체크박스는 실제 실행·검증 후에만 완료 처리한다.

**Goal:** Coolgear 장착판 R1 한 부품의 설계 기준을 MVS의 합성 이미지 검사·특징 연결·검토 기록·검증 ZIP까지 연결하고 품질보증 사례로 설명한다.

**Architecture:** 기존 FreeCAD producer와 MVS의 읽기 전용 importer를 사용한다. FreeCAD는 실제 기준 형상을 읽어 고정 뷰와 8개 검사 영역을 내보내고, MVS는 그 영역을 불변 case 기준으로 저장해 분석·표시·내보내기·재가져오기에 사용한다. 두 저장소는 파일 묶음과 명시적 계약으로 연결한다.

**Tech Stack:** FreeCAD/Python, 기존 Node ES modules·runner·output-manifest, MVS Python/FastAPI/SQLite/JSON Schema/Pillow/NumPy, React/TypeScript, pytest·기존 Node tests.

**Spec:** [연동 설계와 사실 근거](../architecture/freecad-mvs-qa-integration.md).

작성일: 2026-09-18. **최초 작성 당시에는 계획 문서였으며, 아래 체크 표시는 후속 실행 근거를 반영한다.** G0–G5 실행 결과와 G6 자료는 [품질보증 사례](../portfolio/freecad-mvs-qa-case.ko.md)에 기록한다. 디지털 연동 완료, 탐지 성능 한계, 재검사 보류, 실물 미시험을 구분한다. MVS 전체 검증은 E1 구현 해시 불일치로 HOLD이며, 전체 PASS나 병합 승인을 뜻하지 않는다. 실제 ChatGPT `6 Pro` 리뷰를 받아 [종합 판단](../architecture/freecad-mvs-qa-integration.md#8-chatgpt-pro-리뷰와-최종-판단)에 반영했다. Pro 자문은 설계 리뷰이며 독립 코드 실행/시험이 아니다.

## Global Constraints

- 첫 대상: 장착판 R1 한 부품, 상면 한 뷰, `hole_H1`–`hole_H4`/`hole_P1`–`hole_P4` 8개 특징.
- 초기 제안 식별: `part_id=USB-REF-ADAPTER`, `cad_revision=R1`. 기존 원본 식별자/파일명과 대응만 추가한다.
- 현재 `physical_test=not_tested`, `manufacturing_release=false`, 실제 하중 정격·토크 `null` 유지.
- MVS 입력은 기존 adapter의 JSON/PNG 계약. 원본 CAD 실행·매크로·자동 쓰기 반환 없음.
- FreeCAD 기존 Node → Python → FreeCAD 구조와 `artifact-manifest`/`output-manifest` 계약 유지.
- MVS 현재 dirty 후보 선택 파일, frozen E1 설정·연구 결과·기존 v0.1.0 묶음 보존.
- 이전 QA HOLD는 해당 커밋의 기록으로 유지. 범위 내 통과를 전체 저장소 통과나 HOLD 해제로 바꾸지 않는다.
- 기준 자료 변경은 새 근거·새 리비전/case로 기록. 과거 기록의 ID나 해시를 바꿔 재사용하지 않는다.
- 구현 작업마다 소유 저장소·파일을 명시한다. 다른 저장소는 읽기 전용 입력으로 다룬다.
- 제어 파일은 작업 저장소의 `tmp/codex/`, 생성 결과는 `output/` 또는 MVS의 기존 ignored 로컬 자료 경로에 둔다.
- 코드 변경은 관련 실패 재현 → 최소 수정 → 회귀 검증 → 읽기 전용 diff 검토 → 작은 커밋 순서다. 원격 반영/PR 상태는 실제 Git 근거로 기록한다.

## 1. 권장 순서

**FreeCAD의 첫 업그레이드는 검사 기준 내보내기로 한정한다. 그 전에 MVS의 기준 버전과 검사 영역 전달 계약을 확인한다.**

| 단계 | 주 작업 | 완료 결과 | 선행 |
|---|---|---|---|
| G0 | 버전 고정·기본 경로 검증·의존 확인 | 사용 커밋과 통합 착수 근거 보고서 | 없음 |
| G1 | 8개 특징 소실 재현·이미지 좌표 계약 | 의도된 RED와 양쪽의 고정 계약/fixture | G0 |
| G2 | FreeCAD 내보내기 | CAD 근거를 가진 JSON/PNG 4파일 | G1 |
| G3 | MVS 기준 저장·영역 전달 | 기본 예제 대신 실제 8개 영역으로 분석 | G1; G2는 실제 입력 검증에 필요 |
| G4 | 결과·검토·ZIP·화면 연결 | 입력부터 재가져오기까지 동일성 확인 | G2+G3 |
| G5 | 합성 평가와 변경 사례 | 놓침/오검출·잘못된 리비전·재검토 목록 | G4 |
| G6 | 품질보증 포트폴리오 | 근거 연결표·시정조치 사례·재현 시연 | G5 |

G2와 G3는 계약이 고정되면 독립 개발 가능하지만 기본 실행은 순차로 한다. 범용 장치 확대·AI 학습·대규모 UI 개편·클라우드·카메라/PLC·실물 시험은 후속 별도 범위다.

## 2. 기준 저장소와 파일 지도

작업 시작점 후보는 FreeCAD `a4a1a3f696deaf260cc8b2879d98d9c2ffd0e8b8`, MVS `3ced81cd94edf1f15f80ce140eab59a267867b17`이다. 이 SHA는 계획 입력이며 검증을 생략할 권한이 아니다. 구현 시 원래 dirty 작업 트리를 보존하고 선택한 SHA의 별도 작업 트리를 사용한다. 새 브랜치 이름은 `codex/` 접두사를 사용한다.

### FreeCAD 소유 파일

| 종류 | 경로 | 책임 |
|---|---|---|
| 기존 재사용 | `lib/runner.js`, `lib/output-manifest.js` | `runScript`, 기존 manifest 작성 |
| 기존 입력 | `configs/examples/usb_hub_reference_mount.json` | 기준 형상·안정적인 feature ID |
| 신규 | `scripts/export-mvs-reference.js` | 명시적 입력/출력 경로, Python 실행, 해시·manifest |
| 신규 | `scripts/export_mvs_reference.py` | 실제 판 형상 읽기·측정·상면 투영 자료 |
| 신규 | `scripts/mvs_reference_projection.py` | 순수 좌표 변환·ROI 계산·투영 검사 |
| 신규 시험 | `tests/mvs-reference-export.test.js`, `tests/test_mvs_reference_projection.py`, `tests/test_mvs_reference_runtime.py` | 계약·좌표·실제 FreeCAD export 검증 |

첫 producer는 명시적 개발용 스크립트로 추가한다. 검증되기 전에 기존 `fcad create/draw`의 기본 동작이나 Studio 경로를 바꾸지 않는다. 정식 CLI 승격은 기존 command manifest를 사용하는 후속 작업이다.

### MVS 소유 파일

| 종류 | 경로 | 책임 |
|---|---|---|
| 신규 | `src/manufacturing_vision_studio/cad_binding.py` | 순수 프로파일 검증·불변 바이트 연결·영역 변환 |
| 수정 | `src/manufacturing_vision_studio/adapters.py` | 같은 검증 스냅샷으로 reference와 binding 전달 |
| 수정 | `src/manufacturing_vision_studio/registry.py` | 원자적 binding 저장·case/analysis 연결 |
| 기존 재사용 | `src/manufacturing_vision_studio/model.py` | 명시적 `feature_regions` 인자; 알고리즘 교체 없음 |
| 수정 | `src/manufacturing_vision_studio/evidence.py` | CAD binding payload·교차 검증·재가져오기 |
| 계약 검토/필요시 수정 | `schemas/v1/inspection-case.schema.json`, `schemas/v1/analysis-result.schema.json`, `schemas/v1/evidence-bundle-manifest.schema.json` | 기존 optional binding 사용 및 필요한 버전 확장 설계 |
| 신규 시험 | `tests/test_freecad_feature_binding.py`, `tests/test_coolgear_integration.py` | 소프트웨어 누락·반례·연결 흐름 |
| 기존 시험 확대 | `tests/test_evidence_bundles.py`, `tests/test_registry_fail_closed.py`, `tests/test_dispositions.py` | 보존·실패 원자성·오래된 판정 방지 |
| 좁은 UI 수정 | `web/src/types.ts`, `web/src/components/InspectionWorkspace.tsx`, `web/src/components/EvidencePanel.tsx`, `web/src/copy.ts` | 실제 feature ID·리비전·합성 자료 표시 |

이 경로 목록은 **향후 수정 계획**이다. 새 파일은 이번 계획 작성에서 만들지 않는다. 스키마의 닫힌 객체를 임의 확장하지 않으며 incompatible 변화가 필요하면 새 버전과 legacy reader를 함께 정의한다.

## G0. 사용할 버전과 통합 착수 근거

**Files:** 각 저장소의 `tmp/codex/freecad-mvs-baseline/`.

**Consumes:** 위 후보 커밋, 원래 dirty 상태, 별도 `9020ea4` HOLD 기록.

**Produces:** `baseline.json`에 실제 선택 SHA/branch/runtime/명령/exit code, `integration-entry-report.md`에 기본 경로·공유 의존성·현재 feature 전달 누락·HOLD 적용 범위 기록.

- [x] **1. 원본 상태를 읽고 고정한다.** 각 저장소에서 아래 명령을 실행하고 결과·dirty diff 해시를 자신의 제어 폴더에 보존한다.

```sh
pwd
git rev-parse --show-toplevel
git branch --show-current
git rev-parse HEAD
git status --short
git diff --name-only HEAD
```

- [x] **2. 선택 SHA의 clean 작업 트리에서 관련 기본 검사를 실행한다.** 기존 working copy, 후보 선택 파일, 별도 수리 worktree는 변경하지 않는다.

```sh
# FreeCAD 작업 트리
npm test
npm run check:source-hygiene

# MVS 작업 트리
uv run ruff check .
uv run mypy src
uv run pytest tests/test_model_contract.py tests/test_registry_fail_closed.py tests/test_evidence_bundles.py tests/test_dispositions.py tests/test_api_fail_closed.py tests/test_schema_contracts.py tests/test_study_package_import_closure.py
npm --prefix web run check
```

- [x] **3. 소스 경로와 공유 의존성을 확인한다.** `adapters.import_reference → registry.add_reference`, `registry.analyze_case → model.inspect`, `registry._case_document`의 기본 ID와 기존 import-closure 시험을 읽는다. 선택 커밋과 별도 HOLD 커밋의 차이를 대조한다. 어댑터·저장·분석·evidence 경로에 공유되는 실패인지 명시하고 근거 경로를 보고서에 적는다.

- [x] **4. 실패를 분류한다.** 기본 경로 자체 실패와 새 연동 요구의 예상 RED를 구분한다. 영향 없는 다른 커밋의 E1 HOLD는 이력으로 보존한다. 실제 통합 의존 경로의 실패는 수리 범위를 정한 별도 작업으로 기록한다. 재현되지 않은 과거 실패를 현재 결과로 옮기지 않는다.

**완료 기준:** 정확한 커밋에서 기본 경로와 의존 영향이 판정되어 G1을 시작할 수 있다. 관련 실패 또는 영향 불명확성이 있으면 그 범위의 수리를 기록한다. 새로운 8-feature 요구의 RED는 G1에서 재현하며 기능 미구현 증거이지 G0 착수를 막는 기존 회귀가 아니다. 첫 실제 실행 작업은 이 G0 보고서 한 건이다.

## G1. 계약과 독립 투영 검사

**Files:** FreeCAD 신규 `docs/reference-data/mvs-coolgear-profile-v1.json`, `tests/fixtures/mvs-reference/profile-v1.json`, `tests/test_mvs_reference_projection.py`; MVS 신규 `tests/cad_binding_fixtures.py`, `tests/test_freecad_feature_binding.py`, `src/manufacturing_vision_studio/cad_binding.py`.

**Consumes:** 기존 adapter v1 schema, 실제 R1 구멍 좌표·지름, 설계 문서 §4.

**Produces:** 양쪽이 고정한 `coolgear-plate-top/v1` 프로파일과 동일 fixture 해시. 새 해시 필드의 의미·스키마 버전 결정 기록.

- [x] **1. 형상/뷰 규칙을 고정한다.** 1520×840, 10 px/mm, 5 mm 여백, Y 반전, 사각형 ROI의 양의 크기, 8개 고유 ID, finite 좌표 및 0–1 범위, native 단위 mm를 선언한다.
- [x] **2. 구현과 독립적인 기대값으로 투영 시험을 작성한다.** 아래 함수와 인자는 신규 순수 모듈의 계약이다.

```python
# scripts/mvs_reference_projection.py의 제안 인터페이스
def project_point(x_mm: float, y_mm: float) -> tuple[float, float]:
    return 10.0 * (x_mm + 5.0), 10.0 * (79.0 - y_mm)

def test_three_independent_reference_points():
    assert project_point(0.0, 0.0) == (50.0, 790.0)
    assert project_point(142.0, 0.0) == (1470.0, 790.0)
    assert project_point(0.0, 74.0) == (50.0, 50.0)
    assert project_point(29.0, 24.4) == (340.0, 546.0)
```

- [x] **3. MVS fixture helper와 특징 전달 RED를 만든다.** 아래 fixture는 현재 v1 adapter 경계를 통과시키기 위한 합성 계약 자료다. 실제 native CAD export와 구분한다. G1의 프로파일 의미 검증을 추가할 때에도 이 구분과 실제 생성 바이트를 유지한다.

```python
# tests/cad_binding_fixtures.py
from hashlib import sha256
from pathlib import Path
import json
from PIL import Image, ImageDraw


def json_bytes(value):
    return (json.dumps(value, sort_keys=True, indent=2) + "\n").encode()


def write_minimal_cad_export(root: Path) -> Path:
    root.mkdir(parents=True, exist_ok=False)
    identity = {"part_id": "USB-REF-ADAPTER", "cad_revision": "R1"}
    points = [("H1", 29, 24.4, 2), ("H2", 29, 49.6, 2),
              ("H3", 113, 24.4, 2), ("H4", 113, 49.6, 2),
              ("P1", 12, 12, 2.75), ("P2", 12, 62, 2.75),
              ("P3", 130, 12, 2.75), ("P4", 130, 62, 2.75)]
    image = Image.new("RGB", (1520, 840), "black")
    drawing = ImageDraw.Draw(image)
    drawing.rectangle((50, 50, 1470, 790), fill=(180, 180, 180))
    features = []
    for name, x, y, radius in points:
        u, v = 10 * (x + 5), 10 * (79 - y)
        r, margin = 10 * radius, 10 * (radius + 1)
        drawing.ellipse((u-r, v-r, u+r, v+r), fill="black")
        features.append({"feature_id": "hole_" + name,
                         "display_name": name, "feature_type": "hole",
                         "normalized_region": {
                             "x_min": (u-margin)/1520, "y_min": (v-margin)/840,
                             "x_max": (u+margin)/1520, "y_max": (v+margin)/840}})
    image.save(root / "reference.png", format="PNG", compress_level=9)
    upstream = {"kind": "synthetic_contract_fixture", **identity}
    upstream_hash = sha256(json_bytes(upstream)).hexdigest()
    feature_map = {"profile": "coolgear-plate-top/v1", "features": features}
    metadata = {"profile": "coolgear-plate-top/v1", "part_identity": identity,
                "source_kind": "synthetic_contract_fixture",
                "source_manifest_payload": upstream,
                "source_manifest_sha256": upstream_hash,
                "width_px": 1520, "height_px": 840, "units": "mm",
                "cad_to_pixel": [[10, 0, 50], [0, -10, 790], [0, 0, 1]]}
    (root / "feature-map.json").write_bytes(json_bytes(feature_map))
    (root / "cad-metadata.json").write_bytes(json_bytes(metadata))
    artifacts = []
    for name, role, media in [("reference.png", "reference_render", "image/png"),
                             ("feature-map.json", "feature_map", "application/json"),
                             ("cad-metadata.json", "cad_metadata", "application/json")]:
        data = (root / name).read_bytes()
        artifacts.append({"artifact_id": role, "role": role,
                          "relative_path": name, "media_type": media,
                          "sha256": sha256(data).hexdigest(), "byte_size": len(data)})
    manifest = {"schema_version": "1.0.0",
                "adapter_id": "freecad-automation-read-only-export",
                "adapter_version": "1.0.0", "export_id": "fixture-coolgear-r1",
                "producer": {"system_id": "freecad-automation", "system_version": "1.1.0",
                             "export_schema_version": "1.0.0",
                             "exported_at": "2026-09-18T00:00:00Z"},
                "part_identity": identity, "source_manifest_sha256": upstream_hash,
                "adapter_policy": {"access_mode": "read_only", "copy_on_import": True,
                                   "allow_external_paths": False, "allow_symlinks": False,
                                   "execute_freecad": False},
                "features": features, "artifacts": artifacts,
                "limitations": ["Synthetic contract fixture; no native CAD or physical test."]}
    (root / "freecad-export-adapter-manifest.json").write_bytes(json_bytes(manifest))
    return root
```

```python
# tests/test_freecad_feature_binding.py
def test_imported_feature_ids_reach_case(tmp_path):
    from cad_binding_fixtures import write_minimal_cad_export
    from manufacturing_vision_studio.adapters import FreeCADExportAdapter
    from manufacturing_vision_studio.config import Settings
    from manufacturing_vision_studio.registry import CaseRegistry

    settings = Settings(data_dir=tmp_path / "registry")
    registry = CaseRegistry(settings)
    registry.create_case(part_id="USB-REF-ADAPTER", cad_revision="R1", case_id="case-r1")
    source = write_minimal_cad_export(tmp_path / "source")
    detail = FreeCADExportAdapter(settings).import_reference(
        registry, "case-r1", source, expected_case_revision=1
    )
    expected = [f"hole_{group}{i}" for group in ("H", "P") for i in range(1, 5)]
    assert detail["case"]["feature_ids"] == expected
    assert detail["case"]["freecad_adapter_binding"]["manifest_sha256"]
```

실행 명령은 `uv run pytest tests/test_freecad_feature_binding.py::test_imported_feature_ids_reach_case -q`다. schema·import 실패가 아니라 **기본 예제 feature 목록과 기대한 8개 목록의 차이**에서 실패했는지 확인한다. 이 RED는 G3에서 해소한다. fixture는 테스트가 고정한 예상 해시와 임시 저장소에서만 사용하며 실제 runtime 생산 근거로 승격하지 않는다.
- [x] **4. 중복 ID, 뒤집힌 사각형, NaN, 영역 밖 좌표, manifest/features 불일치, metadata part/revision 불일치, 해시·크기 불일치를 각각 거부하는 시험을 작성하고 최소 validator를 구현한다.** 바이트 검증을 통과해도 의미가 다른 입력은 승인하지 않는다.

```python
# MVS cad_binding.py의 제안 인터페이스
@dataclass(frozen=True)
class CadFeatureBinding:
    manifest_sha256: str
    source_manifest_sha256: str
    feature_map_sha256: str
    metadata_sha256: str
    reference_pixel_sha256: str
    part_id: str
    cad_revision: str
    feature_regions: tuple[tuple[str, float, float, float, float], ...]

def validate_cad_binding(manifest_bytes: bytes,
                         artifacts: Mapping[str, bytes]) -> CadFeatureBinding:
    """Validate the closed profile and return one immutable snapshot."""
```

이 타입은 신규 인터페이스 선언이다. `dataclass`는 표준 `dataclasses`, `Mapping`은 `collections.abc`에서 가져온다. 검증되지 않은 사전이나 변경 가능한 영역을 보관하지 않는다.

- [x] **5. 실행·검토 후 계약을 고정한다.**

```sh
# FreeCAD
node scripts/run-pytest.js -q tests/test_mvs_reference_projection.py
# MVS
uv run pytest tests/test_freecad_feature_binding.py -k contract
uv run ruff check src/manufacturing_vision_studio/cad_binding.py tests/test_freecad_feature_binding.py tests/cad_binding_fixtures.py
uv run mypy src
```

**완료 기준:** profile/fixture/생산자·소비자 해시 의미가 일치한다. 현재 case 전달 RED는 G3에서 해소할 대상으로 남기며 선택한 시험만 통과한 것을 전체 통과라고 하지 않는다. 의도된 RED는 feature 작업 브랜치의 증거로 남기고, 실패가 남은 상태를 green 배포나 merge 대상으로 제시하지 않는다.

## G2. FreeCAD 검사 기준 내보내기

**Files:** 파일 지도의 FreeCAD 신규 3개 스크립트, 관련 3개 시험. 기존 runner/manifest는 재사용한다.

**Consumes:** R1 입력, 실제 판 BREP/STEP, 그 출력의 기존 manifest, G1 프로파일.

**Produces:** 새 출력 폴더의 4개 adapter 파일과 기존 helper로 작성한 output-manifest. 기존 원본 자료는 바이트 단위로 보존한다.

- [x] **1. Node 오케스트레이션의 실패 시험을 먼저 작성한다.** 원본 manifest/CAD의 불일치, 없는 feature, native 검사 실패, 기존 출력 폴더 덮어쓰기를 거부한다. 의도적으로 실패한 native 실행에서 정상 이미지나 pass manifest가 나오지 않아야 한다.
- [x] **2. 다음 명시적 개발 명령을 구현한다.** `--config`, `--model`, `--source-manifest`, `--out-dir`는 필수다. `--part-id`와 `--cad-revision`은 metadata와 맞춰 검증한다. 새 public `fcad` 명령은 만들지 않는다.

```sh
node scripts/export-mvs-reference.js \
  --config configs/examples/usb_hub_reference_mount.json \
  --model output/usb-hub-reference-mount/cad/usb_hub_reference_adapter_R1.brep \
  --source-manifest output/usb-hub-reference-mount/cad/usb_hub_reference_adapter_R1_manifest.json \
  --part-id USB-REF-ADAPTER --cad-revision R1 \
  --out-dir output/mvs-reference/coolgear-r1
```

위 source-manifest 파일은 계획 시 실제 존재를 확인한 create 출력이다. 실행 시에도 역할/입력/CAD 해시를 재검증하며, 없거나 불일치하면 가짜 manifest로 대체하지 않는다.

- [x] **3. Python에서는 `lib/runner.js`의 `runScript()`와 기존 `_bootstrap` 방식을 통해 FreeCAD를 사용한다.** 실제 판 형상이 유효한 단일 solid인지, 142×74×4인지, 8개 cylinder hole 중심·지름이 입력과 연결되는지 확인한다. 전체 조립체의 첫 객체를 임의로 장착판으로 선택하지 않는다. native 형상에서 얻은 상면 외곽/구멍 투영을 PNG와 ROI에 사용한다.
- [x] **4. staging 폴더에서 바이트를 완성한 뒤 manifest를 쓴다.** Native metadata → PNG/feature-map/cad-metadata → 기존 MVS adapter manifest 순서로 생성한다. 생산 실행 provenance는 `buildOutputManifest()`/`writeOutputManifest()`로 기록한다. 순환 해시를 만들지 않는다.
- [x] **5. 재현·반례·원본 보존을 확인한다.** 실제 구멍 하나를 제거한 별도 입력에서 기대한 hole ID 실패가 발생하는지 확인한다. 같은 입력·환경에서 payload가 같고 변경된 입력에서는 관련 digest가 달라져야 한다. 생성 시간 같은 실행 메타데이터의 차이는 payload 차이와 구분한다.

```sh
node tests/mvs-reference-export.test.js
node scripts/run-pytest.js -q tests/test_mvs_reference_projection.py tests/test_mvs_reference_runtime.py
npm test
npm run check:source-hygiene
```

**완료 기준:** 실제 FreeCAD 실행과 무결성 기록을 가진 exporter가 있다. 이 시점은 producer 완료이며 MVS end-to-end 완료가 아니다.

## G3. MVS 불변 기준 저장과 실제 영역 전달

**Files:** `cad_binding.py`, `adapters.py`, `registry.py`, 필요한 명시적 schema 버전, `test_freecad_feature_binding.py`, `test_registry_fail_closed.py`.

**Consumes:** 검증한 `CadFeatureBinding`과 원본 payload snapshot, 기존 case identity/revision.

**Produces:** 실제 `freecad_adapter_binding`을 가진 case, 8개 영역을 사용한 analysis, 기존 합성 case의 호환 동작.

- [x] **1. G1 특징 전달 시험을 RED로 확인한다.** 분석 호출에도 영역이 전달되는 spy 시험을 추가한다. 입력 fixture의 8개 ID가 model 호출 인자·case ID 목록·결과 feature 목록에서 같아야 한다.
- [x] **2. registry에 원자적 가져오기 경계를 추가한다.** 제안 인터페이스는 아래와 같다. reference만 먼저 추가하고 나중에 binding을 쓰는 두 번의 공개 mutation으로 구현하지 않는다.

```python
def import_cad_reference(
    self, case_id: str, *, image: IngestedImage,
    binding: CadFeatureBinding,
    payloads: Mapping[str, bytes], expected_case_revision: int,
) -> dict[str, Any]:
    """Publish one matching reference/binding transaction or leave no mutation."""
```

기존 reference가 있는 case의 교체는 첫 버전에서 거부하고 새 case를 사용한다. 새 SQLite binding table은 case ID와 manifest hash를 연결하고 payload는 기존 content-addressed blob 저장을 쓴다. transaction 실패 시 새 blob 정리도 기존 원자성 패턴으로 처리한다.

- [x] **3. 저장된 영역을 분석에 전달한다.**

```python
regions = {row[0]: tuple(row[1:]) for row in binding.feature_regions}
result = active_model.inspect(reference, inspection, feature_regions=regions)
```

반복성 확인용 두 번째 호출에도 같은 `regions`를 사용한다. CAD case의 binding 누락/손상은 오류다. 기존 합성 case만 기존 기본 영역을 유지한다. 분석 cache 재사용은 영상·구성·binding의 일치가 확인될 때만 허용한다.

- [x] **4. binding과 분석 결과의 연결을 명시적으로 버전화한다.** 기존 v1 case의 optional `freecad_adapter_binding`을 사용하되, analysis/evidence에 새 필드가 필요하면 새 버전 schema와 reader를 함께 추가한다. 기존 `configuration_sha256`의 의미나 과거 결과를 재작성하지 않는다. 새로운 CAD case에는 model configuration과 CAD binding 모두 연결되어야 한다.
- [x] **5. 실패 원자성과 legacy 호환을 실행한다.** 다른 부품/리비전, stale case revision, 재해시한 다른 metadata/feature-map, validation 후 파일 변경, binding 없는 CAD case, 복제 ID, invalid 영역은 case/blob 변경 없이 실패해야 한다.

```sh
uv run pytest tests/test_freecad_feature_binding.py tests/test_registry_fail_closed.py tests/test_model_contract.py tests/test_dispositions.py tests/test_api_fail_closed.py tests/test_schema_contracts.py
uv run ruff check .
uv run mypy src
```

**완료 기준:** 8개 feature가 실제 분석까지 전달되고 기존 합성 case가 보존된다. 원자성·해시·identity 시험 실패는 좁은 수리 후 다시 확인한다.

## G4. 검토·결과 묶음·재가져오기·화면

**Files:** `evidence.py`, `test_evidence_bundles.py`, `test_coolgear_integration.py`, 기존 schema reader, 좁은 UI 4파일.

**Consumes:** G3 case/analysis, 실제 검토 또는 명확히 합성으로 표시한 scripted disposition.

**Produces:** export/import/re-export 후 part/revision/8 feature/binding/analysis/disposition이 유지되는 묶음과 한국어 검토 화면.

- [x] **1. 결과 묶음 왕복 시험을 먼저 작성한다.** 새로운 CAD payload 역할을 기존 v1 enum에 무조건 끼워 넣지 않는다. 새 버전이 필요하면 exporter/reader를 함께 추가하고 legacy bundle 검증은 유지한다.
- [x] **2. 기준 payload의 원본 바이트와 hash를 묶음에 포함한다.** 새 registry로 가져온 후 기준 이미지뿐 아니라 manifest·view/ROI·출처 binding이 있어야 한다. 원본 export 폴더에 접근할 수 없어도 보존 자료의 검증이 가능해야 한다.
- [x] **3. 교차 검증을 추가한다.** case의 binding hash, analysis의 binding, manifest/features, 파일 바이트, source image와 reviewer 판정의 analysis hash가 일치해야 한다. 내부 일관성은 실제 CAD 정합성/현장 승인으로 표시하지 않는다.

묶음이 요구하는 evaluation report도 대상 pipeline/configuration과 맞아야 한다. 기존 v0.1.0의 2-image 결과를 Coolgear 검출 성능으로 붙이지 않는다. 이 단계에는 현재 합성 계약 fixture로 수행한 smoke 범위의 기록만 넣고, G5의 별도 평가와 구분한다. 현재 스키마가 미평가/범위 구분을 표현하지 못하면 먼저 명시적 버전 계약으로 해결하며 숫자를 만들어 필수 필드를 채우지 않는다.

- [x] **4. 실제 자료를 화면에 표시한다.** `InspectionWorkspace`와 `EvidencePanel`에 부품·리비전·해당 구멍 ID·CAD 합성 기준·검토 상태를 표시한다. 가져온 특징이 없을 때 예제 구멍이나 예제 heatmap을 실분석처럼 표시하지 않는다. 기존 한국어 copy 구조를 사용한다.
- [x] **5. 왕복과 호환을 확인한다.**

```sh
uv run pytest tests/test_coolgear_integration.py tests/test_evidence_bundles.py tests/test_dispositions.py
npm --prefix web run check
npm --prefix web run test:e2e
```

기존 `test_published_v010_bundle_remains_verifiable_importable_and_exportable`를 보존한다. UI의 기준 이미지/검사 이미지/feature/판정/재가져오기 화면을 실제 브라우저로 확인한다. 자동 시험의 reviewer label은 synthetic임을 기록한다.

**완료 기준:** 한 case가 입력부터 결과 재가져오기까지 이어진다. 모든 필수 확인이 없으면 단순 PNG import 성공만을 연동 완료로 표시하지 않는다.

## G5. 합성 검사·리비전 변경 사례

**Files:** MVS 신규 `scripts/run_coolgear_integration.py`, `tests/test_coolgear_integration.py`, `configs/integration/coolgear-r1-v1.json`, `docs/evaluation/coolgear-integration-protocol.md`; FreeCAD의 별도 R2 demo 입력과 기존 `compare-rev`/`inspection-plan` 결과.

**Consumes:** G4, 사전 고정한 데이터/라벨/모델/threshold, 독립된 정상 R1/R2 기준.

**Produces:** 표본 수와 FP/FN/feature 정오·미매핑·보류·실패를 포함한 합성 결과, 변경 영향과 재검토 항목.

- [x] **1. 작은 smoke 집합의 정상/누락 구멍/이동 구멍/외곽 변화/영상 잡음 시나리오와 별도 평가 seed를 JSON 프로토콜에 먼저 고정한다.** Markdown은 JSON의 설명 문서다. 같은 이미지의 복사·미세 변형을 development/test 양쪽에 나누어 독립 평가인 것처럼 세지 않는다. 정답 마스크 생성 코드는 detector 출력에 의존하지 않는다. 예상 revision은 정상 R1을 유지하고 결함 생성용 CAD hash/revision은 evaluator의 생성 이력에만 기록한다.
- [x] **2. 분석 함수에는 검사 이미지와 사전에 확정된 기준만 넘긴다.** 결함 종류, 정답 feature, 마스크, 결함 생성좌표는 evaluator만 읽는다. ROI는 기준 CAD에서 정하며 검사 결함을 보고 이동시키지 않는다.
- [x] **3. 인식 결과와 무결성 시험을 분리한다.** 현 core의 whole-image threshold `0.0025`에서 작은 구멍 누락이 FN이면 그대로 기록한다. 이를 이유로 frozen E1나 평가용 threshold를 바꿔 PASS로 만들지 않는다. 구멍 하나의 이동과 전체 영상 이동을 나누어 정합이 결함을 흡수하는지 확인한다. 외곽 ROI 없는 edge-change는 feature 기준 미검사/미매핑으로 표시한다. 잘못된 부품/리비전·tamper 차단율을 시각 결함 검출 성능에 합산하지 않는다.
- [x] **4. R2 변경을 재생한다.** 별도 demo config에서 `hole_H4` X좌표를 113→113.5 mm로 바꾼다. R1 권위 기준을 그대로 적용한 비교에서는 기존 0.10 mm 소프트웨어 비교 허용값을 넘어 `fail`이어야 한다. 새 R2 설계 기준이 필요한 경우 그 요구사항 변경을 별도 명시하고 R1 결과와 섞지 않는다. R2는 승인된 실제 설계가 아닌 변경관리 시연 입력이다.
- [x] **5. 기존 변경/검사 계약으로 가능한 연결을 실행한다.** 정상적인 baseline/candidate review pack을 각각 만들고 `compare-rev --impact-out` 및 `inspection-plan --scope delta`를 사용한다. 부족한 권위 입력은 명시적으로 보류한다. 빈 검사 템플릿을 실측 결과로 채우지 않는다.

```sh
# 실제 새 스크립트 구현 후 MVS에서 실행할 제안 명령
uv run python scripts/run_coolgear_integration.py --protocol configs/integration/coolgear-r1-v1.json --out-dir output/coolgear-integration/run-001
uv run pytest tests/test_coolgear_integration.py
```

**완료 기준:** 조건·분모·실패를 숨기지 않는 재현 결과가 있다. 합성 사례의 범위와 실제 제품 품질을 구분한다. `make validate`와 E1 상태는 독립 칸에 실제 실행 결과로 기록한다.

## G6. QA 포트폴리오와 최종 판정

**Files:** FreeCAD 신규 `docs/portfolio/freecad-mvs-qa-case.ko.md`, 출력 자료 `output/freecad-mvs-qa-case/`; MVS 기존 case/evidence 결과의 읽기 전용 참조.

**Consumes:** 실제 G0–G5 로그·원본 파일 hash·사례별 결과. 이전 USB 허브 소프트웨어 치수 추적 오류의 기록.

**Produces:** 요구사항 연결표, 변경·재검토 사례, 시정조치 사례, 한 페이지 요약, 재현 명령과 결과 묶음.

- [x] **1. 요구사항 표를 만든다.** 행 필드는 `requirement_id`, `feature_id`, `source_revision`, `requirement_kind`, `criterion_source`, `method`, `evidence_ref`, `status`, `limitation`으로 고정한다. 제조사 공칭값·설계 선택·소프트웨어 허용값·미확정 실물 기준을 구분한다.
- [x] **2. 실제 소프트웨어 문제 해결을 서술한다.** 해당 기준 입력의 치수 추적 0% 실패 → 분류/연결 조건 원인 → 지름 그룹별 feature 연결 → 해당 입력 100% 및 반례 유지의 근거를 기록한다. 전후 입력·검사항목·분모·커밋을 확인한 경우에만 0→100%를 개선 지표로 쓰고, 조건이 달라졌으면 각각의 결과로 기술한다. 새로운 통합 작업의 성과와 과거 수정 성과를 따로 날짜/커밋으로 연결한다.
- [x] **3. 최종 상태표를 만든다.** producer/consumer/왕복/합성 평가/웹/E1/전체 저장소/물리 시험을 각 행으로 표시한다. 날짜·커밋·명령·종료 코드를 함께 제시한다. 실패·중단·미실행은 PASS로 요약하지 않는다.
- [x] **4. 읽기 전용 최종 검토와 자료 검증을 한다.** 각 변경 저장소에서 검토 전후 `git diff --name-only`와 patch hash를 비교한다. 모든 상대 링크·ZIP CRC·멤버 hash·과거 묶음 보존을 확인한다. 이 계획 자체의 승인과 실제 품질/제조 승인을 혼동하지 않는다.
- [x] **5. 작은 커밋과 정확한 전달 상태를 기록한다.** 문서·코드·fixture만 버전 관리하고 생성 CAD/이미지/DB/로그/원시 ChatGPT 대화는 기존 ignored 경로에 둔다. push/PR/merge는 실제 수행한 범위만 보고한다.

**완료 기준:** 면접에서 한 부품을 선택하여 “왜 이 항목을 검사하는지, 어떤 입력/버전으로 분석했는지, 이상과 미확정을 어떻게 처리하는지, 변경 후 무엇을 다시 확인했는지”를 실제 자료로 보여줄 수 있다.

## 3. 실행 시점의 검증 원칙

- 이번 계획 작성에서 제품 테스트나 실제 연동을 실행하지 않았다. 현재의 static 소스 확인과 이전 검증 기록을 새 실행 결과로 만들지 않는다.
- 각 단계의 새 시험은 RED/GREEN 원문과 정확한 변경 범위를 남긴다. 문서-only 계획에 제품 전체 검사를 반복 실행할 필요는 없다.
- MVS `make validate`는 Ruff → mypy → pytest → web check → E2E를 포함한다. 중간 실패로 뒤 단계가 미도달이면 각 단계 상태를 나눠 기록한다.
- FreeCAD `npm test`는 실제 FreeCAD/물리 시험 전체를 뜻하지 않는다. exporter runtime 검사는 따로 실행한다.
- 고급 E1 문제와 새 기본 연동을 무관하다고 추측하지 않는다. 선택 커밋의 실제 의존·회귀 결과를 확인하여 범위를 판정한다.

## 4. 관련 문서

- [설계와 현재 소스 근거](../architecture/freecad-mvs-qa-integration.md)
- [기준 설계 패키지](../usb-hub-reference-design-package.md)
- [기존 변경 영향 분석](../revision-impact-and-reinspection.md)
- [기존 검사 계획](../inspection-plan-and-supplier-checksheet.md)
- [기존 master 통합 계획](usb-hub-master-integration.md): 별도 작업이며 이번 계획의 선행 전체 작업으로 자동 편입하지 않는다.
