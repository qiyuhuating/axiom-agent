import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import React, { useEffect, useRef, useState } from "react";
import terminalCss from "../vendor/dsh/sidebar/terminal.module.css";
import { api, errorBox, Header, msg, terminalAction } from "./panel-shared.tsx";

function terminalTheme() {
  const style = getComputedStyle(document.body);
  const dark = document.body.hasAttribute("data-ds-dark-theme");
  return {
    background: style.getPropertyValue("--bg").trim(),
    foreground: style.getPropertyValue("--ink").trim(),
    cursor: style.getPropertyValue("--ink").trim(),
    selectionBackground: style.getPropertyValue("--pi-active").trim(),
    red: dark ? "#f25a5a" : "#dc2626",
    green: dark ? "#4ed17e" : "#15803d",
    blue: dark ? "#7aaaff" : "#2563eb",
  };
}
export default function TerminalView() {
  const node = useRef<HTMLDivElement>(null),
    [error, setError] = useState(""),
    [id, setId] = useState(""),
    [exit, setExit] = useState<number | null>(null),
    [terminals, setTerminals] = useState<any[]>([]),
    [selected, setSelected] = useState(""),
    [interrupted, setInterrupted] = useState(false);
  useEffect(() => {
    void api("terminals")
      .then(setTerminals)
      .catch((e) => setError(msg(e)));
  }, []);
  useEffect(() => {
    if (!selected) return;
    setExit(null);
    setInterrupted(false);
    setError("");
    let disposed = false,
      termId = "",
      eventSource: EventSource | undefined,
      observer: ResizeObserver | undefined;
    const term = new Terminal({
      fontFamily: getComputedStyle(document.body).getPropertyValue("--pi-code-font").trim(),
      fontSize: 14,
      scrollback: 2000,
      theme: terminalTheme(),
      cursorBlink: !matchMedia("(prefers-reduced-motion: reduce)").matches,
      allowProposedApi: false,
      disableStdin: true,
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(node.current!);
    const applyTheme = () => {
      term.options.theme = terminalTheme();
    };
    document.addEventListener("axiom:theme", applyTheme);
    // Preserve keystroke order across asynchronous HTTP requests. Never retry
    // an ambiguous write; discard pending input on failure and surface it.
    let pendingInput = "";
    let writing = false;
    let replaying = true;
    let replayGeneration = 0;
    let ended = false;
    async function flushInput() {
      if (writing || disposed || !termId) return;
      writing = true;
      try {
        while (pendingInput && !disposed) {
          let end = Math.min(pendingInput.length, 65536);
          if (end < pendingInput.length && /[\uD800-\uDBFF]/.test(pendingInput[end - 1])) end--;
          const data = pendingInput.slice(0, end);
          pendingInput = pendingInput.slice(end);
          await terminalAction("input", { id: termId, data });
        }
      } catch (e) {
        pendingInput = "";
        if (!disposed) setError(msg(e));
      } finally {
        writing = false;
      }
    }
    const input = term.onData((data) => {
      if (!termId || disposed || replaying || ended) return;
      pendingInput += data;
      void flushInput();
    });
    async function launch() {
      try {
        const created = selected.startsWith("new:")
          ? await terminalAction("create")
          : { id: selected };
        termId = created.id;
        if (disposed) {
          if (selected.startsWith("new:")) await terminalAction("close", { id: termId });
          return;
        }
        setId(termId);
        eventSource = new EventSource("/api/terminal/events?id=" + encodeURIComponent(termId));
        eventSource.onmessage = ({ data }) => {
          const e = JSON.parse(data);
          if (e.snapshot) {
            const generation = ++replayGeneration;
            replaying = true;
            ended = Boolean(e.interrupted) || typeof e.exit === "number";
            term.options.disableStdin = true;
            term.reset();
            setInterrupted(Boolean(e.interrupted));
            setExit(typeof e.exit === "number" ? e.exit : null);
            term.write(e.data || "", () => {
              if (disposed || generation !== replayGeneration) return;
              replaying = false;
              term.options.disableStdin = ended;
              if (!ended) resize();
            });
          } else if (e.data) {
            term.write(e.data);
          }
          if (typeof e.exit === "number") {
            ended = true;
            setExit(e.exit);
            term.options.disableStdin = true;
          }
          if (e.closed) eventSource?.close();
        };
        eventSource.onerror = () => {
          replaying = true;
          term.options.disableStdin = true;
          setError("终端连接中断");
        };
        const resize = () => {
          if (
            !term.options.disableStdin &&
            node.current?.clientWidth &&
            node.current.clientHeight
          ) {
            fit.fit();
            void terminalAction("resize", {
              id: termId,
              cols: term.cols,
              rows: term.rows,
            }).catch((e) => setError(msg(e)));
          }
        };
        observer = new ResizeObserver(resize);
        observer.observe(node.current!);
        resize();
      } catch (e) {
        setError(msg(e));
      }
    }
    void launch();
    return () => {
      disposed = true;
      observer?.disconnect();
      eventSource?.close();
      input.dispose();
      document.removeEventListener("axiom:theme", applyTheme);
      term.dispose();
    };
  }, [selected]);
  return (
    <div className={"wb-panel " + terminalCss.root}>
      <Header>
        <strong>PowerShell 7</strong>
        <button
          type="button"
          onClick={() => {
            setSelected("new:" + crypto.randomUUID());
          }}
        >
          新建
        </button>
        {id && (
          <button
            type="button"
            onClick={() => {
              void terminalAction("close", { id })
                .then(() => {
                  setSelected("");
                  setId("");
                  return api("terminals");
                })
                .then(setTerminals)
                .catch((e) => setError(msg(e)));
            }}
          >
            结束
          </button>
        )}
        {interrupted && <span>已中断：历史输出</span>}
        {id && !interrupted && exit === null && <span className="wb-muted">已连接</span>}
        {exit !== null && <span>退出码 {exit}</span>}
      </Header>
      {errorBox(error)}
      {!selected && (
        <div>
          {terminals.map((t) => (
            <button key={t.id} type="button" onClick={() => setSelected(t.id)}>
              恢复 {t.id.slice(0, 8)}{" "}
              {t.interrupted ? "已中断" : t.exit === null ? "运行中" : "已退出"}
            </button>
          ))}
        </div>
      )}
      <div ref={node} className={"wb-terminal " + terminalCss.screen} />
    </div>
  );
}
