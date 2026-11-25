import { Plus } from "lucide-react";
import { memo, useCallback, useRef, useState } from "react";
import inputCss from "../vendor/dsh/conversation/InputBar.module.css";
import { DraftEditor } from "./draft-editor.tsx";
import { HarnessModeDock, PlanDock } from "./harness-features.tsx";
import { PiModelSelect } from "./model-select.tsx";
import {
  action,
  addFiles,
  loadOptions,
  refresh,
  removeAttachment,
  run,
  submit,
  type useProjection,
} from "./projection.ts";

const MemoDraftEditor = memo(DraftEditor);
const MemoHarnessModeDock = memo(HarnessModeDock);
const MemoPlanDock = memo(PlanDock);
export function Composer({
  p,
  unavailable,
  locked,
  quote,
  clearQuote,
}: {
  p: ReturnType<typeof useProjection>;
  unavailable: boolean;
  locked: boolean;
  quote: { text: string; id: number; sessionId?: string } | null;
  clearQuote: () => void;
}) {
  const files = useRef<HTMLInputElement>(null);
  const sessionId = p.state?.sessionId;
  const [queue, setQueue] = useState("steer");
  const submitDraft = useCallback(() => void run(() => submit(queue)), [queue]);
  return (
    <>
      <form
        id="form"
        className={inputCss.card}
        data-composer-card
        onSubmit={(e) => {
          e.preventDefault();
          void run(() => submit(queue));
        }}
      >
        <div id="attachment-list">
          {p.attachments.map((a, i) => (
            <button
              type="button"
              className="attachment-chip"
              key={i}
              onClick={() => removeAttachment(i)}
              title="移除附件"
            >
              {a.name} ×
            </button>
          ))}
        </div>
        <MemoDraftEditor
          key={p.state?.sessionId}
          quote={quote?.sessionId === sessionId ? quote : null}
          onQuoteConsumed={clearQuote}
          draft={p.draft}
          hasAttachments={p.attachments.length > 0}
          disabled={unavailable}
          sessionId={p.state?.sessionId}
          onSubmit={submitDraft}
        />
        <div className={inputCss.row + " axiom-input-controls"} data-composer-controls="">
          <div className={inputCss.tools}>
            <input
              ref={files}
              type="file"
              id="attach-input"
              multiple
              hidden
              onChange={(e) => {
                const list = Array.from(e.currentTarget.files ?? []);
                e.currentTarget.value = "";
                void addFiles(list);
              }}
            />
            <button
              type="button"
              id="attach-button"
              className={inputCss.add}
              disabled={unavailable}
              aria-label="添加附件"
              title="添加附件"
              onClick={() => files.current?.click()}
            >
              <Plus size={14} />
            </button>
            <div className={inputCss.modes}>
              <MemoHarnessModeDock inline />
              <select
                id="queue-mode"
                className={inputCss.select}
                aria-label="运行中的消息队列"
                value={queue}
                onChange={(e) => setQueue(e.target.value)}
              >
                <option value="steer">引导当前任务</option>
                <option value="followUp">当前任务结束后发送</option>
              </select>
            </div>
          </div>
          <div className={inputCss.trailing}>
            <div className={inputCss.standardControls}>
              <PiModelSelect
                models={p.models}
                levels={p.levels}
                current={p.state?.model}
                effort={p.state?.thinkingLevel}
                sessionId={p.state?.sessionId}
                disabled={locked}
                onModel={(model) =>
                  run(async () => {
                    await action("model", model);
                    await loadOptions();
                  })
                }
                onEffort={(level) =>
                  run(async () => {
                    await action("thinking", level);
                    await loadOptions();
                  })
                }
              />
            </div>
            <button
              type="button"
              id="stop"
              className={inputCss.primary}
              disabled={!p.busy || !p.connected}
              aria-label="停止"
              title="停止"
              onClick={() =>
                void run(async () => {
                  await action("abort");
                  await refresh();
                })
              }
            >
              <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
                <rect x="3" y="3" width="10" height="10" rx="3" fill="currentColor" />
              </svg>
            </button>
            <button
              id="send"
              type="submit"
              className={inputCss.primary}
              disabled={unavailable}
              aria-label={p.busy ? "加入消息队列" : "发送"}
              title={p.busy ? "加入消息队列 (Ctrl+Enter)" : "发送 (Ctrl+Enter)"}
            >
              <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
                <path
                  d="M8.3125 0.980183C8.66767 1.0531 8.97902 1.20418 9.2627 1.43233C9.48724 1.61297 9.73029 1.85793 9.97949 2.10714L14.707 6.83468L13.293 8.24874L9 3.95577V15.0417H7V3.95577L2.70703 8.24874L1.29297 6.83468L6.02051 2.10714C6.26971 1.85793 6.51277 1.61297 6.7373 1.43233C6.97662 1.23986 7.28445 1.04402 7.6875 0.980183C7.8973 0.947006 8.1031 0.95516 8.3125 0.980183Z"
                  fill="currentColor"
                />
              </svg>
            </button>
          </div>
        </div>
      </form>
      <div className={inputCss.dock} data-composer-dock>
        <MemoPlanDock key={p.state?.sessionId} />
      </div>
    </>
  );
}
