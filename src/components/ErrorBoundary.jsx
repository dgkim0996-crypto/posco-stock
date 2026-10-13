import { Component } from "react";

// 렌더링 중 예외가 나도 빈 화면 대신 복구 안내를 보여 주는 최상위 오류 경계다.
// 오류 원문은 콘솔에만 남기고 화면에는 일반 안내와 재시도·새로고침만 제공한다.
export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
    this.retry = this.retry.bind(this);
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    console.error("화면 렌더링 오류:", error, info?.componentStack);
  }

  retry() {
    this.setState({ error: null });
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <main role="alert" style={{ minHeight: "100vh", display: "grid", placeItems: "center", padding: 24, background: "#f4f7fb" }}>
        <section style={{ width: "min(520px, 100%)", padding: 32, borderRadius: 16, background: "white", boxShadow: "0 16px 45px rgba(16, 42, 67, .12)" }}>
          <strong style={{ color: "#005891" }}>POSCO SECURITIES</strong>
          <h1 style={{ margin: "12px 0", fontSize: 24 }}>화면을 표시하는 중 문제가 발생했습니다.</h1>
          <p style={{ margin: 0, lineHeight: 1.7, color: "#4b6075" }}>
            계좌와 주문 정보는 서버에 안전하게 보관되어 있습니다. 다시 시도해도 같은 문제가 반복되면 페이지를 새로고침해 주세요.
          </p>
          <div style={{ display: "flex", gap: 8, marginTop: 20 }}>
            <button type="button" onClick={this.retry} style={{ padding: "10px 16px", borderRadius: 8, border: "1px solid #005891", background: "white", color: "#005891", cursor: "pointer" }}>
              다시 시도
            </button>
            <button type="button" onClick={() => window.location.reload()} style={{ padding: "10px 16px", borderRadius: 8, border: 0, background: "#005891", color: "white", cursor: "pointer" }}>
              새로고침
            </button>
          </div>
        </section>
      </main>
    );
  }
}
