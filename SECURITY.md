# Security policy

Axiom is intended for a trusted local user. Do not expose its HTTP or runtime ports to the network, put them behind a public reverse proxy, or run the program as administrator.

The foreground agent and user-controlled terminal can execute code with the user's privileges. Pi project trust and tool approvals are not operating-system sandboxes. Cordis and Pi extensions are executable code; install only reviewed packages. Windows background workers use a restricted-token write boundary, not complete read or network isolation. ACL exceptions, hard links and existing operating-system permissions remain relevant. Session, job and terminal history can contain secrets.

The foreground policy defaults to approval for mutating tools when no permission record exists. A damaged or unknown record blocks tool calls. Repair it from Settings and reselect the intended mode. A missing worker policy permits only its read-only tool set. Project code, native Pi settings and installed extensions share the local user's trust boundary.

Axiom custom provider registration accepts HTTPS for remote services and HTTP for loopback. Previously saved endpoints that fail validation are skipped at Pi startup. Correct them in the provider panel and restart the Pi host. Treat the session directory, Pi profile and backups as private user data, including when configuring Windows ACLs.

Please report vulnerabilities through the repository's private vulnerability reporting facility if enabled, or contact the maintainer privately. Include affected version, reproduction and impact; do not post credentials or private session content in public issues.

The preview branch/version receives fixes on a best-effort basis; no security guarantee or stable support window is implied.
