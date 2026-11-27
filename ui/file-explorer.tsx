import { ChevronDown, ChevronRight, File, Folder, FolderOpen, RefreshCw } from "lucide-react";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, msg } from "./panel-shared.tsx";
import { PanelSearch } from "./pi-primitives.tsx";

type Entry = {
  path: string;
  name: string;
  meta: { kind: "directory" | "file" | "other"; hidden?: boolean };
};
type Listing = { entries?: Entry[]; loading: boolean; error?: string };
const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });

export function FileExplorer({ onOpen }: { onOpen: (entry: Entry) => void }) {
  const [listings, setListings] = useState<Record<string, Listing>>({});
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());
  const [selected, setSelected] = useState("");
  const [query, setQuery] = useState("");
  const requests = useRef(new Set<string>());
  const load = useCallback(async (path: string) => {
    if (requests.current.has(path)) return;
    requests.current.add(path);
    setListings((old) => ({ ...old, [path]: { ...old[path], loading: true, error: undefined } }));
    try {
      const entries: Entry[] = await api("files?path=" + encodeURIComponent(path));
      entries.sort(
        (a, b) =>
          Number(b.meta.kind === "directory") - Number(a.meta.kind === "directory") ||
          collator.compare(a.name, b.name),
      );
      setListings((old) => ({ ...old, [path]: { entries, loading: false } }));
    } catch (error) {
      setListings((old) => ({
        ...old,
        [path]: { ...old[path], loading: false, error: msg(error) },
      }));
    } finally {
      requests.current.delete(path);
    }
  }, []);
  useEffect(() => {
    void load("");
  }, [load]);
  const toggle = (entry: Entry) => {
    const next = new Set(expanded);
    if (next.has(entry.path)) next.delete(entry.path);
    else {
      next.add(entry.path);
      if (!listings[entry.path]?.entries) void load(entry.path);
    }
    setExpanded(next);
  };
  const normalized = query.trim().toLocaleLowerCase();
  const matches = useMemo(() => {
    if (!normalized) return [];
    const result: Entry[] = [];
    const walk = (path: string) => {
      for (const entry of listings[path]?.entries ?? []) {
        if (entry.path.toLocaleLowerCase().includes(normalized)) result.push(entry);
        if (entry.meta.kind === "directory") walk(entry.path);
      }
    };
    walk("");
    return result;
  }, [listings, normalized]);
  const select = (entry: Entry) => {
    setSelected(entry.path);
    onOpen(entry);
  };
  const renderDirectory = (path: string, depth: number) => {
    const listing = listings[path];
    if (!listing) return null;
    return (
      <>
        {listing.error && (
          <div className="pi-file-status" role="alert">
            <span>{listing.error}</span>
            <button type="button" onClick={() => void load(path)}>
              重试
            </button>
          </div>
        )}
        {listing.loading && (
          <div className="pi-file-status" role="status">
            加载中…
          </div>
        )}
        {!listing.loading && !listing.error && listing.entries?.length === 0 && (
          <div className="pi-file-status" style={{ paddingInlineStart: 12 + depth * 14 }}>
            空目录
          </div>
        )}
        {listing.entries?.map((entry) => (
          <div key={entry.path}>
            <FileRow
              entry={entry}
              depth={depth}
              expanded={expanded.has(entry.path)}
              selected={selected === entry.path}
              onActivate={() => (entry.meta.kind === "directory" ? toggle(entry) : select(entry))}
            />
            {entry.meta.kind === "directory" &&
              expanded.has(entry.path) &&
              renderDirectory(entry.path, depth + 1)}
          </div>
        ))}
      </>
    );
  };
  return (
    <div className="wb-panel pi-file-explorer">
      <header className="pi-panel-header">
        <div>
          <strong className="file-page-title">工作区文件</strong>
          <small>浏览与编辑项目</small>
        </div>
        <button
          type="button"
          className="pi-icon-button"
          title="刷新文件"
          aria-label="刷新文件"
          onClick={() => {
            void load("");
            for (const path of expanded) void load(path);
          }}
        >
          <RefreshCw size={16} aria-hidden="true" />
        </button>
      </header>
      <PanelSearch label="筛选已加载文件" value={query} onChange={setQuery} />
      <section className="pi-file-scroll" aria-label="工作区目录">
        {normalized ? (
          <>
            <p className="pi-file-status">{matches.length} 个已加载的匹配项</p>
            {matches.map((entry) => (
              <FileRow
                key={entry.path}
                entry={entry}
                depth={0}
                expanded={expanded.has(entry.path)}
                selected={selected === entry.path}
                fullPath
                onActivate={() => {
                  if (entry.meta.kind === "directory") {
                    setExpanded((old) => {
                      const next = new Set(old);
                      let path = entry.path;
                      while (path) {
                        next.add(path);
                        path = path.slice(0, Math.max(0, path.lastIndexOf("/")));
                      }
                      return next;
                    });
                    if (!listings[entry.path]?.entries) void load(entry.path);
                    setQuery("");
                  } else select(entry);
                }}
              />
            ))}
          </>
        ) : (
          renderDirectory("", 0)
        )}
      </section>
    </div>
  );
}
const FileRow = memo(function FileRow({
  entry,
  depth,
  expanded,
  selected,
  fullPath,
  onActivate,
}: {
  entry: Entry;
  depth: number;
  expanded: boolean;
  selected: boolean;
  fullPath?: boolean;
  onActivate: () => void;
}) {
  const directory = entry.meta.kind === "directory";
  const Icon = directory ? (expanded ? FolderOpen : Folder) : File;
  const Chevron = expanded ? ChevronDown : ChevronRight;
  return (
    <button
      type="button"
      className="pi-file-row"
      data-path={entry.path}
      data-selected={selected || undefined}
      data-hidden={entry.meta.hidden || undefined}
      aria-expanded={directory ? expanded : undefined}
      aria-current={selected ? "true" : undefined}
      disabled={entry.meta.kind === "other"}
      title={entry.path}
      style={{ paddingInlineStart: 8 + depth * 14 }}
      onClick={onActivate}
      onKeyDown={(event) => {
        const row = event.currentTarget;
        const rows = Array.from(
          row
            .closest(".pi-file-scroll")
            ?.querySelectorAll<HTMLButtonElement>("button.pi-file-row:not(:disabled)") ?? [],
        );
        const index = rows.indexOf(row);
        if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
          event.preventDefault();
          const next =
            event.key === "Home"
              ? 0
              : event.key === "End"
                ? rows.length - 1
                : index + (event.key === "ArrowDown" ? 1 : -1);
          rows[next]?.focus();
        } else if (!fullPath && event.key === "ArrowRight" && directory) {
          event.preventDefault();
          if (!expanded) onActivate();
          else if (rows[index + 1]?.dataset.path?.startsWith(entry.path + "/"))
            rows[index + 1].focus();
        } else if (!fullPath && event.key === "ArrowLeft") {
          event.preventDefault();
          if (directory && expanded) onActivate();
          else {
            const parent = entry.path.slice(0, Math.max(0, entry.path.lastIndexOf("/")));
            rows.find((item) => item.dataset.path === parent)?.focus();
          }
        }
      }}
    >
      {directory ? <Chevron size={13} aria-hidden="true" /> : <span className="pi-file-spacer" />}
      <Icon size={16} aria-hidden="true" />
      <span>{fullPath ? entry.path : entry.name}</span>
    </button>
  );
});
