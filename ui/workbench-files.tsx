import { ArrowLeft, ArrowRight, ExternalLink, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { parseBrowserAddress } from "../vendor/dsh/browser/url.ts";
import { FileTree } from "../vendor/dsh/files/FileTree.tsx";
import { Button } from "../vendor/dsh/primitives/Button.tsx";
import browserCss from "../vendor/dsh/sidebar/Browser.module.css";
import filesCss from "../vendor/dsh/sidebar/FilesBody.module.css";
import { api, errorBox, Header, msg, useLoad } from "./panel-shared.tsx";
import { open } from "./workbench.tsx";

export function Files() {
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
export function GitDiff() {
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
export function BrowserView() {
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
