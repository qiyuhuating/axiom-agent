import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { javascript } from "@codemirror/lang-javascript";
import { json as jsonLanguage } from "@codemirror/lang-json";
import { markdown as markdownLanguage } from "@codemirror/lang-markdown";
import { python } from "@codemirror/lang-python";
import { defaultHighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { EditorState } from "@codemirror/state";
import {
  drawSelection,
  EditorView,
  highlightActiveLine,
  keymap,
  lineNumbers,
} from "@codemirror/view";
import { RefreshCw, Save } from "lucide-react";
import React, { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "../vendor/dsh/primitives/Button.tsx";
import { DiffBlock } from "../vendor/dsh/primitives/DiffBlock.tsx";
import MarkdownIt from "./markdown.ts";
import { api, dirtyTabs, errorBox, Header, msg } from "./panel-shared.tsx";

const diffLabels = {
  codeLabel: "Diff",
  wrapLabel: "自动换行",
  unwrapLabel: "取消换行",
  copy: "复制",
  copied: "已复制",
  collapseAria: "折叠差异",
  expandAria: (n: number) => "展开 " + n + " 行",
  collapse: "收起",
  expand: (n: number) => "展开 " + n + " 行",
};
const md = new MarkdownIt({ html: false, linkify: true }).disable("image");
function language(path: string) {
  if (/\.[cm]?[jt]sx?$/i.test(path))
    return javascript({
      typescript: /tsx?$/i.test(path),
      jsx: /[jt]sx$/i.test(path),
    });
  if (/\.json$/i.test(path)) return jsonLanguage();
  if (/\.py$/i.test(path)) return python();
  if (/\.md$/i.test(path)) return markdownLanguage();
  return [];
}
const editorTheme = EditorView.theme(
  {
    "&": { height: "100%", background: "#15171a", color: "#dce3e9" },
    ".cm-scroller": { overflow: "auto", fontFamily: "Consolas, monospace" },
    ".cm-gutters": { background: "#1b1e22", color: "#7b8792", border: "none" },
    ".cm-activeLine": { background: "#242930" },
    ".cm-activeLineGutter": { background: "#242930" },
    ".cm-cursor": { borderLeftColor: "#b2e1cc" },
    ".cm-selectionBackground": { background: "#344e46!important" },
  },
  { dark: true },
);
export default function Editor({ path }: { path: string }) {
  const [file, setFile] = useState<any>(null),
    [error, setError] = useState(""),
    [changed, setChanged] = useState(false),
    [mode, setMode] = useState("edit"),
    [version, setVersion] = useState(0),
    [text, setText] = useState("");
  const container = useRef<HTMLDivElement>(null),
    view = useRef<EditorView | null>(null),
    latest = useRef(""),
    original = useRef("");
  const load = useCallback(async () => {
    try {
      const f = await api("file?path=" + encodeURIComponent(path));
      setFile(f);
      latest.current = f.text || "";
      original.current = f.text || "";
      setText(f.text || "");
      setChanged(false);
      dirtyTabs.delete(path);
      setVersion((v) => v + 1);
      setError("");
    } catch (e) {
      setError(msg(e));
    }
  }, [path]);
  useEffect(() => {
    void load();
    return () => {
      dirtyTabs.delete(path);
    };
  }, [path, load]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: A load revision recreates the editor even when the file type stays unchanged.
  useEffect(() => {
    if (!container.current || file?.kind !== "text" || mode !== "edit") return;
    const current = latest.current;
    const v = new EditorView({
      parent: container.current,
      state: EditorState.create({
        doc: current,
        extensions: [
          EditorState.lineSeparator.of(original.current.includes("\r\n") ? "\r\n" : "\n"),
          lineNumbers(),
          drawSelection(),
          highlightActiveLine(),
          history(),
          keymap.of([...defaultKeymap, ...historyKeymap]),
          language(path),
          syntaxHighlighting(defaultHighlightStyle),
          editorTheme,
          EditorView.updateListener.of((u) => {
            if (u.docChanged) {
              latest.current = u.state.sliceDoc();
              const delta = latest.current !== original.current;
              setChanged(delta);
              if (delta) dirtyTabs.add(path);
              else dirtyTabs.delete(path);
            }
          }),
        ],
      }),
    });
    view.current = v;
    return () => {
      v.destroy();
      view.current = null;
    };
  }, [version, mode, path, file?.kind]);
  async function save() {
    try {
      const submitted = latest.current;
      const r = await api("file-save", {
        path,
        text: submitted,
        revision: file.revision,
      });
      original.current = submitted;
      setFile({ ...file, text: submitted, revision: r.revision });
      const delta = latest.current !== submitted;
      setChanged(delta);
      if (delta) dirtyTabs.add(path);
      else dirtyTabs.delete(path);
      setError("");
    } catch (e) {
      setError(msg(e));
    }
  }
  function changeMode(next: string) {
    setText(latest.current);
    setMode(next);
  }
  const isMd = /\.md$/i.test(path);
  return (
    <div className="wb-panel">
      <Header>
        <strong className="wb-ellipsis" title={path}>
          {path}
          {changed ? " *" : ""}
        </strong>
        {file?.kind === "text" && (
          <>
            <Button
              size="sm"
              icon={<Save size={15} />}
              disabled={!changed}
              onClick={() => void save()}
            >
              保存
            </Button>
            <Button size="sm" onClick={() => changeMode(mode === "diff" ? "edit" : "diff")}>
              {mode === "diff" ? "编辑" : "Diff"}
            </Button>
            {isMd && (
              <Button size="sm" onClick={() => changeMode(mode === "preview" ? "edit" : "preview")}>
                {mode === "preview" ? "编辑" : "预览"}
              </Button>
            )}
          </>
        )}
        <Button
          size="sm"
          icon={<RefreshCw size={15} />}
          onClick={() => {
            if (!changed || window.confirm("放弃未保存修改？")) void load();
          }}
        />
      </Header>
      {errorBox(error)}
      {!file ? (
        <p className="wb-muted">加载文件…</p>
      ) : file.kind === "text" ? (
        mode === "edit" ? (
          <div ref={container} className="wb-editor" />
        ) : mode === "diff" ? (
          <div className="wb-scroll">
            {text === original.current ? (
              <p className="wb-muted">没有更改</p>
            ) : (
              <DiffBlock
                diffs={[{ path, oldText: original.current, newText: text }]}
                labels={diffLabels}
              />
            )}
          </div>
        ) : (
          <div
            className="wb-scroll markdown"
            // biome-ignore lint/security/noDangerouslySetInnerHtml: Markdown-it escapes raw HTML and rejects unsafe links.
            dangerouslySetInnerHTML={{ __html: md.render(text) }}
          />
        )
      ) : file.kind === "media" ? (
        file.mime === "application/pdf" ? (
          <MediaFrame file={file} />
        ) : (
          <div className="wb-scroll">
            <img
              className="wb-image"
              alt={path}
              src={"data:" + file.mime + ";base64," + file.data}
            />
          </div>
        )
      ) : (
        <p className="wb-muted">二进制文件（{file.size} 字节），不支持文本编辑。</p>
      )}
    </div>
  );
}
function MediaFrame({ file }: { file: any }) {
  const [src, setSrc] = useState("");
  useEffect(() => {
    const bytes = Uint8Array.from(atob(file.data), (c) => c.charCodeAt(0));
    const url = URL.createObjectURL(new Blob([bytes], { type: file.mime }));
    setSrc(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);
  return src ? <iframe title="PDF 预览" className="wb-frame" src={src} /> : null;
}
