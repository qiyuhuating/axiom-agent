import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { INTERACTION_TITLE, validateAnswer, validateRequest } from "./interaction-protocol.mjs";

const modeKey = "axiom-plan-mode-v1";
const readTools = new Set([
  "read",
  "ls",
  "find",
  "grep",
  "ask_user_question",
  "review_plan",
  "present_files",
]);
function planning(ctx: ExtensionContext) {
  const entry = ctx.sessionManager
    .getBranch()
    .findLast((e) => e.type === "custom" && e.customType === modeKey);
  return entry?.type === "custom" && entry.data === true;
}
async function request(ctx: ExtensionContext, value: unknown) {
  const validated = validateRequest(value);
  const payload = JSON.stringify(validated);
  if (payload.length > 256000) throw Error("Interaction payload too large");
  const response = await ctx.ui.editor(INTERACTION_TITLE, payload);
  return response === undefined ? { cancelled: true } : validateAnswer(validated, response);
}
export default function (pi: ExtensionAPI) {
  pi.registerCommand("axiom-plan", {
    description: "Enable or disable session plan mode: /axiom-plan on|off",
    handler: async (args, ctx) => {
      if (!["on", "off"].includes(args.trim())) {
        ctx.ui.notify("Use /axiom-plan on or off", "warning");
        return;
      }
      pi.appendEntry(modeKey, args.trim() === "on");
      ctx.ui.notify(
        args.trim() === "on"
          ? "Plan mode enabled; mutating agent tools blocked"
          : "Plan mode disabled; normal permissions still apply",
        "info",
      );
    },
  });
  pi.on("before_agent_start", (event, ctx) =>
    planning(ctx)
      ? {
          systemPrompt:
            event.systemPrompt +
            "\n\nPlan mode is active. Use read-only investigation, ask_user_question to clarify, review_plan to request explicit approval of a complete plan. Do not modify files or run commands before approval.",
        }
      : undefined,
  );
  pi.on("tool_call", (event, ctx) =>
    planning(ctx) && !readTools.has(event.toolName)
      ? {
          block: true,
          reason: "Plan mode: only read-only investigation and review tools are allowed",
        }
      : undefined,
  );
  const option = Type.Object({ label: Type.String(), description: Type.Optional(Type.String()) });
  const question = Type.Object({
    id: Type.String(),
    question: Type.String(),
    header: Type.Optional(Type.String()),
    detail: Type.Optional(Type.String()),
    multiSelect: Type.Optional(Type.Boolean()),
    options: Type.Optional(Type.Array(option, { maxItems: 12 })),
  });
  pi.registerTool({
    name: "ask_user_question",
    label: "Ask user questions",
    description:
      "Ask one batch of up to twelve structured questions; options, multiple selections, custom answers and explicit skips are supported. Wait for user response.",
    parameters: Type.Object({ questions: Type.Array(question, { minItems: 1, maxItems: 12 }) }),
    execute: async (_id, args, _signal, _update, ctx) => {
      const answer = await request(ctx, { kind: "questions", questions: args.questions });
      return {
        content: [{ type: "text" as const, text: JSON.stringify(answer) }],
        details: { kind: "axiom-question-reply-v1", questions: args.questions, ...answer },
      };
    },
  });
  pi.registerTool({
    name: "review_plan",
    label: "Review plan",
    description:
      "Submit a complete Markdown plan for explicit approve, revise or reject. Approval ends plan mode, but never grants permissions.",
    parameters: Type.Object({ title: Type.String(), markdown: Type.String() }),
    execute: async (_id, args, _signal, _update, ctx) => {
      const answer = await request(ctx, { kind: "plan-review", ...args });
      if ("decision" in answer && answer.decision === "approve" && planning(ctx))
        pi.appendEntry(modeKey, false);
      return {
        content: [{ type: "text" as const, text: JSON.stringify(answer) }],
        details: { kind: "axiom-plan-review-v1", ...args, ...answer },
      };
    },
  });
}
