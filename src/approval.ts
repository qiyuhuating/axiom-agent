import { realpathSync } from "node:fs";
import { isAbsolute, relative, resolve, sep } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { readPermission } from "./permission-policy.mjs";
export default function (pi: ExtensionAPI) {
  pi.on("tool_call", async (event, ctx) => {
    const path = process.env.AXIOM_PERMISSION_FILE;
    let policy: string;
    try {
      policy = readPermission(path, process.env.AXIOM_WORKSPACE_ROOT ? "read-only" : "ask");
    } catch {
      return {
        block: true,
        reason: "Cannot read the Axiom permission policy. Repair it in Settings.",
      };
    }
    if (policy === "full") return;
    const allowed = [
      "read",
      "ls",
      "find",
      "grep",
      ...(!process.env.AXIOM_TEAM_TOKEN && !process.env.AXIOM_WORKSPACE_ROOT
        ? ["ask_user_question", "review_plan", "present_files", "goal_complete"]
        : []),
      ...(process.env.AXIOM_TEAM_TOKEN ? ["team_board", "team_send", "team_inbox"] : []),
    ];
    const mutating = !allowed.includes(event.toolName);
    if (
      process.env.AXIOM_WORKSPACE_ROOT &&
      ["read", "ls", "find", "grep"].includes(event.toolName)
    ) {
      try {
        const root = realpathSync(process.env.AXIOM_WORKSPACE_ROOT);
        const input = event.input as { path?: string };
        const target = realpathSync(resolve(root, input.path || "."));
        const rel = relative(root, target);
        if (isAbsolute(rel) || rel === ".." || rel.startsWith(".." + sep))
          return { block: true, reason: "Read path outside workspace" };
      } catch {
        return {
          block: true,
          reason: "Invalid or inaccessible workspace path",
        };
      }
    }
    if (policy === "read-only" && mutating)
      return { block: true, reason: "User enabled read-only mode" };
    if (policy === "ask" && mutating) {
      let yes: boolean;
      try {
        yes = await ctx.ui.confirm(
          "Authorize " + event.toolName,
          JSON.stringify(event.input, null, 2).slice(0, 6000),
          { timeout: 120000 },
        );
      } catch {
        return { block: true, reason: "Approval dialog unavailable" };
      }
      if (!yes)
        return {
          block: true,
          reason: "User denied or did not approve tool execution",
        };
    }
  });
  pi.registerCommand("axiom-ui-test", {
    description: "Test the GUI confirmation bridge without calling a model",
    handler: async (_args, ctx) => {
      const yes = await ctx.ui.confirm("Axiom UI test", "Confirm that extension dialogs work.", {
        timeout: 30000,
      });
      ctx.ui.notify(yes ? "AXIOM_DIALOG_OK" : "AXIOM_DIALOG_CANCELLED", "info");
    },
  });
}
