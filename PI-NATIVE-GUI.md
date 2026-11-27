# Pi-native GUI

The redesign branch is an independent workbench for Pi. Pi remains the only agent engine, and existing host, session and tool APIs are retained.

The initial shell uses its own visual tokens, larger text, explicit workspace and tool status, a responsive conversation layout and light/dark themes. Existing editor, composer, settings, terminal and DockKit adapters remain in use; they are not yet an independent component library.

## Native high-DPI rendering

The Windows executable declares PerMonitorV2 DPI awareness with a per-monitor fallback. Tauri sizes the initial window from the primary monitor work area in logical pixels; WebView2 owns rasterization at the monitor device scale. The reading column grows with available space up to 1120 CSS pixels. No manual device-pixel-ratio transform is applied.

## Design contract

The desktop workbench borrows the typography, grid, contrast and inspection principles of [Taste Skill](https://github.com/Leonxlnx/taste-skill) and the interaction guidance of [Emil Design Engineering](https://github.com/emilkowalski/skills), not their marketing-page layouts or animation libraries.

- Neutral graphite and restrained teal; a single primary accent, readable light and dark surfaces.
- Aligned reading and composer columns, system CJK fonts and responsive model controls.
- Starter tasks only append editable draft text. They do not execute a command or call a provider.
- Real clipboard feedback, visible keyboard focus and reduced-motion support.
- Draft and live response subscribers are separate from the shell. The shell snapshot stays stable during draft changes and intermediate text deltas; autoscroll is coalesced per animation frame.

## Verification

- npm ci, npm run lint, npm run build:ui, npm test
- Run the optional Chromium layout test with AXIOM_TEST_PLAYWRIGHT_MODULE pointing to a local Playwright installation and AXIOM_TEST_CHROME pointing to a Chromium executable:

    node scripts/check-pi-native-layout.mjs

The browser test uses a temporary Pi profile and workspace, real local server, twelve viewport/DPR combinations, including 2560×1440 and 3840×2160 at 100%, 125%, 150%, and 200% scaling, and no paid inference. The test reads the actual screenshot PNG dimensions in device pixels, with a one-pixel rounding tolerance, and checks layout, center alignment, starter tasks, draft preservation, focus, model control geometry, and theme switching. A synthetic Pi stream also verifies the visible response, clipboard output, and shell snapshot identity (100 draft writes produce zero shell changes; 100 text deltas plus message completion produce two). These counts measure state invalidation, not application FPS. The DPR override tests browser rendering and layout, not Windows per-monitor DPI transitions or an installed Tauri/WebView2 package.

## Workbench and history

- The owned file explorer loads one directory at a time, coalesces concurrent requests for the same directory, caches successful listings, and supports directory keyboard navigation. Search covers loaded paths only; refresh updates the root and expanded directories.
- The DockKit controller still preserves split panes, floating tabs, dirty-editor confirmation, and stateful terminal, browser and editor tabs. Guide, Git Diff and trajectory bodies unmount when hidden, so their transient view state (including trace filters) resets on reopening.
- The trajectory groups actual tool states, renders at most 100 matching entries initially, and mounts masked arguments and results only when expanded.
- Conversation history opens with the most recent 80 message records; more history is revealed in batches of 80, with a measured scroll anchor. While browsing history, the start index is frozen rather than silently evicting the reader's earlier messages. Returning to the recent page releases older message bodies. This initial iteration retained all history in the projection; the later server pagination section below supersedes that transport behavior.
- Shared theme tokens cover navigation, file explorer, trace filters, code syntax colors, Diff and terminal. The model menu moves focus without changing model on Tab from search. Existing provider, session and tool APIs remain in use.

The expanded Chromium smoke test checks a real directory and file, cache reuse and refresh, editor highlighting, 2,000 history records (80 initially mounted, 160 after one reveal), 500 tool results (100 initially mounted), trace filtering and hidden-body disposal, model keyboard navigation, and all twelve viewport/DPR cases. These are synthetic history/tool fixtures through the actual snapshot protocol, not inference benchmarks.

## Native WebView2 performance

Run the measurement only on an isolated development desktop with a loopback CDP endpoint:

    node scripts/check-native-webview-perf.mjs <cdp-port> <host-base-url>

Set AXIOM_TEST_PLAYWRIGHT_MODULE as for the browser test. The script replaces the isolated target's snapshot response with 2,000 text-message records, mounts the latest 80, and samples 120 requestAnimationFrame intervals during scripted transcript scrolling. It also queries CDP main-thread metrics and WebGL/SystemInfo GPU capabilities. It does not submit prompts or persist synthetic history.

2026-11-27 local Windows debug build, 1088 × 680 CSS pixels, devicePixelRatio 2, visible WebView2 window:

- Native HWND PerMonitorV2, DPI 192.
- Median frame callback interval 8.30 ms; P95 and maximum 8.50 ms (120 samples).
- CDP task, script, layout and style recalculation time deltas: 96.66 ms, 9.04 ms, 0.53 ms and 0.79 ms; these metrics overlap and must not be summed.
- CDP reported 1,791 DOM nodes and 9,485,648 bytes of used JS heap after the sample.
- ANGLE Direct3D 11 on AMD Radeon 880M; GPU compositing and rasterization enabled, multiple raster threads enabled, WebGL and WebGPU enabled.

This is a single native debug-build observation on the available monitor, not a release-build A/B benchmark, total process memory measurement, GPU frame-time trace, or proof of 120 presented frames per second. Installed NSIS, physical 4K and mixed-monitor DPI transition validation remain separate. The isolated native test also exposed residual child processes holding its jobs SQLite file after shutdown; the test-only process tree and data were removed, but graceful shutdown under that scenario needs a dedicated investigation.

Remaining inherited DockKit, Lexical and settings/provider adapters should be migrated only when there is a demonstrable usability or performance benefit.

## Server pagination and runtime exit

The browser requests the opt-in paged snapshot; the legacy unpaged snapshot and Pi session export remain available. The initial page includes 80 user/assistant message records (display text, not attachments or tool-call payloads), an active-session and prefix-SHA-256 cursor, and compact tool summaries. Older messages load in pages of 80. A pinned reading window is retained across refresh while its cursor remains valid; a changed branch/prefix replaces it or rejects the old cursor. Tool parameters/results are fetched only when expanded; file-change and deliverable metadata remain in the summary. The Pi RPC still obtains the full active history on the server; this is HTTP/client-side memory reduction, not bounded Pi RPC memory or disk pagination. Large individual result text is previewed at 16,384 characters, and a Git diff initially mounts 500 lines with explicit expansion. CodeMirror keeps immutable Text documents, serializing on save and view changes instead of on each edit.

The desktop uses an authenticated, per-launch ownership identifier to stop its own idle runtime on normal EOF. Active jobs, scheduled jobs, live terminals, and an already running external runtime are preserved. The Node HTTP host closes connections and lets its event loop exit, avoiding a reproduced Windows libuv assertion from forced process.exit. keepRuntimeOnExit:true opts out. This is not a guarantee of cleanup after OS termination or a desktop crash.

Reproduce the JSON benchmark with node scripts/bench-history-snapshot.mjs. Synthetic payload benchmark, Node 24.16.0, 2,000 text messages and 500 tool results of 4,096 characters each: raw response 3,356,794 bytes; paged response with tool summaries 93,179 bytes. 24 alternating samples per mode after warmup: median construction/serialization 2.225 ms raw, 2.167 ms paged. This measures JSON construction, not network, end-to-end latency, renderer memory, or release-build GPU performance. The actual persisted Pi HTTP fixture and Chromium viewport regression test validate page boundaries, stale cursors, on-demand detail, scroll anchoring, large diff expansion, and CRLF save/undo. Native gateway and Rust terminal lifecycle verification uses the staged runtime's own node.exe and working directory.

## Runtime leases, incremental Pi entries and large tool payloads

- The private runtime advertises leaseProtocol 1. Each compatible host holds an authenticated loopback SSE connection. Normal EOF or forced termination closes its lease; an idle desktop-owned runtime stops only when the last lease is gone and no live terminal, queued/running job, or enabled schedule remains. Standalone and keepRuntimeOnExit runtimes remain independent. A one-second idle watcher also reclaims work that finishes after the final desktop closes. Foreground Pi itself observes RPC stdin EOF. Tests deliberately terminate actual host processes and observe their Pi/runtime PIDs exit; this is not an OS-wide kill policy or a guarantee for arbitrary externally detached descendants.
- Settled snapshots use the upstream get_entries(since) cursor and buildSessionContext, cached per active Pi client/session. Unchanged leaf + no entries reuses the projection. Branch, compaction and context edits are resolved by Pi; switching/retiring the client invalidates the index. Busy snapshots obtain live messages but use flat entries for Harness state. The history-detail UI projects a flat tree without nested RPC JSON serialization. The legacy unpaged session-details tree endpoint is retained for compatibility and is still subject to upstream tree limits.
- The session sidebar caches only metadata by file identity, size, mtime and ctime, and skips unchanged JSONL files. Changed files are streamed; a concurrent append cannot poison the cache. The native list remains the authority for switch/delete. This avoids repeated full directory scans of message content but is not byte-range pagination of the Pi session itself. Initial RPC hydration still loads all entries, and its active-session index retains them.
- Historical tool output has a masked UTF-16 page protocol. Each field returns at most 16,384 code units, does not split surrogate pairs, and requires the same SHA-256 revision for subsequent pages. Previous/next replaces the displayed text rather than accumulating DOM. Live SSE and the compatibility full-detail endpoint remain unbounded by this page protocol; masking/serialization is currently repeated for each requested field page.
- Buttons, user bubbles, state dots and modal chrome now use Pi-owned components/tokens. The upstream modal focus hook, menus, DockKit, Lexical, editor Diff and capability adapters are still reused. Browser tests cover focus trapping/restore, tool pagination, file editing and all twelve DPR cases.

### Release WebView2 A/B, 2026-11-27

Baseline 3b64393 versus the new runtime/UI, same optimized Rust desktop executable and production dependency versions, ABBA order, independent test application profile per run, native Pi JSONL fixture (not intercepted HTTP). Windows, 1088 x 680 CSS viewport, DPR 2. Each 400-message/100-tool-result run samples eight warm snapshot requests and 120 requestAnimationFrame intervals. The fixture uses 4096-character tool results. All initial JSON response sizes were 32,169 bytes because the previous HTTP pagination is already present.

| Mode | Snapshot median ms | rAF median / P95 ms | CDP JS heap bytes | Native tree private bytes (excludes WebView2) | Task / layout / style delta ms |
| --- | ---: | ---: | ---: | ---: | --- |
| A1 | 14.9 | 8.4 / 8.6 | 5,004,228 | 654,184,448 | 119.32 / 0.54 / 1.08 |
| B1 | 6.2 | 8.3 / 8.5 | 5,030,512 | 515,616,768 | 146.47 / 8.17 / 11.52 |
| B2 | 6.0 | 8.3 / 8.8 | 5,028,440 | 515,297,280 | 165.10 / 8.00 / 10.85 |
| A2 | 14.7 | 8.4 / 8.7 | 5,015,260 | 565,628,928 | 107.16 / 0.55 / 0.76 |

Mean of per-run snapshot medians: 14.8 -> 6.1 ms (58.8% reduction). Native private bytes averaged 609,906,688 -> 515,457,024 (15.5% reduction), with substantial run-to-run variation; this is not overall WebView2 process memory. Renderer heap and frame intervals were essentially unchanged. Task/layout/style times regressed in this 400-message sample and should be investigated; metrics overlap and cannot be summed.

For the 2,000-message / 500-tool-result fixture, baseline snapshot returned HTTP 400 "Maximum call stack size exceeded" from deeply nested get_tree serialization. New Release opens the session with 80 mounted messages: snapshot median 9.4 ms (8 warm samples), response 74,106 bytes, rAF median/P95/max 8.3/8.5/8.8 ms (120 samples), CDP JS heap 5,033,536 bytes, 1,379 DOM nodes. No numerical speed ratio is assigned to the failed baseline. No presented-frame or physical 4K claim.

Reproduce with scripts/bench-native-release.ps1 after building the isolated release identifier with TAURI_CONFIG='{"identifier":"io.github.qiyuhuating.axiom.pi-release-bench"}', staging the desktop runtime and building release. Set AXIOM_TEST_PLAYWRIGHT_MODULE. Use -Records 400 for ABBA, -Records 2000 -Modes A,B for the failure/success comparison. The script refuses a non-isolated binary, uses disposable profile/workspace paths and shared dependency directories (no real user sessions or inference), and deletes its own temporary data. Rebuild with TAURI_CONFIG unset to restore the normal app identifier.

## Axiom monochrome workbench

The default appearance for new profiles is dark, with an explicit light/dark toggle and existing saved choices preserved. The visual reference is the OpenCode desktop workspace (https://github.com/anomalyco/opencode) and Berd's public design system (https://github.com/block/berd/blob/main/DESIGN.md): neutral surfaces, quiet navigation, compact product chrome, readable conversation and centered composer. No external component code or new dependency was added. Axiom's own wordmark replaces the Pi mark; the welcome screen has no decorative logo. Pi remains the agent engine.

Dark surfaces: canvas #101010, rail #171717, control surface #1e1e1e, border #303030, foreground #ededed, secondary #a3a3a3, primary action #eeeeee with #171717 text. Light mode uses the same gray-only hierarchy. The shell, modal, menu, file selection, tool filters, session rows and composer share these tokens. Red/amber errors and warnings, blue links/diff additions and terminal ANSI colors retain semantic meaning. The user-message article now spans its conversation column; only the inner bubble is width-limited. The session heading uses a dedicated left-aligned layout and the active composer uses a smaller minimum height.

Browser verification covers 12 viewport/DPR combinations, neutral computed shell colors and send contrast, absence of the former Pi brand mark, explicit theme toggling, long history/trace, files, CRLF editing and keyboard focus. Physical monitor/installed desktop appearance is not revalidated by this browser run.

## Balanced workbench and command palette

The Axiom frame uses its own column resolver. Expanded navigation is 248 CSS px; the initial workbench preference is 30% of window width, bounded to 360–680 CSS px. A docked workbench has a 300 px minimum and must leave at least 560 px for conversation. If both cannot fit, it overlays instead; returning to a larger viewport restores the user's saved width. The right splitter shares the same resolver and exposes its actual accessible maximum, supports Home/End, arrows (16 px), and Shift+arrows (64 px), with pointer changes coalesced per animation frame. Identical layout updates no longer publish a new state.

The Quick Actions palette provides Ctrl+Shift+P / Command+Shift+P, bilingual search, arrow selection, Enter, Escape, and focus restoration. It dispatches existing navigation/appearance actions and respects session availability and locks. It does not execute shell commands or submit prompts.

Real Chromium regression on a 1440 x 900 CSS viewport: before 280 / 512 / 648 px, after 248 / 760 / 432 px. Maximum docked width leaves 560 px in the conversation. Dragging from 428 to 464 px persists the preference, narrowing to 1024 px switches to overlay with 776 px conversation, and restoring 1440 px retains 464 px. The smoke test also exercises keyboard navigation, theme contrast, history/trace, file editor and 12 viewport/DPR combinations. No new runtime dependency or agent core change.
