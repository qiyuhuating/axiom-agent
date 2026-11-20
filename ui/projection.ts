import { useSyncExternalStore } from "react";
import { api } from "./panel-shared.tsx";
export type Dialog = {
  id: string;
  method: string;
  title?: string;
  message?: string;
  options?: string[];
  placeholder?: string;
  prefill?: string;
};
export type Message = {
  role: string;
  content: any;
  errorMessage?: string;
  toolCallId?: string;
  toolName?: string;
  isError?: boolean;
  details?: unknown;
};
export type Tool = {
  id: string;
  name: string;
  args?: unknown;
  result?: unknown;
  finished: boolean;
  failed: boolean;
  started?: number;
  ended?: number;
  details?: unknown;
  turn?: number;
};
type Session = { id: string; name?: string; firstMessage?: string };
type State = {
  sessionId: string;
  workspace: string;
  busy: boolean;
  retrying?: boolean;
  model?: { provider: string; id: string };
  thinkingLevel?: string;
};
type Model = { provider: string; id: string };
type Attachment = {
  name: string;
  path?: string;
  image?: { type: "image"; mimeType: string; data: string };
};
type Composer = { draft: string; attachments: Attachment[] };
export type Job = {
  id: string;
  team?: string;
  node?: string;
  label: string;
  status: string;
  activity?: string;
  error?: string;
  steps?: string[];
  blockedBy: string[];
};
type JobState = {
  jobs: Job[];
  schedules: any[];
  plans: Record<string, { goal: string; items: { text: string; done: boolean }[] }>;
};
type HarnessState = {
  sessionId: string;
  planMode: boolean;
  goal: null | {
    id: string;
    objective: string;
    phase: string;
    remaining: number;
    evidence?: string;
  };
};
type Snapshot = {
  harness: HarnessState | null;
  jobs: JobState | null;
  state: State | null;
  messages: Message[];
  tools: Tool[];
  turn: number;
  stream: string;
  models: Model[];
  levels: string[];
  sessions: Session[];
  dialogs: Dialog[];
  draft: string;
  attachments: Attachment[];
  syncing: boolean;
  syncFailed: boolean;
  changing: boolean;
  busy: boolean;
  retrying: boolean;
  connected: boolean;
  error: string;
  notice: string;
};
let snapshot: Snapshot = {
  harness: null,
  jobs: null,
  state: null,
  messages: [],
  tools: [],
  turn: 0,
  stream: "",
  models: [],
  levels: [],
  sessions: [],
  dialogs: [],
  draft: "",
  attachments: [],
  syncing: true,
  syncFailed: false,
  changing: false,
  busy: false,
  retrying: false,
  connected: false,
  error: "",
  notice: "",
};
const listeners = new Set<() => void>();
function update(patch: Partial<Snapshot>) {
  snapshot = { ...snapshot, ...patch };
  for (const listener of listeners) listener();
}
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};
export const getSnapshot = () => snapshot;
export function useProjection() {
  return useSyncExternalStore(subscribe, getSnapshot);
}
export function useProjectionField<K extends keyof Snapshot>(key: K): Snapshot[K] {
  return useSyncExternalStore(subscribe, () => snapshot[key]);
}
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
export function textOf(content: any): string {
  return typeof content === "string"
    ? content
    : (content ?? [])
        .filter((x: any) => x.type === "text")
        .map((x: any) => x.text)
        .join("\n");
}
function mergeTool(e: Partial<Tool> & { id: string }, old?: Tool): Tool {
  return {
    id: e.id,
    name: e.name ?? old?.name ?? "tool",
    args: e.args ?? old?.args,
    result: e.result ?? old?.result,
    finished: e.finished ?? old?.finished ?? false,
    failed: e.failed ?? old?.failed ?? false,
    started: e.started ?? old?.started,
    ended: e.ended ?? old?.ended,
    details: e.details ?? old?.details,
    turn: old?.turn ?? e.turn,
  };
}
function upsertTool(tools: Tool[], e: Partial<Tool> & { id: string }): Tool[] {
  const old = tools.find((t) => t.id === e.id);
  const next = mergeTool(e, old);
  return old ? tools.map((t) => (t.id === e.id ? next : t)) : [...tools, next];
}
export function projectHistory(messages: Message[]) {
  const tools = new Map<string, Tool>();
  let turn = 0;
  for (const m of messages) {
    if (m.role === "user") turn++;
    if (Array.isArray(m.content))
      for (const c of m.content)
        if (c.type === "toolCall")
          tools.set(
            c.id,
            mergeTool({ id: c.id, name: c.name, args: c.arguments, turn }, tools.get(c.id)),
          );
    if (m.role === "toolResult" && m.toolCallId) {
      tools.set(
        m.toolCallId,
        mergeTool(
          {
            id: m.toolCallId,
            name: m.toolName,
            result: m.content,
            details: m.details,
            failed: !!m.isError,
            finished: true,
          },
          tools.get(m.toolCallId),
        ),
      );
    }
  }
  return {
    messages: messages.filter((m) => ["user", "assistant"].includes(m.role)),
    tools: Array.from(tools.values()),
    turn,
  };
}
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
let jobRequest: Promise<JobState> | undefined;
export function loadJobs() {
  jobRequest ??= api("jobs")
    .then((jobs: JobState) => {
      update({ jobs });
      return jobs;
    })
    .finally(() => {
      jobRequest = undefined;
    });
  return jobRequest;
}
export async function loadOptions() {
  const [models, levels, state] = await Promise.all([api("models"), api("levels"), api("state")]);
  if (snapshot.state?.sessionId === state.sessionId) update({ models, levels, state });
}
export async function changeSession(kind: string, value?: unknown) {
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
  events.onopen = () => {
    update({ connected: true });
    void run(async () => {
      await refresh();
      await loadOptions();
    });
  };
  events.onerror = () => update({ connected: false });
  events.onmessage = ({ data }) => handleEvent(JSON.parse(data));
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
