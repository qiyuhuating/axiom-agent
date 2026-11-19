# Rust host migration: phase 1

This PR adds the first native HTTP gateway and PTY migration slice. The optional Rust listener owns the public loopback HTTP ingress while the existing Node host remains the private handler for business routes. Pi remains the only agent engine. The Node business host, job runtime, Cordis, and legacy node-pty implementation remain available. New desktop configurations default to Rust ingress and PTY; existing configurations are not rewritten.

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
- The Rust archive is separate (rust-terminals.json). Stop the legacy runtime and verify that no process still owns the legacy session directory before setting importLegacyTerminalHistory to true. On first startup, the daemon imports the existing terminals.json under its exclusive archive lock, marks unfinished sessions interrupted, and writes the new archive atomically. The original file is preserved; an existing Rust archive always takes precedence, even when empty. Active processes are not transferred. The Web host now rejects a runtime with a different terminalBackend rather than silently reusing it. Stop the authenticated runtime after finishing active jobs and terminals, edit the configuration, and restart. Older runtimes without a backend field are treated as Node.

## Native HTTP ingress (preview)

Set nativeGateway to true in the desktop configuration to use the bundled Rust executable as the public loopback listener. It launches Node on a private ephemeral port, forwards streaming request/response bodies without buffering and uses a fresh internal secret to prevent direct access. The Node host checks the original public Host and Origin, and the secret is removed from its environment before launching Pi or background processes. Stopping the gateway closes the private Node host; scheduled jobs and terminals remain independent. New desktop installations use the Rust ingress and PTY by default. Existing installations retain their configured/default Node ingress until the owner explicitly opts in.

The source test can be run with AXIOM_TEST_GATEWAY pointing at the built daemon; the packaged CI repeats the HTTP integration test and full terminal restart path through the Rust listener. This gateway does not yet implement the business handlers in Rust.

## Remaining gates before removing node-pty

- Repeat xterm/WebView end-to-end acceptance on the exact updated NSIS artifact with the native gateway and new-install defaults. The previous CI installer passed keyboard ordering, UTF-8, page reload, reconnect, and terminal close on both backends. A reproducible manual driver is in scripts/check-installed-terminal.mjs.
- The Axiom Cordis terminal service retains synchronous list/get/action and stable record/listener semantics through a dedicated RPC worker, with asynchronous HTTP requests on the ordinary gateway. The included actual Loader plugin tests these calls and PTY write/resize. A compatibility PTY facade also exposes kill/onData/onExit; it is not a native node-pty instance. Do not switch plugins depending on undocumented native handles or other node-pty internals.
- Offline legacy history import is tested; automatic cutover, active process migration, installer upgrade/rollback, and owner-only token/lock-file provisioning remain pending. Windows Job Objects are attached before exposing the terminal to input: actual subprocess cleanup on explicit close, daemon shutdown, and daemon crash is covered. Upstream portable-pty launches the process before attachment; this is not an atomic Windows startup job-list assignment. Non-Windows process-tree cleanup remains fail-closed.
- Native HTTP ingress is implemented; Rust has not yet taken over every business-route implementation. Keep the Node runtime and all existing packages until the corresponding parity gate passes.

Phase 2 will migrate sandboxing, DAG, Cron and team state only after phase 1 acceptance; phase 3 will migrate Pi RPC lifecycle/idle eviction. No inference engine rewrite.

## Installed window smoke test

Use an isolated desktop configuration and a fresh terminal archive. Launch the app from a test-only PowerShell environment with WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS set to --remote-debugging-port=18764 --remote-debugging-address=127.0.0.1. Use a locally available Playwright module (not a production dependency); set AXIOM_TEST_PLAYWRIGHT_MODULE to its absolute module path, then run node scripts/check-installed-terminal.mjs 18764 http://127.0.0.1:<host-port>. The script creates and closes a real PTY and exercises keyboard input, UTF-8 and reload/reconnect. Remove the debugging environment variable after the test. Do not enable remote debugging for a production session.
