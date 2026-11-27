import { MessageSquare, Search, Trash2 } from "lucide-react";
import React, { useState } from "react";
import rowsCss from "../vendor/dsh/sidebar/Rows.module.css";
import workspaceCss from "../vendor/dsh/sidebar/WorkspaceBrowser.module.css";
import { maskCredentials } from "./credential-mask.ts";
import { Button, Modal } from "./pi-primitives.tsx";
import "../vendor/dsh/theme/base.css";
import "../vendor/dsh/theme/design-platform.css";
import "../vendor/dsh/theme/gradient-shadow-text.css";
import "../vendor/dsh/theme/scrollbar.css";
import "../vendor/dsh/theme/focus.css";

type Session = { id: string; name?: string; firstMessage?: string };
type Props = {
  sessions: Session[];
  current: string | null;
  disabled: boolean;
  onSelect: (id: string) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
};
export function SessionList({ sessions, current, disabled, onSelect, onDelete }: Props) {
  const [query, setQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const [target, setTarget] = useState<Session | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [failure, setFailure] = useState("");
  const title = (s: Session) => maskCredentials(s.name || s.firstMessage || "未命名会话");
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
      <div className={workspaceCss.root + " axiom-workspace-list"}>
        <div className={workspaceCss.sectionHeader}>
          {searching ? (
            <input
              className="session-search"
              ref={(input) => {
                if (input) input.focus();
              }}
              aria-label="搜索会话"
              placeholder="搜索会话"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape") {
                  setQuery("");
                  setSearching(false);
                }
              }}
            />
          ) : (
            <span className={workspaceCss.sectionLabel}>会话历史</span>
          )}
          <button
            type="button"
            className={workspaceCss.iconButton}
            title="搜索会话"
            aria-label="搜索会话"
            aria-expanded={searching}
            onClick={() => {
              setSearching(!searching);
              setQuery("");
            }}
          >
            <Search size={16} />
          </button>
        </div>
        <div className={workspaceCss.list + " session-list"}>
          {sessions.length === 0 && <p className="empty-sessions">暂无历史会话</p>}
          {sessions
            .filter((s) => title(s).toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()))
            .map((s) => (
              <div
                key={s.id}
                className={
                  rowsCss.sessionRow +
                  " session-row" +
                  (s.id === current ? " " + rowsCss.selected + " active" : "")
                }
              >
                <Button
                  variant="ghost"
                  className="session-select"
                  disabled={disabled || deleting}
                  aria-current={s.id === current ? "page" : undefined}
                  title={title(s)}
                  icon={<MessageSquare size={16} strokeWidth={1.7} />}
                  onClick={() => void onSelect(s.id)}
                >
                  <span className={rowsCss.title}>{title(s)}</span>
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
