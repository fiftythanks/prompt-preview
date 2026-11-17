import { expect, test } from "bun:test";
import type { ExtensionContext } from "@oh-my-pi/pi-coding-agent";
import { getKeybindings, matchesKey, ProcessTerminal, TUI, type Component } from "@oh-my-pi/pi-tui";
import type { WorkspaceController, WorkspaceView } from "../src/contract";
import { confirmReviewAction, showReviewWorkspace } from "../src/review-ui";

// Exercise the real TUI capture/listener/focus pipeline without owning a tty.
class InputTerminal extends ProcessTerminal {
  input: (data: string) => void = () => {};
  override start(onInput: (data: string) => void) { this.input = onInput; }
  override get columns() { return 96; }
  override get rows() { return 40; }
}

function harness(initial: Partial<WorkspaceView> = {}) {
  const terminal = new InputTerminal();
  const tui = new TUI(terminal);
  let component: Component & { dispose?(): void };
  let finish: (value: unknown) => void = () => {};
  const listeners = new Set<() => void>();
  const actions: string[] = [];
  const view: WorkspaceView = {
    id: "keybinding-check", draft: "alpha\nbravo", revision: 0,
    reviewedDraft: "alpha\nbravo", mandatoryDraft: "alpha\nbravo",
    review: { corrections: [{ id: "spelling", category: "spelling", start: 0, end: 5, original: "alpha", replacement: "Alpha", explanation: "Synthetic correction." }], suggestions: [], tone: "Neutral." },
    busy: false, delivering: false, uncertain: false, error: null, notice: null,
    attachmentCount: 0, settings: { enabled: true, provider: "openai-codex", modelId: "gpt-6.1-terra", effort: "medium" },
    ...initial,
  };
  const controller: WorkspaceController = {
    view: () => view,
    subscribe(listener) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    setDraft(text) { view.draft = text; view.revision++; for (const listener of listeners) listener(); },
    async act(action) { actions.push(action); },
  };
  const ctx = {
    ui: {
      custom(factory: (tui: TUI, theme: unknown, keys: unknown, done: (value: unknown) => void) => Component) {
        const { promise, resolve } = Promise.withResolvers<unknown>();
        finish = resolve;
        component = factory(tui, { fg: (_colour: string, text: string) => text, bold: (text: string) => text }, getKeybindings(), resolve);
        tui.showOverlay(component);
        component.render(96);
        return promise;
      },
      notify() {},
    },
  } as unknown as ExtensionContext;
  // Representative user-supplied Emacs aliases, not bindings owned by this extension.
  tui.addInputListener(data => {
    if (matchesKey(data, "ctrl+p")) return { data: "\x1b[A" };
    if (matchesKey(data, "ctrl+n")) return { data: "\x1b[B" };
  });
  // Model a background composer's multiline-paste handler alongside the key remapper.
  tui.addInputListener(data => data.length > 1 && data.includes("\n") ? { consume: true } : undefined);
  tui.start();
  return {
    ctx, controller, view, actions,
    key(data: string) { terminal.input(data); component.render(96); },
    render() { return Bun.stripANSI(component.render(96).join("\n")); },
    close() { component?.dispose?.(); finish(undefined); tui.stop(); },
  };
}

test("review draft honours global Emacs up/down remapping without losing Tab focus", async () => {
  const app = harness();
  const workspace = showReviewWorkspace(app.ctx, app.controller, new AbortController().signal);
  try {
    app.key("\t");
    app.key("\x10"); // Ctrl+P: same column on the preceding line.
    app.key("!");
    expect(app.view.draft).toBe("alpha!\nbravo");
    app.key("\x0e"); // Ctrl+N: next line, clamped to its end.
    app.key("?");
    expect(app.view.draft).toBe("alpha!\nbravo?");
  } finally { app.close(); await workspace; }
});

test("review options honour the global Emacs next-item mapping", async () => {
  const app = harness();
  const workspace = showReviewWorkspace(app.ctx, app.controller, new AbortController().signal);
  try {
    app.key("\t"); app.key("\t");
    app.key("\x0e"); app.key("\r");
    expect(app.actions).toEqual(["bypass"]);
  } finally { app.close(); await workspace; }
});

test("confirmation honours Emacs next-item mapping rather than confirming default No", async () => {
  const app = harness();
  const confirmation = confirmReviewAction(app.ctx, "Send?", "Synthetic confirmation.");
  try {
    app.key("\x0e"); app.key("\r");
    expect(await confirmation).toBe(true);
  } finally { app.close(); }
});

test("multiline draft paste stays in the review editor, not a background composer", async () => {
  const app = harness();
  const workspace = showReviewWorkspace(app.ctx, app.controller, new AbortController().signal);
  try {
    app.key("\t");
    app.key("one\ntwo");
    expect(app.view.draft).toBe("alpha\nbravoone\ntwo");
    expect(app.actions).toEqual([]);
  } finally { app.close(); await workspace; }
});

test("suggestions locate the anchored occurrence in context, even after the draft changes", async () => {
  const draft = [
    "# Plan", "", "Earlier: intend on changing the label.", "Keep this paragraph unchanged.",
    "Next 🧭: I intend on changing the parser, not the label.",
    ...Array(30).fill("Other instructions remain unchanged."),
  ].join("\n");
  const original = "intend on changing";
  const start = draft.lastIndexOf(original);
  const app = harness({
    draft, reviewedDraft: draft, mandatoryDraft: null,
    review: { corrections: [], suggestions: [{
      id: "naturalness", category: "naturalness", start, end: start + original.length, original,
      explanation: "Use the more natural construction.", alternatives: ["intend to change"], uncertainty: null,
    }], tone: "Neutral." },
  });
  const workspace = showReviewWorkspace(app.ctx, app.controller, new AbortController().signal);
  try {
    expect(app.render()).toContain("Reviewed line 5, column 11");
    expect(app.render()).toContain("Next 🧭: I ⟦intend on changing⟧ the parser, not the label.");
    expect(app.render()).not.toContain("Earlier: ⟦intend on changing⟧");
    app.controller.setDraft(`New heading\n${draft}`);
    expect(app.render()).toContain("Reviewed line 5, column 11");
    expect(app.render()).toContain("previous wording");
    expect(app.view.draft).toBe(`New heading\n${draft}`);
  } finally { app.close(); await workspace; }
});

test("multiline uncertain suggestions retain their full span and reviewed line range", async () => {
  const draft = "# Plan\r\n\r\nWe intend\r\nto change the parser.\r\nDone.";
  const original = "intend\r\nto change";
  const start = draft.indexOf(original);
  const app = harness({
    draft, reviewedDraft: draft, mandatoryDraft: null,
    review: { corrections: [], suggestions: [{
      id: "line-break", category: "possible_issue", start, end: start + original.length, original,
      explanation: "The split phrasing may be intentional.", alternatives: [],
      uncertainty: "Context may justify the line break.",
    }], tone: "Neutral." },
  });
  const workspace = showReviewWorkspace(app.ctx, app.controller, new AbortController().signal);
  try {
    expect(app.render()).toContain("Reviewed lines 3–4, starting column 4");
    expect(app.render()).toContain("We ⟦intend ↵ to change⟧ the parser.");
    expect(app.render()).toContain("Context may justify the line break.");
    expect(app.view.draft).toBe(draft);
    expect(app.actions).toEqual([]);
  } finally { app.close(); await workspace; }
});
