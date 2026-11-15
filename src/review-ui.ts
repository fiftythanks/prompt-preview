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

function feedback(view: WorkspaceView): string[] {
  const lines = [bold("Language feedback"), "Unsourced model judgements · your wording stays yours.", ""];
  if (view.busy) lines.push("Reviewing… Draft locked; Cancel review to edit.", "");
  if (view.error) lines.push(bold("Review / delivery error"), safe(view.error), "");
  if (view.notice) lines.push(safe(view.notice), "");
  if (!view.review) {
    lines.push("No completed review yet.");
  } else {
    if (view.reviewedDraft !== view.draft) lines.push(bold("STALE: feedback belongs to the previous wording."), "");
    lines.push(bold(`Corrections: ${view.review.corrections.length}`));
    for (const correction of view.review.corrections) {
      lines.push("", `[${correction.category === "house_style" ? "Your house style — preference" : correction.category}]`,
        `Remove: ${red(shown(correction.original))}  Use: ${green(shown(correction.replacement))}`,
        safe(correction.explanation));
    }
    lines.push("", bold(`Optional suggestions: ${view.review.suggestions.length}`));
    for (const suggestion of view.review.suggestions) {
      lines.push("", `[${suggestion.category.replaceAll("_", " ")}] ${safe(suggestion.original)}`,
        safe(suggestion.explanation));
      if (suggestion.alternatives.length) lines.push(`British alternatives: ${suggestion.alternatives.map(safe).join(" / ")}`);
      if (suggestion.uncertainty) lines.push(`Uncertain: ${safe(suggestion.uncertainty)}`);
    }
    lines.push("", bold("Tone (description only)"), safe(view.review.tone));
  }
  lines.push("", "No corrections are applied automatically. Rewrite the draft yourself and review it again.");
  if (view.mandatoryDraft === view.draft) lines.push("Change the wording before re-reviewing, or explicitly bypass.");
  return lines;
}

function actions(view: WorkspaceView): { key: WorkspaceAction; label: string }[] {
  const list: { key: WorkspaceAction; label: string }[] = [];
  if (view.busy) list.push({ key: "stop", label: "Cancel review" });
  else if (!view.delivering && !view.uncertain && view.draft.trim()) list.push({ key: "review", label: view.draft === view.mandatoryDraft ? "Rewrite first (F6)" : view.error ? "Retry review" : "Review revision" });
  if (!view.busy && !view.delivering && !view.uncertain && view.review && view.reviewedDraft === view.draft && !view.review.corrections.length) {
    list.push({ key: "send", label: "Send without these suggestions" });
  }
  if (!view.delivering && view.draft.trim()) list.push({ key: "bypass", label: view.uncertain ? "Confirm send again" : "Bypass review and send" });
  list.push({ key: "cancel", label: view.attachmentCount ? "Cancel / attachments" : "Return draft" },
    { key: "model", label: "Reviewer model" }, { key: "toggle", label: view.settings.enabled ? "Future review off" : "Future review on" });
  return list;
}

export async function showReviewWorkspace(ctx: ExtensionContext, controller: WorkspaceController, signal: AbortSignal): Promise<void> {
  await ctx.ui.custom<void>((tui, _theme, keybindings) => {
    const editor = new Editor(getEditorTheme());
    editor.disableSubmit = true;
    editor.setText(controller.view().draft);
    const initialCursorMode = editor.getUseTerminalCursor();
    let view = controller.view();
    let focus: "feedback" | "draft" = "feedback";
    let selected: WorkspaceAction | undefined;
    let usable = true;
    let pasted = false;
    let disposed = false;
    let focused = true;
    let bodyDirty = true;
    const scroll = new ScrollView({ render: (width: number) => feedback(view).flatMap(line => wrapTextWithAnsi(line, Math.max(1, width))), invalidate() {} }, { height: 8, scrollbar: "always" });
    function updateFocus() {
      const active = focused && focus === "draft" && !view.busy && !view.delivering && usable;
      editor.focused = active;
      editor.setUseTerminalCursor(active ? initialCursorMode : true);
    }
    const unsubscribe = controller.subscribe(() => {
      const next = controller.view();
      // Do not reset the live editor on every render: retain cursor, paste markers and undo.
      if (next.draft !== editor.getExpandedText()) editor.setText(next.draft);
      view = next;
      bodyDirty = true;
      updateFocus();
      tui.requestRender();
    });
    editor.onChange = () => { controller.setDraft(editor.getExpandedText()); tui.requestRender(); };
    function act(action: WorkspaceAction) {
      void controller.act(action).catch(error => ctx.ui.notify(error instanceof Error ? error.message : String(error), "error"));
    }
    return {
      get focused() { return focused; },
      set focused(value: boolean) { focused = value; updateFocus(); },
      capturesInput() { return true; },
      render(width: number): string[] {
        const height = Math.max(1, tui.terminal.rows - 2);
        usable = width >= 40 && height >= (width >= 100 ? 11 : 15);
        updateFocus();
        const reviewStatus = view.delivering ? "SENDING" : view.busy ? "REVIEWING" : view.error ? "HELD / ERROR" : view.reviewedDraft !== view.draft && view.review ? "EDITED / STALE" : "HELD";
        const header = truncateToWidth(bold(`PROTOTYPE · ${reviewStatus} · draft r${view.revision} · ${view.attachmentCount} attachment(s)`), width, "");
        if (!usable) return [header, truncateToWidth("Resize terminal to review/edit. Escape cancels the held prompt.", width, "")];
        const bodyHeight = height - 4;
        const columns = width >= 100;
        const reviewWidth = columns ? Math.floor((width - 1) * 0.55) : width;
        const draftWidth = columns ? width - reviewWidth - 1 : width;
        const reviewHeight = columns ? bodyHeight : Math.ceil(bodyHeight / 2);
        const draftHeight = columns ? bodyHeight : bodyHeight - reviewHeight;
        scroll.setHeight(Math.max(1, reviewHeight - 1));
        editor.setMaxHeight(Math.max(3, draftHeight - 1));
        if (bodyDirty) { scroll.invalidate(); bodyDirty = false; }
        const left = [bold(`${focus === "feedback" ? "▶" : " "} Feedback (scroll)`), ...scroll.render(reviewWidth)];
        const right = [bold(`${focus === "draft" ? "▶" : " "} Your draft${view.busy ? " — read-only" : " — rewrite here"}`), ...editor.render(draftWidth)];
        // Clamp only allocated rows; Editor.setMaxHeight owns its viewport/cursor placement.
        const rows = columns
          ? Array.from({ length: bodyHeight }, (_, i) => `${pad(left[i] ?? "", reviewWidth)}│${pad(right[i] ?? "", draftWidth)}`)
          : [...Array.from({ length: reviewHeight }, (_, i) => pad(left[i] ?? "", width)), ...Array.from({ length: draftHeight }, (_, i) => pad(right[i] ?? "", width))];
        const options = actions(view);
        if (!options.some(option => option.key === selected)) selected = options[0]?.key;
        const index = options.findIndex(option => option.key === selected);
        const allActions = options.map(option => option.key === selected ? `[${option.label}]` : option.label).join(" · ");
        const optionsLine = visibleWidth(allActions) > width
          ? `[${index + 1}/${options.length}] ${options[index]?.label ?? ""}`
          : allActions;
        return [header, truncateToWidth(`${safe(view.settings.provider)}/${safe(view.settings.modelId)} · ${safe(view.settings.effort)} · future review ${view.settings.enabled ? "on" : "off"}`, width, ""),
          ...rows, truncateToWidth(optionsLine, width, ""), truncateToWidth("F6 focus · Tab/←/→ actions · Enter activate/review · Esc back/cancel", width, "")];
      },
      handleInput(data: string) {
        if (disposed) return;
        if (!usable) { if (matchesKey(data, "escape")) act("cancel"); return; }
        if (matchesKey(data, "f6")) { focus = focus === "feedback" ? "draft" : "feedback"; updateFocus(); tui.requestRender(); return; }
        if (focus === "draft") {
          if (pasted || data.includes("\x1b[200~")) {
            pasted = !data.includes("\x1b[201~");
            if (!view.busy && !view.delivering) editor.handleInput(data);
            tui.requestRender(); return;
          }
          if (matchesKey(data, "escape") && !editor.vimConsumesEscape()) { focus = "feedback"; updateFocus(); tui.requestRender(); return; }
          if (view.busy || view.delivering) return;
          if (keybindings.matches(data, "tui.input.submit") || data === "\n") { controller.setDraft(editor.getExpandedText()); act("review"); return; }
          // Editing gestures (including configured interrupt) belong to the editor first.
          editor.handleInput(data);
          tui.requestRender(); return;
        }
        if (matchesKey(data, "escape")) { act("cancel"); return; }
        const options = actions(view);
        const index = Math.max(0, options.findIndex(option => option.key === selected));
        if (matchesKey(data, "tab") || matchesKey(data, "right")) selected = options[(index + 1) % options.length]?.key;
        else if (matchesKey(data, "shift+tab") || matchesKey(data, "left")) selected = options[(index + options.length - 1) % options.length]?.key;
        else if (keybindings.matches(data, "tui.input.submit") || data === "\n") { if (selected) act(selected); }
        else scroll.handleScrollKey(data);
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
