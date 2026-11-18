# Axiom 0.4.0 integration and validation

Pi 1.5.2 remains the only agent execution engine. Upstream DeepSeek Harness MIT source at the pinned commit is reused for UI, task-graph validation and Windows ACL/native process primitives. Cordis 4.1.0, Loader and Include 1.1.0 are their published native packages.

## Changes
- DAG: 1–30 named task nodes, dependencies, cycle/duplicate/missing-edge rejection using the upstream task-graph validator; run ready nodes with global concurrency 3; failed/cancelled dependencies block descendants; predecessor outputs are passed to dependent Pi workers.
- Teams: trusted Pi extension provides team_board, team_send, team_inbox. The runtime authenticates each worker with a random scoped token, authorizes only its own team, and persists messages. This is a fixed graph with member messaging, not the full upstream adaptive team leadership system.
- Native Windows ACL sandbox: upstream restricted-token runner and Job Object primitives are compiled from vendored source. Private job and temp directories are writable; the project remains read-only via Pi's explicit tool allowlist. Worker-specific Pi settings, selected provider credentials (if present), and model config are isolated and cleaned; project resources/MCP/discovered extensions are disabled for background workers. ACL restricts writes, not arbitrary OS reads or network; Everyone ACL and hard-link exceptions are inherited upstream limitations. The read path hook is complementary, not a complete filesystem security boundary.
- Independent runtime: web server proxies jobs and PTY through a loopback, token-authenticated service on port 4790 by default (config.runtimePort overrides). It stays alive after web shutdown; cron schedules remain active. Terminal IDs and live ConPTY survive web restart; terminal output checkpoints (last 256 KiB) are restored as interrupted history if the runtime itself restarts. Running process memory, environment changes, and open programs cannot be resurrected after OS shutdown. Terminal history may contain sensitive output; remove the session from the terminal list to delete the archive.
- Native Cordis: runtime routes use injected axiomJobs and axiomTerminal services, native Loader and file-backed Include; trusted user plugins are configured through .sessions/cordis.json (or configured session directory). Example: [{"id":"example","name":"./plugin.mjs","config":{}}]. Plugin code has host authority; only load reviewed plugins. Full DeepSeek Harness host-specific service graph and all plugin contracts are not yet ported.
- MCP: native project HTTP/stdio configuration, real discovery, resource trust for the exact workspace. The trust change is explicit and saved through pinned Pi ProjectTrustStore. Restart Web/Pi host after changing workspace trust. Model/provider secrets are not exposed through UI config. Skill and plugin management use native Pi package tools.
- Windows login autostart script is optional; not registered automatically. No execution while machine is off; missed runs are not replayed by default.

## Verified on LEADER
- Native Windows PowerShell 7 ACL test: write inside permitted directory succeeded; outside denied; actual Kimi DAG executed within restricted worker processes after per-worker settings isolation.
- Real team producer sent PEER_527; dependent consumer returned PEER_527 RESULT_527, with successful cycle rejection.
- Independent runtime PID, PTY ID, schedule ID unchanged after web restart.
- Cordis trusted fixture loaded through native Include and read injected service.
- Native Pi package installation and command discovery, project MCP discovery, real Kimi MCP tool call (MCP_FIXTURE_817), removal of both package and MCP verified. Explicit output budget used after provider 402.
- Real GUI HTTP/RPC image payload inference: Kimi correctly identified red circle, blue square.
- Scope: local isolated fixture, no production history mutations. Full OS read/network sandbox, complete DSH plugin parity, arbitrary third-party package compatibility and native OS-process restoration remain unverified/unimplemented.
