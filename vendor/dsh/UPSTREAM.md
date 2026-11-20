Upstream: https://github.com/deepseek-ai/deepseek-harness
Commit: 2e39e70496aa02986ca6a820c5d497e816b69d7e
License: MIT (see LICENSE).
Imported: Button, Modal, modal focus and keyboard helpers, column geometry, base theme.
Local change: Modal icon imports map to Lucide.

0.3.0 additional imported upstream components: files/FileTree, DockKit controller/renderer, browser URL parsing, DiffBlock, CodeToolbar, clipboard, FoldToggle, Tooltip, MenuSurface, ShortcutKeys, Switch and code-language logic. FileTree and DockKit imports are adapted to local primitives; Lucide icon substitutions and code-language seams replace upstream host-specific dependencies. React components/algorithms retain upstream license. See DSH-INTEGRATION.md.


0.4.0: vendored packages/team/agent-team/src/task-graph.ts, sandbox-windows-acl core runner, win32-process primitives, subprocess/control, lazy-require and HarnessError from pinned upstream commit. ACL index does not re-export the upstream diagnosis-skill integration; runner bundle uses local aliases. Cordis published native packages are pinned in package.json.

UI alignment: copied unmodified design-platform.css, scrollbar.css, focus.css and GuideBody.module.css from pinned upstream; GuideTitle.tsx glyphs retain upstream SVG, with local type seam. Axiom shell adapts upstream component geometry to existing Pi interfaces.

Sidebar alignment: original SidebarRoot.module.css, Rows.module.css, WorkspaceBrowser.module.css, SettingsRoot.module.css, FilesBody.module.css, Browser.module.css and terminal.module.css are copied from the pinned upstream commit. Their CSS-module classes are consumed by Axiom adapters, with no slot-system or alternative engine dependency.

Composer/credential port: imported ui-secret-mask scanner, tables, masks and SecretText with type-only local seams; ui-input-trigger trigger detection and file-reference grammar with local type imports; original menu, InputBar and HeroShell CSS. See UI-ALIGNMENT.md for scope.
