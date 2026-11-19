import { Activity, ArrowUp, MessageSquare, PanelLeft, Plus, Square, Trash2 } from "lucide-react";
import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import { computeColumns, SIDEBAR_DEFAULT } from "../vendor/dsh/layout/columns.ts";
import { Button } from "../vendor/dsh/primitives/Button.tsx";
import { Modal } from "../vendor/dsh/primitives/Modal.tsx";
import "../vendor/dsh/theme/base.css";

type Session = { id: string; name?: string; firstMessage?: string };
type Props = {
  sessions: Session[];
  current: string | null;
  disabled: boolean;
  onSelect: (id: string) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
};
function SessionList({ sessions, current, disabled, onSelect, onDelete }: Props) {
  const [target, setTarget] = useState<Session | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [failure, setFailure] = useState("");
  const title = (s: Session) => s.name || s.firstMessage || "未命名会话";
  async function confirm() {
    if (!target || deleting) return;
    setDeleting(true);
    setFailure("");
    try {
      await onDelete(target.id);
      setTarget(null);
    } catch (e) {
      setFailure(e instanceof Error ? e.message : String(e));
    } finally {
      setDeleting(false);
    }
  }
  return (
    <>
      <div className="session-list">
        {sessions.length === 0 && <p className="empty-sessions">暂无历史会话</p>}
        {sessions.map((s) => (
          <div key={s.id} className={"session-row" + (s.id === current ? " active" : "")}>
            <Button
              variant="ghost"
              className="session-select"
              disabled={disabled || deleting}
              aria-current={s.id === current ? "page" : undefined}
              title={title(s)}
              icon={<MessageSquare size={16} strokeWidth={1.7} />}
              onClick={() => void onSelect(s.id)}
            >
              <span>{title(s)}</span>
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="session-delete"
              disabled={disabled || deleting}
              aria-label={"删除会话：" + title(s)}
              title="删除会话"
              icon={<Trash2 size={16} strokeWidth={1.7} />}
              onClick={() => {
                setFailure("");
                setTarget(s);
              }}
            />
          </div>
        ))}
      </div>
      <Modal
        open={target !== null}
        title="删除会话"
        tone="warning"
        closeLabel="关闭"
        onClose={() => {
          if (!deleting) setTarget(null);
        }}
        description="此操作将永久删除该会话的本地历史记录，不会删除工作区文件。"
        footer={
          <>
            <Button
              variant="outline"
              data-modal-autofocus
              disabled={deleting}
              onClick={() => setTarget(null)}
            >
              取消
            </Button>
            <Button
              className="danger"
              disabled={deleting || disabled}
              variant="primary"
              onClick={() => void confirm()}
            >
              {deleting ? "删除中…" : "确认删除"}
            </Button>
          </>
        }
      >
        <div className="delete-session-name">{target && title(target)}</div>
        {failure && (
          <p className="delete-error" role="alert">
            {failure}
          </p>
        )}
      </Modal>
    </>
  );
}
let listRoot: ReturnType<typeof createRoot> | undefined;
export function renderSessions(props: Props) {
  listRoot ??= createRoot(document.getElementById("sessions")!);
  listRoot.render(<SessionList {...props} />);
}
const iconRoots = new Map<string, ReturnType<typeof createRoot>>();
export function controlIcon(
  id: string,
  kind: "new" | "send" | "stop" | "trace" | "sidebar",
  label: string,
) {
  const el = document.getElementById(id)!;
  let root = iconRoots.get(id);
  if (!root) {
    el.replaceChildren();
    root = createRoot(el);
    iconRoots.set(id, root);
  }
  const Icon = {
    new: Plus,
    send: ArrowUp,
    stop: Square,
    trace: Activity,
    sidebar: PanelLeft,
  }[kind];
  root.render(
    <>
      <Icon size={16} strokeWidth={1.7} aria-hidden="true" />
      <span>{label}</span>
    </>,
  );
}
export function layout() {
  const w = window.innerWidth;
  if (w < 650) {
    document.body.style.removeProperty("--sidebar-width");
    document.body.style.removeProperty("--trace-width");
    return;
  }
  const c = computeColumns(w, SIDEBAR_DEFAULT, w >= 1000 ? 330 : 0);
  document.body.style.setProperty("--sidebar-width", c.sidebar + "px");
  document.body.style.setProperty("--trace-width", c.rightbar + "px");
}
