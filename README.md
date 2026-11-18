# Axiom Agent

A local engineering workbench built on **Pi**, with interface and host components reused from **DeepSeek Harness**.

Pi is the only model-facing agent engine. Axiom adds a browser workbench, local session management, file editing, terminal, team orchestration and a Cordis-based host runtime. The original Pi CLI remains available.

**Status: preview.** The project does not yet implement every DeepSeek Harness host service or expose every Pi capability in its GUI. See [integration status](DSH-INTEGRATION.md) and [feature coverage](FEATURES.md).

## Run locally

The currently tested platform is Windows x64 with Node.js 24 and PowerShell 7. Git is required for the Git diff panel.

```powershell
git clone https://github.com/qiyuhuating/axiom-agent.git
Set-Location axiom-agent
npm ci
Copy-Item axiom.config.example.json axiom.config.json
npm run pi -- --help
npm run pi
npm start
```

Configure a model provider through Pi's native login/configuration before sending requests. Axiom uses the installed Pi provider catalog and existing Pi credentials. Never place API keys in the repository.

Open [http://127.0.0.1:4789](http://127.0.0.1:4789). The workbench binds to loopback only.

### Configuration

Copy the example and set the workspace, session directory and optional model/provider. Omit provider/model to use Pi's defaults. `maxOutputTokens` is optional; when set it caps output for that instance. The independent runtime uses port 4790 unless overridden.

`npm run pi -- <arguments>` passes arguments to the upstream Pi CLI in the configured workspace. Native commands, extensions, skills and model management are available independently of the GUI. CLI sessions use Pi's native default store unless explicitly directed otherwise. Do not open the same active JSONL session in two writer processes.

The background runtime survives Web server shutdown. To stop it deliberately, finish your work and run `npm run runtime:stop`. Windows login autostart is optional, not enabled automatically.

## Architecture

| Layer | Implementation |
| --- | --- |
| Agent | Pi RPC / native session APIs |
| Interface | React, reused DeepSeek Harness components, CodeMirror, xterm.js |
| Host | Node.js, Cordis Context / Loader / Include |
| Tasks | Pi workers, upstream graph validation, Croner |
| Windows write restrictions | Upstream restricted-token ACL runner |
| Storage | Native Pi JSONL sessions and local runtime state |

## Development

```powershell
npm ci
npm run build:ui
npm test
```

The default tests require no paid model request. Live-model, MCP, browser and sandbox integration checks require an appropriate local fixture and credentials; they are not represented by the unit test count.

Read [CONTRIBUTING.md](CONTRIBUTING.md), [SECURITY.md](SECURITY.md) and [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

## License and attribution

MIT. Axiom is an independent project, not an official Pi or DeepSeek product. Retained upstream source and notices are under `vendor/dsh`. See the [upstream source record](vendor/dsh/UPSTREAM.md) and third-party notices.
