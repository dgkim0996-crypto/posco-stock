import React from "react";

export default function OrderToasts({
  orderToasts, dismissOrderToast,
}) {
  return (
    <div className="order-toast-viewport" aria-live="polite" aria-label="주문 처리 알림">
      {orderToasts.map((toast) => (
        <article className={`order-toast is-${toast.tone}`} key={toast.id} role={toast.tone === "error" ? "alert" : "status"}>
          <span className="order-toast-icon" aria-hidden="true">
            {toast.tone === "success" ? "✓" : toast.tone === "info" ? "i" : "!"}
          </span>
          <div>
            <strong>{toast.title}</strong>
            <p>{toast.text}</p>
          </div>
          <button type="button" onClick={() => dismissOrderToast(toast.id)} aria-label="주문 알림 닫기">×</button>
          <span className="order-toast-progress" aria-hidden="true" />
        </article>
      ))}
    </div>
  );
}
