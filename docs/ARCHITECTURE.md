# 코드 구조와 데이터 흐름

이 문서는 현재 React/Vite 프런트엔드, Express API, Supabase 계좌 DB와 SQLite 시세 캐시의 책임을 설명한다. 실행 환경과 배포 설정은 [README](../README.md), 주요 파일별 역할은 [FILE_MAP](./FILE_MAP.md)을 참고한다. 구조 분리는 기존 화면, API 경로, 저장 키, 거래 규칙을 유지한다. 이 리팩터링에는 실제 DB 적용이나 배포 작업이 포함되지 않는다.

## 1. 디렉터리 구조

아래는 소스 디렉터리 전체와 주요 진입점이다. 의존성(`node_modules`), Git 내부 파일, 빌드(`dist`), 실행 캐시(`.cache`), 생성 산출물(`output`)은 제외했다.

```text
posco-stock/
├─ index.html                    # Vite HTML 진입점
├─ package.json                  # 실행·검증 명령
├─ vite.config.js                # React 변환, 개발 API/WS 프록시
├─ api/
│  └─ index.js                   # Vercel 요청 경로를 Express에 연결
├─ src/
│  ├─ main.jsx                   # 설정 확인, React 마운트, 전역 CSS
│  ├─ App.jsx                    # 인증 초기화·로그인·비밀번호 복구 분기
│  ├─ styles.css                 # CSS import 순서 목록
│  ├─ app/                       # 로그인 이후 기능 조합
│  ├─ assets/                    # 브랜드 이미지
│  ├─ components/                # 기존 공용/독립 UI 및 호환 진입점
│  ├─ data/                      # 초기 상품 카탈로그
│  ├─ features/
│  │  ├─ account/                # 계좌 동기화, 평가금액, 초기화
│  │  ├─ chart/                  # 차트 조회·계산·상호작용·SVG 레이어
│  │  ├─ dashboard/              # 투자 위젯과 배치 편집
│  │  ├─ favorites/              # 사용자별 관심종목 저장·동기화
│  │  ├─ market/                 # REST/WS 시세, 종목 분류·표시
│  │  ├─ navigation/             # 상단 검색, 화면·상품군·종목 선택
│  │  ├─ preferences/            # 테마, 첫 안내, 저장 키
│  │  └─ trading/                # 주문 입력·확인·전송·알림·작업영역
│  ├─ lib/                       # 브라우저 Supabase 클라이언트
│  ├─ pages/                     # 자산·투자정보·상품·뱅킹·시장·운영 화면
│  ├─ utils/                     # API URL/인증 요청, 거래 형식·세금·검색
│  └─ styles/
│     ├─ account/                # 보유·자산·배분
│     ├─ auth/                   # 인증·첫 안내
│     ├─ banking/                # 입출금·활동·금융약정
│     ├─ base/                   # 전역 토큰·리셋·로고
│     ├─ chart/                  # 차트·축·지표·체결 표시·거래량
│     ├─ dashboard/              # 위젯·내용·크기 조절
│     ├─ layout/                 # 거래 셸·공통 페이지·내비게이션
│     ├─ legacy/                 # 기존에 주석 처리된 실험 코드 보존
│     ├─ market/                 # 시세·히트맵·피드·기업정보
│     ├─ operations/             # 운영 상태 화면
│     ├─ products/               # 상품·장기추정·AI 분석·모션
│     ├─ responsive/             # 여러 기능에 걸친 기존 반응형 블록
│     ├─ theme/                  # 다크·시그니처·라운드·라이트 덮어쓰기
│     └─ trading/                # 호가·주문·알림·세션 안내
├─ server/
│  ├─ server.js                  # 상시 HTTP/WS 서버, 수집·자동체결 시작/종료
│  ├─ app.js                     # Express 미들웨어·라우터 등록
│  ├─ routes/                    # 경로·메서드·인증 연결
│  ├─ controllers/               # HTTP 입력/응답과 서비스 호출
│  ├─ services/                  # 거래·계좌·시장·외부 제공처 업무 처리
│  │  └─ charts/                 # 차트 제공처·변환·캐시·폴백
│  ├─ data/                      # 상품/호환 데이터 모듈
│  ├─ lib/                       # 서버 전용 Supabase 관리자 클라이언트
│  └─ middleware/                # 계좌 인증, 제한, 지표, 404/오류 처리
├─ shared/
│  └─ tradingRules.js            # 프런트·서버 공용 거래 계산/검증
├─ supabase/
│  └─ migrations/                # 순서가 있는 테이블·RPC·정책 SQL
├─ scripts/
│  └─ fixtures/                  # 격리 UI 미리보기의 가짜 계좌 데이터
└─ docs/
   ├─ ARCHITECTURE.md            # 구조·흐름·확장 기준
   └─ FILE_MAP.md                # 주요 파일과 CSS 적용 범위
```

루트의 `.env.example`, `Dockerfile`, `vercel.json`, `nodemon.json`, `START_POSCO.bat`는 환경·실행 어댑터다. 실제 `.env` 값은 문서나 프런트 번들에 복사하지 않는다.

## 2. 프런트엔드 구성

`main.jsx`가 공개 Supabase 설정을 확인하고 `App`을 마운트한다. `App.jsx`는 인증 상태만 소유한다. 로그인 이후에는 `app/TradingApp.jsx`가 `useTradingModel(session)`의 결과를 받아 화면을 조합한다.

```text
main.jsx → App.jsx
             ├─ AuthScreen / PasswordRecovery
             └─ TradingApp → useTradingModel
                  ├─ TradingHeader
                  ├─ TradingWorkspace
                  │    ├─ MarketList / InstrumentSummary
                  │    ├─ TradingChartPanel → Sparkline
                  │    └─ OrderPanel / OrderWorkspace
                  ├─ InvestmentDashboard
                  ├─ SecondaryPages → pages/* (lazy + Suspense)
                  └─ WelcomeGuide / OrderToasts / OrderDialog
```

`pages/AssetOverview.jsx`는 자산·원장·결제, `InvestmentInfo.jsx`는 뉴스·일정·지수, `Products.jsx`는 상품 탐색, `Banking.jsx`는 현금·환전·금융약정, `MarketSummary.jsx`는 시장 히트맵, `Operations.jsx`는 서버 운영 상태를 담당한다. 화면 이동은 별도 라우팅 라이브러리 없이 `mainTab` 상태로 결정한다.

`OrderDialog`의 주문 확인/정정 입력과 `OrderWorkspace`의 계좌 전체 주문 조회·필터·CSV 기능은 기존 컴포넌트에 유지한다. 새 주문 훅은 이 컴포넌트들을 조합하며 동일한 역할의 별도 주문 화면을 만들지 않는다. `components/Sparkline.jsx`도 기존 import 경로와 props를 유지하고 실제 책임을 `features/chart`로 위임한다.

## 3. 인증부터 API 요청까지

1. `src/lib/supabase.js`는 공개 URL/Publishable Key로 브라우저 클라이언트를 만든다. `AuthScreen`이 이메일·비밀번호 또는 OAuth 로그인을 시작한다.
2. `App`은 `getSession()`과 `onAuthStateChange()`로 세션을 복원한다. `PASSWORD_RECOVERY` 이벤트와 URL 상태에 따라 비밀번호 복구 화면으로 분기한다.
3. 계좌 요청은 `utils/api.js`의 `apiFetch()`를 거친다. 이 함수는 현재 세션의 Access Token을 `Authorization: Bearer …` 헤더에 넣는다. 공개 시세 요청은 `fetch(apiUrl(path))`를 사용한다.
4. `apiUrl()`은 `VITE_API_BASE_URL`, `websocketUrl()`은 `VITE_WS_BASE_URL` 또는 API 주소를 사용한다. 설정이 없으면 동일 출처 `/api`, `/ws` 경로를 쓰며 개발 중에는 Vite 프록시가 서버에 전달한다.
5. `server/app.js`는 CORS → 본문 파싱 → 요청 지표 → 공개 시장 라우터 → 계좌 라우터 → 404/오류 처리 순으로 연결한다. 공개 라우터를 먼저 등록하는 현재 순서를 유지해야 계좌 인증 미들웨어가 공개 조회를 가로채지 않는다.
6. 계좌 라우터의 `requireAccount`는 서버 Supabase의 `auth.getUser(token)`으로 사용자를 검증하고 `provision_user_account` RPC로 계좌를 준비한다. 확인된 `req.authUser`, `req.accountId`만 컨트롤러/서비스에 전달한다.

서버의 관리자 키는 `server/lib/supabase.js`에서만 사용한다. 클라이언트가 보낸 계좌 ID로 소유권을 결정하지 않는다. 네이버 프로필 변환은 `authProviders.routes.js` → `authProviders.controller.js` → `naverAuth.service.js`가 맡는다.

## 4. 주문: 화면 → route → controller → service → DB

```text
OrderPanel / OrderWorkspace
  → useOrderReview: 입력 검증, 확인창별 clientOrderId 생성
  → OrderDialog: 사용자 확인
  → useSpotOrders / useFuturesOrders
  → apiFetch + 인증 토큰
  → routes → requireAccount → controllers → services
  → Supabase PostgreSQL RPC: 계좌 잠금·검증·잔고·주문·원장 갱신
  → 응답 반영 + useAccount.refreshAccount(): 최종 계좌 상태 동기화
```

| 요청 | 서버 파일 흐름 | DB 처리 |
| --- | --- | --- |
| `POST /api/orders` | `orders.routes` → `orders.controller.createOrder` → `orders.service.createOrder` | 신규 현물 주문 `place_spot_order_once` |
| `POST /api/accounts/me/pending-orders` | `pendingOrders.routes` → `createPendingOrder` → `pendingOrders.service.create` | `create_pending_spot_order_once` |
| `PATCH /api/accounts/me/pending-orders/:pendingId` | 같은 route → `amendPendingOrder` → `service.amend` | `amend_pending_spot_order` |
| `DELETE /api/accounts/me/pending-orders/:pendingId` | 같은 route → `cancelPendingOrder` → `service.remove` | `cancel_pending_spot_order` |
| `POST /api/accounts/me/futures` 및 `/:positionId/close` | `futures.routes` → `futures.controller` → `futures.service` | 선물 개설·청산 RPC |

서비스는 `spotOrderValidation`으로 수량·호가·상품을 검증하고, `orderCapacity.service`로 예약금을 포함한 가능금액/수량을 확인한다. `orderIdempotency.service`는 계좌와 `clientOrderId` 기준으로 동일 요청의 응답을 재사용하고 다른 조건을 같은 ID로 보낸 경우를 거부한다. DB RPC가 최종 원자성을 보장하므로 서버 계산만으로 잔고 일관성을 보장한다고 가정하지 않는다.

시장가 체결 가격은 브라우저 표시값이 아니라 `orders.service.executionQuoteFor()`가 확인한 서버 시세다. 유효한 최신 시세가 없으면 체결하지 않는다. 신규 현물 주문의 같은 확인창을 재전송할 때는 `clientOrderId`를 유지한다.

지정가 체결은 브라우저가 수행하지 않는다. `pendingOrderMatcher.service`가 서버 시세와 지정가를 비교하고 `match_pending_spot_order` RPC로 부분체결한다. 상시 서버는 5초 간격 작업을 예약하고, `GET /api/accounts/me/state`도 해당 계좌의 제한된 체결 검사를 수행한다. 같은 시세의 중복 체결과 정정/취소 경합은 DB에서 검사한다. 상시 프로세스가 없는 `api/index.js` 실행 환경에서는 요청 시 검사 경로가 동작하며 독립적인 상시 타이머를 시작하지 않는다.

계좌·주문·보유·금융약정·원장의 원본은 Supabase PostgreSQL이다. `supabase/migrations`의 기존 SQL이 트랜잭션과 RLS/함수 정의를 소유하며 이번 구조 분리의 수정 대상이 아니다.

## 5. 시세 REST / WebSocket / 캐시

### 현재가

`server/server.js`는 `marketData.service.startPolling()`을 시작한다. 서비스는 추적 종목을 하나씩 KIS REST로 조회하고 조회 완료 후 1.1초 뒤 다음 종목을 수집한다. `kisAuth.service`가 토큰을, `kisRequest.service`가 공통 호출 간격·재시도를 담당한다. 정상 현재가는 메모리 캐시와 `marketDatabase.service`의 SQLite에 저장된다.

브라우저 `useMarketData`는 `/api/quotes`를 2초, `/api/alternative-quotes`를 30초, `/api/indices`를 60초 간격으로 조회한다. 국내·해외 주식이 아닌 상품은 대체 시세 서비스를 사용한다. 실제 시세가 없는 모의 상품의 기존 갱신과 합성상품 계산도 이 훅에 남아 있다.

```text
KIS REST ───────────────┐
                       ├─ marketData 메모리 ↔ SQLite → /api/quotes → useMarketData
KIS WebSocket 체결가 ───┘
        └─ kisWebSocket.service → /ws/market → useRealtimeQuote → 같은 markets 상태
KIS WebSocket 호가 ─────────────→ /ws/market → useRealtimeQuote.orderBook
```

`useRealtimeQuote`는 선택된 실제 국내 원화 주식을 구독하고 연결 종료 시 2초 뒤 재연결한다. 종목 변경/언마운트 시 구독과 타이머를 해제한다. 서버는 `H0STCNT0` 체결가와 `H0STASP0` 호가를 전달한다. 체결가는 REST와 같은 서버 캐시에 합쳐지므로 주문 서비스도 이를 사용할 수 있다. 호가와 연결 상태는 별도 상태지만 현재가 원본 React 상태는 `useMarketData.markets` 하나다.

### 차트

`useChartHistory` → `/api/charts/:symbol?period=…` → `charts.routes` → `charts.controller` → `chartData.service.getChart(symbol, period)`가 공개 흐름이다. 비주식은 `/api/alternative-charts/:category/:symbol`로 분기한다. 합성상품은 기초종목 봉을 받아 `syntheticCandles.js`에서 합성한다.

`chartData.service`는 기간/종목 검증, 기존 캐시 응답, 만료 캐시의 백그라운드 갱신 중복 방지에 집중한다. `charts/chartLoader`는 제공처와 폴백 순서를 결정하고 `kisChartClient`, `yahooChartClient`가 외부 응답을 받는다. `chartTransforms`는 OHLCV 정규화·정렬·분봉 집계·직전 종가 보충을, `chartCache`는 메모리와 SQLite 저장을 담당한다.

- `5m`, `30m`, `60m`은 Yahoo 분봉을 우선 시도하고 실패 시 KIS로 대체한다. `1m`과 `day`는 KIS 경로를 사용한다.
- 분봉이 없으면 기존 일봉 기반 직전 종가 폴백을 유지한다. 일부 국내 장기 분봉 부족 시 일봉 종가로 보충한다.
- 서버 캐시 TTL은 일봉 5분, 분봉 30초다. 만료 캐시도 즉시 반환하고 뒤에서 갱신한다. 이는 표시용 폴백이며 오래된 시세로 주문을 체결한다는 의미가 아니다.
- 브라우저는 기본적으로 일봉 5분, 분봉 1분 뒤 다시 조회한다. 같은 종목/기간의 진행 중 요청을 공유하고, 1분봉 조회 성공 후 나머지 기간을 순차 준비한다. 오류 응답의 `retryAfter`를 존중한다.

SQLite 위치는 로컬 `.cache/market-data.sqlite`, Vercel에서는 OS 임시 디렉터리다. 이 DB는 현재가·차트·투자 피드의 마지막 정상 표시값을 보관하며 계좌 원본이 아니다. 브라우저 `localStorage`는 빠른 초기 표시와 개인 화면 설정에 사용한다.

## 6. 상태 소유권과 custom hook

`useTradingModel`은 훅들의 입력과 결과를 연결하는 조합 계층이다. Redux/전역 store를 추가하지 않으며 기존 React 상태를 기능별 소유자에 배치한다. 파생 계산은 원본 상태를 복제해 다시 저장하지 않는다.

| 소유자 | 상태·책임 |
| --- | --- |
| `App` | 인증 세션, 인증 준비, 비밀번호 복구 |
| `useMarketData`, `useRealtimeQuote` | 시장 전체 가격/지수와 선택 종목 WS 연결·호가 |
| `useTradingNavigation` | 화면 탭, 상품군, 선택 종목, 상단 검색 |
| `useAccount` | 현금·포지션·약정·주문·원장·결제·위험상태, 계좌 조회 잠금/버전 |
| `usePortfolio` | 원본 계좌/시세에서 평가액·손익·증거금·부채 계산 |
| `useOrderInput`, `useOrderForm` | 입력 상태, 시장 시간, 주문가능수량·세금·평균단가·체결 표시 계산 |
| `useOrderReview` | 주문 초안/확인/재시도 ID, 변경 잠금, 변경 후 계좌 재조회 |
| `useSpotOrders`, `useFuturesOrders`, `useAccountReset` | 현물/선물/초기화 API 실행과 기존 계좌 상태 갱신 |
| `useOrderNotifications` | 주문 알림, 거래 메시지, 알림 제거 타이머 |
| `useChartHistory`, `useChartViewport` | 봉 조회/캐시/기간·지표 선택과 차트 내부 확대·이동·포인터 |
| `useFavorites` | 사용자별 관심종목의 로컬 저장·서버 동기화 |
| `useDashboardLayout`, `useTradingPreferences` | 위젯 순서/크기/접기/숨기기, 테마·첫 안내 |

`useAccount`는 최초 진입, 보이는 문서의 5초 주기, 창 focus 시 계좌를 갱신한다. 위험 상태는 10초 주기로 조회하고 자산 탭 진입 시 원장·주문 이벤트·결제 내역을 가져온다. `orderMutationLock`과 요청 버전은 주문 중 정기 조회 및 뒤늦은 응답이 변경 결과를 덮어쓰지 않도록 한다. 거래 훅들이 별도의 계좌 상태를 만들지 않고 이 소유자의 setter/ref를 받는 이유다.

저장 키는 `features/preferences/storageKeys.js`에 모았다. 종목/차트 캐시, 대시보드, 테마는 기존 키를 유지하며 관심종목과 첫 안내는 사용자 ID를 반영한다. 저장 파싱·레거시 값 복구는 각 기능의 `*Storage.js`가 담당한다.

## 7. 공용 거래 규칙

`shared/tradingRules.js`는 호가 단위, 가격 정규화/한 호가 이동, 지정가·수량 검증, 미체결 예약을 제외한 가능금액/수량, 모의 USD/KRW 환율, 국내 장 시간 안내를 제공한다. 프런트의 `useOrderForm`, `useOrderReview`, 주문 컴포넌트와 서버의 주문 검증·가능금액 서비스가 같은 함수를 import한다.

현재 공용 모듈은 기존 순수 데이터인 `src/data/markets.js`와 순수 계산인 `src/utils/tradeTaxes.js`를 사용한다. 따라서 이 두 파일에도 React, DOM, 브라우저 환경변수 의존성을 추가하지 않는다. 공용 규칙 안에서 API 요청이나 DB 쓰기를 수행하지 않는다. 최종 수수료·세금·예약금·원자적 잔고 처리는 DB RPC가 수행하고 프런트 계산은 입력 검증과 미리보기 역할이다.

## 8. CSS 구성과 적용 순서

`main.jsx`는 계속 `src/styles.css` 하나를 import한다. 이 파일은 원래 8,809줄의 연속된 기능 블록을 59개 CSS 파일로 나눈 import 목록이다. 파일별 범위는 [FILE_MAP의 CSS 표](./FILE_MAP.md#css-파일별-적용-범위)에 있다.

기본 토큰/셸 → 기능 스타일 → 기존 위치의 반응형 블록 → 상세 차트/기능 확장 → 내비게이션 → 다크 테마 → 인증 → 후반 테마 덮어쓰기의 원래 순서를 유지한다. 기능 파일에도 해당 기능만의 반응형 규칙이 포함된다. `responsive/`는 여러 기능을 동시에 바꾸는 기존 블록이다.

CSS는 전역 선택자 방식이며 파일을 나누었다고 범위가 자동 격리되지 않는다. **`styles.css`의 import 순서가 cascade 계약이므로 파일명 순으로 정렬하거나 모든 media query를 마지막으로 이동하지 않는다.** `theme/`의 뒤쪽 규칙은 앞선 기본 규칙을 의도적으로 덮어쓴다. `legacy/reverted-experiments.css`는 기존에 비활성화된 주석만 보관한다. `OrderDialog.css`, `OrderWorkspace.css` 같은 기존 컴포넌트 CSS는 해당 컴포넌트의 import 경로를 유지한다.

## 9. 테스트와 실행 명령

명령의 실제 테스트 목록은 `package.json`을 기준으로 한다. 아래는 검증 범위 설명이며 실행 결과 보고가 아니다.

| 명령 | 범위·환경 |
| --- | --- |
| `npm run test:unit` | `scripts/*.test.mjs` 중 등록된 공용 규칙, 주문 UI 계산·멱등성·서비스와 리팩터링 회귀 테스트 |
| `node --test scripts/chart-model.test.mjs` | 프런트 차트 정규화·지표·좌표·경로·표시 형식 회귀 |
| `node --test scripts/chart-service.test.mjs` | 서버 OHLCV 정규화·집계·fallback 변환 회귀; 외부 API와 DB 미사용 |
| `node --test scripts/trading-app.test.mjs` | 가짜 세션·계좌로 앱 조합, 테마, 주문 확인과 단일 전송을 검증 |
| `npm run test:brokerage-db` | `order-reservations-e2e.mjs`와 `order-idempotency-e2e.mjs`; `.env` 없이 새 PGlite 메모리 DB 사용 |
| `npm run build` | Vite의 실제 모듈 그래프, 동적 import, CSS import와 프로덕션 번들 |
| `npm run preview:brokerage` | 가짜 계좌 fixture로 주문 UI를 확인하는 격리 개발 화면 |
| `npm run dev:all` | Vite와 Express 개발 서버 동시 실행 |

로컬 DB 테스트는 SQL 파일을 읽어 **임시 PGlite DB에만** 적용한다. 예약금 테스트는 기존 부분체결·세금/결제·위험 SQL 시나리오도 이 DB 어댑터로 실행한다. 실제 Supabase에 마이그레이션을 적용하지 않는다.

`npm run test:db`는 `DATABASE_URL`의 PostgreSQL에 접속하고, `test:auth`는 실행 중인 API와 인증 서비스를, `test:websocket`은 지정된 실시간 서버를 사용한다. 이들은 외부 계정 없이 수행하는 리팩터링 기본 검증과 환경이 다르다. `scripts/apply-migration.mjs` 역시 실제 DB 적용 도구이므로 로컬 회귀검증 명령으로 취급하지 않는다.

UI를 확인할 때는 기존 저장값이 있는 로그인, 종목/기간 전환, 호가 선택, 주문 확인·재시도·정정·취소, 계좌 갱신, 위젯 편집, 라이트/다크, 모바일 폭을 함께 본다. CSS 분리는 원문 결합과 Vite CSS 전처리 결과의 동일성도 확인할 수 있다.

## 10. 새 기능을 추가할 위치

| 추가할 책임 | 위치·기준 |
| --- | --- |
| 거래 화면의 새 업무 | `src/features/<기능>/`의 훅과 화면 컴포넌트; 조합만 `useTradingModel`/`TradingApp`에 연결 |
| 독립 서비스 화면 | `src/pages/`에 만들고 `app/SecondaryPages.jsx`에 lazy import 연결 |
| 차트 지표·표시 | 순수 계산은 `chartIndicators`, 좌표/정규화는 `chartData`, SVG는 차트 레이어 파일 |
| 화면만의 임시 상태 | 해당 컴포넌트 또는 기능 훅; 서버 계좌 값은 `useAccount` 소유권 유지 |
| 여러 기능의 순수 도우미 | `src/utils/`; 거래 서버도 필요하면 `shared/`의 순수 모듈 |
| 새 API | `server/routes`에 경로, `controllers`에 HTTP 어댑터, `services`에 업무 처리 |
| 차트 제공처 | `server/services/charts/`의 클라이언트와 `chartLoader`에 연결; 기존 `getChart` 응답 유지 |
| DB 거래 변경 | 별도 범위의 `supabase/migrations`; 적용은 구조 리팩터링과 구분 |
| 스타일 | 기존 기능 CSS 또는 의미 있는 새 파일; import 위치와 후반 theme 덮어쓰기 확인 |
| 회귀 시나리오 | `scripts/`의 독립 테스트; 순수/가짜 응답 또는 PGlite로 재현 가능한 경로 우선 |

주요 구현은 책임 단위로 나누어 대체로 100~300줄을 목표로 한다. 짧은 어댑터·상수·순수 계산은 그대로 두고, 여러 책임이 섞인 파일은 역할을 기준으로 분리한다. 하위 기능이 `TradingApp`이나 `useTradingModel`을 거꾸로 import하지 않도록 하며, 기능 간 결합은 조합 계층의 props/훅 입력으로 드러낸다.
