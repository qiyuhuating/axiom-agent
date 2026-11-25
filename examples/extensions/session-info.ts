import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export default function (pi: ExtensionAPI) {
  pi.registerCommand("session-info", {
    description: "Show the current Pi session ID",
    handler: async (_args, ctx) => {
      ctx.ui.notify(ctx.sessionManager.getSessionId(), "info");
    },
  });
}
