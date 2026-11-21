import { useSyncExternalStore } from "react";
import {
  computeColumns,
  RIGHTBAR_DEFAULT_RATIO,
  SIDEBAR_AUTO_COLLAPSE,
  SIDEBAR_DEFAULT,
  SIDEBAR_DRAWER_BREAKPOINT,
} from "../vendor/dsh/layout/columns.ts";

let preference: boolean | undefined;
type LayoutState = {
  width: number;
  collapsed: boolean;
  drawer: boolean;
  workbenchOpen: boolean;
  wide: boolean;
};
let state: LayoutState = {
  width: window.innerWidth,
  collapsed:
    window.innerWidth < SIDEBAR_AUTO_COLLAPSE && window.innerWidth >= SIDEBAR_DRAWER_BREAKPOINT,
  drawer: false,
  workbenchOpen: false,
  wide: false,
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
  toggleWorkbench() {
    set({ workbenchOpen: !state.workbenchOpen });
  },
  setWide(wide: boolean) {
    set({ wide });
  },
  apply(s: LayoutState) {
    const drawer = s.width < SIDEBAR_DRAWER_BREAKPOINT;
    const c = computeColumns(
      s.width,
      s.collapsed ? 0 : SIDEBAR_DEFAULT,
      s.workbenchOpen ? s.width * (s.wide ? 0.65 : RIGHTBAR_DEFAULT_RATIO) : 0,
    );
    document.body.classList.toggle("sidebar-collapsed", s.collapsed);
    document.body.classList.toggle("sidebar-drawer", s.drawer);
    document.body.classList.toggle("workbench-open", s.workbenchOpen);
    document.body.classList.toggle(
      "workbench-overlay",
      s.workbenchOpen && (drawer || c.rightbar === 0),
    );
    document.body.style.setProperty("--sidebar-width", c.sidebar + "px");
    document.body.style.setProperty("--trace-width", c.rightbar + "px");
  },
};
