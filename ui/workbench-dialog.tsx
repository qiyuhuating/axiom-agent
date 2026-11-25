import { useState } from "react";
import { decodeRequest } from "../src/interaction-protocol.mjs";
import questionCss from "../vendor/dsh/capabilities/QuestionComposer.module.css";
import { Button } from "../vendor/dsh/primitives/Button.tsx";
import { Modal } from "../vendor/dsh/primitives/Modal.tsx";
import { api, errorBox, msg } from "./panel-shared.tsx";
import { type Dialog, removeDialog } from "./projection.ts";
import { StructuredDialog } from "./structured-dialog.tsx";

export function DialogView({ dialog }: { dialog: Dialog }) {
  let request: ReturnType<typeof decodeRequest>;
  try {
    request = decodeRequest(dialog);
  } catch {
    return (
      <PlainDialog
        dialog={{
          ...dialog,
          prefill: "Invalid structured request",
          title: "Invalid structured request",
        }}
      />
    );
  }
  return request ? (
    <StructuredDialog dialog={dialog} request={request} />
  ) : (
    <PlainDialog dialog={dialog} />
  );
}
function PlainDialog({ dialog }: { dialog: Dialog }) {
  const [value, setValue] = useState(dialog.prefill || ""),
    [error, setError] = useState(""),
    [working, setWorking] = useState(false);
  async function respond(payload: any) {
    setWorking(true);
    try {
      await api("ui-response", { id: dialog.id, ...payload });
      removeDialog(dialog.id);
    } catch (e) {
      setError(msg(e));
    } finally {
      setWorking(false);
    }
  }
  const confirm = dialog.method === "confirm";
  return (
    <Modal
      open
      title={dialog.title || "Pi 扩展请求"}
      tone={confirm ? "warning" : undefined}
      description={confirm ? undefined : dialog.message}
      closeLabel="关闭"
      onClose={() => {
        if (!working) void respond({ cancelled: true });
      }}
      footer={
        <>
          <Button
            variant="outline"
            data-modal-autofocus
            disabled={working}
            onClick={() => void respond(confirm ? { confirmed: false } : { cancelled: true })}
          >
            {confirm ? "拒绝" : "取消"}
          </Button>
          <Button
            variant="primary"
            disabled={working || (dialog.method === "select" && !dialog.options?.includes(value))}
            onClick={() => void respond(confirm ? { confirmed: true } : { value })}
          >
            {confirm ? "确认授权" : "确定"}
          </Button>
        </>
      }
    >
      {confirm && <pre className="wb-approval">{dialog.message}</pre>}
      {dialog.method === "select" && (
        <div className={questionCss.options}>
          {dialog.options?.map((o, i) => (
            <button
              type="button"
              key={o}
              className={questionCss.option + (value === o ? " " + questionCss.optionSelected : "")}
              aria-pressed={value === o}
              disabled={working}
              onClick={() => setValue(o)}
            >
              <span className={questionCss.number}>{i + 1}</span>
              <span className={questionCss.optionLabel}>{o}</span>
            </button>
          ))}
        </div>
      )}
      {dialog.method === "input" && (
        <input
          value={value}
          placeholder={dialog.placeholder}
          onChange={(e) => setValue(e.target.value)}
        />
      )}
      {dialog.method === "editor" && (
        <textarea rows={7} value={value} onChange={(e) => setValue(e.target.value)} />
      )}
      {errorBox(error)}
    </Modal>
  );
}
