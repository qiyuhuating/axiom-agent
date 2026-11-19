import { CredentialScanner } from "../vendor/dsh/secret/credential-scanner.ts";
import { formatTables } from "../vendor/dsh/secret/format-tables.ts";
export function credentialParts(text: string) {
  const scanner = new CredentialScanner(formatTables());
  const parts: {
    start: number;
    text: string;
    node?: NonNullable<ReturnType<CredentialScanner["match"]>>;
  }[] = [];
  let offset = 0;
  while (offset < text.length) {
    const node = scanner.match(text, offset);
    if (!node) {
      parts.push({ start: offset, text: text.slice(offset) });
      break;
    }
    if (node.start > offset) parts.push({ start: offset, text: text.slice(offset, node.start) });
    parts.push({ start: node.start, text: text.slice(node.start, node.end), node });
    offset = node.end;
  }
  return parts;
}
export function maskCredentials(text: string) {
  return credentialParts(text)
    .map((p) => p.node?.data.masked ?? p.text)
    .join("");
}
