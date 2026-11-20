import React from "react";
import { createRoot } from "react-dom/client";
import { SecretText } from "../vendor/dsh/secret/SecretText.tsx";
import { credentialParts, maskCredentials } from "./credential-mask.ts";

const roots = new Set<ReturnType<typeof createRoot>>();

export { maskCredentials };
export function drawUserText(element: HTMLElement, text: string) {
  const parts = credentialParts(text);
  if (!parts.some((p) => p.node)) {
    element.textContent = text;
    return;
  }
  const root = createRoot(element);
  roots.add(root);
  root.render(
    <>
      {parts.map((p) =>
        p.node ? (
          <SecretText
            key={p.start}
            node={p.node}
            raw={p.text}
            interactive
            t={(k) => (k === "secret.hide" ? "隐藏凭据" : "显示凭据")}
          />
        ) : (
          <React.Fragment key={p.start}>{p.text}</React.Fragment>
        ),
      )}
    </>,
  );
}
export function clearUserText() {
  for (const root of roots) root.unmount();
  roots.clear();
}
