# 주요 파일 책임표

이 문서는 현재 소스 파일의 책임과 변경 위치를 빠르게 찾기 위한 표다. 전체 데이터 흐름과 확장 원칙은 [ARCHITECTURE](./ARCHITECTURE.md)를 참고한다.

## 프런트엔드 진입점과 조합

| 파일 | 책임 |
| --- | --- |
| `src/main.jsx` | 환경 설정 오류 표시, React 루트 마운트, 전역 CSS 로드 |
| `src/App.jsx` | Supabase 세션 복원, 인증/비밀번호 복구/거래 앱 분기 |
| `src/app/TradingApp.jsx` | 로그인 이후 최상위 화면 조합과 공통 상태 표시 |
| `src/app/useTradingModel.js` | 기능 훅 사이의 의존성과 화면에 전달할 모델 조합 |
| `src/app/SecondaryPages.jsx` | 자산·피드·상품·뱅킹·요약·운영 화면 lazy 로드 |
| `src/data/markets.js` | 프런트 초기 상품 카탈로그와 표시 메타데이터 |
| `src/lib/supabase.js` | 브라우저 Supabase 클라이언트 설정 |

## 프런트엔드 기능 모듈

| 기능 | 파일 | 책임 |
| --- | --- | --- |
| 계좌 | `features/account/useAccount.js` | 계좌 원본 조회, 5초/focus 동기화, 주문 이력·위험 조회, 조회 잠금/버전 |
| 계좌 | `features/account/usePortfolio.js` | 현물·선물·대주·부채를 이용한 자산/손익 파생 계산 |
| 계좌 | `features/account/useAccountReset.js` | 계좌 초기화 API와 관련 화면 상태 초기화 |
| 시세 | `features/market/useMarketData.js` | REST 현재가·대체시장·지수 폴링과 모의/합성 가격 갱신 |
| 시세 | `features/market/useRealtimeQuote.js` | 선택 국내주식 WebSocket 구독, 재연결, 호가 상태 |
| 시세 | `features/market/marketStorage.js` | 초기 상품 복제와 브라우저 시세 캐시 병합 |
| 시세 | `features/market/marketHelpers.js` | 상품군·국내외 구분, 원화 환산, 표시 분류 |
| 시세 | `features/market/marketConstants.js` | 상품군/주문 분류 표시 이름 |
| 시세 | `features/market/InstrumentSummary.jsx` | 선택 종목명, 현재가, 등락, 최우선 호가 표시 |
| 탐색 | `features/navigation/useTradingNavigation.js` | 화면 탭·상품군·선택 종목·통합 검색 상태와 이동 |
| 탐색 | `features/navigation/TradingHeader.jsx` | 상단 메뉴, 검색, 계좌, 로그아웃, 테마 UI |
| 주문 | `features/trading/useOrderInput.js` | 주문 탭·방향·유형·가격·수량·확인창 UI 상태 |
| 주문 | `features/trading/useOrderForm.js` | 주문가능금액/수량, 호가, 세금 미리보기, 체결 마커 계산 |
| 주문 | `features/trading/useOrderReview.js` | 입력 검증, `clientOrderId` 생성, 확인창 제출과 변경 잠금 |
| 주문 | `features/trading/useSpotOrders.js` | 시장가/지정가 현물 접수, 정정·취소와 응답 반영 |
| 주문 | `features/trading/useFuturesOrders.js` | 선물 포지션 개설·청산과 결과 반영 |
| 주문 | `features/trading/useOrderNotifications.js` | 주문 토스트와 최근 거래 메시지 수명주기 |
| 주문 | `features/trading/TradingWorkspace.jsx` | 종목 목록·요약·차트·주문·계좌 현황 배치 |
| 주문 | `features/trading/OrderPanel.jsx` | 호가, 주문 입력, 비용 미리보기, 미체결/체결 탭 |
| 주문 | `features/trading/OrderToasts.jsx` | 주문 결과 알림 표시 |
| 주문 | `features/trading/tradingConstants.js` | 모의계좌 시작 예수금 |
| 차트 | `features/chart/useChartHistory.js` | 기간별 OHLCV 요청·중복 방지·브라우저 캐시·사전 로드 |
| 차트 | `features/chart/useChartViewport.js` | 확대·이동·축 드래그·포인터·거래량 높이 상태 |
| 차트 | `features/chart/chartData.js` | 입력 봉 정규화와 보이는 구간의 좌표/범위 모델 계산 |
| 차트 | `features/chart/chartIndicators.js` | 이동평균·볼린저밴드·RSI·MACD 계산 |
| 차트 | `features/chart/chartPaths.js` | 선·영역 SVG path 생성 |
| 차트 | `features/chart/chartFormatters.js` | 축·툴팁 가격과 시간 형식 |
| 차트 | `features/chart/chartConstants.js` | SVG 크기, 여백, 지표 색과 기본 범위 |
| 차트 | `features/chart/chartOptions.js` | 사용자가 고르는 보조지표 목록 |
| 차트 | `features/chart/chartStorage.js` | 손상된 브라우저 차트 캐시의 안전한 복구 |
| 차트 | `features/chart/syntheticCandles.js` | 초기 모의 흐름과 두 기초종목의 레버리지 봉 합성 |
| 차트 | `features/chart/TradingChartPanel.jsx` | 기간/보조지표 도구와 Sparkline 조합 |
| 차트 | `features/chart/ChartPriceLayer.jsx` | 캔들·가격선·볼린저밴드와 가격축 SVG |
| 차트 | `features/chart/ChartIndicatorPanels.jsx` | RSI·MACD 보조 패널 SVG |
| 차트 | `features/chart/ChartCrosshair.jsx` | 크로스헤어, 툴팁, 평균단가와 체결 표시 |
| 차트 | `features/chart/VolumeChart.jsx` | 거래량 막대와 크기 조절 UI |
| 대시보드 | `features/dashboard/useDashboardLayout.js` | 위젯 순서·크기·접기·숨김·저장과 포인터 리사이즈 |
| 대시보드 | `features/dashboard/InvestmentDashboard.jsx` | 보유상품·선물·당일 체결 위젯 렌더링 |
| 대시보드 | `features/dashboard/dashboardStorage.js` | 저장 배치 검증과 레거시 배치 복원 |
| 대시보드 | `features/dashboard/dashboardConstants.js` | 기본 위젯 배치와 제목 메타데이터 |
| 즐겨찾기 | `features/favorites/useFavorites.js` | 사용자별 로컬 저장, 서버 조회·이관·수정 |
| 즐겨찾기 | `features/favorites/favoritesStorage.js` | 사용자별 키 생성과 기존 공용 키 복구 |
| 설정 | `features/preferences/useTradingPreferences.js` | 테마 적용과 사용자별 첫 안내 상태 |
| 설정 | `features/preferences/preferenceStorage.js` | 테마/첫 안내 저장값 읽기 |
| 설정 | `features/preferences/storageKeys.js` | 기존 localStorage 키의 단일 정의 |
| 설정 | `features/preferences/WelcomeGuide.jsx` | 첫 방문 안내 UI |

## 기존 공용 컴포넌트와 화면

| 파일 | 책임 |
| --- | --- |
| `components/Sparkline.jsx` | 기존 props/API를 유지하는 차트 SVG 조합 진입점 |
| `components/MarketList.jsx` | 종목 목록·검색·정렬·즐겨찾기 |
| `components/OrderDialog.jsx` | 신규 주문 확인과 미체결 정정·취소 확인, 중복 submit 잠금 |
| `components/OrderWorkspace.jsx` | 전체 주문 조회·필터·요약·CSV와 정정/취소 진입 |
| `components/AuthScreen.jsx`, `PasswordRecovery.jsx` | 로그인/가입/OAuth와 비밀번호 재설정 |
| `components/AssetLogo.jsx` | 상품 로고와 심볼 fallback |
| `components/StockFundamentals.jsx` | 선택 주식 재무정보 조회·표시 |
| `components/LongTermGuide.jsx` | 장기투자 안내·추정 UI |
| `pages/AssetOverview.jsx` | 통합 자산, 포지션, 원장, 주문 이벤트, 결제 예정 |
| `pages/Banking.jsx` | 입출금·환전·신용/대주/담보 약정 |
| `pages/InvestmentInfo.jsx` | 뉴스·경제 일정·지수 피드 |
| `pages/Products.jsx` | 상품 탐색·수익 추정·포트폴리오 분석 |
| `pages/MarketSummary.jsx` | 시장 지수와 종목 히트맵 |
| `pages/Operations.jsx` | DB·시세·WebSocket·HTTP 운영 상태 |
| `utils/api.js` | API/WS 주소 결정과 Access Token 첨부 요청 |
| `utils/tradeTaxes.js` | 모의 수수료·즉시세금·이연세금 미리보기 |
| `utils/tradingFormatters.js` | 원화·상품가격·등락률 표시 |
| `utils/assetSearch.js`, `marketChange.js`, `orderWorkspace.js` | 검색, 등락 표시, 주문 목록 순수 계산 |

## 백엔드

| 계층/파일 | 책임 |
| --- | --- |
| `server/server.js` | HTTP/WS 서버 수명주기, 시세 수집과 지정가 matcher 시작/종료 |
| `server/app.js` | Express 공통 미들웨어와 모든 라우터 등록 |
| `server/middleware/auth.js` | 토큰 사용자 검증, 사용자 계좌 준비, `accountId` 주입 |
| `server/routes/*.routes.js` | URL·HTTP 메서드·인증·컨트롤러 연결만 담당 |
| `server/controllers/*.controller.js` | 요청 필드 추출, 서비스 호출, HTTP 응답/오류 전달 |
| `services/accounts.service.js` | 계좌 상태·원장·주문 이벤트·초기화 |
| `services/orders.service.js` | 최신 서버 시세 기반 현물 체결과 멱등 RPC 호출 |
| `services/pendingOrders.service.js` | 지정가 접수·정정·취소와 계좌별 목록 |
| `services/pendingOrderMatcher.service.js` | 서버 시세에 따른 제한된 부분체결 배치 |
| `services/orderCapacity.service.js` | 미체결 예약을 포함한 현금·보유·대주 가능량 검사 |
| `services/orderIdempotency.service.js` | `clientOrderId` 검증, 기존 결과 조회, 조건 충돌 변환 |
| `services/spotOrderValidation.js` | 상품·수량·가격·시세 신선도·pending 연결 검증 |
| `services/futures.service.js`, `risk.service.js` | 선물 개설/청산, 증거금 평가와 강제청산 |
| `services/settlements.service.js` | D+2 결제 예정 조회와 처리 |
| `services/marketData.service.js` | KIS REST 현재가 수집과 메모리/SQLite 캐시 |
| `services/kisWebSocket.service.js` | KIS 체결가·호가 구독과 브라우저 WS 전달 |
| `services/kisAuth.service.js`, `kisRequest.service.js` | KIS 토큰과 호출 제한·재시도 공통 처리 |
| `services/alternativeMarketData.service.js`, `alternativeChartData.service.js` | 선물·채권·디지털자산 공개 시세/차트 어댑터 |
| `services/marketIndices.service.js`, `fundamentals.service.js`, `investmentFeed.service.js` | 지수·재무·투자 피드 수집/정규화 |
| `services/marketDatabase.service.js` | 마지막 정상 현재가·차트·피드 SQLite 저장 |
| `services/chartData.service.js` | 기존 `getChart` 공개 인터페이스와 stale-while-revalidate 조정 |
| `services/charts/chartConfig.js` | 허용 기간, 거래소 코드, HTTP 오류 생성 |
| `services/charts/chartTransforms.js` | OHLCV 정규화·시간 변환·정렬·집계·종가 fallback |
| `services/charts/kisChartClient.js` | 국내외 KIS 분봉/일봉 요청과 pagination |
| `services/charts/yahooChartClient.js` | Yahoo 분봉 요청과 공통 봉 변환 |
| `services/charts/chartLoader.js` | 기간별 제공처 선택, KIS fallback, 저장 응답 구성 |
| `services/charts/chartCache.js` | 단일 메모리 캐시와 SQLite 저장, TTL 부여 |
| `shared/tradingRules.js` | 프런트·서버 공용 호가·수량·주문가능·시장시간 규칙 |
| `supabase/migrations/*.sql` | PostgreSQL 스키마, RLS, 원자적 거래 RPC의 순차 변경 |

## CSS 파일별 적용 범위

`src/styles.css`에 적힌 import 순서가 기존 cascade 순서다. 아래 표는 책임별 묶음일 뿐이며 표의 순서로 import를 재정렬하면 안 된다.

| 디렉터리 | 파일별 범위 |
| --- | --- |
| `styles/base` | `theme.css` 전역 토큰·리셋, `asset-logo.css` 상품 로고 |
| `styles/layout` | `terminal.css` 거래 셸, `service-pages.css` 독립 페이지 공통, `navigation.css` 상단 검색·메뉴·탭 |
| `styles/market` | `watchlist-quotes.css` 종목목록·가격, `information.css` 투자정보, `heatmap-overview.css` 시장 개요, `heatmap-tiles.css` 히트맵, `feed-list.css` 피드 목록, `feed-modal.css` 피드 상세, `instrument-identity.css` 종목 헤더, `fundamentals.css` 재무 요약, `fundamentals-details.css` 재무 상세, `feed-highlights.css` 피드 강조 |
| `styles/chart` | `base.css` 차트 프레임/SVG, `toolbar.css` 기간·도구, `indicators.css` 지표 메뉴·패널, `annotations.css` 평균단가·체결·크로스헤어, `volume.css` 거래량 |
| `styles/dashboard` | `widgets.css` 위젯 그리드/편집, `content.css` 표·체결 내용, `resizing.css` 리사이즈 피드백 |
| `styles/trading` | `orderbook.css` 호가, `order-form.css` 주문 폼, `order-toast.css` 알림, `order-inputs.css` 가격·수량 입력, `order-status.css` 미체결·체결 목록, `broker-controls.css` 세션·확인창 연계 컨트롤 |
| `styles/account` | `holdings.css` 보유 표, `assets.css` 자산 화면, `allocation-colors.css` 배분 범례 색상 |
| `styles/banking` | `forms.css` 입출금/환전 폼, `activity.css` 금융 활동, `financing.css` 신용·대주·담보 |
| `styles/products` | `catalog.css` 상품 카탈로그, `projection.css` 장기 수익 추정, `portfolio-advisor.css` 분석 결과, `longterm-motion.css` 안내 모션, `motion-support.css` 모션 접근성/지원 |
| `styles/auth` | `login.css` 인증 화면, `welcome.css` 첫 안내, `theme-responsive.css` 인증/안내 테마·반응형 |
| `styles/operations` | `monitor.css` 운영 지표와 상태 카드 |
| `styles/responsive` | `terminal.css` 거래 셸, `service-pages.css` 독립 화면, `chart-dashboard.css` 차트·위젯, `navigation.css` 상단 메뉴의 다기능 breakpoint |
| `styles/theme` | `dark-shell.css`, `dark-chart.css`, `dark-trading-banking.css`, `dark-dashboard.css`, `dark-fundamentals.css`, `dark-products-account.css`, `dark-feed.css` 다크 오버라이드; `signature.css` 브랜드 표현; `rounded-surfaces.css` 후반 표면 규칙; `light.css` 최종 라이트 보정 |
| `styles/legacy` | `reverted-experiments.css` 원본에서 이미 주석 처리된 실험 규칙 보존(활성 선택자 없음) |
| 컴포넌트 CSS | `components/OrderDialog.css`, `components/OrderWorkspace.css`는 각 컴포넌트가 직접 import하는 격리된 주문 UI 스타일 |

## 검증 파일

| 파일 | 책임 |
| --- | --- |
| `scripts/trading-rules.test.mjs` | 공용 호가·수량·주문가능·시장시간 규칙 |
| `scripts/order-workspace.test.mjs` | 주문 병합·필터·요약·CSV |
| `scripts/order-idempotency.test.mjs`, `order-services.test.mjs` | 멱등성 어댑터와 주문 서비스 흐름 |
| `scripts/chart-model.test.mjs` | 프런트 차트 데이터·지표·좌표·경로·형식 |
| `scripts/chart-service.test.mjs` | 서버 차트 정규화·집계·fallback |
| `scripts/trading-app.test.mjs` | 격리 세션/계좌에서 앱 조합과 주문 단일 전송 |
| `scripts/fixtures/brokerage-ui.js` | 외부 계정/네트워크 없는 가짜 세션·계좌 API |
| `scripts/fixtures/trading-app-harness.mjs` | JSDOM 앱 마운트와 사용자 입력 도우미 |
| `scripts/order-reservations-e2e.mjs`, `order-idempotency-e2e.mjs` | PGlite 메모리 DB의 예약·체결·멱등 RPC 회귀 |
