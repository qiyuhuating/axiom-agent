# DeepSeek Harness visual alignment

Source: upstream deepseek-ai/deepseek-harness, commit 2e39e70496aa02986ca6a820c5d497e816b69d7e (MIT). The original theme token, scrollbar, focus and guide CSS modules are vendored directly. The guide compass uses the upstream SVG. Existing vendored DockKit, FileTree, Button and Modal remain in use.

The Axiom shell adapts AppFrame, SidebarRoot, HeroShell, InputBar and MessageItem geometry to its own Pi-backed host. New UI follows the operating system appearance until explicitly toggled; normal sidebar 280 px, collapsed rail 56 px, drawer below 768 px, optional docked/overlay workbench. User bubble, 748 px chat/764 px composer width, 28 px input card radius and right-hand guide follow upstream styles. Models and thinking levels move to the composer. No extra production dependencies or API changes.

The complete upstream conversation and slot system is not copied: its session, provider, command and extension contracts differ from Pi. Native titlebar, original brand imagery, rich contenteditable composer, and every upstream plugin page are not pixel-identical. Axiom retains its own identity and existing functions.

## Verification

Windows WebView2 test fixture: light and dark appearance, sidebar collapse and expand, guide opening and closing, white base/rgb(249,250,251) sidebar, 28 px composer radius. Existing installed terminal smoke covers Unicode, page reload, reconnect and terminal close. Tested against a previously installed test-only executable with rebuilt UI assets, not an exact new NSIS artifact. Build and core tests pass; lint has warnings but no errors.

Use scripts/check-installed-appearance.mjs with the same isolated CDP procedure as scripts/check-installed-terminal.mjs. Set AXIOM_TEST_PLAYWRIGHT_MODULE to a local Playwright module. Optional AXIOM_UI_SCREENSHOT_DIR stores actual screenshots locally. Never enable debugging on a production session.

## Sidebar source alignment

Seven additional original upstream CSS modules are used directly at the sidebar, workspace history, settings, files, browser and terminal render sites. The left navigation opens the existing Axiom workbench routes, includes a local title search over loaded Pi sessions and retains the settings entry in the rail. Settings uses the upstream navigation cells for general/permission and model-provider sections. Existing FileTree/DockKit remain upstream source. Jobs, resources and Git status keep their Axiom-specific data contracts and layouts; the browser remains a sandboxed iframe, not the upstream Electron browser surface.

Installed-fixture appearance smoke exercises the navigation, title search, files, browser, settings, resources, jobs, and terminal reconnection without running inference or changing permissions. The latest exact NSIS artifact is still pending CI.
