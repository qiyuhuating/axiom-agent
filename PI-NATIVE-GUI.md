# Pi-native GUI

The redesign branch is an independent workbench for Pi. Pi remains the only agent engine, and existing host, session and tool APIs are retained.

The initial shell uses its own visual tokens, larger text, explicit workspace and tool status, a responsive conversation layout and light/dark themes. Existing editor, composer, settings, terminal and DockKit adapters remain in use; they are not yet an independent component library.

## Native high-DPI rendering

The Windows executable declares PerMonitorV2 DPI awareness with a per-monitor fallback. Tauri sizes the initial window from the primary monitor work area in logical pixels; WebView2 owns rasterization at the monitor device scale. The reading column grows with available space up to 1120 CSS pixels. No manual device-pixel-ratio transform is applied.

## Verification

- npm ci, npm run lint, npm run build:ui, npm test
- Run the optional Chromium layout test with AXIOM_TEST_PLAYWRIGHT_MODULE pointing to a local Playwright installation and AXIOM_TEST_CHROME pointing to a Chromium executable:

    node scripts/check-pi-native-layout.mjs

The browser test uses a temporary Pi profile and workspace, real local server, twelve viewport/DPR combinations, including 2560×1440 and 3840×2160 at 100%, 125%, 150%, and 200% scaling, and no paid inference. The test reads the actual screenshot PNG dimensions in device pixels, with a one-pixel rounding tolerance, and checks layout. The DPR override tests browser rendering and layout, not Windows per-monitor DPI transitions or an installed Tauri/WebView2 package.

Subsequent work should migrate the remaining inherited view components into owned Pi-oriented components, with independent accessibility and native desktop verification.
