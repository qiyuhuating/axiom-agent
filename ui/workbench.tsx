import React, {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { createPortal } from "react-dom";
import { decodeRequest } from "../src/interaction-protocol.mjs";
import { useModalLayer } from "../vendor/dsh/primitives/useModalLayer.ts";
import { FileExplorer } from "./file-explorer.tsx";
import { JobDetails, TeamOverview, TraceLedger } from "./harness-features.tsx";
import { api, dirtyTabs, errorBox, Header, msg } from "./panel-shared.tsx";
import { Button, Modal } from "./pi-primitives.tsx";
import {
  appendDraft,
  type Dialog,
  getSnapshot,
  loadJobs,
  loadOptions,
  removeDialog,
  useProjection,
  useProjectionField,
} from "./projection.ts";
import { layoutActions, layoutState, useLayout } from "./shell-layout.ts";
import { StructuredDialog } from "./structured-dialog.tsx";

const Editor = React.lazy(() => import("./editor.tsx"));
const TerminalView = React.lazy(() => import("./terminal.tsx"));

import {
  Activity,
  ArrowLeft,
  ArrowRight,
  Check,
  ExternalLink,
  File,
  Folder,
  GitCompare,
  Globe,
  PanelLeft,
  Paperclip,
  Play,
  Plus,
  Redo2,
  RefreshCw,
  Save,
  Settings,
  Shield,
  Square,
  Terminal as TerminalIcon,
  Undo2,
  Workflow,
  X,
} from "lucide-react";
import { parseBrowserAddress } from "../vendor/dsh/browser/url.ts";
import { DockController, DockLayout } from "../vendor/dsh/dockkit/index.ts";
import "@xterm/xterm/css/xterm.css";
import "../vendor/dsh/primitives/DiffBlock.module.css";
import "../vendor/dsh/primitives/CodeCard.module.css";
import type { CSSProperties } from "react";
import pluginCss from "../vendor/dsh/capabilities/PluginManagerPage.module.css";
import questionCss from "../vendor/dsh/capabilities/QuestionComposer.module.css";
import guideCss from "../vendor/dsh/guide/GuideBody.module.css";
import { CompassGlyph } from "../vendor/dsh/guide/GuideTitle.tsx";
import browserCss from "../vendor/dsh/sidebar/Browser.module.css";
import settingsCss from "../vendor/dsh/sidebar/SettingsRoot.module.css";
import sidebarCss from "../vendor/dsh/sidebar/SidebarRoot.module.css";
import panelCss from "../vendor/dsh/sidebar-right/SidebarRight.module.css";

const jobAction = (action: string, value: unknown) => api("job-action", { action, value });
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
const open = (kind: string, title?: string, id?: string) => {
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
const insert = appendDraft;
function useLoad(path: string, initial: any) {
  const [value, setValue] = useState(initial),
    [error, setError] = useState("");
  const load = useCallback(async () => {
    try {
      setValue(await api(path));
      setError("");
    } catch (e) {
      setError(msg(e));
    }
  }, [path]);
  useEffect(() => {
    void load();
  }, [load]);
  return { value, error, load, setValue, setError };
}
function Files() {
  const workspace = useProjectionField("state")?.workspace;
  return (
    <FileExplorer key={workspace} onOpen={(entry) => open("editor", entry.name, entry.path)} />
  );
}
function GitDiff() {
  const { value, error, load } = useLoad("diff", null);
  return (
    <div className="wb-panel">
      <Header>
        <strong>Git 更改</strong>
        <Button size="sm" icon={<RefreshCw size={15} />} onClick={() => void load()}>
          刷新
        </Button>
      </Header>
      {errorBox(error)}
      <div className="wb-scroll">
        {!value ? (
          <p>加载中…</p>
        ) : !value.available ? (
          <p>{value.reason}</p>
        ) : (
          <>
            <h4>工作区状态</h4>
            <pre>{value.status || "无更改"}</pre>
            <h4>未暂存</h4>
            <Patch text={value.unstaged} />
            <h4>已暂存</h4>
            <Patch text={value.staged} />
          </>
        )}
      </div>
    </div>
  );
}
function Patch({ text }: { text: string }) {
  const lines = useMemo(() => (text ? text.split("\n") : []), [text]);
  const [limit, setLimit] = useState(500);
  return (
    <div>
      <pre className="git-patch">
        {lines.length
          ? lines.slice(0, limit).map((line, i) => (
              <div
                key={i}
                className={
                  line.startsWith("+")
                    ? "patch-add"
                    : line.startsWith("-")
                      ? "patch-del"
                      : line.startsWith("@@")
                        ? "patch-meta"
                        : ""
                }
              >
                {line || " "}
              </div>
            ))
          : "无更改"}
      </pre>
      {lines.length > 500 && (
        <div className="pi-history-controls">
          <span>
            {Math.min(limit, lines.length)} / {lines.length} 行
          </span>
          {lines.length > limit && (
            <button
              type="button"
              className="pi-more-button"
              onClick={() => setLimit((n) => n + 500)}
            >
              加载更多差异
            </button>
          )}
          {limit > 500 && (
            <button type="button" className="pi-more-button" onClick={() => setLimit(500)}>
              收起
            </button>
          )}
        </div>
      )}
    </div>
  );
}
function BrowserView() {
  const [input, setInput] = useState(""),
    [history, setHistory] = useState<string[]>([]),
    [index, setIndex] = useState(-1),
    [error, setError] = useState("");
  const url = history[index];
  function go() {
    const r = parseBrowserAddress(input, location.origin);
    if (!r.ok) {
      setError("地址不允许或无效：" + r.reason);
      return;
    }
    setError("");
    setHistory((xs) => [...xs.slice(0, index + 1), r.target.url]);
    setIndex(index + 1);
    setInput(r.target.url);
  }
  function move(n: number) {
    setIndex(n);
    setInput(history[n]);
  }
  return (
    <div className={"wb-panel " + browserCss.root}>
      <form
        className={browserCss.toolbar}
        onSubmit={(e) => {
          e.preventDefault();
          go();
        }}
      >
        <button
          type="button"
          className={browserCss.tool}
          title="后退"
          aria-label="后退"
          disabled={index <= 0}
          onClick={() => move(index - 1)}
        >
          <ArrowLeft size={16} />
        </button>
        <button
          type="button"
          className={browserCss.tool}
          title="前进"
          aria-label="前进"
          disabled={index >= history.length - 1}
          onClick={() => move(index + 1)}
        >
          <ArrowRight size={16} />
        </button>
        <div className={browserCss.addressBox}>
          <input
            className={browserCss.address}
            aria-label="浏览器地址"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="输入网址"
          />
          <button
            className={browserCss.tool + " " + browserCss.addressGo}
            type="submit"
            title="前往"
            aria-label="前往"
          >
            <ArrowRight size={16} />
          </button>
        </div>
        {url && (
          <a title="在外部浏览器打开" target="_blank" rel="noopener noreferrer" href={url}>
            <ExternalLink size={16} />
          </a>
        )}
      </form>
      {errorBox(error)}
      {url ? (
        <iframe
          title="浏览器"
          className={browserCss.frame}
          sandbox="allow-scripts allow-forms allow-popups"
          referrerPolicy="no-referrer"
          src={url}
        />
      ) : (
        <p className={browserCss.start}>打开 HTTP(S) 页面。禁止内嵌的网站可在外部打开。</p>
      )}
    </div>
  );
}
function Providers() {
  const data = useLoad("providers", []),
    [form, setForm] = useState({
      name: "axiom-custom-",
      baseUrl: "",
      api: "openai-completions",
      envKey: "",
      modelId: "",
      contextWindow: 128000,
      maxTokens: 8192,
      reasoning: false,
      image: false,
    }),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const field = (key: string, value: any) => setForm((f) => ({ ...f, [key]: value }));
  async function execute(operation: string, name = form.name) {
    try {
      await api("provider-action", { ...form, operation, name });
      await data.load();
      setError("");
      setNotice("已保存，重启 Axiom 使 Pi 加载配置。");
    } catch (e) {
      setError(msg(e));
    }
  }
  return (
    <>
      <h4>自定义模型提供商</h4>
      {errorBox(error || data.error)}
      {data.value.map((p: any) => (
        <div className="wb-list-row" key={p.name}>
          <span>
            {p.name}
            <small>
              {p.modelId} · {p.api}
            </small>
          </span>
          <Button size="sm" onClick={() => setForm(p)}>
            编辑
          </Button>
          <Button
            size="sm"
            onClick={() => {
              if (window.confirm("删除此提供商配置？")) void execute("remove", p.name);
            }}
          >
            删除
          </Button>
        </div>
      ))}
      <label>
        提供商名称
        <input value={form.name} onChange={(e) => field("name", e.target.value)} />
      </label>
      <label>
        API 地址
        <input
          placeholder="https://api.example.com/v1"
          value={form.baseUrl}
          onChange={(e) => field("baseUrl", e.target.value)}
        />
      </label>
      <label>
        协议
        <select value={form.api} onChange={(e) => field("api", e.target.value)}>
          {["openai-completions", "openai-responses", "anthropic-messages"].map((a) => (
            <option key={a}>{a}</option>
          ))}
        </select>
      </label>
      <label>
        API Key 环境变量名
        <input
          placeholder="MY_API_KEY"
          value={form.envKey}
          onChange={(e) => field("envKey", e.target.value)}
        />
      </label>
      <label>
        模型 ID
        <input value={form.modelId} onChange={(e) => field("modelId", e.target.value)} />
      </label>
      <label>
        上下文窗口
        <input
          type="number"
          value={form.contextWindow}
          onChange={(e) => field("contextWindow", Number(e.target.value))}
        />
      </label>
      <label>
        最大输出
        <input
          type="number"
          value={form.maxTokens}
          onChange={(e) => field("maxTokens", Number(e.target.value))}
        />
      </label>
      <label className="wb-check">
        <input
          type="checkbox"
          checked={form.reasoning}
          onChange={(e) => field("reasoning", e.target.checked)}
        />
        推理模型
      </label>
      <label className="wb-check">
        <input
          type="checkbox"
          checked={form.image}
          onChange={(e) => field("image", e.target.checked)}
        />
        支持图像输入
      </label>
      <Button variant="primary" onClick={() => void execute("upsert")}>
        保存提供商
      </Button>
      {notice && <p className="wb-muted">{notice}</p>}
      <p className="wb-muted">
        仅使用环境变量引用，密钥不会存入 GUI 配置。自定义模型价格需以服务商账单为准。
      </p>
    </>
  );
}

function BuiltinPromptEditor() {
  const { value, error, load, setValue, setError } = useLoad("builtin-prompt", null);
  const [draft, setDraft] = useState<string>();
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const text = draft ?? value?.text ?? "";
  async function save(reset = false) {
    setSaving(true);
    setSaved(false);
    try {
      const next = await api(
        "builtin-prompt",
        reset ? { reset: true, expected: value.text } : { text, expected: value.text },
      );
      setValue(next);
      setDraft(undefined);
      setError("");
      setSaved(true);
    } catch (e) {
      setError(msg(e));
    } finally {
      setSaving(false);
    }
  }
  return (
    <div className="wb-form settings-section">
      {errorBox(error)}
      <label>
        内置提示词
        <textarea
          aria-label="内置提示词"
          rows={9}
          maxLength={value?.limit}
          disabled={!value || saving}
          value={text}
          onChange={(e) => {
            setDraft(e.target.value);
            setSaved(false);
          }}
        />
      </label>
      <p className="wb-muted">附加到 Pi 的系统提示词，下次运行时生效。留空可停用附加提示。</p>
      <div className="builtin-prompt-actions">
        <Button size="sm" disabled={!value || saving} onClick={() => void save(true)}>
          恢复默认
        </Button>
        <Button size="sm" disabled={saving} onClick={() => void load()}>
          重新读取
        </Button>
        <Button
          variant="primary"
          disabled={!value || saving || text === value.text}
          onClick={() => void save()}
        >
          保存提示词
        </Button>
      </div>
      {saved && <p role="status">已保存</p>}
    </div>
  );
}

const settingsSections = {
  general: "通用与权限",
  models: "模型提供商",
  prompt: "内置提示词",
} as const;
function SettingsView({ onClose }: { onClose?: () => void } = {}) {
  const { value, error, load, setError } = useLoad("settings", null);
  const models = useProjectionField("models");
  const levels = useProjectionField("levels");
  const state = useProjectionField("state");
  const [section, setSection] = useState<keyof typeof settingsSections>("general");
  const [opened, setOpened] = useState({ general: true, models: false, prompt: false });
  async function update(action: string, value: unknown) {
    try {
      await api("action", { action, value });
      await loadOptions();
      setError("");
    } catch (e) {
      setError(msg(e));
    }
  }
  async function mode(value: string) {
    try {
      await api("permission", { mode: value });
      await load();
    } catch (e) {
      setError(msg(e));
    }
  }
  return (
    <div className="wb-panel axiom-settings-view">
      <Header>
        <strong>设置</strong>
        <Button size="sm" onClick={() => void load()}>
          刷新
        </Button>
        {onClose && (
          <Button size="sm" title="关闭设置" aria-label="关闭设置" onClick={onClose}>
            ×
          </Button>
        )}
      </Header>
      <nav className="settings-sections" aria-label="设置分类">
        {(Object.keys(settingsSections) as (keyof typeof settingsSections)[]).map((key) => (
          <button
            type="button"
            key={key}
            className={settingsCss.navCell + (key === section ? " " + settingsCss.active : "")}
            aria-pressed={key === section}
            onClick={() => {
              setSection(key);
              if (!opened[key]) setOpened({ ...opened, [key]: true });
            }}
          >
            {settingsSections[key]}
          </button>
        ))}
      </nav>
      <div className="wb-scroll">
        <div className="wb-form settings-section" hidden={section !== "general"}>
          {errorBox(error)}
          <label>
            模型
            <select
              aria-label="设置模型"
              value={state?.model ? JSON.stringify(state.model) : ""}
              onChange={(e) => void update("model", JSON.parse(e.target.value))}
            >
              <option value="" disabled>
                选择模型
              </option>
              {models.map((m) => (
                <option
                  key={m.provider + m.id}
                  value={JSON.stringify({ provider: m.provider, id: m.id })}
                >
                  {m.provider} / {m.id}
                </option>
              ))}
            </select>
          </label>
          <label>
            推理强度
            <select
              value={state?.thinkingLevel || ""}
              onChange={(e) => void update("thinking", e.target.value)}
            >
              {levels.map((l) => (
                <option key={l}>{l}</option>
              ))}
            </select>
          </label>
          <label>
            Agent 权限
            <select
              aria-label="权限模式"
              value={value?.permission ?? ""}
              onChange={(e) => void mode(e.target.value)}
            >
              <option value="" disabled>
                选择权限模式
              </option>
              <option value="full">完全信任</option>
              <option value="ask">非只读工具逐次审批</option>
              <option value="read-only">只读工具</option>
            </select>
          </label>
          <p className="wb-muted">
            这是 Pi 工具调用策略，不是操作系统沙箱。用户自行打开的终端不受 Agent 工具审批约束。
          </p>
        </div>
        {opened.models && (
          <div className="wb-form settings-section" hidden={section !== "models"}>
            <Providers />
          </div>
        )}
        {opened.prompt && (
          <div hidden={section !== "prompt"}>
            <BuiltinPromptEditor />
          </div>
        )}
        <div className="wb-form settings-section" hidden={section !== "general"}>
          <div className="wb-readonly">
            工作区<code>{value?.workspace}</code>
          </div>
          <div className="wb-readonly">
            输出额度<code>{value?.maxOutputTokens ?? "模型默认"}</code>
          </div>
          <div className="wb-readonly">
            项目上下文发现<code>{value?.discoverContext ? "开启" : "关闭"}</code>
          </div>
          <p className="wb-muted">
            工作区及输出预算仍由 axiom.config.json 控制，修改后重启。提供商凭证由 Pi 原生配置管理。
          </p>
        </div>
      </div>
    </div>
  );
}
function Resources() {
  const commands = useLoad("commands", []),
    inventory = useLoad("resources", {
      packages: [],
      servers: [],
      projectExtensions: [],
    }),
    [source, setSource] = useState(""),
    [name, setName] = useState(""),
    [url, setUrl] = useState(""),
    [stdio, setStdio] = useState(""),
    [argv, setArgv] = useState("[]"),
    [result, setResult] = useState(""),
    [working, setWorking] = useState(false);
  async function execute(operation: string, value: any) {
    if (!window.confirm("确认执行 Pi 项目级资源变更？第三方插件可能运行代码。")) return;
    setWorking(true);
    setResult("");
    try {
      const r = await api("resource-action", { operation, ...value });
      setResult(r.message || "已完成。请执行 /reload 以刷新 Pi。");
      await inventory.load();
    } catch (e) {
      setResult(msg(e));
    } finally {
      setWorking(false);
    }
  }
  return (
    <div className="wb-panel">
      <Header>
        <strong>Skills · MCP · 插件</strong>
        <Button
          size="sm"
          onClick={() => {
            void commands.load();
            void inventory.load();
          }}
        >
          刷新
        </Button>
      </Header>
      <div className="wb-scroll wb-form">
        {errorBox(commands.error || inventory.error)}
        <h4>Pi 原生技能与命令</h4>
        {commands.value.map((c: any) => (
          <div className="wb-list-row" key={c.name}>
            <span>
              <strong>/{c.name}</strong>
              <small>{c.description}</small>
            </span>
            <Button size="sm" onClick={() => insert("/" + c.name + " ")}>
              使用
            </Button>
          </div>
        ))}
        <h4>项目资源信任</h4>
        <p className="wb-muted">
          {inventory.value.trust?.decision === true
            ? "已信任"
            : inventory.value.trust?.decision === false
              ? "已拒绝"
              : "未明确授权"}{" "}
          · {inventory.value.workspace}
        </p>
        <Button
          size="sm"
          disabled={working}
          onClick={() => void execute("trust", { trusted: true })}
        >
          信任当前工作区
        </Button>
        <Button
          size="sm"
          disabled={working}
          onClick={() => void execute("trust", { trusted: false })}
        >
          拒绝当前工作区
        </Button>
        <h4>MCP 配置</h4>
        {inventory.value.servers.map((s: any) => (
          <div key={s.scope + s.name} className="wb-list-row">
            <span>
              {s.name}
              <small>
                {s.scope} · {s.transport} · {s.enabled ? "启用" : "停用"} · {s.exposure}
              </small>
            </span>
            {s.scope === "project" && (
              <>
                <Button
                  size="sm"
                  disabled={working}
                  onClick={() => void execute("mcp-toggle", { name: s.name })}
                >
                  {s.enabled ? "停用" : "启用"}
                </Button>
                <Button
                  size="sm"
                  disabled={working}
                  onClick={() => void execute("mcp-remove", { name: s.name })}
                >
                  移除
                </Button>
              </>
            )}
          </div>
        ))}
        <input
          aria-label="MCP 名称"
          placeholder="服务名称"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <input
          aria-label="MCP URL"
          placeholder="Streamable HTTP URL"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
        />
        <Button
          variant="outline"
          disabled={working || !name || !url}
          onClick={() => void execute("mcp-add", { name, url })}
        >
          添加项目 MCP
        </Button>
        <input
          aria-label="MCP stdio 命令"
          placeholder="stdio 可执行文件"
          value={stdio}
          onChange={(e) => setStdio(e.target.value)}
        />
        <input
          aria-label="MCP stdio 参数"
          placeholder="JSON 字符串数组"
          value={argv}
          onChange={(e) => setArgv(e.target.value)}
        />
        <Button
          variant="outline"
          disabled={working || !name || !stdio.trim()}
          onClick={() => {
            try {
              void execute("mcp-add-stdio", {
                name,
                command: stdio,
                args: JSON.parse(argv),
              });
            } catch (e) {
              setResult(msg(e));
            }
          }}
        >
          添加 stdio MCP
        </Button>
        <Button size="sm" disabled={working} onClick={() => void execute("mcp-check", {})}>
          检查实际 MCP 连接
        </Button>
        <h4>Pi 插件包</h4>
        {inventory.value.packages.map((p: any, i: number) => (
          <div key={i} className={pluginCss.card + " wb-list-row"}>
            <div className={pluginCss.cardHead}>
              <span className={pluginCss.cardIcon}>
                <Paperclip size={16} />
              </span>
              <div className={pluginCss.cardMain}>
                <div className={pluginCss.cardTitle}>{p.source}</div>
                <small className={pluginCss.cardDesc}>{p.scope}</small>
              </div>
            </div>
            {p.scope === "project" && (
              <>
                <Button
                  size="sm"
                  disabled={working}
                  onClick={() =>
                    void execute(p.disabled ? "package-enable" : "package-disable", {
                      source: p.source,
                    })
                  }
                >
                  {p.disabled ? "启用" : "停用"}
                </Button>
                <Button
                  size="sm"
                  disabled={working || !/^(npm:|git:)/.test(p.source)}
                  onClick={() => void execute("package-update", { source: p.source })}
                >
                  更新
                </Button>
                <Button
                  size="sm"
                  disabled={working}
                  onClick={() => void execute("remove", { source: p.source })}
                >
                  移除
                </Button>
              </>
            )}
          </div>
        ))}
        <input
          aria-label="插件源"
          placeholder="npm:package 或 git:repository"
          value={source}
          onChange={(e) => setSource(e.target.value)}
        />
        <Button
          variant="outline"
          disabled={working || !source.trim()}
          onClick={() => void execute("install", { source })}
        >
          安装项目插件
        </Button>
        <Button size="sm" onClick={() => insert("/reload")}>
          将 /reload 放入输入框
        </Button>
        {result && <pre>{result}</pre>}
      </div>
    </div>
  );
}
function Jobs() {
  const { jobs, state: session } = useProjection();
  const data = { value: jobs ?? { jobs: [], schedules: [], plans: {} }, load: loadJobs, error: "" };
  const [goal, setGoal] = useState(""),
    [plan, setPlan] = useState<{ text: string; done: boolean }[]>([]),
    [item, setItem] = useState(""),
    [label, setLabel] = useState(""),
    [steps, setSteps] = useState(""),
    [cron, setCron] = useState("0 9 * * *"),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const [expandedJob, setExpandedJob] = useState("");
  const [previousPages, setPreviousPages] = useState<string[]>([]);
  async function navigate(cursor: string, history: string[]) {
    setBusy(true);
    try {
      await loadJobs(cursor);
      setPreviousPages(history);
      setExpandedJob("");
      setError("");
    } catch (e) {
      setError(msg(e));
    } finally {
      setBusy(false);
    }
  }
  const reloadJobs = data.load;
  useEffect(() => {
    let mounted = true;
    async function initialize() {
      try {
        const j = await loadJobs();
        const st = getSnapshot().state;
        if (!mounted || !st) return;
        const p = j.plans[st.sessionId];
        setGoal(p?.goal || "");
        setPlan(p?.items || []);
      } catch (e) {
        if (mounted) setError(msg(e));
      }
    }
    void initialize();
    const switched = () => void initialize();
    window.addEventListener("axiom:session", switched);
    const tick = setInterval(
      () =>
        void reloadJobs().catch((e) => {
          if (mounted) setError(msg(e));
        }),
      3000,
    );
    return () => {
      mounted = false;
      clearInterval(tick);
      window.removeEventListener("axiom:session", switched);
    };
  }, [reloadJobs]);
  async function execute(a: string, v: any) {
    setBusy(true);
    try {
      await jobAction(a, v);
      const creating = ["start", "team", "dag", "schedule-run"].includes(a);
      await loadJobs(creating ? "" : undefined);
      if (creating) setPreviousPages([]);
      setError("");
    } catch (e) {
      setError(msg(e));
    } finally {
      setBusy(false);
    }
  }
  async function savePlan(next = plan) {
    if (!session) return;
    setPlan(next);
    await execute("plan", { sessionId: session.sessionId, goal, items: next });
  }
  const [graph, setGraph] = useState("");
  const currentSteps = () =>
    steps
      .split("\n")
      .map((s) => s.trim())
      .filter(Boolean);
  function startDag() {
    try {
      const nodes = JSON.parse(graph);
      if (!window.confirm("运行依赖图中的只读 Pi 智能体？")) return;
      void execute("dag", { label, model: session?.model, nodes });
    } catch (e) {
      setError(msg(e));
    }
  }
  const create = (a: string) => {
    if (
      !window.confirm(
        a === "schedule-create"
          ? "确认建立重复执行的只读 Pi 定时任务？"
          : "启动独立 Pi 后台任务？将使用当前模型账户。",
      )
    )
      return;
    void execute(a, {
      label,
      steps: currentSteps(),
      cron,
      model: session?.model,
    });
  };
  return (
    <div className="wb-panel">
      <Header>
        <strong>目标、工作流与 Agent Teams</strong>
        <Button size="sm" onClick={() => void data.load()}>
          刷新
        </Button>
      </Header>
      <div className="wb-scroll wb-form">
        {errorBox(error || data.error)}
        <h4>当前会话目标与计划</h4>
        <textarea
          aria-label="会话目标"
          value={goal}
          onChange={(e) => setGoal(e.target.value)}
          placeholder="目标"
        />
        <Button size="sm" onClick={() => void savePlan()} disabled={busy}>
          保存目标
        </Button>
        {plan.map((p, i) => (
          <div className="wb-list-row" key={i}>
            <label className="wb-check">
              <input
                type="checkbox"
                checked={p.done}
                onChange={(e) =>
                  void savePlan(
                    plan.map((x, j) => (j === i ? { ...x, done: e.target.checked } : x)),
                  )
                }
              />
              {p.text}
            </label>
            <Button size="sm" onClick={() => void savePlan(plan.filter((_, j) => j !== i))}>
              移除
            </Button>
          </div>
        ))}
        <input placeholder="新增计划项" value={item} onChange={(e) => setItem(e.target.value)} />
        <Button
          size="sm"
          disabled={!item.trim() || busy}
          onClick={() => {
            void savePlan([...plan, { text: item.trim(), done: false }]);
            setItem("");
          }}
        >
          新增计划
        </Button>
        <Button
          size="sm"
          onClick={() =>
            insert(
              "目标：" +
                goal +
                "\n计划：\n" +
                plan.map((p) => (p.done ? "[x] " : "[ ] ") + p.text).join("\n"),
            )
          }
        >
          把计划交给 Pi
        </Button>
        <h4>创建后台任务 / 工作流 / 团队</h4>
        <input placeholder="任务名称" value={label} onChange={(e) => setLabel(e.target.value)} />
        <textarea
          aria-label="任务步骤"
          placeholder="每行一个步骤或子智能体任务"
          value={steps}
          onChange={(e) => setSteps(e.target.value)}
          rows={5}
        />
        <p className="wb-muted">
          独立 Pi 会话。工作流依次执行各步，团队为每行建立独立只读子智能体。并发上限
          3；结果保留在本机。
        </p>
        <Button variant="primary" disabled={busy || !steps.trim()} onClick={() => create("start")}>
          运行工作流
        </Button>
        <Button variant="outline" disabled={busy || !steps.trim()} onClick={() => create("team")}>
          并行 Agent Team
        </Button>
        <label>
          定时表达式（Cron，本机时区）
          <input value={cron} onChange={(e) => setCron(e.target.value)} />
        </label>
        <Button
          variant="outline"
          disabled={busy || !steps.trim()}
          onClick={() => create("schedule-create")}
        >
          创建自动化
        </Button>
        <h4>DAG 依赖工作流</h4>
        <p className="wb-muted">
          JSON 节点数组，每个节点包含 id、prompt、dependsOn。依赖完成后自动运行，结果传给下游。
        </p>
        <textarea
          aria-label="DAG 节点"
          rows={6}
          value={graph}
          onChange={(e) => setGraph(e.target.value)}
          placeholder={JSON.stringify(
            [
              { id: "research", prompt: "分析项目", dependsOn: [] },
              { id: "review", prompt: "审查分析", dependsOn: ["research"] },
            ],
            null,
            2,
          )}
        />
        <Button variant="outline" disabled={busy || !graph.trim()} onClick={startDag}>
          运行 DAG
        </Button>
        <h4>计划任务</h4>
        {data.value.schedules.map((s: any) => (
          <div key={s.id} className="wb-job">
            <strong>{s.label}</strong>
            <small>
              {s.cron} · {s.timezone} · {s.enabled ? "启用" : "暂停"}
            </small>
            <div className="wb-bar">
              <Button
                size="sm"
                disabled={busy}
                onClick={() => void execute("schedule-toggle", { id: s.id })}
              >
                {s.enabled ? "暂停" : "启用"}
              </Button>
              <Button size="sm" onClick={() => void execute("schedule-run", { id: s.id })}>
                运行
              </Button>
              <Button
                size="sm"
                onClick={() => {
                  if (window.confirm("删除定时任务？"))
                    void execute("schedule-delete", { id: s.id });
                }}
              >
                删除
              </Button>
            </div>
          </div>
        ))}
        <h4>团队消息</h4>
        {(data.value.mail || [])
          .slice(-50)
          .reverse()
          .map((m: any) => (
            <div className="wb-job" key={m.id}>
              <small>
                {m.team.slice(0, 8)} · {m.from} → {m.to}
              </small>
              <pre>{m.text}</pre>
            </div>
          ))}
        <h4>执行历史</h4>
        <TeamOverview jobs={jobs?.teamJobs ?? []} />
        {data.value.jobs.map((j: any) => (
          <div className="wb-job" key={j.id}>
            <strong>{j.label}</strong>
            <small>
              {j.status} {j.activity || ""}
              {j.team ? " · " + j.team.slice(0, 8) + " / " + (j.node || "成员") : ""}
              {j.blockedBy?.length ? " · " + j.blockedBy.length + " 个依赖" : ""}
            </small>
            {["queued", "running"].includes(j.status) && (
              <Button size="sm" onClick={() => void execute("cancel", { id: j.id })}>
                取消
              </Button>
            )}
            <Button
              size="sm"
              aria-expanded={expandedJob === j.id}
              onClick={() => setExpandedJob(expandedJob === j.id ? "" : j.id)}
            >
              任务详情
            </Button>
            {expandedJob === j.id && <JobDetails job={j} insert={insert} />}
          </div>
        ))}
        {jobs?.cursor && (
          <Button disabled={busy} onClick={() => void navigate("", [])}>
            返回最新任务
          </Button>
        )}
        {!!previousPages.length && (
          <Button
            disabled={busy}
            onClick={() => void navigate(previousPages.at(-1)!, previousPages.slice(0, -1))}
          >
            上一页
          </Button>
        )}
        {jobs?.nextCursor && (
          <Button
            disabled={busy}
            onClick={() => void navigate(jobs.nextCursor!, [...previousPages, jobs.cursor])}
          >
            下一页
          </Button>
        )}
      </div>
    </div>
  );
}
const guideDescriptions: Record<string, string> = {
  files: "浏览与编辑工作区文件",
  diff: "检查暂存和未暂存变更",
  terminal: "运行本地命令",
  settings: "配置模型与应用",
  resources: "管理 Skills 和 MCP",
  jobs: "查看任务、计划与进度",
  browser: "在工作台中打开网页",
  trajectory: "检查工具状态及调用详情",
};
function Guide() {
  return (
    <div className="pi-workbench-guide">
      <div className="pi-guide-heading">
        <span className="pi-guide-kicker">PI WORKBENCH</span>
        <h2>工作台</h2>
        <p>打开所需工具，保持当前任务的上下文。</p>
      </div>
      {Object.entries(guideDescriptions).map(([kind, description]) => {
        const Icon = icons[kind as keyof typeof icons];
        return (
          <button
            type="button"
            key={kind}
            className="pi-guide-entry"
            aria-label={names[kind as keyof typeof names]}
            onClick={() => open(kind)}
          >
            <Icon size={20} aria-hidden="true" />
            <span>
              <strong>{names[kind as keyof typeof names]}</strong>
              <small>{description}</small>
            </span>
            <ArrowRight size={15} aria-hidden="true" />
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
      {(["files", "terminal", "browser", "diff", "jobs", "resources", "trajectory"] as const).map(
        (kind) => {
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
        },
      )}
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
  useLayoutEffect(() => {
    controller.setExpanded(false);
    layoutActions.setFullscreen(controller.getSnapshot().state.mode === "fullscreen");
    layoutActions.hideWorkbench();
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
          keepMounted={(tab) => !["guide", "trajectory", "diff"].includes(tab.kind)}
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
export function DialogView({ dialog }: { dialog: Dialog }) {
  let request: ReturnType<typeof decodeRequest>;
  try {
    request = decodeRequest(dialog);
  } catch {
    return (
      <PlainDialog
        dialog={{
          ...dialog,
          prefill: "Invalid structured request",
          title: "Invalid structured request",
        }}
      />
    );
  }
  return request ? (
    <StructuredDialog dialog={dialog} request={request} />
  ) : (
    <PlainDialog dialog={dialog} />
  );
}
function PlainDialog({ dialog }: { dialog: Dialog }) {
  const [value, setValue] = useState(dialog.prefill || ""),
    [error, setError] = useState(""),
    [working, setWorking] = useState(false);
  async function respond(payload: any) {
    setWorking(true);
    try {
      await api("ui-response", { id: dialog.id, ...payload });
      removeDialog(dialog.id);
    } catch (e) {
      setError(msg(e));
    } finally {
      setWorking(false);
    }
  }
  const confirm = dialog.method === "confirm";
  return (
    <Modal
      open
      title={dialog.title || "Pi 扩展请求"}
      tone={confirm ? "warning" : undefined}
      description={confirm ? undefined : dialog.message}
      closeLabel="关闭"
      onClose={() => {
        if (!working) void respond({ cancelled: true });
      }}
      footer={
        <>
          <Button
            variant="outline"
            data-modal-autofocus
            disabled={working}
            onClick={() => void respond(confirm ? { confirmed: false } : { cancelled: true })}
          >
            {confirm ? "拒绝" : "取消"}
          </Button>
          <Button
            variant="primary"
            disabled={working || (dialog.method === "select" && !dialog.options?.includes(value))}
            onClick={() => void respond(confirm ? { confirmed: true } : { value })}
          >
            {confirm ? "确认授权" : "确定"}
          </Button>
        </>
      }
    >
      {confirm && <pre className="wb-approval">{dialog.message}</pre>}
      {dialog.method === "select" && (
        <div className={questionCss.options}>
          {dialog.options?.map((o, i) => (
            <button
              type="button"
              key={o}
              className={questionCss.option + (value === o ? " " + questionCss.optionSelected : "")}
              aria-pressed={value === o}
              disabled={working}
              onClick={() => setValue(o)}
            >
              <span className={questionCss.number}>{i + 1}</span>
              <span className={questionCss.optionLabel}>{o}</span>
            </button>
          ))}
        </div>
      )}
      {dialog.method === "input" && (
        <input
          value={value}
          placeholder={dialog.placeholder}
          onChange={(e) => setValue(e.target.value)}
        />
      )}
      {dialog.method === "editor" && (
        <textarea rows={7} value={value} onChange={(e) => setValue(e.target.value)} />
      )}
      {errorBox(error)}
    </Modal>
  );
}

export function openDelivery(path: string) {
  activeController().setExpanded(true);
  layoutActions.showWorkbench();
  open("editor", path.split("/").at(-1), path);
}
let settingsOpen = false;
const settingsListeners = new Set<() => void>();
const subscribeSettings = (listener: () => void) => {
  settingsListeners.add(listener);
  return () => {
    settingsListeners.delete(listener);
  };
};
const settingsSnapshot = () => settingsOpen;
export function openSettings() {
  settingsOpen = true;
  layoutActions.closeDrawer();
  for (const listener of settingsListeners) listener();
}
function closeSettings() {
  settingsOpen = false;
  for (const listener of settingsListeners) listener();
}
export function SettingsOverlay() {
  const shown = useSyncExternalStore(subscribeSettings, settingsSnapshot);
  const root = useRef<HTMLDivElement>(null);
  useModalLayer(root, shown, closeSettings);
  if (!shown) return null;
  return createPortal(
    <div className="axiom-settings-overlay">
      <button
        type="button"
        className="axiom-settings-backdrop"
        aria-label="关闭设置背景"
        onClick={closeSettings}
      />
      <section
        ref={root}
        role="dialog"
        aria-modal="true"
        aria-label="设置"
        className="axiom-settings-dialog"
        tabIndex={-1}
      >
        <SettingsView onClose={closeSettings} />
      </section>
    </div>,
    document.body,
  );
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
