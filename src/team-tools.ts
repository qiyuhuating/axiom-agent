import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
export default function (pi: ExtensionAPI) {
  const call = async (operation: string, args: object) => {
    const r = await fetch(process.env.AXIOM_TEAM_URL!, {
      method: "POST",
      headers: {
        Authorization: "Bearer " + process.env.AXIOM_TEAM_TOKEN,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ operation, ...args }),
      signal: AbortSignal.timeout(10000),
    });
    const value = await r.json();
    if (!r.ok) throw Error(value.error);
    return {
      content: [{ type: "text" as const, text: JSON.stringify(value) }],
      details: value,
    };
  };
  pi.registerTool({
    name: "team_board",
    label: "Team board",
    description: "Read the shared team task graph and available results",
    parameters: Type.Object({}),
    execute: async () => call("board", {}),
  });
  pi.registerTool({
    name: "team_inbox",
    label: "Team inbox",
    description: "Read messages sent to this team member",
    parameters: Type.Object({}),
    execute: async () => call("inbox", {}),
  });
  pi.registerTool({
    name: "team_send",
    label: "Team message",
    description: "Send a durable message to a named team member",
    parameters: Type.Object({ to: Type.String(), text: Type.String() }),
    execute: async (_id, args) => call("send", args),
  });
}
