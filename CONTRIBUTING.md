# Contributing

Use Windows with Node.js 24 and PowerShell 7 for the currently supported development path. Run `npm ci`, `npm run build:ui` and `npm test` before submitting a change.

Pi remains the sole agent engine. Prefer direct upstream reuse and thin adapters over duplicated protocol, UI or execution implementations. Preserve upstream licensing and record the exact source revision and local modifications in `vendor/dsh/UPSTREAM.md`.

Submit focused pull requests with the problem, the change, and the verification actually performed. Check existing issues and pull requests first. Keep tests proportional to the change; do not claim model calls, platform coverage or sandbox protections that were not exercised. Use isolated temporary workspaces for tests that write files, load plugins or call providers.

AI-assisted contributions are welcome when the contributor has reviewed the change, can explain it, and is responsible for the verification. Follow upstream rules when contributing back to upstream projects.

Never commit credentials, session logs, local workspace contents, provider configuration or generated private artifacts. Report suspected security vulnerabilities privately as described in SECURITY.md.

By submitting changes to this project, you agree that your contributions are licensed under the project's MIT license, while preserving any applicable upstream notices.
