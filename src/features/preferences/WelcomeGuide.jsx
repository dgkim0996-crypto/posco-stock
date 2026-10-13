import React from "react";

export default function WelcomeGuide({
  dismissWelcomeGuide, session, startFirstTrade,
}) {
  return (
    <div className="welcome-guide-backdrop" role="presentation">
      <section className="welcome-guide" role="dialog" aria-modal="true" aria-labelledby="welcome-guide-title">
        <button type="button" className="welcome-guide-close" onClick={dismissWelcomeGuide} aria-label="처음 안내 닫기">×</button>
        <div className="welcome-guide-sparkles" aria-hidden="true">✦</div>
        <span className="welcome-guide-eyebrow">WELCOME TO YOUR PRACTICE SPACE</span>
        <h1 id="welcome-guide-title">반가워요, {session.user.email?.split("@")[0] || "투자자"}님!<br />천천히 시작해도 충분해요.</h1>
        <p>여기는 실제 돈이 움직이지 않는 연습 공간이에요. 궁금한 종목을 둘러보고, 작은 모의 주문부터 편하게 경험해 보세요.</p>
        <ol className="welcome-guide-steps">
          <li><b>01</b><div><strong>오늘의 시장 둘러보기</strong><span>홈에서 가격 흐름과 인기 종목을 가볍게 살펴봐요.</span></div></li>
          <li><b>02</b><div><strong>가상으로 주문해 보기</strong><span>부담 없이 한 주부터 매수·매도를 연습할 수 있어요.</span></div></li>
          <li><b>03</b><div><strong>내 자산 변화 확인하기</strong><span>내 자산 메뉴에서 결과와 기록을 한눈에 확인해요.</span></div></li>
        </ol>
        <div className="welcome-guide-actions">
          <button type="button" className="welcome-guide-secondary" onClick={dismissWelcomeGuide}>먼저 둘러볼게요</button>
          <button type="button" className="welcome-guide-primary" onClick={startFirstTrade}>첫 모의 주문 해보기 <span aria-hidden="true">→</span></button>
        </div>
        <small>언제든 실제 주문 없이 자유롭게 연습할 수 있어요.</small>
      </section>
    </div>
  );
}
