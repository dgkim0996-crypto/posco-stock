import { useEffect, useRef, useState } from "react";
import { MAX_VISIBLE_CANDLES, MIN_PRICE_SCALE, MAX_PRICE_SCALE } from "./chartConstants.js";

// Own horizontal/vertical zoom and pointer state; consumers supply current SVG geometry.
export function useChartViewport({ candleCount, assetId, period }) {
  const [hoverIndex, setHoverIndex] = useState(null);
  const [viewRange, setViewRange] = useState({ start: 0, end: 0 });
  const [priceScale, setPriceScale] = useState(1);
  const svgRef = useRef(null);
  const dragRef = useRef(null);

  // 종목이나 기간이 바뀌면 기간별 기본 봉 개수로 화면 범위를 초기화한다.
  useEffect(() => {
    const end = candleCount;
    const initialCount = Math.min(MAX_VISIBLE_CANDLES, end);
    setViewRange({ start: Math.max(0, end - initialCount), end });
    setHoverIndex(null);
  }, [assetId, period, candleCount]);

  // 다른 종목이나 기간으로 이동하면 세로축을 해당 데이터의 자동 범위로 되돌린다.
  useEffect(() => {
    setPriceScale(1);
  }, [assetId, period]);

  // React의 wheel 이벤트는 브라우저에서 passive 리스너로 처리될 수 있다.
  // 차트 위에서 휠을 돌릴 때 페이지까지 함께 스크롤되지 않도록 non-passive 리스너를 직접 등록한다.
  useEffect(() => {
    const chart = svgRef.current;
    if (!chart) return undefined;

    function handleChartWheel(event) {
      event.preventDefault();

      const total = candleCount;
      if (!total) return;

      const rect = chart.getBoundingClientRect();
      const centerRatio = rect.width > 0
        ? Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width))
        : 0.5;
      const factor = event.deltaY < 0 ? 0.8 : 1.25;

      setViewRange((current) => {
        const end = current.end || total;
        const currentCount = Math.max(1, end - current.start);
        const minimumCount = Math.min(8, total);
        const nextCount = Math.max(
          minimumCount,
          Math.min(total, MAX_VISIBLE_CANDLES, Math.round(currentCount * factor)),
        );
        const center = current.start + currentCount * centerRatio;
        let start = Math.round(center - nextCount * centerRatio);
        start = Math.max(0, Math.min(total - nextCount, start));
        return { start, end: start + nextCount };
      });
      setHoverIndex(null);
    }

    chart.addEventListener("wheel", handleChartWheel, { passive: false });
    return () => chart.removeEventListener("wheel", handleChartWheel);
  }, [candleCount]);

  function getPointerHandlers(prepared) {
    const { w, h, left, plotW, priceBottom, axisBottom, clean } = prepared;
    // 포인터 툴팁을 이동하고 드래그 중에는 차트 이동 또는 시간축 확대를 수행한다.
    function handlePointerMove(event) {
      const rect = svgRef.current?.getBoundingClientRect();
      if (!rect) return;
      if (dragRef.current) {
        const baseCount = dragRef.current.end - dragRef.current.start;
        if (dragRef.current.mode === "price-scale") {
          const delta = event.clientY - dragRef.current.y;
          const nextScale = dragRef.current.priceScale * Math.exp(delta / 180);
          setPriceScale(Math.max(MIN_PRICE_SCALE, Math.min(MAX_PRICE_SCALE, nextScale)));
        } else if (dragRef.current.mode === "time-scale") {
          const delta = event.clientX - dragRef.current.x;
          const nextCount = Math.max(8, Math.min(candleCount, MAX_VISIBLE_CANDLES, Math.round(baseCount * Math.exp(-delta / 220))));
          const center = dragRef.current.start + baseCount / 2;
          let start = Math.round(center - nextCount / 2);
          start = Math.max(0, Math.min(candleCount - nextCount, start));
          setViewRange({ start, end: start + nextCount });
        } else {
          const pointWidth = rect.width / Math.max(1, baseCount - 1);
          const shift = Math.round((dragRef.current.x - event.clientX) / pointWidth);
          if (shift !== 0) {
            const maxStart = Math.max(0, candleCount - baseCount);
            const start = Math.max(0, Math.min(maxStart, dragRef.current.start + shift));
            setViewRange({ start, end: start + baseCount });
          }
        }
        return;
      }
      const svgX = ((event.clientX - rect.left) / rect.width) * w;
      const ratio = Math.max(0, Math.min(1, (svgX - left) / plotW));
      setHoverIndex(Math.round(ratio * (clean.length - 1)));
    }

    // 본문/시간축 더블클릭은 기간을, 우측 가격축 더블클릭은 세로 자동 범위를 복원한다.
    function resetRange(event) {
      const rect = svgRef.current?.getBoundingClientRect();
      const svgX = rect ? ((event.clientX - rect.left) / rect.width) * prepared.w : 0;
      if (svgX > left + plotW) {
        setPriceScale(1);
        return;
      }
      setViewRange({ start: Math.max(0, candleCount - MAX_VISIBLE_CANDLES), end: candleCount });
      setPriceScale(1);
      setHoverIndex(null);
    }

    return {
      onPointerDown(event) {
        const rect = event.currentTarget.getBoundingClientRect();
        const svgX = ((event.clientX - rect.left) / rect.width) * w;
        const svgY = ((event.clientY - rect.top) / rect.height) * h;
        dragRef.current = {
          mode: svgX > left + plotW && svgY <= priceBottom ? "price-scale" : svgY >= axisBottom - 18 ? "time-scale" : "pan",
          x: event.clientX,
          y: event.clientY,
          start: viewRange.start,
          end: viewRange.end,
          priceScale,
        };
        event.currentTarget.setPointerCapture(event.pointerId);
      },
      onPointerMove: handlePointerMove,
      onPointerUp(event) {
        dragRef.current = null;
        event.currentTarget.releasePointerCapture(event.pointerId);
      },
      onPointerCancel() { dragRef.current = null; },
      onPointerLeave() { if (!dragRef.current) setHoverIndex(null); },
      onDoubleClick: resetRange,
    };
  }

  return { hoverIndex, viewRange, priceScale, svgRef, dragRef, getPointerHandlers };
}
