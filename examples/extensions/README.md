# Pi extensions

From the repository root, run the example in the native Pi CLI:

```powershell
$extension = (Resolve-Path examples/extensions/session-info.ts).Path
npm run pi -- --extension $extension
```

Enter `/session-info` to display the active session ID. The absolute path is needed because Axiom launches Pi in the configured workspace.

| Capability | Enforcement |
| --- | --- |
| Display commands | The example reads the session ID through the Pi context and displays a notification. |
| Model tool calls | Axiom's foreground approval extension evaluates calls against the configured read-only, ask or full policy. A new tool is classified as mutating unless explicitly allowed. |
| Extension code | Extensions run as trusted code in the Pi process. The tool approval policy does not intercept direct Node filesystem or subprocess calls made by an extension. Review source and dependencies before loading it. |
| Background jobs | Keep the existing private worker configuration and OS sandbox. Loading a foreground extension does not add it to the worker allowlist. |

For a Cordis plugin that contributes an agent command, move its command handler into a Pi extension and use the Pi context for interaction. Plugins that manage terminals, scheduling or process lifetime need a host integration. Importing that code into Pi would grant it the Pi process's permissions.
