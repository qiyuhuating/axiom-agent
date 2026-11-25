import { api, dirtyTabs } from "./panel-shared.tsx";
import {
  type Attachment,
  type Composer,
  type Dialog,
  type JobState,
  snapshot,
  update,
} from "./projection-store.ts";

export {
  type Dialog,
  getSnapshot,
  type Job,
  type Message,
  type Tool,
  useProjection,
  useProjectionField,
} from "./projection-store.ts";

import { projectHistory, textOf, upsertTool } from "./message-history.ts";

export { projectHistory, textOf } from "./message-history.ts";

const composers = new Map<string, Composer>();
const draftKey = (id: string) => "axiom.composer-draft.v1:" + id;
function composerFor(id: string): Composer {
  const cached = composers.get(id);
  if (cached) return cached;
  let draft = "";
  try {
    draft = sessionStorage.getItem(draftKey(id)) ?? "";
  } catch {
    // Storage may be disabled; composing still works in this tab.
  }
  return { draft, attachments: [] };
}
function saveComposer(id: string, composer: Composer) {
  if (composer.draft || composer.attachments.length) composers.set(id, composer);
  else composers.delete(id);
  try {
    if (composer.draft) sessionStorage.setItem(draftKey(id), composer.draft);
    else sessionStorage.removeItem(draftKey(id));
  } catch {
    // Keep the current draft in memory when persistent storage is unavailable.
  }
  if (snapshot.state?.sessionId === id) update(composer);
}
export const setDraft = (draft: string, id = snapshot.state?.sessionId) => {
  if (id && id === snapshot.state?.sessionId && draft !== snapshot.draft)
    saveComposer(id, { draft, attachments: snapshot.attachments });
};
export const appendDraft = (text: string) =>
  setDraft([snapshot.draft, text].filter(Boolean).join("\n"));
export const setError = (e: unknown) =>
  update({ error: e instanceof Error ? e.message : String(e ?? "") });
export async function run(fn: () => Promise<unknown>) {
  setError("");
  try {
    await fn();
  } catch (e) {
    setError(e);
  }
}
export const action = (action: string, value?: unknown, images?: unknown[]) =>
  api("action", {
    action,
    value,
    ...(["prompt", "steer", "followUp"].includes(action)
      ? { sessionId: snapshot.state?.sessionId }
      : {}),
    ...(images?.length ? { images } : {}),
  });
let generation = 0;
let pendingEvents: any[] | null = null;
export async function refresh() {
  const id = ++generation;
  pendingEvents = [];
  update({ syncing: true });
  try {
    const { state, messages, sessions, dialogs, harness } = await api("snapshot");
    if (id !== generation) return;
    const switched = snapshot.state?.sessionId !== state.sessionId;
    try {
      const live = new Set(dialogs.map((d: Dialog) => "axiom.question-draft.v1:" + d.id));
      for (let i = sessionStorage.length - 1; i >= 0; i--) {
        const key = sessionStorage.key(i);
        if (key?.startsWith("axiom.question-draft.v1:") && !live.has(key))
          sessionStorage.removeItem(key);
      }
    } catch {
      /* Storage is optional; never block the authoritative snapshot. */
    }
    const buffered = pendingEvents;
    pendingEvents = null;
    const projected = projectHistory(messages);
    if (!switched) {
      const previousTools = new Map(snapshot.tools.map((tool) => [tool.id, tool]));
      projected.tools = projected.tools.map((t) => {
        const old = previousTools.get(t.id);
        return old ? { ...t, started: old.started, ended: old.ended } : t;
      });
    }
    update({
      state,
      harness: harness.sessionId === state.sessionId ? harness : null,
      ...projected,
      ...(switched ? composerFor(state.sessionId) : {}),
      sessions,
      dialogs,
      stream: "",
      busy: state.busy,
      retrying: state.retrying === true,
      syncing: false,
      syncFailed: false,
    });
    // Live events during an unversioned snapshot cannot safely be replayed:
    // completed messages/dialogs may already be present. Refresh on settlement.
    if (
      buffered?.some(
        (e) =>
          e.type === "agent_settled" ||
          e.type === "state_changed" ||
          e.type === "message_end" ||
          e.type === "extension_ui_request" ||
          e.type === "ui_closed",
      )
    )
      queueMicrotask(() => void run(refresh));
    else if (buffered?.length) {
      for (const e of buffered) handleEvent(e);
    }
    if (switched) window.dispatchEvent(new Event("axiom:session"));
  } catch (error) {
    if (id !== generation) return;
    if (pendingEvents?.some((event) => event.type === "state_changed")) {
      queueMicrotask(() => void run(refresh));
      return;
    }
    update({ syncFailed: true });
    throw error;
  } finally {
    if (id === generation) {
      pendingEvents = null;
      update({ syncing: false });
    }
  }
}
let jobCursor = "";
let jobRequest: { key: string; pending: Promise<JobState> } | undefined;
export function loadJobs(cursor = jobCursor) {
  jobCursor = cursor;
  const session = snapshot.state?.sessionId ?? "";
  const key = new URLSearchParams({ view: "page", session });
  if (cursor) key.set("cursor", cursor);
  const path = key.toString();
  if (jobRequest?.key === path) return jobRequest.pending;
  const pending: Promise<JobState> = api("jobs?" + path)
    .then((page) => {
      const jobs: JobState = page;
      if (jobRequest?.pending === pending && (snapshot.state?.sessionId ?? "") === session) {
        jobCursor = page.cursor;
        update({ jobs });
      }
      return jobs;
    })
    .finally(() => {
      if (jobRequest?.pending === pending) jobRequest = undefined;
    });
  jobRequest = { key: path, pending };
  return pending;
}
export async function loadOptions() {
  const [models, levels, state] = await Promise.all([api("models"), api("levels"), api("state")]);
  if (snapshot.state?.sessionId === state.sessionId) update({ models, levels, state });
}
export async function changeSession(kind: string, value?: unknown) {
  const current = snapshot.state?.sessionId;
  const leaving =
    kind === "new" ||
    kind === "fork" ||
    (kind === "switch" && value !== current) ||
    (kind === "delete" && value === current);
  if (
    leaving &&
    dirtyTabs.size > 0 &&
    !window.confirm("有 " + dirtyTabs.size + " 个文件未保存。离开当前会话将丢弃这些编辑，继续？")
  ) {
    throw Error("已取消会话切换，未保存修改仍然保留");
  }
  if (
    !snapshot.connected ||
    snapshot.syncFailed ||
    snapshot.busy ||
    snapshot.changing ||
    snapshot.syncing
  )
    throw Error("Agent is busy or synchronizing");
  update({ changing: true });
  let forkDraft: string | undefined;
  try {
    const result = await action(kind, value);
    if (kind === "fork" && !result.cancelled && typeof result.text === "string")
      forkDraft = result.text;
    if (kind === "delete" && typeof result.deleted === "string")
      saveComposer(result.deleted, { draft: "", attachments: [] });
    if (result.cancelled) throw Error("Pi cancelled the session operation");
  } finally {
    try {
      await refresh();
      if (forkDraft !== undefined) setDraft(forkDraft);
    } finally {
      update({ changing: false });
    }
  }
  await loadOptions();
}
export function removeDialog(id: string) {
  try {
    sessionStorage.removeItem("axiom.question-draft.v1:" + id);
  } catch {
    /* optional storage */
  }
  update({ dialogs: snapshot.dialogs.filter((d) => d.id !== id) });
}
let recovering = false;
export function connect() {
  const events = new EventSource("/api/events");
  let lastSeqId = 0;
  events.onopen = () => {
    lastSeqId = 0;
    update({ connected: true });
    void run(async () => {
      await refresh();
      await loadOptions();
    });
  };
  events.onerror = () => update({ connected: false });
  events.onmessage = ({ data }) => {
    const event = JSON.parse(data);
    if (event.seqId <= lastSeqId) return;
    if (lastSeqId && event.seqId !== lastSeqId + 1) void run(refresh);
    lastSeqId = event.seqId;
    handleEvent(event);
  };
  return () => {
    events.close();
    generation++;
    pendingEvents = null;
  };
}
function handleEvent(e: any) {
  if (pendingEvents && e.type !== "connection_error") {
    pendingEvents.push(e);
    return;
  }
  if (typeof e.busy === "boolean" && e.busy !== snapshot.busy) update({ busy: e.busy });
  switch (e.type) {
    case "auto_retry_start":
      update({ retrying: true });
      break;
    case "auto_retry_end":
      update({ retrying: false });
      break;
    case "message_start":
      if (e.message.role === "assistant") update({ stream: "" });
      break;
    case "message_update":
      if (e.assistantMessageEvent.type === "text_delta")
        update({ stream: snapshot.stream + e.assistantMessageEvent.delta });
      break;
    case "message_end":
      if (["user", "assistant"].includes(e.message.role))
        update({
          messages: [...snapshot.messages, e.message],
          turn: snapshot.turn + (e.message.role === "user" ? 1 : 0),
          stream: e.message.role === "assistant" ? "" : snapshot.stream,
          ...(e.message.errorMessage ? { error: e.message.errorMessage } : {}),
        });
      break;
    case "run_status":
      if (e.busy === false) void run(refresh);
      break;
    case "agent_settled":
      update({ retrying: false });
      void run(refresh);
      break;
    case "state_changed":
      if (!snapshot.changing)
        void run(async () => {
          await refresh();
          await loadOptions();
        });
      break;
    case "ui_closed":
      removeDialog(e.id);
      break;
    case "extension_ui_request":
      if (["confirm", "select", "input", "editor"].includes(e.method)) {
        if (!snapshot.dialogs.some((d) => d.id === e.id))
          update({ dialogs: [...snapshot.dialogs, e] });
      } else if (e.method === "set_editor_text") setDraft(e.text ?? "");
      else if (["notify", "setStatus", "setWidget", "setTitle"].includes(e.method))
        update({
          notice:
            e.message ?? e.text ?? e.title ?? (Array.isArray(e.lines) ? e.lines.join(" ") : ""),
        });
      break;
    case "connection_error":
      update({ retrying: false });
      setError(e.error);
      if (!recovering) {
        recovering = true;
        void run(async () => {
          try {
            await refresh();
            await loadOptions();
          } finally {
            recovering = false;
          }
        });
      }
      break;
    default:
      if (e.type.startsWith("tool_execution_"))
        update({
          tools: upsertTool(snapshot.tools, {
            id: e.toolCallId,
            name: e.toolName,
            args: e.args,
            result: e.result ?? e.partialResult,
            details: e.result?.details,
            failed: !!e.isError,
            finished: e.type === "tool_execution_end",
            turn: snapshot.turn,
            ...(e.type === "tool_execution_start" ? { started: Date.now() } : {}),
            ...(e.type === "tool_execution_end" ? { ended: Date.now() } : {}),
          }),
        });
  }
}
export function removeAttachment(index: number) {
  const id = snapshot.state?.sessionId;
  if (id)
    saveComposer(id, {
      draft: snapshot.draft,
      attachments: snapshot.attachments.filter((_, i) => i !== index),
    });
}
export async function addFiles(files: File[]) {
  const id = snapshot.state?.sessionId;
  if (!id) return;
  for (const file of files) {
    try {
      if (file.size > 8 * 1024 * 1024) throw Error("Attachment exceeds 8 MiB");
      if (composerFor(id).attachments.length >= 8) throw Error("At most 8 attachments");
      const data = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result).split(",")[1]);
        reader.onerror = () => reject(reader.error);
        reader.readAsDataURL(file);
      });
      let attachment: Attachment;
      if (["image/png", "image/jpeg", "image/webp", "image/gif"].includes(file.type))
        attachment = { name: file.name, image: { type: "image", mimeType: file.type, data } };
      else {
        const result = await api("upload", { name: file.name, data });
        attachment = { name: file.name, path: result.path };
      }
      const composer = composerFor(id);
      if (composer.attachments.length >= 8) throw Error("At most 8 attachments");
      saveComposer(id, { ...composer, attachments: [...composer.attachments, attachment] });
    } catch (e) {
      if (snapshot.state?.sessionId === id) setError(e);
    }
  }
}
let submitting = false;
export async function submit(mode: string) {
  const sessionId = snapshot.state?.sessionId;
  if (
    !sessionId ||
    submitting ||
    snapshot.syncing ||
    snapshot.syncFailed ||
    snapshot.changing ||
    !snapshot.connected
  )
    return;
  const { draft, attachments, busy } = snapshot;
  const suffix = attachments
    .filter((a) => a.path)
    .map((a) => "附件：" + a.name + "（工作区路径：" + a.path + "）")
    .join("\n");
  const images = attachments.flatMap((a) => (a.image ? [a.image] : []));
  const text = [draft.trim(), suffix].filter(Boolean).join("\n");
  if (!text && !images.length) return;
  submitting = true;
  try {
    const result = await api("action", {
      action: busy ? mode : "prompt",
      value: text || "请分析附加图片。",
      sessionId,
      ...(images.length ? { images } : {}),
    });
    const current = composerFor(sessionId);
    saveComposer(sessionId, {
      draft: current.draft === draft ? "" : current.draft,
      attachments: current.attachments.filter((a) => !attachments.includes(a)),
    });
    if (result === "queued" && snapshot.state?.sessionId === sessionId)
      update({ notice: mode === "steer" ? "已加入引导队列" : "已加入后续队列" });
  } finally {
    submitting = false;
  }
}
