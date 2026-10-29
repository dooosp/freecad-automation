# 99만 원 파일럿 고객 안내 키트

가격은 **990,000원, 부가세 별도**다. 고객에게 제공하는 것은 합의한 부품군의 설치·설정·검수·인계와 제한된 지원이다. 소스는 계속 MIT 라이선스로 제공된다. 이 키트는 실제 고객의 구매나 고객 부품의 검수 완료를 뜻하지 않는다.

## 고객에게 보여줄 자료

| 자료 | 용도 |
| --- | --- |
| [소개 페이지 원본](../../public/pilot/index.html) | 가격, 적용 대상, 인도물, 적합성 확인, 다운로드와 공개 문의 |
| [고객 제안서 PDF](../../public/pilot/assets/pilot-proposal.ko.pdf) | 미팅 전 전달하거나 화면 공유할 3쪽 A4 제안서 |
| [제안서 편집 원본](pilot-proposal.ko.md) | 문구를 수정한 뒤 아래 명령으로 PDF 재생성 |
| [15분 데모 진행안](pilot-demo.ko.md) | 실제 명령, 설명 멘트, 기대 결과, 실패 대응, 인계 검수표 |
| [데모 다운로드 사본](../../public/pilot/assets/pilot-demo.ko.md) | 소개 페이지에서 내려받을 같은 진행안 |

저장소 루트에서 실행한다.

```bash
npm ci
npm run serve
```

[고객 소개 페이지](http://127.0.0.1:3000/pilot/)를 연다. Studio는 기존 `/studio` 경로를 그대로 사용한다. 소개 페이지는 FreeCAD 실행 없이 읽을 수 있으며, `public/pilot/` 폴더만 일반 정적 웹 호스팅에 올려도 동작한다. 파일을 직접 더블클릭하는 대신 HTTP로 열어야 `offer.json`과 다운로드가 정상 동작한다.

페이지의 적합성 확인은 브라우저 안에서만 처리한다. 문의 버튼은 GitHub의 **공개 이슈 작성 화면**을 열 뿐, 자동 제출하지 않는다. 개인정보·연락처·고객명·도면·모델·치수·기밀 자료를 올리지 않는다. 상세 자료 전달 방법은 별도로 합의한다. `.github/ISSUE_TEMPLATE/pilot-inquiry.yml`은 기본 브랜치에 반영된 뒤 선택 가능한 양식이며, 페이지의 사전입력 문의 링크는 양식 활성화에 의존하지 않는다.

## 조건을 수정할 때

[offer.json](../../public/pilot/offer.json)이 가격·한도·지원 환경·검수 범위의 기준이다. PDF는 이 파일과 편집 원본에서 생성한다. 페이지의 JavaScript 미사용 시 표시 문구와 데모 문서도 같이 맞춘다. 고객에게는 제안서만 보내고, [내부 가격 검토](../commercial-pilot.ko.md)의 가정 원가·회수 기간을 고객 실적처럼 소개하지 않는다.

PDF 생성기는 저장소에 포함한 OFL 라이선스의 나눔고딕을 부분 포함한다. 수신자의 한글 글꼴 설치 여부에 의존하지 않는다. 개발용 Python 환경에서 실행한다.

편집 원본의 `{{...}}`는 `offer.json` 값이고 `:::offer`, `:::scope` 등은 PDF 레이아웃 지시자다. 원본을 바로 전달하기보다 PDF를 다시 생성해 전달한다.

```bash
python3 -m pip install -r scripts/requirements-pilot-proposal.txt
python3 scripts/build-pilot-proposal.py
python3 scripts/build-pilot-proposal.py --check
cp docs/sales/pilot-demo.ko.md public/pilot/assets/pilot-demo.ko.md
```

`--check`는 현재 원본·조건·생성기에서 만든 PDF와 저장된 PDF가 같은지 확인한다. PDF를 바꾼 뒤에는 Poppler 등으로 모든 페이지를 렌더링해 한글·줄바꿈·잘림을 확인한다. 데모 사본은 원본과 같아야 한다.

## 판매 전 실행 확인

```bash
npm run customer:quickcheck
npm run customer:quickcheck -- --create-demo
```

`ready`는 환경 준비, `demo_passed`는 공개 샘플의 실제 생성·strict 품질 검증 성공이다. Studio 작업의 `succeeded`나 `Quality: Unknown`을 품질 통과로 설명하지 않는다. 고객 파일럿의 최대 10개 입력 조합은 고객과 합의한 후 별도로 검수한다. 제조 승인·실물 검사·안전성 인증은 제공 범위가 아니다.

저장소 회귀 검사는 [개발 테스트 안내](../testing.md)를 따른다. 추가로 소개 페이지의 데스크톱·모바일 화면, 적합성 확인과 자료 다운로드, PDF 전 페이지, 공개 문의의 안내 문구를 확인한다.

## 호스팅 미리보기

[Sites 미리보기](https://freecad-pilot-990-20261029.jangho1383.chatgpt.site)는 소유자 전용 비공개 배포다. 고객이 접근할 공개 URL로 안내하지 않는다. 고객에게 PDF·진행안을 직접 전달하거나 `public/pilot/`을 고객 접근이 가능한 정적 호스팅에 배포할 수 있다.

- Sites project ID: `appgprj_6ae34fb99c8881919dd4e3637aeb9f5f`
- 정적 배포 원본: `public/pilot/`
- Sites 작업 폴더: 무시되는 `tmp/codex/pilot-site-source/`, 정적 디렉터리 `dist/`
- 기존 Site를 갱신할 때 위 ID를 재사용하고, 별도 소스 저장소의 `.openai/hosting.json` 및 접근 범위를 유지한다. 이 프로젝트의 Git 원격은 바꾸지 않는다. 접근 토큰은 파일이나 커밋에 저장하지 않는다.
