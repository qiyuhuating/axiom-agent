import { useSyncExternalStore } from "react";
import {
  SIDEBAR_AUTO_COLLAPSE,
  SIDEBAR_COLLAPSED,
  SIDEBAR_DRAWER_BREAKPOINT,
} from "../vendor/dsh/layout/columns.ts";

const SIDEBAR_WIDTH = 248;
const CENTER_MIN = 560;
const WORKBENCH_MIN = 300;
const WORKBENCH_DEFAULT_MAX = 680;

function defaultWorkbenchWidth(width: number) {
  return Math.min(WORKBENCH_DEFAULT_MAX, Math.max(360, Math.round(width * 0.3)));
}

export function resolveColumns(s: LayoutState) {
  const drawer = s.width < SIDEBAR_DRAWER_BREAKPOINT;
  const sidebar = drawer ? 0 : s.collapsed ? SIDEBAR_COLLAPSED : SIDEBAR_WIDTH;
  const maxRightbar = Math.min(Math.floor(s.width * 0.7), s.width - sidebar - CENTER_MIN);
  const requested = s.rightbarWidth ?? defaultWorkbenchWidth(s.width);
  const rightbar =
    s.workbenchOpen && !drawer && maxRightbar >= WORKBENCH_MIN
      ? Math.max(WORKBENCH_MIN, Math.min(requested, maxRightbar))
      : 0;
  return {
    sidebar,
    center: s.width - sidebar - rightbar,
    rightbar,
    maxRightbar,
    overlayWidth: Math.min(s.width, Math.max(WORKBENCH_MIN, Math.min(requested, s.width * 0.7))),
  };
}

let preference: boolean | undefined;
type LayoutState = {
  width: number;
  collapsed: boolean;
  drawer: boolean;
  workbenchOpen: boolean;
  fullscreen: boolean;
  rightbarWidth: number | null;
  resizing: boolean;
};
let state: LayoutState = {
  width: window.innerWidth,
  collapsed:
    window.innerWidth < SIDEBAR_AUTO_COLLAPSE && window.innerWidth >= SIDEBAR_DRAWER_BREAKPOINT,
  drawer: false,
  workbenchOpen: false,
  fullscreen: false,
  rightbarWidth: Number(localStorage.getItem("axiom.rightbar.width")) || null,
  resizing: false,
};
const listeners = new Set<() => void>();
const subscribe = (fn: () => void) => {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
};
export const layoutState = () => state;
export const useLayout = () => useSyncExternalStore(subscribe, layoutState);
function set(patch: Partial<LayoutState>) {
  if (Object.entries(patch).every(([key, value]) => state[key as keyof LayoutState] === value))
    return;
  state = { ...state, ...patch };
  for (const fn of listeners) fn();
}
export const layoutActions = {
  resize(width: number) {
    set({
      width,
      collapsed:
        width >= SIDEBAR_DRAWER_BREAKPOINT && (preference ?? width < SIDEBAR_AUTO_COLLAPSE),
      drawer: width < SIDEBAR_DRAWER_BREAKPOINT && state.drawer,
    });
  },
  collapse() {
    if (state.width < SIDEBAR_DRAWER_BREAKPOINT) set({ drawer: false });
    else {
      preference = true;
      set({ collapsed: true });
    }
  },
  expand() {
    if (state.width < SIDEBAR_DRAWER_BREAKPOINT) set({ drawer: !state.drawer });
    else {
      preference = false;
      set({ collapsed: false });
    }
  },
  closeDrawer() {
    set({ drawer: false });
  },
  showWorkbench() {
    set({ workbenchOpen: true, drawer: false });
  },
  hideWorkbench() {
    set({ workbenchOpen: false });
  },
  toggleWorkbench() {
    set({ workbenchOpen: !state.workbenchOpen });
  },
  setFullscreen(fullscreen: boolean) {
    if (fullscreen !== state.fullscreen) set({ fullscreen });
  },
  setRightbarWidth(width: number, persist = true) {
    const { maxRightbar } = resolveColumns(state);
    if (maxRightbar < WORKBENCH_MIN) return;
    const next = Math.round(Math.max(WORKBENCH_MIN, Math.min(width, maxRightbar)));
    if (persist) localStorage.setItem("axiom.rightbar.width", String(next));
    if (state.rightbarWidth === next) return;
    set({ rightbarWidth: next });
  },
  setResizing(resizing: boolean) {
    if (state.resizing !== resizing) set({ resizing });
  },
  apply(s: LayoutState) {
    const drawer = s.width < SIDEBAR_DRAWER_BREAKPOINT;
    const c = resolveColumns(s);
    document.body.classList.toggle("sidebar-collapsed", s.collapsed);
    document.body.classList.toggle("sidebar-drawer", s.drawer);
    document.body.classList.toggle("workbench-open", s.workbenchOpen);
    document.body.classList.toggle(
      "rightbar-fullscreen",
      s.workbenchOpen && (s.fullscreen || s.width < SIDEBAR_DRAWER_BREAKPOINT),
    );
    document.body.classList.toggle(
      "workbench-overlay",
      s.workbenchOpen && (drawer || c.rightbar === 0),
    );
    document.body.style.setProperty("--sidebar-width", c.sidebar + "px");
    document.body.style.setProperty("--trace-width", c.rightbar + "px");
    document.body.style.setProperty("--dsh-rightbar-width", (c.rightbar || c.overlayWidth) + "px");
  },
};
