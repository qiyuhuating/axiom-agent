import { useEffect, useState } from "react";
import { Button } from "../vendor/dsh/primitives/Button.tsx";
import { Modal } from "../vendor/dsh/primitives/Modal.tsx";
import { api, errorBox, msg } from "./panel-shared.tsx";
import { changeSession } from "./projection.ts";

const commands = {
  stats: "会话统计",
  rename: "重命名",
  clone: "复制会话",
  fork: "从消息分支",
  compact: "压缩上下文",
  "auto-compaction": "自动压缩",
  "auto-retry": "自动重试",
  "steering-mode": "引导消息队列",
  "follow-up-mode": "后续消息队列",
} as const;
type Command = keyof typeof commands;
type Detail = { stats?: object; forks?: { entryId: string; text: string }[] };

export function SessionControls({ onClose }: { onClose: () => void }) {
  const [command, setCommand] = useState<Command>("stats");
  const [value, setValue] = useState("");
  const [detail, setDetail] = useState<Detail>();
  const [error, setError] = useState("");
  const [applying, setApplying] = useState(false);
  const toggle = command === "auto-compaction" || command === "auto-retry";
  const queue = command === "steering-mode" || command === "follow-up-mode";
  const needsValue = command === "rename" || command === "fork" || toggle || queue;

  useEffect(() => {
    if (command !== "stats" && command !== "fork") return;
    let ignore = false;
    void api("session-details?view=" + (command === "fork" ? "forks" : "stats")).then(
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
  }, [command]);

  async function apply() {
    if (command === "stats" || applying || (needsValue && !value.trim())) return;
    setApplying(true);
    setError("");
    try {
      await changeSession(command, toggle ? value === "on" : value || undefined);
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
      title="Pi 会话"
      closeLabel="关闭"
      onClose={() => {
        if (!applying) onClose();
      }}
    >
      <form
        className="wb-form"
        onSubmit={(event) => {
          event.preventDefault();
          if (command !== "stats") void apply();
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
        {(command === "stats" || command === "fork") && !detail && !error && (
          <p role="status">加载中…</p>
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
                  {item.text.slice(0, 100)}
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
        {command !== "stats" && (
          <Button
            type="submit"
            variant="primary"
            disabled={applying || (needsValue && !value.trim())}
          >
            应用
          </Button>
        )}
      </form>
    </Modal>
  );
}
