import { useEffect, useRef } from "react";
import frameCss from "../vendor/dsh/layout/AppFrame.module.css";
import {
  computeColumns,
  RIGHTBAR_DEFAULT_RATIO,
  SIDEBAR_DEFAULT,
} from "../vendor/dsh/layout/columns.ts";
import { layoutActions, layoutState, useLayout } from "./shell-layout.ts";

export function RightbarResizeHandle() {
  const layout = useLayout();
  const columns = computeColumns(
    layout.width,
    layout.collapsed ? 0 : SIDEBAR_DEFAULT,
    layout.workbenchOpen ? (layout.rightbarWidth ?? layout.width * RIGHTBAR_DEFAULT_RATIO) : 0,
  );
  const gesture = useRef<{ pointer: number; x: number; width: number } | null>(null);
  const scheduled = useRef<number | null>(null);
  const nextWidth = useRef<number | null>(null);

  const flush = () => {
    if (nextWidth.current !== null) layoutActions.setRightbarWidth(nextWidth.current, false);
    nextWidth.current = null;
    scheduled.current = null;
  };
  const end = () => {
    if (!gesture.current) return;
    if (scheduled.current !== null) cancelAnimationFrame(scheduled.current);
    flush();
    layoutActions.setRightbarWidth(layoutState().rightbarWidth ?? gesture.current.width);
    gesture.current = null;
    layoutActions.setResizing(false);
  };
  useEffect(
    () => () => {
      if (scheduled.current !== null) cancelAnimationFrame(scheduled.current);
      if (gesture.current) layoutActions.setResizing(false);
    },
    [],
  );

  if (!layout.workbenchOpen || layout.fullscreen || layout.width < 768 || columns.rightbar === 0)
    return null;

  return (
    <hr
      className={frameCss.handle + " axiom-rightbar-resize"}
      tabIndex={0}
      aria-label="调整右侧栏宽度"
      aria-orientation="vertical"
      aria-valuemin={300}
      aria-valuemax={Math.round(layout.width * 0.7)}
      aria-valuenow={Math.round(columns.rightbar)}
      style={{ left: layout.width - columns.rightbar }}
      onPointerDown={(event) => {
        if (event.button !== 0 || gesture.current) return;
        gesture.current = { pointer: event.pointerId, x: event.clientX, width: columns.rightbar };
        event.currentTarget.setPointerCapture(event.pointerId);
        layoutActions.setResizing(true);
      }}
      onPointerMove={(event) => {
        const active = gesture.current;
        if (!active || active.pointer !== event.pointerId) return;
        nextWidth.current = active.width - (event.clientX - active.x);
        scheduled.current ??= requestAnimationFrame(flush);
      }}
      onPointerUp={(event) => {
        if (gesture.current?.pointer !== event.pointerId) return;
        nextWidth.current = gesture.current.width - (event.clientX - gesture.current.x);
        end();
      }}
      onPointerCancel={end}
      onLostPointerCapture={end}
      onKeyDown={(event) => {
        if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
        event.preventDefault();
        layoutActions.setRightbarWidth(columns.rightbar + (event.key === "ArrowLeft" ? 16 : -16));
      }}
    />
  );
}
