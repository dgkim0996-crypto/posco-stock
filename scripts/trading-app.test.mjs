import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { transformSync } from 'esbuild';
import React from 'react';
import { renderToString } from 'react-dom/server';
import { mountTradingApp } from './fixtures/trading-app-harness.mjs';
import { INITIAL_MARKETS } from '../src/data/markets.js';
import { useOrderForm } from '../src/features/trading/useOrderForm.js';
import { createClientOrderId, useOrderReview } from '../src/features/trading/useOrderReview.js';

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

test('trading composition keeps navigation, preferences and order confirmation connected to one account', async () => {
  const app = await mountTradingApp();
  try {
    assert.match(app.container.textContent, /UI-TEST-0001/);
    await app.click(app.button('먼저 둘러볼게요'));
    assert.equal(app.container.querySelector('.welcome-guide'), null);
    await app.click(app.container.querySelector('.theme-toggle'));
    assert.equal(document.documentElement.dataset.theme, 'dark');
    assert.equal(window.localStorage.getItem('posco-color-theme-v1'), 'dark');
    await app.click(app.button('매수 주문'));
    assert.equal(app.calls.filter((call) => call.method === 'POST').length, 0, 'review must not submit');
    const dialog = app.container.querySelector('dialog.broker-order-dialog');
    assert.ok(dialog, 'order review dialog must open');
    await app.click(app.button('매수 주문 확정', dialog));
    assert.equal(app.calls.filter((call) => call.url === '/api/orders' && call.method === 'POST').length, 1);
    assert.equal(app.container.querySelector('dialog.broker-order-dialog'), null, 'successful submit closes dialog');
    assert.match(app.container.textContent, /주문이 체결됐어요/);
  } finally { await app.close(); }
});

// 서버 렌더로 훅을 한 번 실행해 "최대" 버튼과 같은 setMaximumOrderQuantity를 호출한다.
function maximumQuantity({ owned = 0, pendingSell = [], side = 'SELL', cash = 0, fraction = 1 }) {
  const btc = INITIAL_MARKETS.crypto.find((asset) => asset.symbol === 'BTC');
  let quantity;
  let form;
  function Probe() {
    form = useOrderForm({
      category: 'crypto', setSelectedId() {}, setQuantity: (value) => { quantity = value; }, setOrderType() {}, setLimitPrice() {},
      orderType: 'MARKET', selected: btc, orderBook: null, marketClock: new Date('2026-10-13T01:00:00Z'), cash,
      pendingOrders: pendingSell.map((amount, index) => ({ id: `p${index}`, pendingOrderId: `p${index}`, assetId: 'BTC', symbol: 'BTC', category: 'crypto', side: 'SELL', quantity: amount, limitPrice: btc.price })),
      allAssets: INITIAL_MARKETS.crypto, spotPositions: owned ? { BTC: { quantity: owned } } : {}, marketCategory: 'crypto', orderSide: side,
      limitPrice: '', futuresPositions: [], shortPositions: {}, quantity: '0.01', filledOrders: [], setMessage() {},
      financeAccount: { lending: { active: false, limit: 0 } }, lendingUsed: 0,
    });
    return null;
  }
  renderToString(React.createElement(Probe));
  form.setMaximumOrderQuantity(fraction);
  return { quantity, availability: form.orderAvailability };
}

test('maximum digital-asset sell quantity keeps the last 1e-8 unit after pending sells and fractions', () => {
  assert.equal(maximumQuantity({ owned: 0.03, pendingSell: [0.01] }).quantity, '0.02', '0.03-0.01 must not become 0.01999999');
  assert.equal(maximumQuantity({ owned: 0.29 }).quantity, '0.29', '0.29*1e8 must not floor to 28999999 units');
  assert.equal(maximumQuantity({ owned: 0.29, fraction: 0.5 }).quantity, '0.145');
  assert.equal(maximumQuantity({ owned: 0.01, pendingSell: [0.01] }).quantity, '0');
  const buy = maximumQuantity({ side: 'BUY', cash: 1_000_000 });
  assert.equal(buy.quantity, String(buy.availability.maxQuantity), 'buy maximum is unchanged by the unit clean-up');
});

test('order review creates a UUID clientOrderId outside secure contexts and amends with the remaining quantity seen', async () => {
  assert.equal(createClientOrderId({ randomUUID: () => 'native-id' }), 'native-id');
  const fallback = { getRandomValues: (bytes) => globalThis.crypto.getRandomValues(bytes) };
  const first = createClientOrderId(fallback);
  assert.match(first, UUID_V4);
  assert.notEqual(createClientOrderId(fallback), first);

  const asset = INITIAL_MARKETS.stocks.find((item) => item.symbol === '005490');
  let draft;
  const amendments = [];
  const review = (orderDialog) => useOrderReview({
    accountReady: true, accountLoading: false, orderMutationLock: { current: false }, quantity: '1', orderType: 'MARKET',
    category: 'domesticStocks', limitPrice: '', selected: asset, marketCategory: 'stocks',
    orderTaxPreview: { grossAmount: asset.price, settlementAmount: -asset.price, feeAmount: 0, immediateTaxAmount: 0 },
    orderSide: 'BUY', orderAvailability: { availableCash: Number.MAX_SAFE_INTEGER, availableSellQuantity: 0 },
    financeAccount: { lending: { active: false } }, notifyOrder: (message) => assert.fail(message), setOrderDialog: (value) => { draft = value; },
    accountNumber: 'UI-TEST-0001', allAssets: [asset], orderDialog, accountRequestVersion: { current: 0 }, setOrderBusy() {}, setBusyOrderId() {},
    amendPendingOrder: async (order, values) => { amendments.push([order, values]); }, cancelPendingOrder: async () => {}, openFuture: async () => {},
    placeSpotOrder: async () => {}, refreshAccount: async () => {},
  });
  // HTTP LAN 주소처럼 randomUUID가 없는 브라우저에서도 주문 확인이 열려야 한다.
  Object.defineProperty(globalThis.crypto, 'randomUUID', { value: undefined, configurable: true });
  try { review(null).reviewOrder(); } finally { delete globalThis.crypto.randomUUID; }
  assert.match(draft.clientOrderId, UUID_V4);

  const order = { id: 'p-1', pendingOrderId: 'p-1', symbol: '005490', quantity: 3, limitPrice: 330000 };
  await review({ action: 'amend', order }).submitReviewedOrder({ quantity: 2, limitPrice: 331000 });
  assert.deepEqual(amendments, [[order, { quantity: 2, limitPrice: 331000, expectedRemaining: 3 }]]);
});

test('amending from the pending list always sends the remaining quantity shown when the dialog opened', async () => {
  const app = await mountTradingApp();
  try {
    await app.change(app.container.querySelector('select.order-type-select'), 'LIMIT');
    await app.click(app.button('매수 주문'));
    await app.click(app.button('매수 주문 확정', app.container.querySelector('dialog.broker-order-dialog')));
    const created = app.calls.find((call) => call.method === 'POST' && call.url === '/api/accounts/me/pending-orders');
    assert.ok(created, 'limit order must be accepted as a pending order');
    // 하네스는 DOM 전역보다 react-dom을 먼저 불러와 React가 구형 입력 폴리필을 쓴다. 정정 창 autoFocus가 찾는 API만 채운다.
    Object.assign(window.HTMLElement.prototype, { attachEvent() {}, detachEvent() {} });
    await app.click(app.button('정정'));
    await app.click(app.button('정정 접수', app.container.querySelector('dialog.broker-order-dialog')));
    const patch = app.calls.find((call) => call.method === 'PATCH');
    assert.deepEqual(patch.body, { quantity: created.body.quantity, limitPrice: created.body.limitPrice, expectedRemaining: created.body.quantity });
  } finally { await app.close(); }
});

// 실제 API 대신 응답을 주입하기 위해 하네스와 같은 방식(esbuild→CJS)으로 useSpotOrders만 불러온다.
function loadSpotOrders(apiFetch) {
  const file = new URL('../src/features/trading/useSpotOrders.js', import.meta.url);
  const requireModule = createRequire(file);
  const module = { exports: {} };
  const { code } = transformSync(fs.readFileSync(file, 'utf8'), { loader: 'js', format: 'cjs' });
  const localRequire = (specifier) => specifier === '../../utils/api.js' ? { apiFetch } : requireModule(fileURLToPath(new URL(specifier, file)));
  new Function('require', 'module', 'exports', code)(localRequire, module, module.exports);
  return module.exports.useSpotOrders;
}

test('a 409 amendment warns about the changed remaining quantity, refreshes the account and closes the stale dialog', async () => {
  const requests = [];
  let status = 409;
  const useSpotOrders = loadSpotOrders(async (url, options) => {
    requests.push(JSON.parse(options.body));
    return new Response(JSON.stringify(status === 409 ? { error: '잔여수량이 바뀌었습니다.' } : { quantity: 2, limitPrice: 331000 }), { status });
  });
  const notices = [];
  const spot = useSpotOrders({ notifyOrder: (...args) => notices.push(args), setPendingOrders() {} });
  const order = { id: 'p-1', pendingOrderId: 'p-1', name: 'POSCO홀딩스', symbol: '005490', quantity: 5, limitPrice: 330000 };
  const dialogs = [];
  const refreshes = [];
  const review = useOrderReview({
    orderMutationLock: { current: false }, accountRequestVersion: { current: 0 }, orderDialog: { action: 'amend', order },
    setOrderBusy() {}, setBusyOrderId() {}, setOrderDialog: (value) => dialogs.push(value),
    amendPendingOrder: spot.amendPendingOrder, refreshAccount: async (options) => { refreshes.push(options); },
  });
  await assert.rejects(review.submitReviewedOrder({ quantity: 5, limitPrice: 331000 }), (error) => error.status === 409);
  assert.deepEqual(requests, [{ quantity: 5, limitPrice: 331000, expectedRemaining: 5 }]);
  assert.deepEqual(notices.map(([, tone, title]) => [tone, title]), [['warning', '주문 잔량이 바뀌었어요']]);
  assert.match(notices[0][0], /잔량이 바뀌었습니다/);
  assert.deepEqual(refreshes, [{ afterMutation: true }]);
  assert.deepEqual(dialogs, [null], 'the stale amendment dialog must close so it is reopened from refreshed data');

  // 호출부가 값을 넘기지 않아도 정정 대상의 잔량을 항상 보낸다.
  status = 200;
  await spot.amendPendingOrder({ ...order, quantity: 3 }, { quantity: 2, limitPrice: 331000 });
  assert.deepEqual(requests.at(-1), { quantity: 2, limitPrice: 331000, expectedRemaining: 3 });
});
