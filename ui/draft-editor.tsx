import { createEmptyHistoryState, registerHistory } from "@lexical/history";
import { registerPlainText } from "@lexical/plain-text";
import {
  $addUpdateTag,
  $createParagraphNode,
  $createTextNode,
  $getNearestNodeFromDOMNode,
  $getRoot,
  $getSelection,
  $isRangeSelection,
  CLICK_COMMAND,
  COMMAND_PRIORITY_LOW,
  createEditor,
  SKIP_DOM_SELECTION_TAG,
} from "lexical";
import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { ComposerContentEditable } from "../vendor/dsh/conversation/ComposerContentEditable.tsx";
import {
  $createReferenceChipNode,
  $isReferenceChipNode,
  ReferenceChipNode,
} from "../vendor/dsh/conversation/chip-node.tsx";
import { DecoratorPortals } from "../vendor/dsh/conversation/DecoratorPortals.tsx";
import { $projectDraft } from "../vendor/dsh/conversation/draft-projection.ts";
import inputCss from "../vendor/dsh/conversation/InputBar.module.css";
import {
  $replaceDetectSpanWithNodes,
  $replaceDetectSpanWithText,
} from "../vendor/dsh/conversation/span-map.ts";
import { ComposerMenu, useComposerSuggestions } from "./composer-menu.tsx";
import { setDraft } from "./projection.ts";
import { openDelivery } from "./workbench.tsx";
import "../vendor/dsh/conversation/composer-editor.module.css";
export function DraftEditor({
  draft,
  disabled,
  onSubmit,
  sessionId,
}: {
  draft: string;
  disabled: boolean;
  onSubmit: () => void;
  sessionId: string | undefined;
}) {
  const editor = useMemo(
    () =>
      createEditor({
        namespace: "axiom-composer",
        nodes: [ReferenceChipNode],
        onError: (error) => {
          throw error;
        },
      }),
    [],
  );
  const [projected, setProjected] = useState<{
    text: string;
    detectText: string;
    caret: number | null;
  }>({
    text: "",
    detectText: "",
    caret: null,
  });
  const [focused, setFocused] = useState(false);
  const [composing, setComposing] = useState(false);
  const consumed = useRef(false);
  const compositionEnd = useRef(0);
  useLayoutEffect(() => {
    const unregister = registerPlainText(editor),
      history = registerHistory(editor, createEmptyHistoryState(), 1000);
    const listen = editor.registerUpdateListener(({ editorState, tags }) => {
      const next = editorState.read($projectDraft);
      setProjected((old) =>
        old.text === next.text && old.detectText === next.detectText && old.caret === next.caret
          ? old
          : next,
      );
      if (!tags.has("axiom-external-draft")) setDraft(next.text);
    });
    const click = editor.registerCommand(
      CLICK_COMMAND,
      (event) => {
        if (event.button !== 0 || event.detail > 1 || !event.target) return false;
        const selection = $getSelection();
        if ($isRangeSelection(selection) && !selection.isCollapsed()) return false;
        const node = $getNearestNodeFromDOMNode(event.target as Node);
        if (
          !$isReferenceChipNode(node) ||
          node.isInvalid() ||
          node.getSource() !== "workspace-file"
        )
          return false;
        openDelivery(node.getReference());
        return true;
      },
      COMMAND_PRIORITY_LOW,
    );
    return () => {
      click();
      listen();
      history();
      unregister();
    };
  }, [editor]);
  useLayoutEffect(() => {
    const text = editor.getEditorState().read(() => $projectDraft().text);
    if (text === draft) return;
    editor.update(
      () => {
        const root = $getRoot();
        root.clear();
        for (const line of draft.split("\n")) {
          const paragraph = $createParagraphNode();
          if (line) paragraph.append($createTextNode(line));
          root.append(paragraph);
        }
        root.selectEnd();
        if (!editor.getRootElement()?.contains(document.activeElement))
          $addUpdateTag(SKIP_DOM_SELECTION_TAG);
      },
      { tag: "axiom-external-draft", discrete: true },
    );
  }, [editor, draft]);
  const menu = useComposerSuggestions({
    text: projected.detectText,
    caret: projected.caret,
    enabled: focused && !composing && !disabled,
    sessionId,
    apply: (start, end, text, expected, caret, candidate) => {
      let applied = false;
      editor.update(
        () => {
          const now = $projectDraft();
          if (now.detectText !== expected || now.caret !== caret) return;
          applied =
            candidate.kind === "file" && candidate.description
              ? $replaceDetectSpanWithNodes({ start, end }, [
                  $createReferenceChipNode({
                    source: "workspace-file",
                    ref: candidate.description,
                    label: candidate.name,
                    appearance: "file",
                    clipboardText: candidate.insert,
                  }),
                  $createTextNode(" "),
                ])
              : $replaceDetectSpanWithText({ start, end }, text);
        },
        { discrete: true },
      );
      if (applied) editor.getRootElement()?.focus();
      return applied;
    },
  });
  return (
    <fieldset
      className="draft-editor"
      aria-label="消息编辑器"
      onFocus={() => setFocused(true)}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget)) setFocused(false);
      }}
      onCompositionStart={() => setComposing(true)}
      onCompositionEnd={() => {
        compositionEnd.current = performance.now();
        setComposing(false);
      }}
      onKeyDownCapture={(event) => {
        const isComposing =
          event.nativeEvent.isComposing ||
          composing ||
          event.keyCode === 229 ||
          performance.now() - compositionEnd.current < 16;
        if (isComposing) return;
        if (!event.ctrlKey && !event.metaKey && !event.altKey && menu.key(event.key)) {
          event.preventDefault();
          event.stopPropagation();
          return;
        }
        if (event.key === "Enter" && !event.shiftKey && !event.altKey) {
          event.preventDefault();
          event.stopPropagation();
          if (!disabled && !consumed.current) {
            consumed.current = true;
            onSubmit();
            queueMicrotask(() => {
              consumed.current = false;
            });
          }
        }
      }}
    >
      <div id="composer-menu">
        <ComposerMenu {...menu} />
      </div>
      <ComposerContentEditable
        id="prompt"
        editor={editor}
        editable={!disabled}
        className={inputCss.input + " axiom-lexical-input"}
        data-placeholder="描述任务，或提出问题…"
        data-empty={!draft || undefined}
        aria-label="输入消息"
        aria-controls={menu.items.length ? "axiom-composer-list" : undefined}
        aria-expanded={menu.items.length > 0}
        aria-autocomplete="list"
        role="combobox"
        aria-activedescendant={menu.items.length ? "axiom-suggest-" + menu.active : undefined}
      />
      <DecoratorPortals editor={editor} />
    </fieldset>
  );
}
