import { File, Folder, Slash } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
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
function ComposerMenu({ input }: { input: HTMLTextAreaElement }) {
  const [items, setItems] = useState<Candidate[]>([]);
  const [hit, setHit] = useState<Hit | null>(null);
  const [active, setActive] = useState(0);
  const generation = useRef(0);
  const [limit, setLimit] = useState(400);
  const current = useRef<{ hit: Hit; draft: string; caret: number } | null>(null);
  const close = useCallback(() => {
    generation.current++;
    current.current = null;
    setItems([]);
    setHit(null);
    input.removeAttribute("aria-activedescendant");
  }, [input]);
  const pick = useCallback(
    (item: Candidate) => {
      const snapshot = current.current;
      if (
        !snapshot ||
        input.value !== snapshot.draft ||
        input.selectionStart !== snapshot.caret ||
        input.selectionEnd !== snapshot.caret
      ) {
        close();
        return;
      }
      const { span } = snapshot.hit;
      input.setRangeText(
        item.insert + (item.kind === "directory" ? "" : " "),
        span.start,
        span.end,
        "end",
      );
      input.focus();
      close();
      if (item.kind === "directory") input.dispatchEvent(new Event("input", { bubbles: true }));
    },
    [input, close],
  );
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const update = (event?: Event) => {
      if (event instanceof InputEvent && event.isComposing) {
        close();
        return;
      }
      if (timer) clearTimeout(timer);
      const draft = input.value,
        caret = input.selectionStart;
      // Pi accepts slash commands at the beginning of a prompt. Don't offer
      // commands in prose or when a selection is active.
      const h =
        input.selectionEnd === caret ? detectTrigger(draft, caret, { tier: "plain" }) : null;
      const id = ++generation.current;
      if (!h || (h.trigger === "/" && h.position !== "leading")) {
        close();
        return;
      }
      current.current = { hit: h, draft, caret };
      setLimit(Math.max(72, Math.min(400, input.getBoundingClientRect().top - 84)));
      setHit(h);
      setItems([]);
      setActive(0);
      timer = setTimeout(async () => {
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
              .flatMap(
                (e: { name: string; path: string; meta: { kind: "file" | "directory" } }) => {
                  const mention = formatFileMention({ path: e.path, kind: e.meta.kind }, h.quoted);
                  return mention === undefined
                    ? []
                    : [{ name: e.name, insert: mention, description: e.path, kind: e.meta.kind }];
                },
              );
          }
          if (id === generation.current) {
            setItems(next);
            if (!next.length) close();
          }
        } catch {
          if (id === generation.current) close();
        }
      }, 80);
    };
    const outside = (e: PointerEvent) => {
      if (e.target instanceof Node && !input.form?.contains(e.target)) close();
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    input.form?.addEventListener("submit", close);
    input.addEventListener("compositionend", update);
    input.addEventListener("input", update);
    input.addEventListener("click", update);
    input.addEventListener("keyup", caretMoved);
    function caretMoved(e: KeyboardEvent) {
      if (["ArrowLeft", "ArrowRight", "Home", "End"].includes(e.key)) update();
    }
    input.addEventListener("keydown", key);
    document.addEventListener("pointerdown", outside);
    const reset = () => close();
    window.addEventListener("axiom:session", reset);
    return () => {
      if (timer) clearTimeout(timer);
      generation.current++;
      input.form?.removeEventListener("submit", close);
      input.removeEventListener("compositionend", update);
      input.removeEventListener("input", update);
      input.removeEventListener("click", update);
      input.removeEventListener("keyup", caretMoved);
      input.removeEventListener("keydown", key);
      document.removeEventListener("pointerdown", outside);
      window.removeEventListener("axiom:session", reset);
    };
  }, [input, close]);
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (!items.length || !hit || e.isComposing || e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        e.stopImmediatePropagation();
        setActive((i) => (i + (e.key === "ArrowDown" ? 1 : items.length - 1)) % items.length);
      } else if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault();
        e.stopImmediatePropagation();
        pick(items[active]);
      }
    };
    input.addEventListener("keydown", key, true);
    if (items.length) {
      input.setAttribute("aria-activedescendant", "axiom-suggest-" + active);
      document.getElementById("axiom-suggest-" + active)?.scrollIntoView({ block: "nearest" });
    }
    input.setAttribute("aria-expanded", String(items.length > 0));
    return () => input.removeEventListener("keydown", key, true);
  }, [items, hit, active, input, pick]);
  if (!hit || !items.length) return null;
  return (
    <MenuSurface className={css.menu} style={{ maxHeight: limit }}>
      <div className={css.sectionTitle}>{hit.trigger === "/" ? "Pi 命令" : "工作区文件"}</div>
      <div id="axiom-composer-list" role="listbox" aria-label="输入建议" className={css.viewport}>
        {items.map((item, i) => {
          const Icon = item.kind === "file" ? File : item.kind === "directory" ? Folder : Slash;
          return (
            <div
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
export function initComposerMenu() {
  const input = document.getElementById("prompt") as HTMLTextAreaElement;
  input.setAttribute("role", "combobox");
  input.setAttribute("aria-controls", "axiom-composer-list");
  input.setAttribute("aria-autocomplete", "list");
  createRoot(document.getElementById("composer-menu")!).render(<ComposerMenu input={input} />);
}
