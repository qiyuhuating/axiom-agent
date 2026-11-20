import {
  Activity,
  ArrowUp,
  PanelLeft,
  PanelRight,
  Paperclip,
  Plus,
  Settings,
  Square,
  SunMoon,
} from "lucide-react";
import MarkdownIt from "markdown-it";
import { memo, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import heroCss from "../vendor/dsh/conversation/HeroShell.module.css";
import inputCss from "../vendor/dsh/conversation/InputBar.module.css";
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
  TraceLedger,
} from "./harness-features.tsx";
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
import { UserText } from "./secret-view.tsx";
import { SessionControls } from "./session-controls.tsx";
import { layoutActions, useLayout } from "./shell-layout.ts";
import { DialogView, openPanel, SidebarPanels, Workbench } from "./workbench.tsx";

const markdown = new MarkdownIt({ html: false, linkify: true }).disable("image");
const MemoWorkbench = memo(Workbench);
const MemoSidebarPanels = memo(SidebarPanels);
const MemoSessionList = memo(SessionList);
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
    if (!text) return null;
    return (
      <article key={(sessionId ?? "") + ":" + index} className={message.role}>
        <b>{message.role === "user" ? "你" : "Axiom"}</b>
        {message.role === "assistant" ? (
          <>
            <MarkdownMessage text={text} />
            <button
              type="button"
              className="quote-message"
              title="引用此回复"
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
              引用
            </button>
          </>
        ) : (
          <UserMessageBubble>
            <UserText text={text} />
          </UserMessageBubble>
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
  const [quote, setQuote] = useState<{ text: string; id: number } | null>(null);
  const clearQuote = useCallback(() => setQuote(null), []);
  const selectQuote = useCallback(
    (text: string) => setQuote({ text: text.slice(0, 16000), id: Date.now() }),
    [],
  );
  const [queue, setQueue] = useState("steer");
  const [sessionControlsOpen, setSessionControlsOpen] = useState(false);
  const [mode, setMode] = useState(() => localStorage.getItem("axiom.appearance") || "system");
  const [systemDark, setSystemDark] = useState(
    () => matchMedia("(prefers-color-scheme: dark)").matches,
  );
  const locked = p.busy || p.syncing || p.changing;
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
  // biome-ignore lint/correctness/useExhaustiveDependencies: scroll after transcript or streaming text changes.
  useEffect(() => {
    if (transcript.current) transcript.current.scrollTop = transcript.current.scrollHeight;
  }, [p.messages, p.stream]);
  const toggleTheme = () => {
    const next = dark ? "light" : "dark";
    localStorage.setItem("axiom.appearance", next);
    setMode(next);
  };
  return (
    <>
      {l.drawer && (
        <button
          type="button"
          className="sidebar-backdrop"
          aria-label="关闭侧栏"
          onClick={layoutActions.closeDrawer}
        />
      )}
      <aside
        className={"sidebar " + sidebarCss.root + (l.collapsed ? " " + sidebarCss.collapsed : "")}
      >
        <div className={"brand " + sidebarCss.logoRow}>
          <span className="mark">A</span>
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
        <nav id="sidebar-panels" aria-label="工作台页面">
          <MemoSidebarPanels />
        </nav>
        <nav id="sessions">
          <MemoSessionList
            sessions={p.sessions}
            current={p.state?.sessionId ?? null}
            disabled={locked}
            onSelect={async (id) => {
              layoutActions.closeDrawer();
              await run(() => changeSession("switch", id));
            }}
            onDelete={(id) => changeSession("delete", id)}
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
      <main>
        <header>
          <button
            type="button"
            id="sidebar-open"
            title="展开侧栏"
            aria-label="展开侧栏"
            onClick={layoutActions.expand}
          >
            <PanelLeft size={16} />
          </button>
          <div className="header-title">
            <strong>工作区</strong>
            <span id="workspace">{p.state?.workspace ?? "连接中"}</span>
          </div>
          <div className="controls">
            <button
              id="show-workbench"
              type="button"
              title="显示工作台"
              aria-expanded={l.workbenchOpen}
              onClick={layoutActions.toggleWorkbench}
            >
              <PanelRight size={16} />
              工作台
            </button>
            <button
              id="session-actions"
              type="button"
              aria-label="Pi 会话"
              disabled={locked}
              onClick={() => setSessionControlsOpen(true)}
            >
              Pi
            </button>
            <span id="status" role="status">
              {!p.connected
                ? p.state
                  ? "连接中断"
                  : "连接中"
                : p.busy
                  ? "运行中"
                  : p.syncing
                    ? "同步中"
                    : "就绪"}
            </span>
          </div>
        </header>
        <section id="transcript" ref={transcript} aria-live="polite">
          {!p.messages.length && !p.stream && (
            <div className="welcome">
              <h1 className={heroCss.headline}>今天构建什么？</h1>
              <p>理解代码、实现功能、验证工程，或者普通对话</p>
            </div>
          )}
          <TranscriptMessages
            messages={p.messages}
            sessionId={p.state?.sessionId}
            locked={locked}
            onQuote={selectQuote}
          />
          <ObservedChanges tools={p.tools} />
          <DeliverableCards tools={p.tools} />
          {p.stream && (
            <article className="assistant">
              <div>{p.stream}</div>
            </article>
          )}
        </section>
        <div className="composer">
          <HarnessModeDock />
          <PlanDock key={p.state?.sessionId} />
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
            <DraftEditor
              key={p.state?.sessionId}
              quote={quote}
              onQuoteConsumed={clearQuote}
              draft={p.draft}
              disabled={p.syncing || p.changing || !p.connected}
              sessionId={p.state?.sessionId}
              onSubmit={() => void run(() => submit(queue))}
            />
            <div className="actions">
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
                aria-label="添加附件"
                title="添加附件"
                onClick={() => files.current?.click()}
              >
                <Paperclip size={16} />
              </button>
              <select
                id="models"
                aria-label="模型"
                disabled={locked}
                value={
                  p.state?.model
                    ? JSON.stringify({ provider: p.state.model.provider, id: p.state.model.id })
                    : ""
                }
                onChange={(e) => {
                  const value = e.target.value;
                  if (value)
                    void run(async () => {
                      await action("model", JSON.parse(value));
                      await loadOptions();
                    });
                }}
              >
                <option value="">选择可用模型</option>
                {p.models.map((m) => (
                  <option
                    key={m.provider + ":" + m.id}
                    value={JSON.stringify({ provider: m.provider, id: m.id })}
                  >
                    {m.provider} / {m.id}
                  </option>
                ))}
              </select>
              <select
                id="levels"
                aria-label="思考强度"
                disabled={locked}
                value={p.state?.thinkingLevel ?? ""}
                onChange={(e) => {
                  const level = e.target.value;
                  void run(async () => {
                    await action("thinking", level);
                    await loadOptions();
                  });
                }}
              >
                {p.levels.map((level) => (
                  <option key={level}>{level}</option>
                ))}
              </select>
              <select
                id="queue-mode"
                aria-label="Message queue"
                value={queue}
                onChange={(e) => setQueue(e.target.value)}
              >
                <option value="steer">Steer</option>
                <option value="followUp">Follow-up</option>
              </select>
              <span className="action-spacer" />
              <button
                type="button"
                id="stop"
                disabled={!p.busy}
                aria-label="停止"
                title="停止"
                onClick={() =>
                  void run(async () => {
                    await action("abort");
                    await refresh();
                  })
                }
              >
                <Square size={16} />
              </button>
              <button
                id="send"
                type="submit"
                disabled={p.syncing || p.changing || !p.connected}
                aria-label="发送"
                title="发送 (Ctrl+Enter)"
              >
                <ArrowUp size={18} />
              </button>
            </div>
          </form>
          <small>Agent 在当前工作区以本机用户身份执行工具。只对可信任项目授权。</small>
        </div>
      </main>
      <aside className="inspector">
        <div id="workbench">
          <MemoWorkbench />
        </div>
        <div className="trace-panel">
          <h2 id="trace-heading">
            <Activity size={16} />
            执行轨迹
          </h2>
          <div id="trace">
            <TraceLedger tools={p.tools} busy={p.busy} />
          </div>
        </div>
      </aside>
      <div id="dialog-root">
        {p.dialogs[0] && <DialogView key={p.dialogs[0].id} dialog={p.dialogs[0]} />}
      </div>
      {sessionControlsOpen && <SessionControls onClose={() => setSessionControlsOpen(false)} />}
      <div id="wb-notice" role="status" hidden={!p.notice}>
        {p.notice}
      </div>
    </>
  );
}
createRoot(document.getElementById("root")!).render(<App />);
