# Feature coverage in the preview

This matrix distinguishes an installed upstream engine from demonstrated GUI parity.

| Feature family | Coverage |
| --- | --- |
| Pi native CLI, slash commands, native provider/auth configuration, skills and extensions | Native CLI available; GUI supports a subset |
| Pi chat, stream, steering, follow-up, stop, model/thinking controls | GUI and RPC |
| Pi session listing, switching, deletion, renaming, clone, fork, statistics and compaction controls | GUI/RPC; some new operations still need live-provider verification |
| Project context, tools, packages and MCP | Native Pi; project trust explicitly managed |
| DeepSeek Harness UI theme, layout, primitives, FileTree, DockKit and DiffBlock | Directly reused/adapted |
| Files, editing, preview, diff, attachments and terminal | Implemented with reused components and Pi host adapters |
| Extension questions and approvals | Basic native Pi RPC interactions |
| Teams, plans, jobs, schedules and workflow DAG | Implemented baseline; adaptive task creation/assignment and full upstream workflows not equivalent |
| Browser panel | Restricted iframe; not upstream browser/computer automation |
| Cordis | Native Context, Loader, Include and Axiom services; upstream host graph not fully ported |
| Full upstream plugin market, connector/account services, deliverable/feedback workflows, agent presets, trajectory views, browser/computer-use, SSH/LSP and document-specific integrations | Not fully integrated; do not count copied code as operational |

The upstream reference is pinned in `vendor/dsh/UPSTREAM.md`. A class of features is marked implemented only where the current Axiom host actually provides the relevant service. See DSH-INTEGRATION.md for previous real-model and runtime verification.
