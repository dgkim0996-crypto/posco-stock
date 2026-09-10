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

## Google·네이버 소셜 로그인

로그인 화면은 Google과 Naver OAuth 버튼을 제공합니다. Google은 Supabase 기본 공급자이며, Naver는 Supabase의 Custom OAuth 공급자로 `naver` 식별자를 사용합니다.

1. Supabase Dashboard의 **Authentication > URL Configuration**에서 Site URL과 Redirect URL에 로컬 주소 `http://localhost:5173` 및 배포 주소를 등록합니다.
2. Google Cloud Console에서 Web OAuth 클라이언트를 만들고, 승인된 JavaScript 원본에 서비스 주소를 추가합니다. 승인된 리디렉션 URI에는 Supabase Dashboard의 Google 공급자 화면에 표시되는 callback URL을 그대로 입력합니다. 그 Client ID와 Secret을 Supabase **Authentication > Providers > Google**에 등록하고 활성화합니다.
3. Naver Developers에서 애플리케이션을 만들고 네이버 로그인 API를 활성화합니다. Supabase **Authentication > Providers > Custom OAuth Providers**에서 식별자 `custom:naver`, Authorization URL `https://nid.naver.com/oauth2.0/authorize`, Token URL `https://nid.naver.com/oauth2.0/token`과 Naver Client ID/Secret을 등록합니다. Naver 개발자센터 Callback URL에는 Supabase가 표시하는 callback URL을 입력합니다.

네이버 프로필 API는 표준 OAuth Claim과 달리 사용자 정보를 `response` 객체 안에 반환합니다. Supabase가
`sub`와 `email`을 인식하도록 Custom Provider의 UserInfo URL에는 배포된 Express 변환 경로를 사용합니다.

```text
https://<Vercel 배포 도메인>/api/auth/naver/userinfo
```

로컬 주소는 Supabase Auth 서버에서 접근할 수 없으므로 이 UserInfo URL에는 반드시 공개 HTTPS 배포 주소를
입력해야 합니다. 네이버 개발자센터에서 이메일을 필수 제공 항목으로 설정해야 신규 사용자 계정이 정상 생성됩니다.

공급자 Secret은 `.env`, React 코드 또는 Git 저장소에 넣지 않고 각 공급자의 콘솔과 Supabase Dashboard에서만 관리합니다.

## Vercel 배포

이 저장소는 `vercel.json`에서 Vite SPA와 Express API를 함께 배포합니다. `/api/*` 요청은
`api/index.js`의 Vercel Function으로 전달되고, 나머지 경로는 React의 `index.html`로 연결됩니다.

Vercel **Project Settings > Environment Variables**에서 최소한 다음 값을 Production과 Preview에
각각 등록한 뒤 새 Deployment를 실행합니다. 환경변수 변경은 이미 완료된 배포에 자동 반영되지 않습니다.

- 브라우저 공개 변수: `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`
- 서버 전용 변수: `SUPABASE_URL`, `SUPABASE_SECRET_KEY`, `SUPABASE_ENABLED=true`
- 실시간 시세 사용 시: `KIS_APP_KEY`, `KIS_APP_SECRET`, `KIS_ENV=paper`
- AI 분석 사용 시: `OPENAI_API_KEY`, 필요하면 `OPENAI_MODEL`

`VITE_` 접두사가 붙은 변수는 빌드 결과에 포함되므로 Supabase Publishable Key처럼 공개 가능한 값만
사용합니다. `SUPABASE_SECRET_KEY`, KIS Secret, OpenAI API Key에는 절대 `VITE_`를 붙이지 않습니다.

Supabase **Authentication > URL Configuration**의 Site URL 및 Redirect URLs에도 실제
`https://...vercel.app` 주소와 사용자 지정 도메인을 추가해야 이메일 확인과 OAuth 로그인이 배포 주소로 돌아옵니다.

Vercel Function의 로컬 SQLite 시세 캐시는 임시 저장소를 사용하므로 인스턴스 교체 시 초기화됩니다.
계좌·주문 데이터의 원본은 Supabase PostgreSQL이며 영향을 받지 않습니다. 장기 연결 기반 실시간 시세는
Vercel 요금제와 Function의 연결 시간 제한을 확인하고, 필요하면 Express/WebSocket 서버를 별도 상시 실행
호스팅으로 분리해 프런트의 WebSocket 주소를 연결해야 합니다.

## 프런트·실시간 백엔드 분리 배포

KIS WebSocket과 시세 순환 수집은 계속 실행되는 프로세스가 필요합니다. 별도 서버에서는 `npm start`로
Express와 `/ws/market`을 함께 시작합니다. 저장소의 `Dockerfile`은 Node 24 기반이며 Docker를 지원하는
호스팅에서 그대로 사용할 수 있습니다. 서버 환경변수에는 다음 값을 등록합니다.

- `PORT`: 호스팅에서 자동 제공하는 값이 있으면 그 값을 사용합니다.
- `HOST=0.0.0.0`
- `CLIENT_URLS=http://localhost:5173,https://posco-stock.vercel.app`
- `SUPABASE_URL`, `SUPABASE_SECRET_KEY`, `SUPABASE_ENABLED=true`
- `KIS_APP_KEY`, `KIS_APP_SECRET`, `KIS_ENV=paper`
- 선택 기능을 사용할 때 `OPENAI_API_KEY`, `BOK_ECOS_API_KEY`

백엔드가 `https://<API 도메인>`으로 배포됐다면 Vercel의 빌드 환경변수에 아래 공개 주소를 등록하고
새로 배포합니다. 두 값은 브라우저에 공개되는 서버 주소이며 Secret을 포함하지 않습니다.

```text
VITE_API_BASE_URL=https://<API 도메인>
VITE_WS_BASE_URL=wss://<API 도메인>
```

값을 비워 두면 로컬 개발에서는 Vite 프록시를, 기존 Vercel 통합 배포에서는 동일 출처 `/api`를 사용합니다.
분리 배포 후 Supabase Custom Naver Provider의 Userinfo URL도
`https://<API 도메인>/api/auth/naver/userinfo`로 옮길 수 있습니다. 전환 전에는 기존 Vercel Userinfo URL을
유지해도 로그인에는 문제가 없습니다.

배포 확인 순서는 `GET /api/health` → `GET /api/health/ready` → 로그인 후
`GET /api/operations/status` → 브라우저 `/ws/market` 연결 순서입니다.
원격 WebSocket 스모크 테스트는 `KIS_WS_TEST_URL=wss://<API 도메인>/ws/market`을 설정한 뒤
`npm run test:websocket`으로 실행합니다.

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
