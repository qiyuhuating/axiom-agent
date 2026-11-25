import {
  Activity,
  File,
  Folder,
  GitCompare,
  Globe,
  PanelLeft,
  Paperclip,
  Plus,
  Settings,
  Terminal as TerminalIcon,
  Workflow,
} from "lucide-react";
import type { CSSProperties } from "react";
import React, { useEffect, useMemo, useSyncExternalStore } from "react";
import { DockController, DockLayout } from "../vendor/dsh/dockkit/index.ts";
import guideCss from "../vendor/dsh/guide/GuideBody.module.css";
import { CompassGlyph } from "../vendor/dsh/guide/GuideTitle.tsx";
import sidebarCss from "../vendor/dsh/sidebar/SidebarRoot.module.css";
import panelCss from "../vendor/dsh/sidebar-right/SidebarRight.module.css";
import { TraceLedger } from "./harness-features.tsx";
import { dirtyTabs } from "./panel-shared.tsx";
import { getSnapshot, useProjectionField } from "./projection.ts";
import { layoutActions, layoutState, useLayout } from "./shell-layout.ts";
import { BrowserView, Files, GitDiff } from "./workbench-files.tsx";
import { Jobs } from "./workbench-jobs.tsx";
import { Resources } from "./workbench-resources.tsx";
import { openSettings } from "./workbench-settings.tsx";
import "@xterm/xterm/css/xterm.css";
import "../vendor/dsh/primitives/DiffBlock.module.css";
import "../vendor/dsh/primitives/CodeCard.module.css";

export { DialogView } from "./workbench-dialog.tsx";
export { openSettings, SettingsOverlay } from "./workbench-settings.tsx";

const Editor = React.lazy(() => import("./editor.tsx"));
const TerminalView = React.lazy(() => import("./terminal.tsx"));
const icons = {
  files: Folder,
  editor: File,
  diff: GitCompare,
  terminal: TerminalIcon,
  settings: Settings,
  resources: Paperclip,
  jobs: Workflow,
  browser: Globe,
  guide: Plus,
  trajectory: Activity,
};
const names = {
  files: "文件",
  diff: "Git Diff",
  terminal: "终端",
  settings: "设置",
  resources: "Skills / MCP",
  jobs: "任务与计划",
  browser: "浏览器",
  guide: "工作台",
  trajectory: "执行轨迹",
};
const labels = {
  emptyPane: "打开工作台功能",
  splitPane: "拆分面板",
  splitPaneDisabled: "达到面板上限",
  splitPaneNarrow: "面板宽度不足",
  closeTab: "关闭标签",
  addTab: "新标签",
  dockFloat: "停靠",
  closeFloat: "关闭浮动面板",
  dropZone: {
    center: "移入",
    top: "上方",
    right: "右方",
    bottom: "下方",
    left: "左方",
  },
};
const make = (id: any) => ({
  id,
  kind: "guide",
  title: "工作台",
  contentId: id,
});
/** Each Pi session keeps an independent right dock, matching Harness SidebarRight. */
const controllers = new Map<string, DockController>();
function controllerFor(sessionId?: string) {
  const id = sessionId ?? "";
  let controller = controllers.get(id);
  if (!controller && id) {
    // The first session can arrive after the shell renders. Keep tabs and
    // mounted terminal processes when that anonymous layout gains an owner.
    controller = controllers.get("");
    if (controller) controllers.delete("");
  }
  if (!controller) {
    controller = new DockController({ makeInitialTab: make, makePaneTab: make });
    controller.setExpanded(false);
  }
  controllers.set(id, controller);
  return controller;
}
const activeController = () => controllerFor(getSnapshot().state?.sessionId);
export function forgetRightbarSession(sessionId: string) {
  controllers.delete(sessionId);
}
export function toggleRightbar() {
  const next = !layoutState().workbenchOpen;
  activeController().setExpanded(next);
  if (next) layoutActions.showWorkbench();
  else layoutActions.hideWorkbench();
}
export const open = (kind: string, title?: string, id?: string) => {
  if (kind === "settings") {
    openSettings();
    return;
  }
  activeController().openContent({
    kind,
    title: title || names[kind as keyof typeof names] || kind,
    contentId: id || (["terminal", "browser"].includes(kind) ? crypto.randomUUID() : kind),
  });
};
function Guide() {
  return (
    <div className={guideCss.guide}>
      <span className={guideCss.hero}>
        <CompassGlyph size={56} />
      </span>
      {Object.entries(names)
        .filter(([kind]) => kind !== "guide")
        .map(([kind, label]) => {
          const Icon = icons[kind as keyof typeof icons];
          return (
            <button
              type="button"
              key={kind}
              className={guideCss.entry}
              title={label}
              onClick={() => open(kind)}
            >
              <span className={guideCss.entryIcon}>
                <Icon size={22} />
              </span>
              <span className={guideCss.entryText}>
                <span className={guideCss.entryTitle}>{label}</span>
              </span>
            </button>
          );
        })}
    </div>
  );
}

function Trajectory() {
  const tools = useProjectionField("tools");
  const busy = useProjectionField("busy");
  return (
    <div className="wb-panel axiom-trajectory-pane">
      <div className="wb-bar">
        <strong>执行轨迹</strong>
      </div>
      <div className="wb-scroll" id="trace">
        <TraceLedger tools={tools} busy={busy} />
      </div>
    </div>
  );
}
function renderTab(tab: any) {
  switch (tab.kind) {
    case "files":
      return <Files />;
    case "editor":
      return (
        <React.Suspense fallback={<p>Loading editor…</p>}>
          <Editor path={tab.contentId} />
        </React.Suspense>
      );
    case "diff":
      return <GitDiff />;
    case "terminal":
      return (
        <React.Suspense fallback={<p>Loading terminal…</p>}>
          <TerminalView />
        </React.Suspense>
      );

    case "resources":
      return <Resources />;
    case "jobs":
      return <Jobs />;
    case "trajectory":
      return <Trajectory />;
    case "browser":
      return <BrowserView />;
    default:
      return <Guide />;
  }
}
export function SidebarPanels() {
  const { collapsed, workbenchOpen } = useLayout();
  const sessionId = useProjectionField("state")?.sessionId;
  const controller = controllerFor(sessionId);
  const { state } = useSyncExternalStore(controller.subscribe, controller.getSnapshot);
  const pane = state.nodes[state.activePaneId];
  const activeTab = pane?.kind === "pane" && pane.activeTabId ? state.tabs[pane.activeTabId] : null;
  return (
    <div className={sidebarCss.panelList + " axiom-panel-list"}>
      {(["files", "terminal", "browser", "diff", "jobs", "resources"] as const).map((kind) => {
        const Icon = icons[kind];
        const active = workbenchOpen && activeTab?.kind === kind;
        return (
          <div
            key={kind}
            className={[
              sidebarCss.panelEntry,
              !collapsed && sidebarCss.panelEntryWide,
              active && sidebarCss.panelEntryActive,
            ]
              .filter(Boolean)
              .join(" ")}
          >
            <button
              type="button"
              className={sidebarCss.panelRow}
              title={names[kind]}
              aria-label={names[kind]}
              aria-current={active ? "page" : undefined}
              onClick={() => {
                openPanel(kind);
              }}
            >
              <span className={sidebarCss.panelGlyph} aria-hidden="true">
                <Icon size={collapsed ? 18 : 16} />
              </span>
              <span className={sidebarCss.panelTitle}>{names[kind]}</span>
            </button>
          </div>
        );
      })}
    </div>
  );
}
/** Original Harness SidebarRight fullscreen controls. */
function FullscreenGlyph() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path
        d="M2.33203 10.4054V13.1681C2.33229 13.444 2.55605 13.6681 2.83203 13.6681H5.49512V14.6681H2.83203C2.00376 14.6681 1.33229 13.9963 1.33203 13.1681V10.4054H2.33203ZM14.6689 13.1681C14.6687 13.996 13.9968 14.6676 13.1689 14.6681H10.4951V13.6681H13.1689C13.4445 13.6676 13.6687 13.4437 13.6689 13.1681V10.4054H14.6689V13.1681ZM13.1689 1.33118C13.9969 1.33163 14.6688 2.00315 14.6689 2.83118V5.4054H13.6689V2.83118C13.6688 2.55544 13.4446 2.33162 13.1689 2.33118H10.4951V1.33118H13.1689ZM5.49512 2.33118H2.83203C2.55598 2.33118 2.33218 2.55516 2.33203 2.83118V5.4054H1.33203V2.83118C1.33218 2.00288 2.00369 1.33118 2.83203 1.33118H5.49512V2.33118Z"
        fill="currentColor"
      />
    </svg>
  );
}

/** Restore-from-fullscreen glyph from the shared product artwork. */
function ExitFullscreenGlyph() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path
        d="M9 2.5V6C9 6.26522 9.10536 6.51957 9.29289 6.70711C9.48043 6.89464 9.73478 7 10 7H13.5"
        stroke="currentColor"
      />
      <path
        d="M7 13.5V10C7 9.73478 6.89464 9.48043 6.70711 9.29289C6.51957 9.10536 6.26522 9 6 9H2.5"
        stroke="currentColor"
      />
    </svg>
  );
}
export function Workbench() {
  const sessionId = useProjectionField("state")?.sessionId;
  const controller = controllerFor(sessionId);
  const snapshot = useSyncExternalStore(controller.subscribe, controller.getSnapshot);
  const layout = useLayout();
  const proxy = useMemo(
    () =>
      new Proxy(controller, {
        get(target, key) {
          if (key === "closeTab")
            return (id: any) => {
              const tab = target.getSnapshot().state.tabs[id];
              if (tab && dirtyTabs.has(tab.contentId) && !window.confirm("关闭并丢弃未保存修改？"))
                return;
              target.closeTab(id);
            };
          const value = (target as any)[key];
          return typeof value === "function" ? value.bind(target) : value;
        },
      }),
    [controller],
  );
  useEffect(() => {
    const surface = controller.getSnapshot().state;
    layoutActions.setFullscreen(surface.mode === "fullscreen");
    if (surface.expanded) layoutActions.showWorkbench();
    else layoutActions.hideWorkbench();
  }, [controller]);
  function toggleFullscreen() {
    const next = !layout.fullscreen;
    controller.setMode(next ? "fullscreen" : "push");
    layoutActions.setFullscreen(next);
  }
  const fullscreen = layout.fullscreen || layout.width < 768;
  const shown = layout.workbenchOpen;
  const width = fullscreen ? "calc(100vw + 1px)" : "var(--dsh-rightbar-width)";
  return (
    <div
      className={panelCss.panel + " axiom-sidebar-right-panel"}
      style={{ width, "--dsh-sidebar-width": width } as CSSProperties}
      data-sidebar-right-panel={fullscreen ? "fullscreen" : "push"}
      data-sidebar-right-open={shown || undefined}
      aria-hidden={(!shown && snapshot.state.floats.length === 0) || undefined}
    >
      <div className={panelCss.panelBody}>
        <DockLayout
          state={snapshot.state}
          canSplit={snapshot.canSplit}
          canAddTab={(paneId) => {
            const pane = snapshot.state.nodes[paneId];
            return (
              pane?.kind === "pane" &&
              !pane.tabs.some((id) => snapshot.state.tabs[id]?.kind === "guide")
            );
          }}
          intents={proxy}
          labels={labels}
          dropZones="horizontal"
          keepMounted={() => true}
          renderTab={(tab) => <div className={panelCss.tabBody}>{renderTab(tab)}</div>}
          renderTabTitle={(tab) => {
            const Icon = icons[tab.kind as keyof typeof icons];
            return (
              <span className={panelCss.tabTitle}>
                {tab.kind === "guide" ? (
                  <CompassGlyph size={14} className={guideCss.titleIcon} />
                ) : Icon ? (
                  <Icon size={14} aria-hidden="true" />
                ) : null}
                <span>{tab.title}</span>
              </span>
            );
          }}
          chrome={
            <div className="axiom-rightbar-chrome">
              <button
                type="button"
                className={panelCss.iconButton}
                title={layout.fullscreen ? "退出全屏" : "全屏展开"}
                aria-label={layout.fullscreen ? "退出全屏" : "全屏展开"}
                data-sidebar-right-mode={layout.fullscreen ? "push" : "fullscreen"}
                disabled={layout.width < 768}
                onClick={toggleFullscreen}
              >
                {layout.fullscreen ? <ExitFullscreenGlyph /> : <FullscreenGlyph />}
              </button>
              <button
                type="button"
                id="rightbar-collapse"
                className={panelCss.iconButton}
                title="收起右侧栏"
                aria-label="收起右侧栏"
                data-sidebar-right-toggle
                onClick={toggleRightbar}
              >
                <PanelLeft className={panelCss.collapseGlyph} size={16} />
              </button>
            </div>
          }
        />
      </div>
    </div>
  );
}
export function openDelivery(path: string) {
  activeController().setExpanded(true);
  layoutActions.showWorkbench();
  open("editor", path.split("/").at(-1), path);
}
export function openPanel(kind: string) {
  if (kind === "settings") {
    openSettings();
    return;
  }
  activeController().setExpanded(true);
  layoutActions.showWorkbench();
  open(kind);
}
