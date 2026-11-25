import { useSyncExternalStore } from "react";
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
export type Attachment = {
  name: string;
  path?: string;
  image?: { type: "image"; mimeType: string; data: string };
};
export type Composer = { draft: string; attachments: Attachment[] };
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
export type JobState = {
  nextCursor: string | null;
  cursor: string;
  teamJobs: Job[];
  mail: any[];
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
export let snapshot: Snapshot = {
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
export function update(patch: Partial<Snapshot>) {
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
