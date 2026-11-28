# 협력사 검사성적서 재검토

협력사가 제출한 CSV의 측정값을 구매자의 개정별 검사 기준과 대조합니다. 결과는 로컬 JSON과 한국어 HTML로 저장됩니다. 수정본을 받으면 달라진 표본, 사라진 측정값, 미해결 항목을 확인할 수 있습니다.

1~4단계의 구현 범위와 5단계 실전 비교의 판정 기준은 [수입검사 도구 개발 계획](../../docs/exec-plans/supplier-inspection-refactoring.ko.md)에서 확인할 수 있습니다.

## 설치

Python 3.9 이상에서 동작하며 실행 의존성은 Python 표준 라이브러리입니다. 저장소에서 이 디렉터리만 복사해 설치할 수 있습니다.

```sh
python3 -m venv .venv
. .venv/bin/activate
python -m pip install .
```

패키지 설치를 위한 빌드 도구가 없는 환경에서는 소스만으로도 실행할 수 있습니다.

```sh
PYTHONPATH=src python3 -m incoming_inspection --help
```

## 가상 성적서로 사용해 보기

패키지 디렉터리에서 실행합니다. `--out`은 상위 폴더가 이미 존재하는 새 경로를 지정합니다.

```sh
incoming-inspection review --requirements tests/fixtures/requirements.json \
  --mapping tests/fixtures/supplier-a.json --measurements tests/fixtures/first.csv \
  --supplier A --lot L42 --out review-01

incoming-inspection review --requirements tests/fixtures/requirements.json \
  --mapping tests/fixtures/supplier-a.json --measurements tests/fixtures/revised.csv \
  --supplier A --lot L42 --out review-02

incoming-inspection diff review-01/review.json review-02/review.json --out changes
```

`review-01/review.html`에서 S1은 상한과 같은 범위 내, S2는 공차 초과 및 공급사 판정과 불일치, S3은 누락으로 표시됩니다. 보고서에서 측정값이 적힌 원본 행을 확인할 수 있습니다. `changes/diff.html`에서는 S2가 10.20 mm에서 10.02 mm로 바뀌고 S3은 미해결로 남습니다. 예제 수치는 가상입니다.

## 실제 파일 준비

| 파일 | 입력 |
| --- | --- |
| 검사 기준 JSON | `part`, `revision`, `characteristics`. 각 특성에는 `id`, `drawing_ref`와 `samples`를 입력하고, 치수에는 `unit`, `lower`, `upper`를 지정합니다. 표본 ID는 문자열입니다. 한계는 양끝을 포함하는 절대 치수이며 소수 문자열로 입력할 수 있습니다. |
| 열 매핑 JSON | `part`, `revision`, `lot`, `sample`, `characteristic`, `value`, `unit`에 CSV 헤더 이름을 연결합니다. `supplier`와 `supplier_result`는 선택 항목입니다. 한글·영어 양식은 가상 예제를 참고할 수 있습니다. |
| 측정 CSV | UTF-8, 한 제출당 한 부품·개정·로트. 단위는 `mm`, `inch` 또는 `in`을 씁니다. 공급사 판정으로 `합격`·`불합격`, `pass`·`fail`, `ok`·`ng`를 인식합니다. |

부품·개정·로트 또는 명시된 공급사가 접수 정보와 다르면 해당 행은 별도 예외 목록에 표시됩니다. 잘못된 단위나 한계, 중복 측정은 판정 불가로 표시합니다. 결과는 입고 담당자의 검토 자료입니다.

각 검토 폴더의 `inputs/`에 기준·매핑·측정 파일의 원본 바이트가 저장됩니다. `review.json`은 각 파일의 SHA-256과 규칙 버전을 기록합니다. 동일 입력을 다른 새 폴더에서 실행하면 같은 JSON을 생성합니다. 행 번호는 헤더를 제외한 1부터 시작하는 CSV 레코드 번호입니다. 비교 시 기준·매핑·규칙 버전이 달라지면 전체 재검토 대상으로 표시합니다. 부품·개정·로트·공급사가 다르면 별건으로 표시합니다.

`review`나 `diff`가 결과를 생성하면 0을 반환합니다. 결과 안에 검토 항목이 있어도 파일 생성 성공 여부는 같습니다. 입력 파일이나 출력 경로를 처리할 수 없으면 종료 상태 2를 반환합니다.

## 테스트

```sh
PYTHONPATH=src python3 -m unittest discover -s tests
```
