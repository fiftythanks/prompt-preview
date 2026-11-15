// THROWAWAY prototype: real native review + manual rewrite, not a browser mock-up.
import type { ExtensionContext } from "@oh-my-pi/pi-coding-agent";
import { Editor, ScrollView, SelectList, getSelectListTheme, getEditorTheme, matchesKey, truncateToWidth, visibleWidth, wrapTextWithAnsi } from "@oh-my-pi/pi-tui";
import type { WorkspaceAction, WorkspaceController, WorkspaceView } from "./contract";

const safe = (value: string) => value.replace(/[\x00-\x08\x0b-\x1f\x7f-\x9f]/g, "").replace(/\t/g, "   ");
const red = (text: string) => `\x1b[31;9m${safe(text)}\x1b[0m`;
const green = (text: string) => `\x1b[32m${safe(text)}\x1b[0m`;
const bold = (text: string) => `\x1b[1m${text}\x1b[0m`;
const shown = (text: string) => text === "" ? "∅" : text.replace(/\n/g, " ↵ ");
const pad = (text: string, width: number) => {
  const clipped = truncateToWidth(text, width, "");
  return clipped + " ".repeat(Math.max(0, width - visibleWidth(clipped)));
};

type Ink = Record<"accent" | "muted" | "warning" | "error" | "success", (text: string) => string>;

function feedback(view: WorkspaceView, width: number, ink: Ink): string[] {
  const lines: string[] = [];
  const paragraph = (text: string, indent = "  ") => {
    lines.push(...wrapTextWithAnsi(text, Math.max(1, width - visibleWidth(indent))).map(line => indent + line));
  };
  const section = (title: string) => {
    if (lines.length) lines.push("");
    lines.push(ink.accent(bold(title)), ink.muted("─".repeat(Math.max(1, width))));
  };
  if (view.busy) { paragraph(ink.accent("Reviewing your wording…")); lines.push(""); }
  if (view.error) { section("Review paused"); paragraph(ink.error(safe(view.error))); }
  if (view.notice) paragraph(ink.warning(safe(view.notice)));
  if (!view.review) {
    if (!view.busy) paragraph(ink.muted("No completed review yet. Your draft is kept below."));
  } else {
    if (view.reviewedDraft !== view.draft) {
      paragraph(ink.warning("Draft changed. This feedback is from the previous wording."));
      lines.push("");
    }
    if (view.review.corrections.length) {
      section(`Corrections · ${view.review.corrections.length}`);
      view.review.corrections.forEach((correction, index) => {
        const label = correction.category === "house_style" ? "House style · your preference" : correction.category === "grammar" ? "Grammar" : "Spelling";
        lines.push("", bold(`${index + 1}. ${label}`));
        paragraph(`${red(shown(correction.original))}  →  ${green(shown(correction.replacement))}`);
        paragraph(safe(correction.explanation));
      });
    } else {
      paragraph(ink.success("✓ No corrections needed."));
    }
    if (view.review.suggestions.length) {
      section(`Optional suggestions · ${view.review.suggestions.length}`);
      view.review.suggestions.forEach((suggestion, index) => {
        const label = suggestion.category.replaceAll("_", " ");
        lines.push("", bold(`${index + 1}. ${label[0]?.toUpperCase()}${label.slice(1)}`));
        paragraph(ink.muted(`“${safe(shown(suggestion.original))}”`));
        paragraph(safe(suggestion.explanation));
        for (const alternative of suggestion.alternatives) {
          const label = suggestion.category === "british_usage" ? "British alternative" : "Example rewrite";
          paragraph(`${ink.accent(`${label} (optional):`)} ${safe(shown(alternative))}`);
        }
        if (suggestion.uncertainty) paragraph(ink.warning(`Uncertain: ${safe(suggestion.uncertainty)}`));
      });
    }
    section("Tone");
    paragraph(safe(view.review.tone));
    paragraph(ink.muted("Description only, not a request to change your voice."));
  }
  lines.push("");
  paragraph(ink.muted("Model advice, not sourced rules. Nothing is rewritten for you."));
  return lines;
}

function actions(view: WorkspaceView): { key: WorkspaceAction; label: string }[] {
  const list: { key: WorkspaceAction; label: string }[] = [];
  if (view.busy) list.push({ key: "stop", label: "Cancel review" });
  else if (!view.delivering && !view.uncertain && view.draft.trim()) list.push({ key: "review", label: view.draft === view.mandatoryDraft ? "Edit draft first" : view.error ? "Retry review" : "Review and send if clear" });
  const canSend = !view.busy && !view.delivering && !view.uncertain && view.review && view.reviewedDraft === view.draft && !view.review.corrections.length;
  if (canSend) list.push({ key: "send", label: "Send as written" });
  else if (!view.delivering && view.draft.trim()) list.push({ key: "bypass", label: view.uncertain ? "Confirm send again…" : "Send without passing review…" });
  list.push({ key: "cancel", label: view.attachmentCount ? "Return / discard attachments…" : "Return to main editor" },
    { key: "model", label: "Change reviewer…" }, { key: "toggle", label: view.settings.enabled ? "Turn future reviews off" : "Turn future reviews on" });
  return list;
}

export async function showReviewWorkspace(ctx: ExtensionContext, controller: WorkspaceController, signal: AbortSignal): Promise<void> {
  await ctx.ui.custom<void>((tui, theme, keybindings) => {
    const ink: Ink = {
      accent: text => theme.fg("accent", text), muted: text => theme.fg("muted", text),
      warning: text => theme.fg("warning", text), error: text => theme.fg("error", text),
      success: text => theme.fg("success", text),
    };
    const editor = new Editor(getEditorTheme());
    editor.disableSubmit = true;
    editor.setText(controller.view().draft);
    editor.setBorderVisible(false);
    editor.setPaddingX(0);
    editor.setScrollbarVisible(true);
    const initialCursorMode = editor.getUseTerminalCursor();
    let view = controller.view();
    const areas = ["review", "draft", "options"] as const;
    let focus: typeof areas[number] = "review";
    let selected: WorkspaceAction | undefined;
    let usable = true;
    let pasted = false;
    let disposed = false;
    let focused = true;
    let bodyDirty = true;
    const scroll = new ScrollView({ render: (width: number) => feedback(view, Math.max(1, width), ink), invalidate() {} }, {
      height: 8, scrollbar: "auto", theme: { track: ink.muted, thumb: ink.accent },
    });
    function updateFocus() {
      const active = focused && focus === "draft" && !view.busy && !view.delivering && usable;
      editor.focused = active;
      editor.setUseTerminalCursor(active ? initialCursorMode : true);
    }
    function moveFocus(direction: number) {
      focus = areas[(areas.indexOf(focus) + direction + areas.length) % areas.length]!;
      updateFocus();
      tui.requestRender();
    }
    const unsubscribe = controller.subscribe(() => {
      const next = controller.view();
      // Keep the live editor's cursor, paste markers and undo across focus and layout changes.
      if (next.draft !== editor.getExpandedText()) editor.setText(next.draft);
      view = next;
      bodyDirty = true;
      updateFocus();
      tui.requestRender();
    });
    editor.onChange = () => { controller.setDraft(editor.getExpandedText()); tui.requestRender(); };
    function act(action: WorkspaceAction) {
      if (action === "review" && view.draft === view.mandatoryDraft && !view.busy) {
        focus = "draft"; updateFocus(); tui.requestRender(); return;
      }
      void controller.act(action).catch(error => ctx.ui.notify(error instanceof Error ? error.message : String(error), "error"));
    }
    function panel(title: string, area: typeof focus, width: number, height: number, content: readonly string[], hint: string): string[] {
      const active = focused && focus === area;
      const border = active ? ink.accent : ink.muted;
      const lead = ` ${active ? "●" : "○"} ${title} `;
      const tail = ` ${hint} `;
      const fill = Math.max(0, width - 2 - visibleWidth(lead) - visibleWidth(tail));
      const heading = visibleWidth(lead) + visibleWidth(tail) <= width - 2
        ? `${bold(lead)}${"─".repeat(fill)}${tail}` : pad(bold(lead), width - 2);
      return [border(`╭${heading}╮`),
        ...Array.from({ length: Math.max(0, height - 2) }, (_, index) => `${border("│")} ${pad(content[index] ?? "", width - 4)} ${border("│")}`),
        border(`╰${"─".repeat(Math.max(0, width - 2))}╯`)];
    }
    return {
      get focused() { return focused; },
      set focused(value: boolean) { focused = value; updateFocus(); },
      capturesInput() { return true; },
      render(width: number): string[] {
        const height = Math.max(1, tui.terminal.rows - 2);
        const options = actions(view);
        if (!options.some(option => option.key === selected)) selected = options[0]?.key;
        const columns = width >= 110;
        const optionsHeight = options.length + 2;
        const contentHeight = height - 3;
        const draftHeight = columns ? contentHeight - optionsHeight - 1 : Math.max(5, Math.min(9, Math.floor(contentHeight / 4)));
        const reviewHeight = columns ? contentHeight : contentHeight - draftHeight - optionsHeight - 2;
        usable = width >= 40 && draftHeight >= 5 && reviewHeight >= 5;
        updateFocus();
        const stale = !!view.review && view.reviewedDraft !== view.draft;
        const status = view.delivering ? "Sending…" : view.busy ? "Reviewing…" : view.uncertain ? "Delivery uncertain" : view.error ? "Review paused" : stale ? "Draft changed · review again" : view.review?.corrections.length ? "Rewrite needed" : "Your choice";
        const summary = view.review
          ? `${view.review.corrections.length} correction${view.review.corrections.length === 1 ? "" : "s"} · ${view.review.suggestions.length} optional`
          : "Your draft stays unchanged until you edit it";
        const title = `${ink.accent(bold("Prompt review"))}  ${ink.warning(status)}`;
        const metadata = ink.muted(`${summary}${view.attachmentCount ? ` · ${view.attachmentCount} attachment(s)` : ""} · prototype`);
        if (!usable) return [truncateToWidth(title, width, ""), truncateToWidth("More room needed. Resize to review/edit; Esc returns the draft.", width, "")];
        const reviewWidth = columns ? Math.floor((width - 1) * .58) : width;
        const draftWidth = columns ? width - reviewWidth - 1 : width;
        scroll.setHeight(reviewHeight - 2);
        editor.setMaxHeight(draftHeight - 2);
        if (bodyDirty) { scroll.invalidate(); bodyDirty = false; }
        const reviewPanel = panel("1 Review", "review", reviewWidth, reviewHeight, scroll.render(reviewWidth - 4), focus === "review" ? "↑↓ scroll" : "Tab to focus");
        const draftPanel = panel("2 Your draft", "draft", draftWidth, draftHeight, editor.render(draftWidth - 4), view.busy || view.delivering ? "Locked" : "Enter: review");
        const menuLines = options.map(option => {
          const active = focus === "options" && focused && option.key === selected;
          const label = `${active ? "›" : " "} ${option.label}`;
          const hint = option.key === "bypass" ? "confirmation required"
            : option.key === "send" ? "only optional advice remains"
            : option.key === "model" ? `${safe(view.settings.provider)}/${safe(view.settings.modelId)} · ${safe(view.settings.effort)}`
            : option.key === "toggle" ? "this session only" : "";
          const room = draftWidth - 4 - visibleWidth(label) - visibleWidth(hint);
          const text = hint && room >= 3 ? `${label}${" ".repeat(room)}${ink.muted(hint)}` : label;
          return active ? ink.accent(bold(text)) : option.key === "bypass" ? ink.warning(text) : text;
        });
        const menuPanel = panel("3 Options", "options", draftWidth, optionsHeight, menuLines, focus === "options" ? "↑↓ · Enter" : "Tab to focus");
        const right = [...draftPanel, "", ...menuPanel];
        const rows = columns
          ? Array.from({ length: contentHeight }, (_, index) => `${pad(reviewPanel[index] ?? "", reviewWidth)} ${pad(right[index] ?? "", draftWidth)}`)
          : [...reviewPanel, "", ...draftPanel, "", ...menuPanel];
        const contextHint = focus === "review" ? "↑↓ scroll"
          : focus === "draft" ? "Enter review revision" : "↑↓ choose · Enter activate";
        return [truncateToWidth(title, width, ""), truncateToWidth(metadata, width, ""),
          ...rows, truncateToWidth(ink.muted(`Tab next · Shift+Tab back · ${contextHint} · Esc back`), width, "")];
      },
      handleInput(data: string) {
        if (disposed) return;
        if (!usable) { if (matchesKey(data, "escape")) act("cancel"); return; }
        // Bracketed-paste content is text, even if it contains tabs or workspace gestures.
        if (focus === "draft" && (pasted || data.includes("\x1b[200~"))) {
          pasted = !data.includes("\x1b[201~");
          if (!view.busy && !view.delivering) editor.handleInput(data);
          tui.requestRender(); return;
        }
        if (matchesKey(data, "tab") || matchesKey(data, "f6")) { moveFocus(1); return; }
        if (matchesKey(data, "shift+tab")) { moveFocus(-1); return; }
        if (focus === "draft") {
          if (matchesKey(data, "escape") && !editor.vimConsumesEscape()) { focus = "review"; updateFocus(); tui.requestRender(); return; }
          if (view.busy || view.delivering) return;
          if (keybindings.matches(data, "tui.input.submit") || data === "\n") { controller.setDraft(editor.getExpandedText()); act("review"); return; }
          editor.handleInput(data);
          tui.requestRender(); return;
        }
        if (matchesKey(data, "escape")) {
          if (focus === "options") { focus = "review"; updateFocus(); tui.requestRender(); }
          else act("cancel");
          return;
        }
        if (focus === "review") { scroll.handleScrollKey(data); tui.requestRender(); return; }
        const options = actions(view);
        const index = Math.max(0, options.findIndex(option => option.key === selected));
        if (matchesKey(data, "down") || matchesKey(data, "right")) selected = options[(index + 1) % options.length]?.key;
        else if (matchesKey(data, "up") || matchesKey(data, "left")) selected = options[(index + options.length - 1) % options.length]?.key;
        else if (keybindings.matches(data, "tui.input.submit") || data === "\n") { if (selected) act(selected); }
        tui.requestRender();
      },
      invalidate() { bodyDirty = true; editor.invalidate(); scroll.invalidate(); },
      dispose() { if (disposed) return; disposed = true; unsubscribe(); scroll.dispose(); editor.onChange = undefined; },
    };
  }, { overlay: true, overlayOptions: { width: "100%", maxHeight: "100%", margin: 0 }, signal });
}

// Core confirm dialogs render below a custom overlay. Keep confirmations in their own top overlay.
export async function confirmReviewAction(ctx: ExtensionContext, title: string, description: string, signal?: AbortSignal): Promise<boolean> {
  return ctx.ui.custom<boolean>((tui, _theme, _keys, done) => {
    const list = new SelectList([{ value: "no", label: "No — keep current state" }, { value: "yes", label: "Yes — confirm" }], 2, getSelectListTheme());
    list.onSelect = item => done(item.value === "yes");
    list.onCancel = () => done(false);
    return {
      capturesInput() { return true; },
      render(width: number) { return [bold(safe(title)), "", ...wrapTextWithAnsi(safe(description), Math.max(1, width)), "", ...list.render(width)]; },
      invalidate() { list.invalidate(); },
      handleInput(data: string) { list.handleInput(data); tui.requestRender(); },
    };
  }, { overlay: true, signal });
}
