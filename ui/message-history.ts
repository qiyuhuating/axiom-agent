import type { Message, Tool } from "./projection-store.ts";
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
export function upsertTool(tools: Tool[], e: Partial<Tool> & { id: string }): Tool[] {
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
