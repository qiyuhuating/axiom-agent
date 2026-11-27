import { useEffect, useState } from "react";
import { writeClipboard } from "../vendor/dsh/primitives/clipboard.ts";
import { maskCredentials } from "./credential-mask.ts";
import { api, errorBox, msg } from "./panel-shared.tsx";
import { Button, Modal } from "./pi-primitives.tsx";
import { action, changeSession, getSnapshot, useProjectionField } from "./projection.ts";

const commands = {
  stats: "会话统计",
  history: "历史与分支",
  "export-html": "导出会话 HTML",
  "last-reply": "复制最近回复",
  rename: "重命名",
  clone: "复制会话",
  fork: "从消息分支",
  compact: "压缩上下文",
  "auto-compaction": "自动压缩",
  "auto-retry": "自动重试",
  "steering-mode": "引导消息队列",
  "follow-up-mode": "后续消息队列",
  "cycle-model": "切换到下一个可用模型",
  "cycle-thinking": "切换到下一级推理强度",
  "clear-queue": "清空消息队列",
  "abort-retry": "停止自动重试",
} as const;
type Command = keyof typeof commands;
type HistoryRow = {
  id: string;
  depth: number;
  kind: string;
  label: string;
  preview: string;
  active: boolean;
};
type Detail = {
  stats?: object;
  forks?: { entryId: string; text: string }[];
  history?: { rows: HistoryRow[]; leafId: string | null };
};
const views = { stats: "stats", fork: "forks", history: "history" } as const;

async function downloadSession(sessionId: string | undefined) {
  const response = await fetch("/api/session-export", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Axiom-Client": "1" },
    body: JSON.stringify({ sessionId }),
  });
  if (!response.ok) throw Error((await response.json()).error);
  const file = URL.createObjectURL(await response.blob());
  const download = document.createElement("a");
  download.href = file;
  download.download = "pi-session.html";
  download.click();
  setTimeout(() => URL.revokeObjectURL(file), 1000);
}

export function SessionControls({ onClose }: { onClose: () => void }) {
  const [command, setCommand] = useState<Command>("stats");
  const [value, setValue] = useState("");
  const [detail, setDetail] = useState<Detail>();
  const [error, setError] = useState("");
  const [applying, setApplying] = useState(false);
  const [sessionId] = useState(getSnapshot().state?.sessionId);
  const activeSessionId = useProjectionField("state")?.sessionId;
  const busy = useProjectionField("busy");
  const retrying = useProjectionField("retrying");
  const toggle = command === "auto-compaction" || command === "auto-retry";
  const queue = command === "steering-mode" || command === "follow-up-mode";
  const needsValue = command === "rename" || command === "fork" || toggle || queue;
  const view =
    command === "stats" || command === "history" || command === "fork" ? views[command] : null;
  const applies = command !== "stats" && command !== "history";
  const canApply =
    applies &&
    activeSessionId === sessionId &&
    (!busy || ["last-reply", "clear-queue", "abort-retry"].includes(command)) &&
    (command !== "abort-retry" || retrying) &&
    (command !== "fork" || detail?.forks?.some((entry) => entry.entryId === value)) &&
    (!needsValue || !!value.trim());

  useEffect(() => {
    if (!view) return;
    let ignore = false;
    void api("session-details?view=" + view).then(
      (data) => {
        if (!ignore) setDetail(data);
      },
      (error) => {
        if (!ignore) setError(msg(error));
      },
    );
    return () => {
      ignore = true;
    };
  }, [view]);

  async function apply() {
    if (!canApply || applying) return;
    setApplying(true);
    setError("");
    try {
      if (command === "export-html") await downloadSession(sessionId);
      else if (command === "last-reply") {
        const { text } = await api("session-details?view=last-reply");
        if (!text) throw Error("当前会话还没有可复制的回复。");
        if (!(await writeClipboard(text))) throw Error("剪贴板不可用。");
      } else if (command === "clear-queue" || command === "abort-retry") {
        await action(command);
      } else {
        await changeSession(command, toggle ? value === "on" : value || undefined);
      }
      onClose();
    } catch (error) {
      setError(msg(error));
    } finally {
      setApplying(false);
    }
  }

  return (
    <Modal
      open
      title="会话管理"
      closeLabel="关闭"
      onClose={() => {
        if (!applying) onClose();
      }}
    >
      <form
        className="wb-form"
        onSubmit={(event) => {
          event.preventDefault();
          void apply();
        }}
      >
        <label>
          操作
          <select
            data-modal-autofocus
            value={command}
            disabled={applying}
            onChange={(event) => {
              setCommand(event.target.value as Command);
              setValue("");
              setDetail(undefined);
              setError("");
            }}
          >
            {Object.entries(commands).map(([id, label]) => (
              <option key={id} value={id}>
                {label}
              </option>
            ))}
          </select>
        </label>
        {command === "stats" && detail?.stats && <pre>{JSON.stringify(detail.stats, null, 2)}</pre>}
        {view && !detail && !error && <p role="status">加载中…</p>}
        {activeSessionId !== sessionId && <p role="status">会话已切换，请重新打开此面板。</p>}
        {command === "history" &&
          detail?.history &&
          (detail.history.rows.length ? (
            <ol className="pi-session-history" aria-label="会话历史">
              {detail.history.rows.map((row) => (
                <li
                  key={row.id}
                  aria-current={row.id === detail.history?.leafId ? "step" : undefined}
                  style={{ paddingInlineStart: Math.min(row.depth, 8) * 12 }}
                >
                  <small>
                    {row.active ? "当前分支" : "其他分支"} · {row.kind}
                  </small>
                  <span>{maskCredentials(row.label || row.preview || row.kind)}</span>
                  {row.kind === "user" && row.active && !busy && activeSessionId === sessionId && (
                    <Button
                      type="button"
                      size="sm"
                      onClick={() => {
                        setDetail(undefined);
                        setValue(row.id);
                        setCommand("fork");
                      }}
                    >
                      从此消息分支
                    </Button>
                  )}
                </li>
              ))}
            </ol>
          ) : (
            <p>暂无会话记录。</p>
          ))}
        {command === "export-html" && (
          <p className="wb-muted">HTML 文件包含完整会话历史和系统提示词。</p>
        )}
        {command === "rename" && (
          <label>
            会话名称
            <input
              maxLength={200}
              value={value}
              onChange={(event) => setValue(event.target.value)}
            />
          </label>
        )}
        {command === "fork" && detail?.forks && (
          <label>
            消息
            <select value={value} onChange={(event) => setValue(event.target.value)}>
              <option value="" disabled>
                {detail.forks.length ? "选择消息" : "暂无可分支的消息"}
              </option>
              {detail.forks.map((item) => (
                <option key={item.entryId} value={item.entryId}>
                  {maskCredentials(item.text.slice(0, 100))}
                </option>
              ))}
            </select>
          </label>
        )}
        {(toggle || queue) && (
          <label>
            选项
            <select value={value} onChange={(event) => setValue(event.target.value)}>
              <option value="" disabled>
                选择设置
              </option>
              {toggle ? (
                <>
                  <option value="on">开启</option>
                  <option value="off">关闭</option>
                </>
              ) : (
                <>
                  <option value="all">全部</option>
                  <option value="one-at-a-time">逐条</option>
                </>
              )}
            </select>
          </label>
        )}
        {errorBox(error)}
        {applies && (
          <Button type="submit" variant="primary" disabled={applying || !canApply}>
            应用
          </Button>
        )}
      </form>
    </Modal>
  );
}
