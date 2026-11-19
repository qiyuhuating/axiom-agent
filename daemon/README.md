# Rust host migration: phase 1

This PR is the first staged migration slice, not the final Rust gateway. Pi remains the only agent engine. The Node host, job runtime, Cordis, and legacy node-pty backend are unchanged by default.

## Try in an isolated workspace

Build the native terminal daemon:

```powershell
cargo build --locked --manifest-path daemon/Cargo.toml
npm run build:ui
node --test scripts/check-terminal-parity.mjs
```

Use a new configuration file with an unused runtime port and Rust terminal port:

```json
{
  "workspace": ".workbench-test/rust-preview/workspace",
  "sessionDir": ".workbench-test/rust-preview/sessions",
  "port": 4801,
  "runtimePort": 4802,
  "terminalBackend": "rust",
  "rustTerminalPort": 4803,
  "rustTerminalBinary": "daemon/target/debug/axiom-daemon.exe",
  "discoverContext": false
}
```

Set AXIOM_CONFIG to that file before starting the host. Desktop staging bundles the Release axiom-daemon.exe in runtime/bin; omit rustTerminalBinary to use the bundled executable. Stop the preview runtime with the existing authenticated runtime:stop command using that same configuration.

## Contract and verification

- Loopback-only Axum terminal service validates exact Host and high-entropy Bearer token. The current Node host provisions the token file; a dedicated Rust lock prevents multiple daemons opening the same terminal archive.
- portable-pty provides ConPTY, PowerShell 7, input, resize, SSE output, bounded history, explicit close and interrupted history recovery. Archive snapshots are atomically replaced only on changes.
- Node and Rust direct endpoints, Node-to-Rust Cordis bridge and HTTP host restart all use the same contract tests with actual PTY processes. The browser/desktop UI protocol is unchanged; clients must answer normal terminal device-status queries.
- The Rust archive is separate (rust-terminals.json), so this opt-in preview does not overwrite legacy terminal history. Existing Node sessions are not migrated or deleted.

## Remaining gates before removing node-pty

- Actual xterm/WebView end-to-end acceptance, including reconnect and UTF-8.
- Preserve Cordis plugin compatibility: the experimental terminal backend currently exposes asynchronous list/action/snapshot; older plugins can depend on the synchronous get() record and listener set. Do not switch such workspaces to the preview backend.
- Explicit legacy history cutover and safe handling of active terminals; installer upgrade/rollback, Windows process-tree cleanup, owner-only token/lock-file provisioning, and final packaging parity.
- Final Rust gateway ownership (all existing host routes) is not yet implemented. Keep the Node runtime and all existing packages until the corresponding parity gate passes.

Phase 2 will migrate sandboxing, DAG, Cron and team state only after phase 1 acceptance; phase 3 will migrate Pi RPC lifecycle/idle eviction. No inference engine rewrite.
