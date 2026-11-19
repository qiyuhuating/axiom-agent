import { File, Folder, Slash } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { detectTrigger } from "../vendor/dsh/input/detect.ts";
import { formatFileMention } from "../vendor/dsh/input/grammar.ts";
import css from "../vendor/dsh/input/MenuView.module.css";
import { MenuSurface } from "../vendor/dsh/primitives/MenuSurface.tsx";
import { api } from "./panel-shared.tsx";

type Candidate = {
  name: string;
  insert: string;
  description?: string;
  kind: "command" | "file" | "directory";
};
type Hit = NonNullable<ReturnType<typeof detectTrigger>>;
export function useComposerSuggestions({
  text,
  caret,
  enabled,
  sessionId,
  apply,
}: {
  text: string;
  caret: number | null;
  enabled: boolean;
  sessionId: string | undefined;
  apply: (start: number, end: number, text: string, expected: string, caret: number) => boolean;
}) {
  const [items, setItems] = useState<Candidate[]>([]),
    [active, setActive] = useState(0),
    [hit, setHit] = useState<Hit | null>(null);
  const generation = useRef(0);
  const last = useRef<{ text: string; caret: number; sessionId: string | undefined } | null>(null);
  const closed = useRef<{ text: string; caret: number | null } | null>(null);
  function close() {
    generation.current++;
    last.current = null;
    closed.current = { text, caret };
    setItems([]);
    setHit(null);
  }
  useEffect(() => {
    const id = ++generation.current;
    last.current = null;
    setItems([]);
    setHit(null);
    setActive(0);
    if (
      !enabled ||
      caret === null ||
      (closed.current?.text === text && closed.current?.caret === caret)
    )
      return;
    const h = detectTrigger(text, caret, { tier: "plain" });
    if (!h || (h.trigger === "/" && h.position !== "leading")) return;
    last.current = { text, caret, sessionId };
    setHit(h);
    const timer = setTimeout(async () => {
      try {
        let next: Candidate[];
        if (h.trigger === "/") {
          const commands = await api("commands");
          next = commands
            .filter((c: { name: string }) => c.name.toLowerCase().includes(h.query.toLowerCase()))
            .slice(0, 40)
            .map((c: { name: string; description?: string }) => ({
              name: "/" + c.name,
              insert: "/" + c.name,
              description: c.description,
              kind: "command",
            }));
        } else {
          const slash = h.query.lastIndexOf("/"),
            dir = slash < 0 ? "" : h.query.slice(0, slash),
            prefix = h.query.slice(slash + 1).toLowerCase();
          const entries = await api("files?path=" + encodeURIComponent(dir));
          next = entries
            .filter(
              (e: { name: string; meta: { kind: string; hidden?: boolean } }) =>
                !e.meta.hidden &&
                e.name.toLowerCase().includes(prefix) &&
                ["directory", "file"].includes(e.meta.kind),
            )
            .slice(0, 40)
            .flatMap((e: { name: string; path: string; meta: { kind: "file" | "directory" } }) => {
              const mention = formatFileMention({ path: e.path, kind: e.meta.kind }, h.quoted);
              return mention === undefined
                ? []
                : [{ name: e.name, insert: mention, description: e.path, kind: e.meta.kind }];
            });
        }
        if (id === generation.current) setItems(next);
      } catch {
        if (id === generation.current) setItems([]);
      }
    }, 80);
    return () => {
      clearTimeout(timer);
      generation.current++;
    };
  }, [text, caret, enabled, sessionId]);
  function pick(item: Candidate) {
    const previous = last.current;
    if (
      !hit ||
      !previous ||
      previous.sessionId !== sessionId ||
      previous.text !== text ||
      previous.caret !== caret
    ) {
      close();
      return;
    }
    const ok = apply(
      hit.span.start,
      hit.span.end,
      item.insert + (item.kind === "directory" ? "" : " "),
      previous.text,
      previous.caret,
    );
    close();
    if (ok && item.kind === "directory") closed.current = null;
  }
  function key(key: string) {
    if (!items.length || !enabled) return false;
    if (key === "Escape") {
      close();
      return true;
    }
    if (key === "ArrowDown" || key === "ArrowUp") {
      setActive((i) => (i + (key === "ArrowDown" ? 1 : items.length - 1)) % items.length);
      return true;
    }
    if (key === "Enter" || key === "Tab") {
      pick(items[active]);
      return true;
    }
    return false;
  }
  return { items, hit, active, setActive, pick, key };
}
export function ComposerMenu({
  items,
  hit,
  active,
  setActive,
  pick,
}: ReturnType<typeof useComposerSuggestions>) {
  const row = useRef<HTMLDivElement>(null);
  // biome-ignore lint/correctness/useExhaustiveDependencies: reveal the current menu option after its index or list changes.
  useEffect(() => {
    row.current?.scrollIntoView({ block: "nearest" });
  }, [active, items]);
  if (!hit || !items.length) return null;
  return (
    <MenuSurface className={css.menu} style={{ maxHeight: 320 }}>
      <div className={css.sectionTitle}>{hit.trigger === "/" ? "Pi 命令" : "工作区文件"}</div>
      <div id="axiom-composer-list" role="listbox" aria-label="输入建议" className={css.viewport}>
        {items.map((item, i) => {
          const Icon = item.kind === "file" ? File : item.kind === "directory" ? Folder : Slash;
          return (
            <div
              ref={i === active ? row : undefined}
              id={"axiom-suggest-" + i}
              key={item.insert}
              role="option"
              tabIndex={-1}
              aria-selected={i === active}
              className={css.item + (i === active ? " " + css.active : "")}
              onMouseMove={() => setActive(i)}
              onMouseDown={(e) => {
                e.preventDefault();
                pick(item);
              }}
            >
              <span className={css.itemIcon}>
                <Icon size={14} />
              </span>
              <span className={css.itemName}>{item.name}</span>
              <span className={css.itemDescription}>{item.description}</span>
            </div>
          );
        })}
      </div>
    </MenuSurface>
  );
}
