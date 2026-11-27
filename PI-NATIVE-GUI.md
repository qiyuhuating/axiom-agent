# Pi-native GUI

The redesign branch is an independent workbench for Pi. Pi remains the only agent engine, and existing host, session and tool APIs are retained.

The initial shell uses its own visual tokens, larger text, explicit workspace and tool status, a responsive conversation layout and light/dark themes. Existing editor, composer, settings, terminal and DockKit adapters remain in use; they are not yet an independent component library.

## Verification

- npm ci, npm run lint, npm run build:ui, npm test
- Run the optional Chromium layout test with AXIOM_TEST_PLAYWRIGHT_MODULE pointing to a local Playwright installation and AXIOM_TEST_CHROME pointing to a Chromium executable:

    node scripts/check-pi-native-layout.mjs

The browser test uses a temporary Pi profile and workspace, real local server, five viewport/DPR combinations, and no paid inference. The DPR override tests browser rendering and layout, not Windows per-monitor DPI transitions or an installed Tauri/WebView2 package.

Subsequent work should migrate the remaining inherited view components into owned Pi-oriented components, with independent accessibility and native desktop verification.
