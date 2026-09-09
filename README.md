# 포스코증권 모의투자 웹

React + Vite 기반 학습용 모의 증권 서비스입니다. 실제 금융회사 또는 실제 주문 시스템과 연결되지 않습니다.

## 이번 버전 주요 개선

- 종목 목록과 선택 종목 영역에 회사/상품별 로고 이미지 표시
  - 온라인 favicon을 사용하며 로딩 실패 시 종목 심볼 이미지로 자동 대체
- 종합차트 고도화
  - 오른쪽 가격대 축
  - 하단 시간 타임라인
  - 모의 거래량 막대
  - 마우스 크로스헤어 및 시간/가격 툴팁
  - KIS 실제 1분 / 5분 / 일봉 보기 전환
- MY 투자 화면 직접 리사이즈
  - `내 화면 편집` 클릭
  - `⠿` 손잡이를 드래그하면 순서 이동
  - 카드 오른쪽 아래 대각선 손잡이를 드래그하면 가로/세로 크기 조절
  - 숨기기 / 접기 / 기본 배치 복원
  - 순서와 크기는 localStorage에 저장되어 새로고침 후에도 유지

## 실행

```bash
npm install
npm run dev:all
```

또는 Windows에서 `START_POSCO.bat`을 실행하세요.

## Supabase 연결 준비

1. `.env.example`의 Supabase 항목을 `.env`에 추가합니다.
2. Supabase SQL Editor에서 `supabase/migrations/001_initial_accounts.sql`을 실행합니다.
   이후 번호 순서대로 나머지 migration SQL도 실행합니다.
3. 연결값을 입력한 뒤 `SUPABASE_ENABLED=true`로 변경합니다.
4. 서버 실행 후 `GET /api/database/status`가 `connected: true`인지 확인합니다.

`SUPABASE_SECRET_KEY`(또는 기존 프로젝트의 `SUPABASE_SERVICE_ROLE_KEY`)는 Express 서버에서만 사용하며 React 코드나 Git 저장소에 넣지 않습니다.
마이그레이션 `003_spot_trading.sql`부터 Express의 계좌·보유종목·일반 현물 주문 API가 Supabase를 원본으로 사용합니다.
React 거래 화면도 통합 계좌 API를 통해 예수금, 보유종목, 체결내역, 금융부채, 대주 및 선물 포지션을 복원합니다.

마이그레이션 `005_finance_contracts.sql`은 신용융자·미수·대주·담보대출 약정과 대주잔고,
현금 변경 원장을 추가합니다. 금융 실행과 상환은 Express API를 거쳐 계좌 잔액과 함께 처리됩니다.

마이그레이션 `006_short_trading.sql`~`008_account_operations.sql`은 대주 주문, 선물 주문,
입금·이체·환전·계좌 초기화를 각각 DB 트랜잭션으로 처리합니다.

마이그레이션 `009_pending_orders.sql`은 지정가 미체결 주문을 저장합니다. 서버 재시작이나 브라우저
새로고침 뒤에도 주문이 복원됩니다. `015_partial_limit_fills.sql` 적용 후에는 체결 조건 충족 시 주문이
분할 체결되고, 각 체결의 잔고·보유수량·현금 원장·주문 이벤트와 잔여수량이 하나의 트랜잭션으로 처리됩니다.

국내주식 거래 화면은 `/ws/market`을 통해 선택 종목의 KIS 실시간 체결가(`H0STCNT0`)와 10단계
호가(`H0STASP0`)를 구독합니다. 연결 종료 시 자동 재접속하며, 전체 종목 REST 순환 시세와 SQLite의
마지막 정상 가격은 WebSocket 장애 시 폴백으로 계속 유지됩니다.

마이그레이션 `017_trade_charges_and_d2_settlement.sql`은 체결 회차별 모의 위탁수수료와 매도세를
현금·통합 원장에 분리 기록하고, 주말 및 `market_holidays` 등록일을 제외한 D+2 결제 예정내역을 생성합니다.
요율은 `trade_charge_policies`에서 관리하며 실제 증권사 계약 요율과 독립된 시뮬레이션 값입니다.

마이그레이션 `018_margin_risk_engine.sql`은 선물 평가손익과 금융부채·담보가치를 주기적으로 평가해
`SAFE → WARNING → MARGIN_CALL → LIQUIDATION` 상태와 추가증거금 요구를 기록합니다. 선물 증거금
비율이 모의 청산 기준에 도달하면 포지션을 원자적으로 강제청산하고 손익·미충당액을 감사 원장에 남깁니다.

계좌 초기화는 `POST /api/accounts/1/reset`을 사용합니다. 주문, 보유종목, 금융약정, 대주·선물 포지션,
미체결 주문과 원장을 초기화하고 모의 예수금을 1,000만원으로 되돌립니다. 즐겨찾기와 화면 설정은 유지합니다.

기존 단일 학습용 계좌(`id=1`)는 마이그레이션 검증을 위해 보존되어 있으며 로그인 사용자에게는 노출되지 않습니다.
로그인한 사용자는 각자 별도의 모의계좌를 자동으로 발급받습니다.

## 이메일·비밀번호 로그인

마이그레이션 `010_email_auth_ownership.sql`은 `profiles`와 `accounts.user_id`, 사용자별 조회 RLS,
신규 사용자 모의계좌 생성 함수를 추가합니다. React는 Publishable Key로 로그인하고, 계좌 관련 API에
Supabase Access Token을 `Authorization: Bearer ...` 형식으로 전달합니다. Express는 토큰의 사용자를
확인한 뒤 해당 사용자 계좌 ID만 서비스 계층에 전달합니다.

Supabase Dashboard의 Authentication 설정에서 Email Provider, 회원가입, 이메일 확인을 활성화하고
Site URL을 `http://localhost:5173`, Redirect URL을 `http://localhost:5173/**`로 등록해야 합니다.
배포할 때는 실제 HTTPS 주소도 Redirect URL 허용 목록에 추가합니다.

서버 포트는 `.env`의 `PORT`를 사용하며 Vite의 `/api` 프록시도 같은 값을 자동으로 읽습니다.
인증·계좌 분리 테스트는 실행 중인 서버를 대상으로 `node scripts/auth-e2e.mjs`로 수행할 수 있습니다.
테스트에서 만든 임시 인증 사용자와 계좌는 완료 여부와 관계없이 자동 삭제됩니다.

## 6단계 운영 상태 점검

- `GET /api/health`: 프로세스 생존 여부를 확인합니다.
- `GET /api/health/ready`: 계좌 DB와 SQLite 시세 캐시가 요청을 처리할 준비가 됐는지 확인하며, 준비되지 않으면 HTTP 503을 반환합니다.
- `GET /api/operations/status`: 로그인 사용자에게 DB, 시세 REST 수집, 실시간 WebSocket, 캐시 건수, 재접속 횟수, HTTP 오류율과 응답시간을 한 번에 제공합니다. 상태 점검 요청 자체는 서비스 오류율에서 제외됩니다.
- 서버 종료 신호를 받으면 시세 수집과 WebSocket을 먼저 멈추고 진행 중인 HTTP 요청을 최대 10초간 기다립니다.

## 시세 데이터 저장

- 정상 수신한 현재가와 차트는 `.cache/market-data.sqlite`에 저장됩니다.
- 장 종료 또는 KIS API 오류 시 SQLite에 저장된 마지막 정상 데이터를 표시합니다.
- 이전 버전의 `.cache/market-quotes.json`, `.cache/market-charts.json`은 SQLite가 비어 있을 때 최초 한 번 자동 이관됩니다.
- 브라우저는 첫 화면을 빠르게 표시하기 위해 마지막 응답을 `localStorage`에도 보관하고, 서버 응답이 도착하면 최신 값으로 교체합니다.

## 검증 명령어

`npm run build`로 프로덕션 번들을 확인합니다. API 서버를 실행한 상태에서 `npm run test:auth`와
`npm run test:websocket`을 실행하고, Supabase DB 함수 회귀검증은 `npm run test:db`로 실행합니다.
테스트 데이터는 트랜잭션 롤백 또는 인증 사용자 삭제로 정리됩니다.

## 참고

- 모의 시세와 거래량은 임의 생성 데이터입니다.
- 종목 로고는 인터넷 연결이 있어야 선명한 외부 favicon이 표시됩니다. 연결이 없으면 심볼 기반 대체 이미지가 표시됩니다.
- 모바일 화면에서는 레이아웃 안정성을 위해 위젯 폭을 한 줄 전체로 고정하며 직접 리사이즈 손잡이를 숨깁니다.
