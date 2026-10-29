# 고객 첫 실행 안내

이 안내는 쓰기 권한이 있는 로컬 소스 체크아웃에서 **환경 확인 → 검증 샘플 생성 → Studio 확인**까지 진행한다. 저장소 개발용 전체 테스트나 `npm link`는 첫 산출물을 만드는 데 필요하지 않다.

현재 직접 검증한 실행 경로는 macOS + FreeCAD 1.1.x다. Windows/Linux는 별도 환경 검증이 필요하다. Node.js 24 이상을 준비하고, FreeCAD는 [공식 다운로드](https://www.freecad.org/downloads.php)에서 별도로 설치한다. 이 프로젝트가 FreeCAD 설치 프로그램을 자동으로 실행하거나 재배포하지는 않는다.

## 1. 설치와 환경 확인

배포받은 소스 폴더 또는 저장소 루트에서 실행한다.

```bash
npm ci
npm run customer:quickcheck
```

기본 quickcheck는 프로그램이나 패키지를 설치하지 않고, CAD 파일도 만들지 않는다. 필요한 소스 파일과 실제 FreeCAD 런타임 탐지·프로브 결과를 확인한다.

- `ready`: 환경 확인 성공. 아직 샘플 모델을 생성한 것은 아니다.
- `blocked`: 런타임을 찾지 못했거나 프로브·소스 파일 확인 실패. 표시된 해결 안내를 적용한 뒤 같은 명령을 다시 실행한다.

필요하면 더 자세한 진단을 실행한다.

```bash
npm run check:runtime
```

FreeCAD가 자동으로 발견되지 않으면 진단이 안내하는 `FREECAD_*` 실행 경로 설정을 확인한다. [플랫폼 지원 범위](support-matrix.md)를 참고하고, 다른 플랫폼에서 런타임이 발견됐다는 이유만으로 전체 워크플로우 검증 완료라고 판단하지 않는다.

## 2. 실제 검증 샘플 생성

```bash
npm run customer:quickcheck -- --create-demo
```

기존 `quality_pass_bracket.toml`을 고유한 `output/customer-demo/run-*` 폴더에 복사하고, 출력 위치만 바꿔 기존 `create --strict-quality` 경로를 실행한다. 원본 예제와 기존 생성 결과를 덮어쓰지 않는다.

`demo_passed`는 다음을 모두 확인한 경우에만 표시된다.

- create 명령이 정상 종료했다.
- STEP과 STL 파일이 실제로 존재하고 비어 있지 않다.
- create-quality JSON이 기존 스키마를 만족하고 품질 검사에 통과했다.
- STEP 재읽기와 STL 검사에 대한 런타임 근거가 있다.
- 기존 output-manifest와 artifact-manifest가 유효하고, 등록된 파일 크기·해시가 실제 산출물과 일치한다.

화면에 표시되는 `step`, `stl`, `create_quality`, `output_manifest`, `artifact_manifest` 경로를 열어 확인한다. 실제 경로는 실행마다 다르므로 예시 폴더 이름을 복사하지 말고 명령이 출력한 경로를 사용한다. 마지막 `Next:` 줄에는 Studio를 여는 `npm run serve` 명령이 나온다. 추가 `inspect` 명령은 별도 분석 실행이며 기본 출력 위치에 매니페스트를 만들 수 있으므로 기존 결과 경로를 확인하고 사용한다.

`demo_failed`면 같은 출력 폴더의 `create.stdout.log`, `create.stderr.log`와 진단을 확인한다. 실패를 성공으로 바꾸거나 품질 검사를 건너뛰지 않는다. 재실행은 새 폴더를 만든다.

이 샘플은 설치·생성·내보내기 검증이다. 모든 부품 형상, 도면·FEM·보고서 기능, 제조 준비도 또는 실물 검사를 검증한 결과는 아니다.

## 3. Studio에서 시작

```bash
npm run serve
```

[로컬 Studio](http://127.0.0.1:3000/studio)를 연다. `localhost`가 다른 프로세스를 가리키면 안내된 `127.0.0.1` 주소를 사용한다.

1. 콘솔의 **검증된 브래킷으로 시작**에서 검증 브래킷 예제를 불러온다.
2. **먼저 추적 생성 실행**을 누른다. 영어 UI에서는 **Run tracked create first**다.
3. 작업 센터에서 완료 여부를 확인하고, 패키지/산출물 화면에서 실제 생성 파일과 품질 결과를 확인한다.
4. 런타임이 없으면 콘솔의 런타임 상태 카드에 나오는 해결 방법을 적용한 후 **상태 새로고침**을 누른다. API 연결 실패와 FreeCAD 런타임 미준비는 별개의 상태다.

명령행 데모는 파일 생성 경로이고, Studio의 추적 작업 이력에 자동 등록되는 작업은 아니다. Studio에서 실행한 추적 생성은 별도의 작업 기록을 만든다. 체크인된 canonical 패키지는 계속 읽기 전용 예제이며, 새 데모 생성이 그 패키지의 readiness 보류를 해제하지 않는다.

Studio의 **작업 성공**은 해당 작업의 실행 성공이다. 작업에 create-quality 또는 보고서 품질 근거가 없으면 Quality/Ready가 `Unknown`으로 표시될 수 있으며, 이를 품질 통과로 읽지 않는다. 위 명령행 데모의 `demo_passed`는 별도로 strict 품질 검수와 실제 산출물 근거를 확인한 결과다.

## 지원을 위한 진단 저장

지원 요청 전에 경로를 가린 JSON을 직접 저장할 수 있다. npm 배너가 섞이지 않도록 `--silent`를 사용한다.

```bash
npm run --silent customer:quickcheck -- --json > customer-quickcheck.json
```

`--json`은 진단 출력 형식만 바꾼다. CAD 생성이 필요할 때만 `--create-demo`를 함께 지정한다. JSON의 런타임 경로는 가려지며, 원시 생성 로그는 로컬 출력 폴더에 남는다. 파일을 외부로 보내는 기능은 없으므로 지원에 공유할 내용은 사용자가 선택한다.

## 개발 검증과 판매 범위

전체 Node/Python/PDF/브라우저 검증은 [개발 테스트 안내](testing.md)를 따른다. Python·PDF 테스트 환경은 첫 STEP/STL 샘플 생성과 구분된다. 소스 체크아웃의 검증 명령과 npm 패키지의 CLI 진입점 검증을 혼동하지 않는다.

가격·지원 시간·고객별 검수 기준은 [유료 파일럿 제안](commercial-pilot.ko.md)에 있다. 제안 가격은 실제 고객의 지불 의사나 절감 효과가 검증된 가격이 아니다.
