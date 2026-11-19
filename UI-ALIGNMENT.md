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

## Composer and credential capabilities

Upstream pinned source: ui-secret-mask (format tables, scanner, masks, SecretText React component and CSS), ui-input-trigger/core/detect.ts, context/file-reference/src/grammar.ts, and MenuView.module.css, InputBar.module.css, HeroShell.module.css. Runtime algorithm bodies retained; type imports/localized component contract are adapted locally. The actual upstream MenuSurface renders Pi command and workspace file candidates obtained from existing authenticated host routes. Candidate insertion uses upstream quoting rules, generation checks and current caret validation, with no execution until explicit normal prompt submission. File mentions are prompt references, not automatic file-content attachments. The complete upstream Lexical conversation editor/slot renderer is not imported.

Credential masking is display-only for recognized formats in user bubbles, session titles and tool trace values. It is not encryption, access control, log sanitization or a guarantee against all disclosures. Original prompts and persisted data remain unchanged; explicit reveal is supported in user bubbles. Assistant output and terminal output are not filtered.

The installed appearance driver expects a test-only workspace containing axiom-fixture.txt. The latest isolated WebView2 fixture passed real Pi slash selection, workspace @ reference selection, synthetic credential mask/reveal/remask, prior sidebar navigation and terminal UTF-8/reconnect. No model inference was needed. Unit tests cover key/address/key-block masking and trigger/quote boundaries. Exact candidate installer remains pending.

## React projection and capability adapters

The checked-in imperative public/app.js has been retired. ui/app.tsx is the only React root; app.js and app.css are generated with lazy editor and terminal chunks. ui/projection.ts owns the shared Pi session snapshot, message/tool projection, draft, dialogs, attachments and job query. Workbench jobs and the composer plan dock consume the same job cache. Component-local editor/input state is not a second authoritative session state.

Lexical 0.49.0 powers the composer using adapted upstream ComposerContentEditable, draft projection and span replacement. The editor retains keyboard history and text references; file-reference, command and quote chips are imported; the full upstream slot registry remains unported. Tool trajectories use actual observed Pi events; historical timing is unknown unless observed. Goal/plan views use persisted Axiom jobs, with explicit user review and insertion into the draft, with bounded automatic continuation through Pi native settlement hooks (see below). Team views use real Axiom DAG task state. Pi select requests use upstream question option styles; confirm requests preserve the existing explicit permission decision. Pi packages and MCP retain the existing host operations, with upstream package-card styling instead of the upstream bundle marketplace.

The upstream PresentedFileCard renders successful present_files records from the Pi extension. The extension accepts existing relative workspace files only (realpath containment, 20 entries, 10 MiB per file), and preview uses existing host validation. Cards represent explicit delivery results rather than detected per-turn file changes.

Upstream source is pinned to the revision stated above; adaptations remain under vendor/dsh. No second agent engine, remote plugin catalog or implicit permission grant is introduced. Full upstream module parity remains outstanding. The fixture tests do not substitute for new exact NSIS acceptance or live inference.

## Native capability integration

- Composer: original ReferenceChip, chip node, decorator portal and span mapping are adapted to Lexical. File labels are atomic decorations; clipboard and prompt serialization preserve the original mention. Commands and quotes now use the original atomic decorator nodes; directories remain navigational text.
- Structured interaction: versioned question/answer batches use native Pi editor RPC. The extension and host validate IDs, selections, cardinality, skip and custom answers. Late responses are rejected; unfinished answer drafts and plan feedback survive a reload of the current WebView for the same live RPC request. They are removed on settlement; restarting Pi does not revive an expired request.
- Plan and goal: active-branch Pi session entries own the state. Plan mode blocks model mutation tools until approval without changing tool permissions; it is not an OS sandbox. Goal continuation requires explicit arming and a bounded extra-settlement budget. Error, interruption, UI interaction and restore pause continuation. Completion evidence is model-reported, not independently verified. An explicitly reauthorized paused goal keeps its unused budget. The budget does not bound individual inference tokens or internal tool calls.
- File observation: successful top-level write/edit calls record before/after SHA-256 for workspace files up to 10 MiB. Failed, unchanged and overlapping observed calls are omitted. UI groups observations by user turn. UTF-8 files up to 64 KiB each retain a bounded historical unified patch (50 ms / 2000 edit budget, 128 KiB result limit), with credential display masking; raw patch data is stored in Pi session history. Shell edits, external concurrent writes and reconstruction of earlier unrecorded changes are not guaranteed.
- Teams: existing read-only workers retain DAG scheduling. Settlement retains only the last assistant message, rejects on disconnection and releases listeners/timers. Team cancellation invalidates worker mail authorization before aborting active members; terminal recipients reject new messages. An inactive team can be explicitly retried after an interruption: preserve completed dependency outputs, clear failed results and attempt mail, reject writable jobs or incomplete worker cleanup. Dynamic reassignment and automatic crash replay are not implemented.
- Plugins: native project settings support reversible enable/disable of simple packages, updates via Pi, and MCP enable/disable. Advanced filters are protected from destructive toggles. Reload is explicit; no marketplace, version rollback or OAuth lifecycle.

Validation covers native structured editor RPC without inference, question validation, plan approval, goal transitions, branch projection, file observation conflict handling and disposable project settings round trips. Isolated Windows WebView2 verifies original reference chip insertion/deletion and existing UI/terminal flows. Live provider-driven continuation, network package updates and the exact new NSIS artifact remain unverified.

Validation update: 17 core tests, lint error gate, frontend build and isolated WebView2 command/file/quote chips, browser draft recovery fixture and Rust PTY reconnection pass. No new package-management functionality or alternate agent engine in this update. Exact installer, full slot registry, durable RPC restart recovery and real-provider continuation remain outstanding.
