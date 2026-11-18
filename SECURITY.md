# Security policy

Axiom is intended for a trusted local user. Do not expose its HTTP or runtime ports to the network, put them behind a public reverse proxy, or run the program as administrator.

The foreground agent and user-controlled terminal can execute code with the user's privileges. Pi project trust and tool approvals are not operating-system sandboxes. Cordis and Pi extensions are executable code; install only reviewed packages. Windows background workers use a restricted-token write boundary, not complete read or network isolation. ACL exceptions, hard links and existing operating-system permissions remain relevant. Session, job and terminal history can contain secrets.

Please report vulnerabilities through the repository's private vulnerability reporting facility if enabled, or contact the maintainer privately. Include affected version, reproduction and impact; do not post credentials or private session content in public issues.

The preview branch/version receives fixes on a best-effort basis; no security guarantee or stable support window is implied.
