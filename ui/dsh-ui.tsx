import {
  Activity,
  ArrowUp,
  MessageSquare,
  PanelLeft,
  PanelRight,
  Paperclip,
  Plus,
  Search,
  Settings,
  Square,
  SunMoon,
  Trash2,
} from "lucide-react";

export { initComposerMenu } from "./composer-menu.tsx";
export { clearUserText, drawUserText, maskCredentials } from "./secret-view.tsx";

import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import heroCss from "../vendor/dsh/conversation/HeroShell.module.css";
import inputCss from "../vendor/dsh/conversation/InputBar.module.css";
import {
  computeColumns,
  RIGHTBAR_DEFAULT_RATIO,
  SIDEBAR_AUTO_COLLAPSE,
  SIDEBAR_DEFAULT,
  SIDEBAR_DRAWER_BREAKPOINT,
} from "../vendor/dsh/layout/columns.ts";
import { Button } from "../vendor/dsh/primitives/Button.tsx";
import { Modal } from "../vendor/dsh/primitives/Modal.tsx";
import rowsCss from "../vendor/dsh/sidebar/Rows.module.css";
import settingsCss from "../vendor/dsh/sidebar/SettingsRoot.module.css";
import sidebarCss from "../vendor/dsh/sidebar/SidebarRoot.module.css";
import workspaceCss from "../vendor/dsh/sidebar/WorkspaceBrowser.module.css";
import { maskCredentials } from "./credential-mask.ts";
import "../vendor/dsh/theme/base.css";
import "../vendor/dsh/theme/design-platform.css";
import "../vendor/dsh/theme/scrollbar.css";
import "../vendor/dsh/theme/focus.css";

type Session = { id: string; name?: string; firstMessage?: string };
type Props = {
  sessions: Session[];
  current: string | null;
  disabled: boolean;
  onSelect: (id: string) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
};
function SessionList({ sessions, current, disabled, onSelect, onDelete }: Props) {
  const [query, setQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const [target, setTarget] = useState<Session | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [failure, setFailure] = useState("");
  const title = (s: Session) => maskCredentials(s.name || s.firstMessage || "未命名会话");
  async function confirm() {
    if (!target || deleting) return;
    setDeleting(true);
    setFailure("");
    try {
      await onDelete(target.id);
      setTarget(null);
    } catch (e) {
      setFailure(e instanceof Error ? e.message : String(e));
    } finally {
      setDeleting(false);
    }
  }
  return (
    <>
      <div className={workspaceCss.root + " axiom-workspace-list"}>
        <div className={workspaceCss.sectionHeader}>
          {searching ? (
            <input
              className="session-search"
              ref={(input) => {
                if (input) input.focus();
              }}
              aria-label="搜索会话"
              placeholder="搜索会话"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape") {
                  setQuery("");
                  setSearching(false);
                }
              }}
            />
          ) : (
            <span className={workspaceCss.sectionLabel}>会话历史</span>
          )}
          <button
            type="button"
            className={workspaceCss.iconButton}
            title="搜索会话"
            aria-label="搜索会话"
            aria-expanded={searching}
            onClick={() => {
              setSearching(!searching);
              setQuery("");
            }}
          >
            <Search size={16} />
          </button>
        </div>
        <div className={workspaceCss.list + " session-list"}>
          {sessions.length === 0 && <p className="empty-sessions">暂无历史会话</p>}
          {sessions
            .filter((s) => title(s).toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()))
            .map((s) => (
              <div
                key={s.id}
                className={
                  rowsCss.sessionRow +
                  " session-row" +
                  (s.id === current ? " " + rowsCss.selected + " active" : "")
                }
              >
                <Button
                  variant="ghost"
                  className="session-select"
                  disabled={disabled || deleting}
                  aria-current={s.id === current ? "page" : undefined}
                  title={title(s)}
                  icon={<MessageSquare size={16} strokeWidth={1.7} />}
                  onClick={() => void onSelect(s.id)}
                >
                  <span className={rowsCss.title}>{title(s)}</span>
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="session-delete"
                  disabled={disabled || deleting}
                  aria-label={"删除会话：" + title(s)}
                  title="删除会话"
                  icon={<Trash2 size={16} strokeWidth={1.7} />}
                  onClick={() => {
                    setFailure("");
                    setTarget(s);
                  }}
                />
              </div>
            ))}
        </div>
      </div>
      <Modal
        open={target !== null}
        title="删除会话"
        tone="warning"
        closeLabel="关闭"
        onClose={() => {
          if (!deleting) setTarget(null);
        }}
        description="此操作将永久删除该会话的本地历史记录，不会删除工作区文件。"
        footer={
          <>
            <Button
              variant="outline"
              data-modal-autofocus
              disabled={deleting}
              onClick={() => setTarget(null)}
            >
              取消
            </Button>
            <Button
              className="danger"
              disabled={deleting || disabled}
              variant="primary"
              onClick={() => void confirm()}
            >
              {deleting ? "删除中…" : "确认删除"}
            </Button>
          </>
        }
      >
        <div className="delete-session-name">{target && title(target)}</div>
        {failure && (
          <p className="delete-error" role="alert">
            {failure}
          </p>
        )}
      </Modal>
    </>
  );
}
let listRoot: ReturnType<typeof createRoot> | undefined;
export function renderSessions(props: Props) {
  listRoot ??= createRoot(document.getElementById("sessions")!);
  listRoot.render(<SessionList {...props} />);
}
const iconRoots = new Map<string, ReturnType<typeof createRoot>>();
export function controlIcon(
  id: string,
  kind:
    | "new"
    | "send"
    | "stop"
    | "trace"
    | "sidebar"
    | "workbench"
    | "theme"
    | "attach"
    | "settings",
  label: string,
) {
  const el = document.getElementById(id)!;
  let root = iconRoots.get(id);
  if (!root) {
    el.replaceChildren();
    root = createRoot(el);
    iconRoots.set(id, root);
  }
  const Icon = {
    new: Plus,
    send: ArrowUp,
    stop: Square,
    trace: Activity,
    sidebar: PanelLeft,
    workbench: PanelRight,
    theme: SunMoon,
    attach: Paperclip,
    settings: Settings,
  }[kind];
  root.render(
    <>
      <Icon size={16} strokeWidth={1.7} aria-hidden="true" />
      <span>{label}</span>
    </>,
  );
}
let sidebarPreference: boolean | undefined;
let workbenchOpen = false;
export function layout() {
  const w = window.innerWidth;
  const drawer = w < SIDEBAR_DRAWER_BREAKPOINT;
  const collapsed = sidebarPreference ?? w < SIDEBAR_AUTO_COLLAPSE;
  const c = computeColumns(
    w,
    collapsed ? 0 : SIDEBAR_DEFAULT,
    workbenchOpen
      ? w * (document.body.classList.contains("workbench-wide") ? 0.65 : RIGHTBAR_DEFAULT_RATIO)
      : 0,
  );
  if (!drawer) document.body.classList.remove("sidebar-drawer");
  document.body.classList.toggle("sidebar-collapsed", collapsed && !drawer);
  document.querySelector(".sidebar")?.classList.toggle(sidebarCss.collapsed, collapsed && !drawer);
  document
    .getElementById("sidebar-settings")
    ?.classList.toggle(settingsCss.rail, collapsed && !drawer);
  document.body.classList.toggle("workbench-open", workbenchOpen);
  document.body.classList.toggle(
    "workbench-overlay",
    workbenchOpen && (drawer || c.rightbar === 0),
  );
  document.body.style.setProperty("--sidebar-width", c.sidebar + "px");
  document.body.style.setProperty("--trace-width", c.rightbar + "px");
  document.getElementById("show-workbench")?.setAttribute("aria-expanded", String(workbenchOpen));
}
export function toggleWorkbench() {
  workbenchOpen = !workbenchOpen;
  layout();
}
export function styleWelcome() {
  document.querySelector(".welcome h1")?.classList.add(heroCss.headline);
}
export function initAppearance() {
  document.getElementById("form")?.classList.add(inputCss.card);
  styleWelcome();
  const sidebar = document.querySelector(".sidebar");
  sidebar?.classList.add(sidebarCss.root);
  sidebar?.querySelector(".brand")?.classList.add(sidebarCss.logoRow);
  sidebar?.querySelector(".brand-name")?.classList.add(sidebarCss.brandName);
  document.getElementById("new-session-row")?.classList.add(sidebarCss.newSessionRow);
  document.getElementById("new")?.classList.add(sidebarCss.newSession);
  document.getElementById("sidebar-toggle")?.classList.add(sidebarCss.iconButton);
  document.getElementById("sidebar-settings")?.classList.add(settingsCss.trigger);
  const media = matchMedia("(prefers-color-scheme: dark)");
  const apply = () => {
    const mode = localStorage.getItem("axiom.appearance") || "system";
    document.body.toggleAttribute(
      "data-ds-dark-theme",
      mode === "dark" || (mode === "system" && media.matches),
    );
    document.dispatchEvent(new Event("axiom:theme"));
  };
  media.addEventListener("change", apply);
  apply();
  controlIcon("sidebar-settings", "settings", "设置");
  controlIcon("theme-toggle", "theme", "");
  controlIcon("sidebar-toggle", "sidebar", "");
  controlIcon("sidebar-open", "sidebar", "");
  controlIcon("show-workbench", "workbench", "工作台");
  controlIcon("attach-button", "attach", "附件");
  document.getElementById("theme-toggle")!.onclick = () => {
    const dark = document.body.hasAttribute("data-ds-dark-theme");
    localStorage.setItem("axiom.appearance", dark ? "light" : "dark");
    apply();
  };
  document.getElementById("sidebar-toggle")!.onclick = () => {
    if (window.innerWidth < SIDEBAR_DRAWER_BREAKPOINT)
      document.body.classList.remove("sidebar-drawer");
    else {
      sidebarPreference = true;
      layout();
    }
  };
  document.getElementById("sidebar-open")!.onclick = () => {
    if (window.innerWidth < SIDEBAR_DRAWER_BREAKPOINT)
      document.body.classList.toggle("sidebar-drawer");
    else {
      sidebarPreference = false;
      layout();
    }
  };
  document.getElementById("sessions")!.addEventListener("click", (event) => {
    if (event.target instanceof Element && event.target.closest(".session-select"))
      document.body.classList.remove("sidebar-drawer");
  });
}
