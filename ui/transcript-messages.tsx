import { Copy, MessageSquareQuote } from "lucide-react";
import MarkdownIt from "markdown-it";
import { memo } from "react";
import assistantCss from "../vendor/dsh/chat/AssistantMarkdown.module.css";
import actionsCss from "../vendor/dsh/chat/MessageIconActions.module.css";
import messageCss from "../vendor/dsh/chat/MessageItem.module.css";
import { writeClipboard } from "../vendor/dsh/primitives/clipboard.ts";
import { UserMessageBubble } from "../vendor/dsh/primitives/UserMessageBubble.tsx";
import { action, type Message, textOf } from "./projection.ts";
import { UserText } from "./secret-view.tsx";

const markdown = new MarkdownIt({ html: false, linkify: true }).disable("image");
export const MarkdownMessage = memo(function MarkdownMessage({ text }: { text: string }) {
  return (
    // biome-ignore lint/security/noDangerouslySetInnerHtml: raw HTML and unsafe links are disabled by markdown-it.
    <div className="markdown" dangerouslySetInnerHTML={{ __html: markdown.render(text) }} />
  );
});
export const TranscriptMessages = memo(function TranscriptMessages({
  messages,
  sessionId,
  locked,
  onQuote,
}: {
  messages: Message[];
  sessionId?: string;
  locked: boolean;
  onQuote: (text: string) => void;
}) {
  return messages.map((message, index) => {
    const text = textOf(message.content) || message.errorMessage || "";
    if (!text || (message.role !== "user" && message.role !== "assistant")) return null;
    const user = message.role === "user";
    const copy = (
      <button
        type="button"
        className={actionsCss.action}
        title="复制消息"
        aria-label="复制消息"
        onClick={() => void writeClipboard(text)}
      >
        <Copy aria-hidden="true" size={15} />
      </button>
    );
    return (
      <article
        key={(sessionId ?? "") + ":" + index}
        className={"axiom-message " + message.role}
        data-chat-flow-kind={user ? "user" : "assistant"}
        data-actions-reveal="hover"
      >
        {user ? (
          <div className={messageCss.userRow}>
            <div className={messageCss.userStack}>
              <UserMessageBubble>
                <UserText text={text} />
              </UserMessageBubble>
              <div className={actionsCss.actions}>{copy}</div>
            </div>
          </div>
        ) : (
          <div className={assistantCss.root}>
            <div className={assistantCss.body}>
              <MarkdownMessage text={text} />
            </div>
            <div className={actionsCss.actions + " " + assistantCss.actions}>
              {copy}
              <button
                type="button"
                className={"quote-message " + actionsCss.action}
                title="引用此回复"
                aria-label="引用"
                disabled={locked}
                onClick={(event) => {
                  const selection = window.getSelection();
                  const article = event.currentTarget.closest("article");
                  const selected = selection?.toString().trim();
                  const within =
                    selection?.anchorNode &&
                    selection.focusNode &&
                    article?.contains(selection.anchorNode) &&
                    article.contains(selection.focusNode);
                  onQuote(within && selected ? selected : text);
                  selection?.removeAllRanges();
                }}
              >
                <MessageSquareQuote aria-hidden="true" size={15} />
              </button>
            </div>
          </div>
        )}
      </article>
    );
  });
});
