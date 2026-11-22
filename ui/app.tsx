import {
  ChevronDown,
  Copy,
  Ellipsis,
  FolderOpen,
  MessageSquareQuote,
  PanelLeft,
  Plus,
  Settings,
  SunMoon,
} from "lucide-react";
import MarkdownIt from "markdown-it";
import { memo, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import assistantCss from "../vendor/dsh/chat/AssistantMarkdown.module.css";
import actionsCss from "../vendor/dsh/chat/MessageIconActions.module.css";
import messageCss from "../vendor/dsh/chat/MessageItem.module.css";
import conversationCss from "../vendor/dsh/conversation/ConversationRoot.module.css";
import heroCss from "../vendor/dsh/conversation/HeroShell.module.css";
import inputCss from "../vendor/dsh/conversation/InputBar.module.css";
import frameCss from "../vendor/dsh/layout/AppFrame.module.css";
import { writeClipboard } from "../vendor/dsh/primitives/clipboard.ts";
import { FishLogo } from "../vendor/dsh/primitives/FishLogo.tsx";
import { StateDot } from "../vendor/dsh/primitives/StateDot.tsx";
import { UserMessageBubble } from "../vendor/dsh/primitives/UserMessageBubble.tsx";
import settingsCss from "../vendor/dsh/sidebar/SettingsRoot.module.css";
import sidebarCss from "../vendor/dsh/sidebar/SidebarRoot.module.css";
import { DraftEditor } from "./draft-editor.tsx";
import { SessionList } from "./dsh-ui.tsx";
import {
  DeliverableCards,
  HarnessModeDock,
  ObservedChanges,
  PlanDock,
} from "./harness-features.tsx";
import { HeroMark } from "./hero-mark.tsx";
import { PiModelSelect } from "./model-select.tsx";
import {
  action,
  addFiles,
  changeSession,
  connect,
  loadOptions,
  type Message,
  refresh,
  removeAttachment,
  run,
  submit,
  textOf,
  useProjection,
} from "./projection.ts";
import { RightbarExpand } from "./rightbar-expand.tsx";
import { RightbarResizeHandle } from "./rightbar-resize.tsx";
import { UserText } from "./secret-view.tsx";
import { SessionControls } from "./session-controls.tsx";
import { layoutActions, useLayout } from "./shell-layout.ts";
import {
  DialogView,
  forgetRightbarSession,
  openPanel,
  SettingsOverlay,
  SidebarPanels,
  toggleRightbar,
  Workbench,
} from "./workbench.tsx";

const markdown = new MarkdownIt({ html: false, linkify: true }).disable("image");
const MemoWorkbench = memo(Workbench);
const MemoSidebarPanels = memo(SidebarPanels);
const MemoSessionList = memo(SessionList);
const MemoDraftEditor = memo(DraftEditor);
const MemoObservedChanges = memo(ObservedChanges);
const MemoDeliverableCards = memo(DeliverableCards);
const MemoHarnessModeDock = memo(HarnessModeDock);
const MemoPlanDock = memo(PlanDock);
const MarkdownMessage = memo(function MarkdownMessage({ text }: { text: string }) {
  return (
    // biome-ignore lint/security/noDangerouslySetInnerHtml: raw HTML and unsafe links are disabled by markdown-it.
    <div className="markdown" dangerouslySetInnerHTML={{ __html: markdown.render(text) }} />
  );
});
const TranscriptMessages = memo(function TranscriptMessages({
  messages,
  sessionId,
  locked,
  onQuote,
}: {
  messages: Message[];
  sessionId?: string;
  locked: boolean;
  onQuote: (text: string) => void;
}) {
  return messages.map((message, index) => {
    const text = textOf(message.content) || message.errorMessage || "";
    if (!text || (message.role !== "user" && message.role !== "assistant")) return null;
    const user = message.role === "user";
    const copy = (
      <button
        type="button"
        className={actionsCss.action}
        title="复制消息"
        aria-label="复制消息"
        onClick={() => void writeClipboard(text)}
      >
        <Copy aria-hidden="true" size={15} />
      </button>
    );
    return (
      <article
        key={(sessionId ?? "") + ":" + index}
        className={"axiom-message " + message.role}
        data-chat-flow-kind={user ? "user" : "assistant"}
        data-actions-reveal="hover"
      >
        {user ? (
          <div className={messageCss.userRow}>
            <div className={messageCss.userStack}>
              <UserMessageBubble>
                <UserText text={text} />
              </UserMessageBubble>
              <div className={actionsCss.actions}>{copy}</div>
            </div>
          </div>
        ) : (
          <div className={assistantCss.root}>
            <div className={assistantCss.body}>
              <MarkdownMessage text={text} />
            </div>
            <div className={actionsCss.actions + " " + assistantCss.actions}>
              {copy}
              <button
                type="button"
                className={"quote-message " + actionsCss.action}
                title="引用此回复"
                aria-label="引用"
                disabled={locked}
                onClick={(event) => {
                  const selection = window.getSelection();
                  const article = event.currentTarget.closest("article");
                  const selected = selection?.toString().trim();
                  const within =
                    selection?.anchorNode &&
                    selection.focusNode &&
                    article?.contains(selection.anchorNode) &&
                    article.contains(selection.focusNode);
                  onQuote(within && selected ? selected : text);
                  selection?.removeAllRanges();
                }}
              >
                <MessageSquareQuote aria-hidden="true" size={15} />
              </button>
            </div>
          </div>
        )}
      </article>
    );
  });
});
function App() {
  const p = useProjection(),
    l = useLayout();
  const files = useRef<HTMLInputElement>(null),
    transcript = useRef<HTMLElement>(null);
  const followingTranscript = useRef(true);
  const [showJump, setShowJump] = useState(false);
  const sessionId = p.state?.sessionId;
  const [quote, setQuote] = useState<{ text: string; id: number; sessionId?: string } | null>(null);
  const clearQuote = useCallback(() => setQuote(null), []);
  const selectQuote = useCallback(
    (text: string) => setQuote({ text: text.slice(0, 16000), id: Date.now(), sessionId }),
    [sessionId],
  );
  const [queue, setQueue] = useState("steer");
  const submitDraft = useCallback(() => void run(() => submit(queue)), [queue]);
  const switchSession = useCallback(async (id: string) => {
    layoutActions.closeDrawer();
    await run(() => changeSession("switch", id));
  }, []);
  const deleteSession = useCallback(async (id: string) => {
    await changeSession("delete", id);
    forgetRightbarSession(id);
  }, []);
  const [sessionControlsOpen, setSessionControlsOpen] = useState(false);
  const [mode, setMode] = useState(() => localStorage.getItem("axiom.appearance") || "system");
  const [systemDark, setSystemDark] = useState(
    () => matchMedia("(prefers-color-scheme: dark)").matches,
  );
  const unavailable = !p.connected || p.syncing || p.syncFailed || p.changing || !sessionId;
  const locked = p.busy || unavailable;
  const empty = p.messages.length === 0 && !p.stream;
  const sessionTitle = p.sessions.find((item) => item.id === sessionId)?.name || "新会话";
  const workspace = p.state?.workspace ?? "";
  const workspaceName = workspace.split(/[\\/]/).filter(Boolean).at(-1) || "工作区";
  useEffect(connect, []);
  useEffect(() => {
    const media = matchMedia("(prefers-color-scheme: dark)"),
      change = () => setSystemDark(media.matches);
    media.addEventListener("change", change);
    return () => media.removeEventListener("change", change);
  }, []);
  const dark = mode === "dark" || (mode === "system" && systemDark);
  useLayoutEffect(() => {
    document.body.toggleAttribute("data-ds-dark-theme", dark);
    document.dispatchEvent(new Event("axiom:theme"));
  }, [dark]);
  useLayoutEffect(() => {
    layoutActions.apply(l);
  }, [l]);
  useEffect(() => {
    if (!l.drawer) return;
    const close = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !event.defaultPrevented) layoutActions.closeDrawer();
    };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [l.drawer]);
  useEffect(() => {
    const resized = () => layoutActions.resize(window.innerWidth);
    window.addEventListener("resize", resized);
    return () => window.removeEventListener("resize", resized);
  }, []);
  // biome-ignore lint/correctness/useExhaustiveDependencies: reset scroll and pending quote when the session changes.
  useLayoutEffect(() => {
    followingTranscript.current = true;
    setShowJump(false);
    setQuote(null);
  }, [sessionId]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: follow committed content only while the reader is near the end.
  useLayoutEffect(() => {
    const element = transcript.current;
    if (element && followingTranscript.current) element.scrollTop = element.scrollHeight;
  }, [p.messages, p.stream, p.tools, sessionId]);
  const toggleTheme = () => {
    const next = dark ? "light" : "dark";
    localStorage.setItem("axiom.appearance", next);
    setMode(next);
  };
  return (
    <div
      className={frameCss.frame + " axiom-frame"}
      data-harness-shell
      data-sidebar-collapsed={l.collapsed}
      data-rightbar-fullscreen={(l.workbenchOpen && (l.fullscreen || l.width < 768)) || undefined}
      data-resizing={l.resizing || undefined}
    >
      {l.drawer && (
        <button
          type="button"
          className="sidebar-backdrop"
          aria-label="关闭侧栏"
          onClick={layoutActions.closeDrawer}
        />
      )}
      <aside
        className={
          "sidebar " +
          frameCss.sidebarCol +
          " " +
          sidebarCss.root +
          (l.collapsed ? " " + sidebarCss.collapsed : "")
        }
      >
        <div className={"brand " + sidebarCss.logoRow}>
          <span className={sidebarCss.brandMark}>
            <FishLogo size={23} />
          </span>
          <div className={"brand-name " + sidebarCss.brandName}>Axiom Agent</div>
          <button
            type="button"
            id="sidebar-toggle"
            className={sidebarCss.iconButton}
            title="收起侧栏"
            aria-label="收起侧栏"
            onClick={layoutActions.collapse}
          >
            <PanelLeft size={16} />
          </button>
        </div>
        <div id="new-session-row" className={sidebarCss.newSessionRow}>
          <button
            type="button"
            id="new"
            className={sidebarCss.newSession}
            aria-label="新建会话"
            disabled={locked}
            onClick={() => void run(() => changeSession("new"))}
          >
            <Plus size={16} />
            <span>新建会话</span>
          </button>
        </div>
        <nav id="sidebar-panels" className={sidebarCss.panelList} aria-label="工作台页面">
          <MemoSidebarPanels />
        </nav>
        <nav id="sessions">
          <MemoSessionList
            sessions={p.sessions}
            current={p.state?.sessionId ?? null}
            disabled={locked}
            onSelect={switchSession}
            onDelete={deleteSession}
          />
        </nav>
        <footer>
          <button
            type="button"
            id="sidebar-settings"
            className={settingsCss.trigger + (l.collapsed ? " " + settingsCss.rail : "")}
            title="设置"
            aria-label="设置"
            onClick={() => openPanel("settings")}
          >
            <Settings size={16} />
            <span>设置</span>
          </button>
          <button
            type="button"
            id="theme-toggle"
            title="切换外观"
            aria-label="切换外观"
            onClick={toggleTheme}
          >
            <SunMoon size={16} />
          </button>
          本地工作台 · Pi 1.5.2
        </footer>
      </aside>
      <div className={frameCss.centerCol + " axiom-center"}>
        <main className={conversationCss.root} data-phase={empty ? "hero" : "active"}>
          <header
            className={conversationCss.header + (empty ? " " + conversationCss.headerBlank : "")}
          >
            <div className={conversationCss.headerLeading}>
              <button
                type="button"
                id="sidebar-open"
                title="展开侧栏"
                aria-label="展开侧栏"
                onClick={layoutActions.expand}
              >
                <PanelLeft size={16} />
              </button>
            </div>
            <div className={conversationCss.titleRow}>
              <div className={conversationCss.titleCluster}>
                <nav className={conversationCss.crumbs} aria-label="会话层级">
                  {!empty && (
                    <span className={conversationCss.crumbSeg}>
                      <span
                        className={conversationCss.crumb + " " + conversationCss.crumbCurrent}
                        title={sessionTitle}
                      >
                        {sessionTitle}
                      </span>
                    </span>
                  )}
                </nav>
                <span id="workspace" hidden title={workspace}>
                  {workspaceName}
                </span>
              </div>
              <div className={conversationCss.headerUtilities}>
                <div className="controls">
                  <button
                    id="session-actions"
                    className={conversationCss.headerMenuButton}
                    type="button"
                    aria-label="Pi 会话"
                    disabled={unavailable}
                    onClick={() => setSessionControlsOpen(true)}
                  >
                    <Ellipsis size={16} />
                  </button>
                  <span id="status" role="status">
                    <StateDot
                      state={
                        !p.connected
                          ? p.state
                            ? "error"
                            : "ongoing"
                          : p.syncing
                            ? "ongoing"
                            : p.syncFailed
                              ? "warning"
                              : p.dialogs.length
                                ? "warning"
                                : p.busy
                                  ? "ongoing"
                                  : "idle"
                      }
                    />
                    {!p.connected
                      ? p.state
                        ? "连接中断"
                        : "连接中"
                      : p.syncing
                        ? "同步中"
                        : p.syncFailed
                          ? "同步失败"
                          : p.dialogs.length
                            ? "等待输入"
                            : p.retrying
                              ? "正在重试"
                              : p.busy
                                ? "运行中"
                                : "就绪"}
                  </span>
                  {p.connected && p.syncFailed && (
                    <button
                      type="button"
                      onClick={() =>
                        void run(async () => {
                          await refresh();
                          await loadOptions();
                        })
                      }
                    >
                      重新同步
                    </button>
                  )}
                </div>
              </div>
              <div className={conversationCss.headerCorner} data-conversation-header-corner="">
                <RightbarExpand
                  expanded={l.workbenchOpen}
                  narrow={l.width < 768}
                  onExpand={toggleRightbar}
                />
              </div>
            </div>
          </header>
          <div
            className={conversationCss.body + " axiom-conversation-body"}
            data-phase={empty ? "hero" : "active"}
          >
            <section
              id="transcript"
              ref={transcript}
              aria-live="polite"
              onScroll={({ currentTarget }) => {
                const { scrollHeight, scrollTop, clientHeight } = currentTarget;
                const following = scrollHeight - scrollTop - clientHeight <= 64;
                if (following === followingTranscript.current) return;
                followingTranscript.current = following;
                setShowJump(!following);
              }}
            >
              {empty && (
                <div className={"welcome " + heroCss.headline}>
                  <HeroMark />
                  <span className={heroCss.titleGroup}>
                    <span>今天构建什么？</span>
                  </span>
                </div>
              )}
              <div className="axiom-chat-column">
                <TranscriptMessages
                  messages={p.messages}
                  sessionId={p.state?.sessionId}
                  locked={locked}
                  onQuote={selectQuote}
                />
                <MemoObservedChanges tools={p.tools} />
                <MemoDeliverableCards tools={p.tools} />
                {p.stream && (
                  <article
                    className="axiom-message assistant"
                    data-chat-flow-kind="assistant"
                    aria-label="正在生成"
                  >
                    <div className={assistantCss.root}>
                      <div className={assistantCss.body}>
                        <MarkdownMessage text={p.stream} />
                      </div>
                    </div>
                  </article>
                )}
              </div>
            </section>
            {showJump && (
              <div className="transcript-jump">
                <button
                  type="button"
                  onClick={() => {
                    followingTranscript.current = true;
                    setShowJump(false);
                    const element = transcript.current;
                    if (element) element.scrollTop = element.scrollHeight;
                  }}
                >
                  回到最新消息
                </button>
              </div>
            )}
            <div
              className={
                "composer " + conversationCss.composerSeat + (empty ? " axiom-hero-composer" : "")
              }
            >
              {empty && (
                <div className={conversationCss.heroWorkspaceRow + " axiom-hero-workspace"}>
                  <button
                    type="button"
                    className={heroCss.workspace}
                    title={workspace}
                    onClick={() => openPanel("files")}
                  >
                    <FolderOpen size={16} />
                    <span className={heroCss.workspaceLabel}>{workspaceName}</span>
                    <ChevronDown size={12} />
                  </button>
                </div>
              )}

              <div id="error" role="alert">
                {p.error}
              </div>
              <form
                id="form"
                className={inputCss.card}
                data-composer-card
                onSubmit={(e) => {
                  e.preventDefault();
                  void run(() => submit(queue));
                }}
              >
                <div id="attachment-list">
                  {p.attachments.map((a, i) => (
                    <button
                      type="button"
                      className="attachment-chip"
                      key={i}
                      onClick={() => removeAttachment(i)}
                      title="移除附件"
                    >
                      {a.name} ×
                    </button>
                  ))}
                </div>
                <MemoDraftEditor
                  key={p.state?.sessionId}
                  quote={quote?.sessionId === sessionId ? quote : null}
                  onQuoteConsumed={clearQuote}
                  draft={p.draft}
                  hasAttachments={p.attachments.length > 0}
                  disabled={unavailable}
                  sessionId={p.state?.sessionId}
                  onSubmit={submitDraft}
                />
                <div className={inputCss.row + " axiom-input-controls"} data-composer-controls="">
                  <div className={inputCss.tools}>
                    <input
                      ref={files}
                      type="file"
                      id="attach-input"
                      multiple
                      hidden
                      onChange={(e) => {
                        const list = Array.from(e.currentTarget.files ?? []);
                        e.currentTarget.value = "";
                        void addFiles(list);
                      }}
                    />
                    <button
                      type="button"
                      id="attach-button"
                      className={inputCss.add}
                      disabled={unavailable}
                      aria-label="添加附件"
                      title="添加附件"
                      onClick={() => files.current?.click()}
                    >
                      <Plus size={14} />
                    </button>
                    <div className={inputCss.modes}>
                      <MemoHarnessModeDock inline />
                      <select
                        id="queue-mode"
                        className={inputCss.select}
                        aria-label="运行中的消息队列"
                        value={queue}
                        onChange={(e) => setQueue(e.target.value)}
                      >
                        <option value="steer">引导当前任务</option>
                        <option value="followUp">当前任务结束后发送</option>
                      </select>
                    </div>
                  </div>
                  <div className={inputCss.trailing}>
                    <div className={inputCss.standardControls}>
                      <PiModelSelect
                        models={p.models}
                        levels={p.levels}
                        current={p.state?.model}
                        effort={p.state?.thinkingLevel}
                        sessionId={p.state?.sessionId}
                        disabled={locked}
                        onModel={(model) =>
                          run(async () => {
                            await action("model", model);
                            await loadOptions();
                          })
                        }
                        onEffort={(level) =>
                          run(async () => {
                            await action("thinking", level);
                            await loadOptions();
                          })
                        }
                      />
                    </div>
                    <button
                      type="button"
                      id="stop"
                      className={inputCss.primary}
                      disabled={!p.busy || !p.connected}
                      aria-label="停止"
                      title="停止"
                      onClick={() =>
                        void run(async () => {
                          await action("abort");
                          await refresh();
                        })
                      }
                    >
                      <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
                        <rect x="3" y="3" width="10" height="10" rx="3" fill="currentColor" />
                      </svg>
                    </button>
                    <button
                      id="send"
                      type="submit"
                      className={inputCss.primary}
                      disabled={unavailable}
                      aria-label={p.busy ? "加入消息队列" : "发送"}
                      title={p.busy ? "加入消息队列 (Ctrl+Enter)" : "发送 (Ctrl+Enter)"}
                    >
                      <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
                        <path
                          d="M8.3125 0.980183C8.66767 1.0531 8.97902 1.20418 9.2627 1.43233C9.48724 1.61297 9.73029 1.85793 9.97949 2.10714L14.707 6.83468L13.293 8.24874L9 3.95577V15.0417H7V3.95577L2.70703 8.24874L1.29297 6.83468L6.02051 2.10714C6.26971 1.85793 6.51277 1.61297 6.7373 1.43233C6.97662 1.23986 7.28445 1.04402 7.6875 0.980183C7.8973 0.947006 8.1031 0.95516 8.3125 0.980183Z"
                          fill="currentColor"
                        />
                      </svg>
                    </button>
                  </div>
                </div>
              </form>
              <div className={inputCss.dock} data-composer-dock>
                <MemoPlanDock key={p.state?.sessionId} />
              </div>
              <small>Agent 在当前工作区以本机用户身份执行工具。只对可信任项目授权。</small>
            </div>
          </div>
        </main>
      </div>
      <RightbarResizeHandle />
      <aside
        className={"inspector " + frameCss.rightbarCol}
        data-rightbar-panel
        data-sidebar-right-open={l.workbenchOpen || undefined}
        data-rightbar-mode={l.fullscreen || l.width < 768 ? "fullscreen" : "push"}
      >
        <div id="workbench">
          <MemoWorkbench />
        </div>
      </aside>
      <div id="dialog-root">
        {p.dialogs[0] && <DialogView key={p.dialogs[0].id} dialog={p.dialogs[0]} />}
      </div>
      {sessionControlsOpen && <SessionControls onClose={() => setSessionControlsOpen(false)} />}
      <SettingsOverlay />
      <div id="wb-notice" role="status" hidden={!p.notice}>
        {p.notice}
      </div>
    </div>
  );
}
createRoot(document.getElementById("root")!).render(<App />);
