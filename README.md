# WEB SHOOTER

손목에 찬 micro:bit를 컨트롤러로 사용해, 팔을 뻗는 순간 큰 화면에서 웹이 발사되는 피지컬 인터랙션 체험입니다.

실행 주소: <https://choi586.github.io/web-shooter/>

## 포함된 완성품

- 코믹북 야간 도시 스타일의 16:9 전체화면 웹앱
- 35초 자동 세션, 자동 명중, 결과·자동 리셋
- Web Serial 연결과 USB 재연결 상태 안내
- 웹 발사·착탄·결과 효과음
- 왼손/오른손, 30/35/45초, 음소거, 볼륨, 움직임 줄이기
- 자동 데모와 하드웨어 없는 Space 키 대체 입력
- 당일 세션·발사 통계
- 손목 센서 A와 USB 수신기 B용 MakeCode 코드
- 설치·보정 가이드와 상세 PRD

## 필요한 것

- micro:bit v2 2개
- micro:bit A용 손목밴드와 배터리 팩
- micro:bit B용 데이터 전송 USB 케이블
- 최신 데스크톱 Chrome
- 16:9 화면 또는 프로젝터

## 가장 빠른 설치

한 번에 받으려면 [`release/WEB_SHOOTER_microbit_source.zip`](release/WEB_SHOOTER_microbit_source.zip)을 내려받으세요. 손목 센서 A 코드, USB 수신기 B 코드, 보정 설명서가 들어 있습니다.

1. [`microbit/wrist-sensor-a.ts`](microbit/wrist-sensor-a.ts)를 MakeCode JavaScript에 붙여 넣고 손목 센서 A에 다운로드합니다.
2. [`microbit/usb-receiver-b.ts`](microbit/usb-receiver-b.ts)를 별도 MakeCode 프로젝트에 붙여 넣고 수신기 B에 다운로드합니다.
3. A를 손목에 찬 상태로 켜고, 중립 자세에서 기다린 뒤 손목을 꺾은 발사 자세로 B 버튼을 눌러 보정합니다.
4. B를 노트북에 USB로 연결합니다.
5. 웹앱을 최신 Chrome의 직접 HTTPS 주소로 열고 **운영 설정 → micro:bit B 연결**을 누릅니다.
6. 장치 선택창에서 micro:bit를 고르고 **운영 시작**을 누릅니다.

상세 보정 방법은 [`microbit/README.md`](microbit/README.md)에 있습니다.

## 하드웨어 없이 확인

- `Space`: 실제 체험과 같은 발사 입력
- 운영 설정의 **시험 발사**: 세션·통계에 포함되지 않는 효과 확인
- `D`: 3~5초 간격 자동 데모 켜기/끄기
- 수신기 B의 A 버튼: 손목 센서 없이 USB 구간까지 확인

## 현장 브라우저

Web Serial은 최신 데스크톱 Chrome에서 가장 안정적입니다. Safari와 모바일 브라우저는 공식 운영 대상이 아닙니다. 페이지는 HTTPS 또는 `localhost`에서 직접 열어야 하며, 다른 사이트의 iframe 안에서는 장치 선택이 막힐 수 있습니다.

장치가 선택창에 나타나지 않으면 데이터 전송 USB 케이블인지 확인하세요. 연결할 수 없다는 메시지가 나오면 MakeCode 콘솔이나 다른 Serial 프로그램이 포트를 사용 중인지 먼저 확인합니다.

## 로컬 실행

Node.js 22 이상과 pnpm이 필요합니다.

```bash
pnpm install
pnpm dev
```

`http://localhost:3000`을 Chrome으로 엽니다.

```bash
pnpm test
pnpm build
```

## 문서

- [상세 PRD](docs/PRD.md)
- [micro:bit 설치·보정](microbit/README.md)
