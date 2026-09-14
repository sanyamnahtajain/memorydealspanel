"use client";

import * as React from "react";

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

/**
 * The keyboard cheat sheet for the bulk grid.
 *
 * The grid has had a full Excel-style keyboard model for a while, but nothing
 * told an operator it existed — a shortcut nobody can discover is a shortcut
 * nobody uses. This is opened with "?" (and from the toolbar, so it is
 * reachable without already knowing a shortcut).
 *
 * The modifier is rendered per-platform: printing "Ctrl" to someone on a Mac
 * sends them hunting for a key that does nothing here.
 */

interface Shortcut {
  keys: string[];
  what: string;
}

interface Group {
  title: string;
  items: Shortcut[];
}

/** `mod` is substituted for the platform's primary modifier at render time. */
const GROUPS: Group[] = [
  {
    title: "Moving around",
    items: [
      { keys: ["↑", "↓", "←", "→"], what: "Move one cell" },
      { keys: ["mod", "↑↓←→"], what: "Jump to the edge of the data" },
      { keys: ["Page Up", "Page Dn"], what: "Move a screenful of rows" },
      { keys: ["Home", "End"], what: "First / last column of this row" },
      { keys: ["mod", "Home"], what: "First cell of the sheet" },
      { keys: ["mod", "End"], what: "Last cell of the sheet" },
      { keys: ["Tab"], what: "Next cell (Shift+Tab for previous)" },
    ],
  },
  {
    title: "Selecting",
    items: [
      { keys: ["Shift", "↑↓←→"], what: "Extend the selection" },
      { keys: ["Shift", "Page Dn"], what: "Extend by a screenful" },
      { keys: ["Shift", "End"], what: "Extend to the end of the row" },
      { keys: ["mod", "A"], what: "Select everything" },
    ],
  },
  {
    title: "Editing",
    items: [
      { keys: ["Enter"], what: "Edit, then move down (Shift+Enter moves up)" },
      { keys: ["F2"], what: "Edit without clearing the cell" },
      { keys: ["Type"], what: "Start typing to replace the cell" },
      { keys: ["Esc"], what: "Cancel the edit" },
      { keys: ["Delete"], what: "Clear the selected cells" },
    ],
  },
  {
    title: "Filling and history",
    items: [
      { keys: ["mod", "D"], what: "Fill down from the top row" },
      { keys: ["mod", "R"], what: "Fill right from the left column" },
      { keys: ["mod", "C"], what: "Copy" },
      { keys: ["mod", "V"], what: "Paste" },
      { keys: ["mod", "X"], what: "Cut" },
      { keys: ["mod", "Z"], what: "Undo (Shift to redo)" },
      { keys: ["mod", "F"], what: "Find in the sheet" },
    ],
  },
];

/** The platform never changes mid-session, so there is nothing to subscribe to. */
function subscribeNever(): () => void {
  return () => {};
}

function getIsMac(): boolean {
  return /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
}

/** Server render: assume the non-Mac label; the client corrects it on mount. */
function getIsMacServer(): boolean {
  return false;
}

function Key({ label }: { label: string }) {
  return (
    <kbd className="inline-flex min-w-6 items-center justify-center rounded border border-border bg-muted px-1.5 py-0.5 font-sans text-[0.7rem] font-medium text-foreground shadow-[0_1px_0_0_var(--color-border)]">
      {label}
    </kbd>
  );
}

export function GridShortcutsDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  // Client-only, and it never changes — so it is read through
  // useSyncExternalStore with a server snapshot of `false` rather than set in
  // an effect. `navigator` doesn't exist while server-rendering, and guessing
  // wrong prints a key the operator doesn't have.
  const isMac = React.useSyncExternalStore(
    subscribeNever,
    getIsMac,
    getIsMacServer,
  );
  const mod = isMac ? "⌘" : "Ctrl";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Keyboard shortcuts</DialogTitle>
        </DialogHeader>

        <div className="grid gap-x-8 gap-y-6 sm:grid-cols-2">
          {GROUPS.map((group) => (
            <section key={group.title} className="space-y-2">
              <h3 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
                {group.title}
              </h3>
              <dl className="space-y-1.5">
                {group.items.map((item) => (
                  <div
                    key={item.what}
                    className="flex items-baseline justify-between gap-3"
                  >
                    <dt className="flex shrink-0 items-center gap-1">
                      {item.keys.map((k, i) => (
                        <React.Fragment key={`${item.what}-${k}-${i}`}>
                          {i > 0 ? (
                            <span
                              aria-hidden
                              className="text-[0.65rem] text-muted-foreground"
                            >
                              +
                            </span>
                          ) : null}
                          <Key label={k === "mod" ? mod : k} />
                        </React.Fragment>
                      ))}
                    </dt>
                    <dd className="min-w-0 text-right text-xs leading-relaxed text-muted-foreground [overflow-wrap:anywhere]">
                      {item.what}
                    </dd>
                  </div>
                ))}
              </dl>
            </section>
          ))}
        </div>

        <p className="text-xs text-muted-foreground">
          Press <Key label="?" /> any time to bring this back.
        </p>
      </DialogContent>
    </Dialog>
  );
}
