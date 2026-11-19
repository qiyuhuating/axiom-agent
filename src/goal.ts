import { randomUUID } from "node:crypto";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
export const GOAL_KEY = "axiom-goal-v1";
type Goal = {
  id: string;
  objective: string;
  remaining: number;
  phase: "armed" | "paused" | "completed" | "exhausted";
  evidence?: string;
};
function goal(ctx: ExtensionContext): Goal | undefined {
  const entry = ctx.sessionManager
    .getBranch()
    .findLast((e) => e.type === "custom" && e.customType === GOAL_KEY);
  return entry?.type === "custom" ? (entry.data as Goal | undefined) : undefined;
}
// No continuation is armed by loading, switching or forking a session.
export default function (pi: ExtensionAPI) {
  let armed: string | undefined,
    run: string | undefined,
    waited = false;
  const save = (g: Goal) => pi.appendEntry(GOAL_KEY, g);
  pi.on("session_start", (_event, ctx) => {
    const g = goal(ctx);
    if (g?.phase === "armed") save({ ...g, phase: "paused" });
    armed = undefined;
    run = undefined;
    waited = false;
  });
  pi.registerCommand("axiom-goal", {
    description:
      "Arm a bounded goal for the next prompt: /axiom-goal <1-10 extra runs> <objective>; pause: /axiom-goal pause; rearm: /axiom-goal resume",
    handler: async (args, ctx) => {
      const old = goal(ctx);
      if (args.trim() === "pause") {
        armed = undefined;
        run = undefined;
        if (old?.phase === "armed") save({ ...old, phase: "paused" });
        ctx.ui.notify("Goal paused", "info");
        return;
      }
      if (args.trim() === "resume") {
        if (!old || old.phase !== "paused" || old.remaining < 1)
          throw Error("No paused goal with remaining budget");
        const next = { ...old, phase: "armed" as const };
        save(next);
        armed = next.id;
        ctx.ui.notify("Goal rearmed for your next prompt", "info");
        return;
      }
      const m = /^([1-9]|10)\s+([\s\S]+)$/.exec(args.trim());
      if (!m || m[2].length > 4000) throw Error("Use /axiom-goal <1-10> <objective>");
      const next: Goal = {
        id: randomUUID(),
        objective: m[2],
        remaining: Number(m[1]),
        phase: "armed",
      };
      save(next);
      armed = next.id;
      ctx.ui.notify("Goal armed for your next task. Extra runs: " + next.remaining, "info");
    },
  });
  pi.on("before_agent_start", (event, ctx) => {
    const g = goal(ctx);
    run =
      event.messageType === "user" && g?.id === armed && g?.phase === "armed" ? armed : undefined;
    armed = undefined;
    waited = false;
    if (run && g)
      return {
        systemPrompt:
          event.systemPrompt +
          "\n\nUser armed a bounded goal: " +
          g.objective +
          "\nUse goal_complete with evidence once the objective is satisfied; do not claim completion without verification.",
      };
  });
  pi.on("ui_prompt_start", () => {
    waited = true;
  });
  pi.on("agent_before_settle", (event, ctx) => {
    const g = goal(ctx);
    if (!run || g?.id !== run || g.phase !== "armed") return;
    const plan = ctx.sessionManager
      .getBranch()
      .findLast((e) => e.type === "custom" && e.customType === "axiom-plan-mode-v1");
    if (
      event.outcome !== "completed" ||
      waited ||
      (plan?.type === "custom" && plan.data === true) ||
      !event.context.canContinue ||
      event.context.pendingMessages.length ||
      event.continue
    ) {
      run = undefined;
      return {
        entries: [
          { type: "custom" as const, customType: GOAL_KEY, data: { ...g, phase: "paused" } },
        ],
      };
    }
    if (g.remaining === 0) {
      run = undefined;
      return {
        entries: [
          { type: "custom" as const, customType: GOAL_KEY, data: { ...g, phase: "exhausted" } },
        ],
      };
    }
    return {
      continue: true,
      entries: [
        {
          type: "custom" as const,
          customType: GOAL_KEY,
          data: { ...g, remaining: g.remaining - 1 },
        },
        {
          type: "custom_message" as const,
          customType: "axiom-goal-continuation",
          display: true,
          content:
            "Continue the user-approved objective: " +
            g.objective +
            ". Verify progress; call goal_complete only with concrete evidence. Remaining extra runs after this: " +
            (g.remaining - 1),
        },
      ],
    };
  });
  pi.on("agent_settled", (event, ctx) => {
    const g = goal(ctx);
    if (run && g?.id === run && g.phase === "armed") save({ ...g, phase: "paused" });
    run = undefined;
    waited = false;
  });
  pi.registerTool({
    name: "goal_complete",
    label: "Report goal completion",
    description:
      "Record completion evidence for the currently authorized goal; stops automatic continuation. This is a model-reported result, not independent verification.",
    parameters: Type.Object({ evidence: Type.String({ minLength: 1, maxLength: 8000 }) }),
    execute: async (_id, args, _signal, _update, ctx) => {
      const g = goal(ctx);
      if (!run || g?.id !== run || g.phase !== "armed") throw Error("No active goal");
      if (!args.evidence.trim() || args.evidence.length > 8000)
        throw Error("Completion evidence required");
      save({ ...g, phase: "completed", evidence: args.evidence });
      run = undefined;
      return {
        content: [
          {
            type: "text" as const,
            text: "Goal completion recorded (model-reported): " + args.evidence,
          },
        ],
        details: { kind: "axiom-goal-completion-v1", goalId: g.id, evidence: args.evidence },
      };
    },
  });
}
