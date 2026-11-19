import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { resolveDeliverables } from "./deliverables.mjs";
export default function (pi: ExtensionAPI) {
  pi.registerTool({
    name: "present_files",
    label: "Present workspace files",
    description:
      "Explicitly present completed workspace files to the user in the Axiom transcript. Pass relative paths, not file contents. Files must already exist and remain within the workspace.",
    parameters: Type.Object({ paths: Type.Array(Type.String(), { minItems: 1, maxItems: 20 }) }),
    execute: async (_id, args, _signal, _onUpdate, ctx) => {
      const files = await resolveDeliverables(ctx.cwd, args.paths);
      return {
        content: [
          {
            type: "text" as const,
            text: "Presented to user: " + files.map((f) => f.path).join(", "),
          },
        ],
        details: { kind: "axiom-deliverables-v1", files },
      };
    },
  });
}
