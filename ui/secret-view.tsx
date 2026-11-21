import React from "react";
import { SecretText } from "../vendor/dsh/secret/SecretText.tsx";
import { credentialParts, maskCredentials } from "./credential-mask.ts";

export { maskCredentials };
export function UserText({ text }: { text: string }) {
  const parts = credentialParts(text);
  return (
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
    </>
  );
}
