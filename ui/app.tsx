import {
  Check,
  ChevronDown,
  Copy,
  Ellipsis,
  FileText,
  FolderOpen,
  MessageSquareQuote,
  PanelLeft,
  Plus,
  Search,
  Settings,
  SunMoon,
  Wrench,
} from "lucide-react";
import MarkdownIt from "markdown-it";
import {
  type ComponentProps,
  type MouseEvent,
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { createRoot } from "react-dom/client";
import assistantCss from "../vendor/dsh/chat/AssistantMarkdown.module.css";
import actionsCss from "../vendor/dsh/chat/MessageIconActions.module.css";
import messageCss from "../vendor/dsh/chat/MessageItem.module.css";
import conversationCss from "../vendor/dsh/conversation/ConversationRoot.module.css";
import heroCss from "../vendor/dsh/conversation/HeroShell.module.css";
import inputCss from "../vendor/dsh/conversation/InputBar.module.css";
import frameCss from "../vendor/dsh/layout/AppFrame.module.css";
import { writeClipboard } from "../vendor/dsh/primitives/clipboard.ts";

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

import { PiModelSelect } from "./model-select.tsx";
import {
  action,
  addFiles,
  appendDraft,
  changeSession,
  connect,
  type HistoryWindow,
  latestHistory,
  loadEarlierHistory,
  loadOptions,
  type Message,
  pinHistory,
  refresh,
  removeAttachment,
  run,
  submit,
  textOf,
  useProjectionField,
  useShellProjection,
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
const ConnectedDraftEditor = memo(function ConnectedDraftEditor(
  props: Omit<ComponentProps<typeof DraftEditor>, "draft">,
) {
  const draft = useProjectionField("draft");
  return <DraftEditor {...props} draft={draft} />;
});
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
const LiveMessage = memo(function LiveMessage({ follow }: { follow: () => void }) {
  const stream = useProjectionField("stream");
  // biome-ignore lint/correctness/useExhaustiveDependencies: follow after each committed stream update.
  useLayoutEffect(() => {
    follow();
  }, [stream, follow]);
  if (!stream) return null;
  return (
    <article
      className="axiom-message assistant pi-live-message"
      data-chat-flow-kind="assistant"
      aria-label="正在生成"
    >
      <div className={assistantCss.root}>
        <div className={assistantCss.body}>
          <MarkdownMessage text={stream} />
        </div>
      </div>
    </article>
  );
});
const CopyMessage = memo(function CopyMessage({ text }: { text: string }) {
  const [feedback, setFeedback] = useState<"idle" | "copied" | "failed">("idle");
  useEffect(() => {
    if (feedback === "idle") return;
    const timer = window.setTimeout(() => setFeedback("idle"), 1400);
    return () => clearTimeout(timer);
  }, [feedback]);
  const label =
    feedback === "copied" ? "已复制" : feedback === "failed" ? "复制失败，请重试" : "复制消息";
  return (
    <button
      type="button"
      className={actionsCss.action + " pi-copy"}
      title={label}
      aria-label={label}
      onClick={async () => setFeedback((await writeClipboard(text)) ? "copied" : "failed")}
    >
      {feedback === "copied" ? (
        <Check size={15} aria-hidden="true" />
      ) : (
        <Copy size={15} aria-hidden="true" />
      )}
    </button>
  );
});
const starterTasks = [
  { label: "理解代码", prompt: "阅读当前项目，解释主要架构、入口及关键模块。", icon: Search },
  {
    label: "定位问题",
    prompt: "检查当前项目中可复现的缺陷，说明证据并提出最小修复方案。",
    icon: Wrench,
  },
  {
    label: "审查变更",
    prompt: "审查当前 Git 变更，找出真实的回归风险与可维护性问题。",
    icon: FileText,
  },
];
const HISTORY_PAGE = 80;
const HistoryMessage = memo(function HistoryMessage({
  message,
  index,
  locked,
  onQuote,
}: {
  message: Message;
  index: number;
  locked: boolean;
  onQuote: (text: string) => void;
}) {
  const text = textOf(message.content) || message.errorMessage || "";
  if (!text || (message.role !== "user" && message.role !== "assistant")) return null;
  const user = message.role === "user";
  const copy = <CopyMessage text={text} />;
  return (
    <article
      data-history-index={index}
      className={"axiom-message " + message.role}
      data-chat-flow-kind={user ? "user" : "assistant"}
      data-actions-reveal="hover"
    >
      {user ? (
        <div className={messageCss.userRow}>
          <div className={messageCss.userStack + " pi-user-stack"}>
            <UserMessageBubble className="pi-user-bubble">
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
const TranscriptMessages = memo(function TranscriptMessages({
  messages,
  history,
  locked,
  onQuote,
  reading,
  onBrowse,
}: {
  messages: Message[];
  history: HistoryWindow | null;
  locked: boolean;
  onQuote: (text: string) => void;
  reading: boolean;
  onBrowse: () => void;
}) {
  // Follow the latest page while at the bottom, but freeze the visible
  // prefix when the reader scrolls back or explicitly reveals earlier data.
  const recentStart = Math.max(0, messages.length - HISTORY_PAGE);
  const [start, setStart] = useState<number | null>(null);
  const first = history ? 0 : start === null ? recentStart : Math.min(start, recentStart);
  useLayoutEffect(() => {
    if (reading && start === null) setStart(recentStart);
    else if (start !== null && start > recentStart) setStart(recentStart);
    else if (!reading && start === recentStart) setStart(null);
  }, [reading, start, recentStart]);
  const [loadingEarlier, setLoadingEarlier] = useState(false);
  const anchor = useRef<{ row: Element; top: number; scroll: HTMLElement } | null>(null);
  useLayoutEffect(() => {
    const saved = anchor.current;
    anchor.current = null;
    if (saved?.row.isConnected)
      saved.scroll.scrollTop += saved.row.getBoundingClientRect().top - saved.top;
  });
  const changePage = (event: MouseEvent<HTMLButtonElement>, next: number) => {
    const scroll = event.currentTarget.closest<HTMLElement>("#transcript");
    const row = Array.from(scroll?.querySelectorAll("[data-history-index]") ?? []).find(
      (row) => Number(row.getAttribute("data-history-index")) >= Math.max(first, next),
    );
    if (scroll && row) anchor.current = { row, top: row.getBoundingClientRect().top, scroll };
    onBrowse();
    setStart(next);
  };

  const older = async (event: MouseEvent<HTMLButtonElement>) => {
    if (!history) {
      changePage(event, Math.max(0, first - HISTORY_PAGE));
      return;
    }
    if (loadingEarlier) return;
    const scroll = event.currentTarget.closest<HTMLElement>("#transcript");
    setLoadingEarlier(true);
    onBrowse();
    try {
      await run(() =>
        loadEarlierHistory(() => {
          const row = scroll?.querySelector("[data-history-index]");
          if (scroll && row) anchor.current = { row, top: row.getBoundingClientRect().top, scroll };
        }),
      );
    } finally {
      setLoadingEarlier(false);
    }
  };
  const remaining = history?.start ?? first;
  const total = history?.total ?? messages.length;
  return (
    <>
      {total > HISTORY_PAGE && (
        <div className="pi-history-controls">
          <span>
            显示最近 {messages.length - first} / {total} 条消息
          </span>
          {remaining > 0 && (
            <button
              type="button"
              className="pi-more-button"
              disabled={loadingEarlier}
              onClick={(event) => void older(event)}
            >
              {loadingEarlier ? "加载中…" : "加载更早消息（剩余 " + remaining + " 条）"}
            </button>
          )}
          {(history ? messages.length > HISTORY_PAGE : first < recentStart) && (
            <button
              type="button"
              className="pi-more-button"
              onClick={(event) =>
                history ? void run(latestHistory) : changePage(event, recentStart)
              }
            >
              仅显示最近消息
            </button>
          )}
        </div>
      )}
      {messages.slice(first).map((message, offset) => (
        <HistoryMessage
          key={(history?.start ?? first) + offset}
          message={message}
          index={(history?.start ?? first) + offset}
          locked={locked}
          onQuote={onQuote}
        />
      ))}
    </>
  );
});
function App() {
  const p = useShellProjection(),
    l = useLayout();
  const files = useRef<HTMLInputElement>(null),
    transcript = useRef<HTMLElement>(null);
  const followingTranscript = useRef(true);
  const scrollFrame = useRef<number | null>(null);
  const followLatest = useCallback(() => {
    if (!followingTranscript.current || scrollFrame.current !== null) return;
    scrollFrame.current = requestAnimationFrame(() => {
      scrollFrame.current = null;
      const element = transcript.current;
      if (element && followingTranscript.current) element.scrollTop = element.scrollHeight;
    });
  }, []);
  useEffect(
    () => () => {
      if (scrollFrame.current !== null) cancelAnimationFrame(scrollFrame.current);
    },
    [],
  );
  const [showJump, setShowJump] = useState(false);
  const browseHistory = useCallback(() => {
    followingTranscript.current = false;
    pinHistory(true);
    setShowJump(true);
  }, []);
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
  const empty = p.messages.length === 0 && !p.hasStream;
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
  // biome-ignore lint/correctness/useExhaustiveDependencies: follow when committed messages or tool content changes.
  useLayoutEffect(() => {
    followLatest();
  }, [p.messages, p.tools, sessionId, followLatest]);
  const toggleTheme = () => {
    const next = dark ? "light" : "dark";
    localStorage.setItem("axiom.appearance", next);
    setMode(next);
  };
  return (
    <div
      className="axiom-frame pi-shell"
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
            <span className="pi-mark" aria-hidden="true">
              π
            </span>
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
            <PanelLeft size={18} />
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
            <Plus size={18} />
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
            <Settings size={18} />
            <span>设置</span>
          </button>
          <button
            type="button"
            id="theme-toggle"
            title="切换外观"
            aria-label="切换外观"
            onClick={toggleTheme}
          >
            <SunMoon size={18} />
          </button>
          <span className="pi-engine-label">Pi · 本地运行</span>
        </footer>
      </aside>
      <div className="axiom-center pi-center">
        <main className="pi-conversation" data-phase={empty ? "hero" : "active"}>
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
                <PanelLeft size={18} />
              </button>
            </div>
            <div className={conversationCss.titleRow + " pi-header-row"}>
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
                <span id="workspace" className="pi-workspace-label" title={workspace}>
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
                    <Ellipsis size={20} />
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
                pinHistory(!following);
                setShowJump(!following);
              }}
            >
              {empty && (
                <div className={"welcome " + heroCss.headline}>
                  <span className="pi-hero-mark" aria-hidden="true">
                    π
                  </span>
                  <span className={heroCss.titleGroup}>
                    <span className="pi-welcome-title">今天做什么？</span>
                    <small className="pi-hero-description">
                      从当前工作区开始。阅读代码、解决问题，或构建新的功能。
                    </small>
                  </span>
                </div>
              )}
              <div className="axiom-chat-column">
                <TranscriptMessages
                  messages={p.messages}
                  history={p.history}
                  key={sessionId}
                  locked={locked}
                  onQuote={selectQuote}
                  reading={showJump}
                  onBrowse={browseHistory}
                />
                <MemoObservedChanges tools={p.tools} />
                <MemoDeliverableCards tools={p.tools} />
                <LiveMessage follow={followLatest} />
              </div>
            </section>
            {showJump && (
              <div className="transcript-jump">
                <button
                  type="button"
                  onClick={() => {
                    followingTranscript.current = true;
                    pinHistory(false);
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
                    <FolderOpen size={18} />
                    <span className={heroCss.workspaceLabel}>{workspaceName}</span>
                    <ChevronDown size={12} />
                  </button>
                </div>
              )}

              <div className="pi-context-strip" hidden={empty && p.tools.length === 0}>
                <span title={workspace}>
                  <FolderOpen size={15} aria-hidden="true" />
                  {workspaceName}
                </span>
                {p.tools.length > 0 && (
                  <button
                    type="button"
                    className="pi-trace-shortcut"
                    onClick={() => openPanel("trajectory")}
                  >
                    {p.tools.filter((tool) => tool.finished).length}/{p.tools.length} 工具已结束
                  </button>
                )}
                {p.tools.some((tool) => !tool.finished) && (
                  <span className="pi-active-tool">
                    正在执行：{p.tools.findLast((tool) => !tool.finished)?.name}
                  </span>
                )}
              </div>
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
                <ConnectedDraftEditor
                  key={p.state?.sessionId}
                  quote={quote?.sessionId === sessionId ? quote : null}
                  onQuoteConsumed={clearQuote}
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
                      <Plus size={18} />
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
                        key={sessionId}
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
              {empty && (
                <div className="pi-starter-tasks">
                  {starterTasks.map(({ label, prompt, icon: Icon }) => (
                    <button
                      key={label}
                      type="button"
                      disabled={unavailable}
                      onClick={() => {
                        appendDraft(prompt);
                        document.getElementById("prompt")?.focus();
                      }}
                    >
                      <Icon size={16} aria-hidden="true" />
                      {label}
                    </button>
                  ))}
                  <span className="pi-key-hint">
                    <kbd>Ctrl</kbd> + <kbd>Enter</kbd> 发送
                  </span>
                </div>
              )}
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
