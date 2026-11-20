import React, { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { decodeRequest } from "../src/interaction-protocol.mjs";
import { TeamOverview } from "./harness-features.tsx";
import { api, dirtyTabs, errorBox, Header, msg } from "./panel-shared.tsx";
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
import { layoutActions, useLayout } from "./shell-layout.ts";
import { StructuredDialog } from "./structured-dialog.tsx";

const Editor = React.lazy(() => import("./editor.tsx"));
const TerminalView = React.lazy(() => import("./terminal.tsx"));

import {
  ArrowLeft,
  ArrowRight,
  Check,
  ExternalLink,
  File,
  Folder,
  GitCompare,
  Globe,
  Maximize2,
  Minimize2,
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
import { FileTree } from "../vendor/dsh/files/FileTree.tsx";
import { Button } from "../vendor/dsh/primitives/Button.tsx";
import { Modal } from "../vendor/dsh/primitives/Modal.tsx";
import "@xterm/xterm/css/xterm.css";
import "../vendor/dsh/primitives/DiffBlock.module.css";
import "../vendor/dsh/primitives/CodeCard.module.css";
import pluginCss from "../vendor/dsh/capabilities/PluginManagerPage.module.css";
import questionCss from "../vendor/dsh/capabilities/QuestionComposer.module.css";
import guideCss from "../vendor/dsh/guide/GuideBody.module.css";
import { CompassGlyph } from "../vendor/dsh/guide/GuideTitle.tsx";
import browserCss from "../vendor/dsh/sidebar/Browser.module.css";
import filesCss from "../vendor/dsh/sidebar/FilesBody.module.css";
import settingsCss from "../vendor/dsh/sidebar/SettingsRoot.module.css";
import sidebarCss from "../vendor/dsh/sidebar/SidebarRoot.module.css";

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
const controller = new DockController({
  makeInitialTab: make,
  makePaneTab: make,
});
controller.setExpanded(true);
const open = (kind: string, title?: string, id?: string) =>
  controller.openContent({
    kind,
    title: title || names[kind as keyof typeof names] || kind,
    contentId: id || (["terminal", "browser"].includes(kind) ? crypto.randomUUID() : kind),
  });
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
  const [levels, setLevels] = useState<Record<string, any[]>>({}),
    [expanded, setExpanded] = useState<string[]>([]),
    [loading, setLoading] = useState<Record<string, any>>({
      "": { loading: true },
    }),
    [current, setCurrent] = useState("");
  const load = useCallback(async (path: string) => {
    setLoading((x) => ({ ...x, [path]: { loading: true } }));
    try {
      const entries = await api("files?path=" + encodeURIComponent(path));
      setLevels((x) => ({ ...x, [path]: entries }));
      setLoading((x) => ({ ...x, [path]: {} }));
    } catch (e) {
      setLoading((x) => ({ ...x, [path]: { failure: msg(e) } }));
    }
  }, []);
  useEffect(() => {
    void load("");
  }, [load]);
  return (
    <div className={"wb-panel " + filesCss.page}>
      <div className={filesCss.header}>
        <strong className="file-page-title">工作区文件</strong>
        <button
          type="button"
          className={filesCss.tool}
          title="刷新文件"
          aria-label="刷新文件"
          onClick={() => {
            void load("");
            for (const dir of expanded) void load(dir);
          }}
        >
          <RefreshCw size={15} />
        </button>
      </div>
      <div className={filesCss.content}>
        <div className={filesCss.navigator + " " + filesCss.wholePage}>
          <div className={filesCss.body}>
            <FileTree
              root=""
              entries={Object.values(levels).flat()}
              expanded={expanded}
              current={current}
              directories={loading}
              t={(key) =>
                ({
                  loading: "加载中…",
                  empty: "空目录",
                  emptyHidden: "没有可见文件",
                  truncated: "部分结果",
                  "entry.noViewer": "无可用预览",
                  "entry.other": "不支持打开",
                })[key] || key
              }
              onToggle={(entry, next) => {
                setExpanded((xs) =>
                  next ? [...xs, entry.path] : xs.filter((x) => x !== entry.path),
                );
                if (next) void load(entry.path);
              }}
              onOpen={(entry) => {
                setCurrent(entry.path);
                open("editor", entry.name, entry.path);
              }}
            />
          </div>
        </div>
      </div>
    </div>
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
  return (
    <pre className="git-patch">
      {text
        ? text.split("\n").map((line, i) => (
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
  async function save() {
    setSaving(true);
    try {
      const next = await api("builtin-prompt", { text, expected: value.text });
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
        <Button
          size="sm"
          disabled={!value || saving}
          onClick={() => {
            setDraft(value.defaultText);
            setSaved(false);
          }}
        >
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
function SettingsView() {
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
    <div className="wb-panel">
      <Header>
        <strong>Pi 设置</strong>
        <Button size="sm" onClick={() => void load()}>
          刷新
        </Button>
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
              value={value?.permission || "full"}
              onChange={(e) => void mode(e.target.value)}
            >
              <option value="full">完全信任（现有行为）</option>
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
      await loadJobs();
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
        <TeamOverview jobs={data.value.jobs} />
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
            {j.error && errorBox(j.error)}
            {j.results.map((r: any, i: number) => (
              <details key={i}>
                <summary>步骤 {i + 1}</summary>
                <pre>{r.text}</pre>
                <Button size="sm" onClick={() => insert(r.text)}>
                  引用结果
                </Button>
              </details>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
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
            <button type="button" key={kind} className={guideCss.entry} onClick={() => open(kind)}>
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
    case "settings":
      return <SettingsView />;
    case "resources":
      return <Resources />;
    case "jobs":
      return <Jobs />;
    case "browser":
      return <BrowserView />;
    default:
      return <Guide />;
  }
}
export function SidebarPanels() {
  const { collapsed, workbenchOpen } = useLayout();
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
export function Workbench() {
  const snapshot = useSyncExternalStore(
      controller.subscribe,
      controller.getSnapshot,
      controller.getSnapshot,
    ),
    [wide, setWide] = useState(false);
  const proxy = useRef(
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
  ).current;
  function expand() {
    const next = !wide;
    setWide(next);
    layoutActions.setWide(next);
  }
  return (
    <div className="wb-shell">
      <div className="wb-launch">
        <Button size="sm" title="文件" icon={<Folder size={16} />} onClick={() => open("files")} />
        <Button
          size="sm"
          title="Git Diff"
          icon={<GitCompare size={16} />}
          onClick={() => open("diff")}
        />
        <Button
          size="sm"
          title="终端"
          icon={<TerminalIcon size={16} />}
          onClick={() => open("terminal")}
        />
        <Button
          size="sm"
          title="浏览器"
          icon={<Globe size={16} />}
          onClick={() => open("browser")}
        />
        <Button
          size="sm"
          title="设置"
          icon={<Settings size={16} />}
          onClick={() => open("settings")}
        />
        <Button size="sm" title="任务" icon={<Workflow size={16} />} onClick={() => open("jobs")} />
        <Button
          size="sm"
          title="资源"
          icon={<Paperclip size={16} />}
          onClick={() => open("resources")}
        />
        <Button
          size="sm"
          title="扩大工作台"
          icon={wide ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
          onClick={expand}
        />
      </div>
      <DockLayout
        state={snapshot.state}
        canSplit={snapshot.canSplit}
        intents={proxy}
        labels={labels}
        dropZones="horizontal"
        keepMounted={() => true}
        renderTab={renderTab}
      />
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
  layoutActions.showWorkbench();
  open("editor", path.split("/").at(-1), path);
}
export function openPanel(kind: string) {
  layoutActions.showWorkbench();
  open(kind);
}
