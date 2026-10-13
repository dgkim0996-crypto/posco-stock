

export const DEFAULT_DASHBOARD_WIDGETS = [
  { id: "holdings", cols: 6, height: 370, collapsed: false, hidden: false },
  { id: "futures", cols: 6, height: 370, collapsed: false, hidden: false },
  { id: "history", cols: 12, height: 330, collapsed: false, hidden: false },
];

export const DASHBOARD_META = {
  holdings: { eyebrow: "잔고", title: "보유상품", description: "평가손익 포함" },
  futures: { eyebrow: "선물옵션", title: "미결제약정", description: "보유 포지션" },
  history: { eyebrow: "거래", title: "당일 체결내역", description: "최근 40건" },
};
