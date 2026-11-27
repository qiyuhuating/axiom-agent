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
- Conversation history opens with the most recent 80 message records; more history is revealed in batches of 80, with a measured scroll anchor. While browsing history, the start index is frozen rather than silently evicting the reader's earlier messages. Returning to the recent page releases older message bodies. All history remains in the projection; this is a DOM mount reduction, not server-side pagination or a hard cap on process memory.
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
