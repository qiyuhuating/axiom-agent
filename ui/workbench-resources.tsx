import { Paperclip } from "lucide-react";
import { useState } from "react";
import pluginCss from "../vendor/dsh/capabilities/PluginManagerPage.module.css";
import { Button } from "../vendor/dsh/primitives/Button.tsx";
import { api, errorBox, Header, msg, useLoad } from "./panel-shared.tsx";
import { appendDraft } from "./projection.ts";

export function Resources() {
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
            <Button size="sm" onClick={() => appendDraft("/" + c.name + " ")}>
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
        <Button size="sm" onClick={() => appendDraft("/reload")}>
          将 /reload 放入输入框
        </Button>
        {result && <pre>{result}</pre>}
      </div>
    </div>
  );
}
