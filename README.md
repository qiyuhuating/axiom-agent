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

Edit the built-in prompt from **设置 → 内置提示词**. Axiom stores edits in `axiom-builtin-prompt.json` in the active Pi user configuration directory. Edits survive restarts and session cleanup. The saved text is appended to Pi's system instructions on the next run, including subsequent background job steps. Save an empty prompt to disable the addition. **恢复默认** immediately restores and saves the bundled default.

The **Pi 会话** menu shows native session history and branch points. It can fork from a user message, export the original Pi HTML, copy the latest reply, cycle the model or thinking level, and clear queued prompts or stop an active retry.

Open [http://127.0.0.1:4789](http://127.0.0.1:4789). The workbench binds to loopback only.

### Configuration

Copy the example and set the workspace, session directory and optional model/provider. Omit provider/model to use Pi's defaults. A positive integer `maxOutputTokens` caps explicit output-token fields sent by the OpenRouter adapter. The independent runtime defaults to the workbench port plus one (normally 4790).

Use a private local NTFS session directory outside the workspace. The first launch creates a shared runtime credential there using an atomic hard link. Each concurrently running configuration needs its own session directory and distinct runtime and Rust terminal ports. An ephemeral workbench port (`0`) requires an explicit runtime port. A missing file named by `AXIOM_CONFIG` stops startup. An omitted default config uses built-in settings.

A new foreground profile asks before mutating tools. Existing explicit permission choices carry forward. Review custom providers when upgrading. Remote endpoints require HTTPS and a key environment variable. Loopback HTTP remains available for local models.

`npm run pi -- <arguments>` passes arguments to the upstream Pi CLI in the configured workspace. Native commands, extensions, skills and model management are available independently of the GUI. CLI sessions use Pi's native default store unless explicitly directed otherwise. Do not open the same active JSONL session in two writer processes.

The background runtime survives Web server shutdown. To stop it deliberately, finish your work and run `npm run runtime:stop`. Windows login autostart is optional, not enabled automatically.

### Windows desktop preview

The desktop target uses Tauri 2 and the system WebView2 runtime, not Electron. Builds require Windows x64, Node.js 24, PowerShell 7, Rust with the MSVC toolchain, and Visual Studio C++ Build Tools with a Windows SDK.

```powershell
npm ci
npm run prepare:desktop
node scripts/check-desktop-runtime.mjs
cargo check --locked --manifest-path src-tauri/Cargo.toml
npm run desktop:build
```

The NSIS build stages a checksum-verified Node.js 24.16.0 distribution and npm, production dependencies, and compiled UI. It excludes build-only frontend dependencies and node-pty; the Rust terminal daemon provides the native PTY. Before upgrading, finish active jobs and terminals, then stop the installed background runtime using the existing authenticated runtime:stop command with its desktop configuration. The desktop app stores configuration and sessions under its local app data directory, uses a dynamically assigned loopback HTTP port, and retains the separate background runtime (default desktop runtime port 4798). PowerShell 7 and Git remain external tools. The preceding Windows CI installer passed native WebView2 acceptance. Source and installed builds use the Rust terminal. Source startup builds the daemon with Cargo. The separate POSIX sandbox and process-tree implementation remain unverified.

## Architecture

| Layer | Implementation |
| --- | --- |
| Agent | Pi RPC / native session APIs |
| Interface | React, reused DeepSeek Harness components, CodeMirror, xterm.js |
| Host | Node.js, Cordis Context / Loader / Include |
| Tasks | Pi workers, upstream graph validation, Croner |
| Windows write restrictions | Upstream restricted-token ACL runner |
| Storage | Native Pi JSONL sessions and local runtime state |

### Operating the workbench

| Component | Owns | Check |
| --- | --- | --- |
| Workbench host | Browser requests, foreground Pi process and editor revisions | `GET /api/health` reports process uptime and local JSON error counters |
| Background runtime | Jobs, schedules, Cordis and the terminal backend | `GET /api/runtime-health` through the workbench starts or checks the configured instance and returns its identity |
| Windows gateway and PTY daemon | Desktop ingress and terminal sessions | Run `node scripts/check-desktop-runtime.mjs` against the staged payload |

`uptimeSeconds` and `httpErrors.client/server` reset when their owning process restarts. A 409 on an editor save requires reopening the file. A 413 identifies a request above its route budget. For a 5xx with a request ID, search the host's stderr (desktop installations use `desktop-host.log`) and `sessionDir/runtime.log` for that ID. Records include service, method, status, UTC time and available system error code. An ambiguous write after a lost connection requires checking job or terminal state before retrying.

Before upgrading, finish active work and stop the runtime using the old configuration. Back up the stopped session directory, config and Pi profile to private storage. If a legacy session directory is inside the workspace, move the complete stopped directory outside it and update `sessionDir`. Remove the exposed copy from the workspace after verifying the backup and migration. The new host verifies the runtime's workspace, session directory and terminal backend. On identity mismatch, check the config and stop the old instance with its own configuration. For rollback, stop the candidate and restore the matching program, configuration and backup together. Keep the original backup until session, terminal and job history have been checked.

### Job storage and log retention in 0.5.1

The runtime stores jobs in `sessionDir/axiom-jobs/jobs.sqlite`. On first start it imports the previous `state.json` in one transaction and keeps that file for rollback. Job transitions update only the affected rows. On upgrade, the runtime builds job status and team indexes and migrates the shared metadata record into one row per plan, schedule and message in a single transaction. Normal startup loads unfinished jobs and enabled schedules. The workbench requests task summaries in pages of 50 and fetches steps, errors and results when a task is expanded. Authenticated clients can call `GET /api/jobs?view=page&limit=50` (limit 1–200), then pass the returned `nextCursor` as `cursor` until it is null. A page's own `cursor` refreshes that same page. New jobs appear on a fresh first page. Add `session` for the current plan. Use `GET /api/jobs?view=detail&id=...` for a full task. The original `GET /api/jobs` keeps its complete snapshot response. Restore a pre-upgrade backup before running an older binary. Stop the runtime before backing up or restoring the complete directory. Downgrading to 0.5.0 reads the legacy snapshot and cannot see work performed since migration.

A failed storage commit stops the background runtime. Free space on the session volume and request runtime health from the workbench to restart it. Check job state before resubmitting. Previously committed jobs are retained, and unfinished work is marked interrupted on restart.

The runtime, Rust terminal and desktop host each cap their diagnostic log at 8 MiB. Reaching the cap starts a new log in the same file. Export diagnostics before rollover if longer retention is required. When storage is full, diagnostic records may be lost.

Use `node scripts/check-job-storage.mjs 3600` for the isolated one-hour store workload. In WSL, run `sh scripts/check-storage-full.sh /absolute/path/to/node` as root for an isolated 12 MiB tmpfs test. Both checks require Node 24.

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


### Concurrent CLI and GUI sessions

The Axiom GUI and `npm run pi` acquire an OS-backed SQLite write lease for each active Pi JSONL file. Opening or deleting a session held by the other entry point reports a conflict. Switch to another session or close the writer to transfer ownership. The operating system releases the lock after a crash. Leave the small SQLite files in the adjacent `.axiom-locks` directory in place. The JSONL file remains the conversation history.

To open a GUI session in the CLI, close or switch away from it in the GUI and run `npm run pi -- --session <absolute-jsonl-path>`. The standalone upstream Pi executable uses its own storage implementation and does not participate in the Axiom lease.
