import { useRef, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { Button } from "../vendor/dsh/primitives/Button.tsx";
import { useModalLayer } from "../vendor/dsh/primitives/useModalLayer.ts";
import settingsCss from "../vendor/dsh/sidebar/SettingsRoot.module.css";
import { api, errorBox, Header, msg, useLoad } from "./panel-shared.tsx";
import { loadOptions, useProjectionField } from "./projection.ts";
import { layoutActions } from "./shell-layout.ts";

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
export function SettingsView({ onClose }: { onClose?: () => void } = {}) {
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
