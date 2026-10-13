import { useState, useEffect } from "react";
import { loadDashboardWidgets } from "./dashboardStorage.js";
import { DASHBOARD_STORAGE_KEY } from "../preferences/storageKeys.js";
import { writeStorage } from "../preferences/preferenceStorage.js";
import { DEFAULT_DASHBOARD_WIDGETS } from "./dashboardConstants.js";

// 기존 거래 화면의 상태와 처리 순서를 기능 단위로 캡슐화한다.
export function useDashboardLayout() {
  const [dashboardWidgets, setDashboardWidgets] = useState(loadDashboardWidgets);

  const [editDashboard, setEditDashboard] = useState(false);

  const [draggingWidget, setDraggingWidget] = useState(null);

  const [dragOverWidget, setDragOverWidget] = useState(null);

  const [resizingWidget, setResizingWidget] = useState(null);

  useEffect(() => {
    // 저장공간이 막혀도 현재 배치는 화면 상태로 유지한다.
    writeStorage(DASHBOARD_STORAGE_KEY, JSON.stringify(dashboardWidgets));
  }, [dashboardWidgets]);

  function updateDashboardWidget(id, patch) {
    setDashboardWidgets((prev) =>
      prev.map((widget) => (widget.id === id ? { ...widget, ...patch } : widget)),
    );
  }

  function startDashboardResize(event, widget) {
    if (!editDashboard || widget.collapsed) return;
    event.preventDefault();
    event.stopPropagation();

    const grid = event.currentTarget.closest(".dashboard-grid");
    const card = event.currentTarget.closest(".dashboard-widget");
    if (!grid || !card) return;

    const gridRect = grid.getBoundingClientRect();
    const cardRect = card.getBoundingClientRect();
    const startX = event.clientX;
    const startY = event.clientY;
    const startWidth = cardRect.width;
    const startHeight = cardRect.height;
    const minWidth = Math.min(320, gridRect.width);

    setResizingWidget(widget.id);
    document.body.classList.add("dashboard-resizing");

    const onMove = (moveEvent) => {
      const nextWidth = Math.max(minWidth, Math.min(gridRect.width, startWidth + moveEvent.clientX - startX));
      const nextHeight = Math.max(250, Math.min(680, startHeight + moveEvent.clientY - startY));
      const nextCols = Math.max(4, Math.min(12, Math.round((nextWidth / gridRect.width) * 12)));
      const snappedHeight = Math.round(nextHeight / 10) * 10;

      setDashboardWidgets((prev) => prev.map((item) =>
        item.id === widget.id ? { ...item, cols: nextCols, height: snappedHeight } : item,
      ));
    };

    const onUp = () => {
      setResizingWidget(null);
      document.body.classList.remove("dashboard-resizing");
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  }

  function moveDashboardWidget(sourceId, targetId) {
    if (!sourceId || !targetId || sourceId === targetId) return;

    setDashboardWidgets((prev) => {
      const next = [...prev];
      const sourceIndex = next.findIndex((widget) => widget.id === sourceId);
      const targetIndex = next.findIndex((widget) => widget.id === targetId);
      if (sourceIndex < 0 || targetIndex < 0) return prev;
      const [moved] = next.splice(sourceIndex, 1);
      next.splice(targetIndex, 0, moved);
      return next;
    });
  }

  function resetDashboardLayout() {
    setDashboardWidgets(DEFAULT_DASHBOARD_WIDGETS.map((widget) => ({ ...widget })));
    setDraggingWidget(null);
    setDragOverWidget(null);
    setResizingWidget(null);
    document.body.classList.remove("dashboard-resizing");
  }

  return {
    dashboardWidgets, editDashboard, setEditDashboard, draggingWidget, setDraggingWidget, dragOverWidget,
    setDragOverWidget, resizingWidget, updateDashboardWidget, startDashboardResize, moveDashboardWidget,
    resetDashboardLayout,
  };
}
