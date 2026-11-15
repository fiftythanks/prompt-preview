// Experimental native prompt-review extension, installed for a real-work trial.
import type { ExtensionAPI, ExtensionContext } from "@oh-my-pi/pi-coding-agent";
import type { ImageContent } from "@oh-my-pi/pi-ai";
import type { WorkspaceAction, WorkspaceController, WorkspaceView, ReviewSettings } from "./contract";
import { DEFAULT_SETTINGS, chooseSelection, loadSettings, saveSettings } from "./settings";
import { reviewDraft } from "./reviewer";
import { confirmReviewAction, showReviewWorkspace } from "./review-ui";

const message = (error: unknown) => error instanceof Error ? error.message : String(error);
// Host command/control syntax must retain its own semantics, not become reviewed prose.
const eligible = (text: string, source: string) => source === "interactive" && !!text.trim() && !/^\s*(?:[\/@!]|->|=>)/u.test(text);
type Held = {
  ctx: ExtensionContext; owner: string; epoch: number; images: ImageContent[];
  state: WorkspaceView; listeners: Set<() => void>; request?: AbortController;
  ui: AbortController; finished: boolean; admissionNeedsSettings: boolean;
};

export default function promptReviewPrototype(pi: ExtensionAPI) {
  let settings: ReviewSettings = { ...DEFAULT_SETTINGS };
  let settingsError: string | null = null;
  let owner = "";
  let epoch = 0;
  let ready: Promise<void> = Promise.resolve();
  let loading = false;
  let active: Held | undefined;
  const queue: Held[] = [];
  let lastContext: ExtensionContext | undefined;
  let settingsMutation: Promise<void> = Promise.resolve();

  function status(ctx = lastContext) {
    ctx?.ui.setStatus("prompt-review", `Review ${settings.enabled ? "on" : "off"} · ${settings.provider}/${settings.modelId} ${settings.effort}${active ? " · held" : ""}${queue.length ? ` · ${queue.length} queued` : ""}`);
  }
  function current(item: Held) { return item.owner === owner && item.epoch === epoch && !item.finished; }
  function emit(item: Held) { item.state.settings = { ...settings }; for (const listener of item.listeners) listener(); status(); }
  function close(item: Held) {
    item.finished = true;
    item.request?.abort(new Error("Held prompt closed"));
    item.ui.abort(new Error("Held prompt closed"));
  }
  function discardAll() {
    epoch++;
    if (active) close(active);
    for (const item of queue.splice(0)) close(item);
    status();
  }
  async function initialise(ctx: ExtensionContext) {
    lastContext = ctx;
    discardAll();
    owner = ctx.sessionManager.getSessionId();
    const token = epoch;
    settings = { ...DEFAULT_SETTINGS }; settingsError = null; loading = true;
    ready = (async () => {
      try {
        const saved = await loadSettings(ctx);
        if (token === epoch && owner === ctx.sessionManager.getSessionId()) settings = saved;
      } catch (error) { if (token === epoch) settingsError = message(error); }
      finally { if (token === epoch) { loading = false; status(ctx); } }
    })();
    await ready;
  }
  async function updateSettings(ctx: ExtensionContext, next: ReviewSettings, token: number) {
    const operation = settingsMutation.catch(() => {}).then(async () => {
      if (token !== epoch || ctx.sessionManager.getSessionId() !== owner) throw new Error("Session changed; settings not changed");
      await saveSettings(ctx, next);
      if (token !== epoch || ctx.sessionManager.getSessionId() !== owner) return;
      settings = { ...next }; settingsError = null;
      if (active && current(active)) emit(active);
      status(ctx);
    });
    settingsMutation = operation;
    await operation;
  }
  async function changeModel(ctx: ExtensionContext, signal?: AbortSignal) {
    const token = epoch;
    const selection = await chooseSelection(ctx, settings, signal);
    if (!selection || token !== epoch || signal?.aborted) return;
    await updateSettings(ctx, { ...settings, ...selection }, token);
    if (token === epoch) ctx.ui.notify(`Reviewer: ${settings.provider}/${settings.modelId} · ${settings.effort}`, "info");
  }

  function recoverDelivery(item: Held, error: unknown) {
    if (item.owner !== owner || item.epoch !== epoch) return;
    const rejected = error instanceof Error && error.name === "PromptDroppedError";
    item.finished = false; item.ui = new AbortController();
    item.state.delivering = false;
    item.state.uncertain = !rejected;
    item.state.error = rejected
      ? `Prompt was not admitted. Nothing sent. ${message(error)}`
      : `Delivery uncertain — nothing resent. Check the target transcript before confirming another send. ${message(error)}`;
    queue.unshift(item);
    item.ctx.ui.notify(item.state.error, "warning");
    queueMicrotask(() => { void pump(); });
  }
  async function deliver(item: Held, bypass: boolean) {
    if (!current(item) || item.state.delivering || !item.state.draft.trim()) return;
    if (bypass) {
      const answer = await confirmReviewAction(item.ctx, item.state.uncertain ? "Possible duplicate delivery" : "Send without passing review?",
        item.state.uncertain ? "The previous delivery may already have reached the target. Send this draft again anyway?" : "Skip the correction check and send your current draft exactly as written, including any unresolved issues? Nothing will be corrected automatically.", item.ui.signal);
      if (!answer || !current(item)) return;
    } else if (item.state.uncertain || item.state.busy || !item.state.review || item.state.reviewedDraft !== item.state.draft || item.state.review.corrections.length) return;
    item.request?.abort(new Error("Sending user draft"));
    item.state.busy = false; item.state.delivering = true; emit(item);
    const payload = [{ type: "text" as const, text: item.state.draft }, ...structuredClone(item.images)];
    // The idle host path may await the entire target turn: do not block future admissions on its promise.
    const delivery = pi.sendUserMessage(payload);
    close(item);
    void delivery.catch(error => recoverDelivery(item, error));
  }
  async function runReview(item: Held) {
    if (!current(item) || item.state.busy || item.state.delivering) return;
    if (item.state.uncertain) { item.state.notice = "Check the transcript, then explicitly confirm bypass to send again, or cancel."; emit(item); return; }
    if (!item.state.draft.trim()) { item.state.notice = "Enter a nonblank draft."; emit(item); return; }
    if (item.state.mandatoryDraft === item.state.draft) { item.state.notice = "Rewrite the flagged draft before reviewing it again, or deliberately bypass."; emit(item); return; }
    const request = new AbortController(); item.request = request;
    const draft = item.state.draft;
    const revision = item.state.revision;
    const selection = { ...settings };
    item.state.busy = true; item.state.error = null; item.state.notice = null; emit(item);
    try {
      if (settingsError) throw new Error(`Session settings unavailable: ${settingsError}`);
      const review = await reviewDraft(draft, selection, item.ctx, request.signal);
      if (!current(item) || item.request !== request || request.signal.aborted || item.state.revision !== revision || item.state.draft !== draft) return;
      item.state.review = review; item.state.reviewedDraft = draft;
      item.state.mandatoryDraft = review.corrections.length ? draft : null;
      item.state.busy = false;
      if (!review.corrections.length && !review.suggestions.length) { await deliver(item, false); return; }
      item.state.notice = review.corrections.length ? "Rewrite the corrections below in your draft, then review again." : "No corrections remain. Suggestions are optional: choose Send as written, or revise again.";
    } catch (error) {
      if (!current(item) || item.request !== request || request.signal.aborted) return;
      item.state.error = message(error);
    } finally {
      if (current(item) && item.request === request) { item.state.busy = false; emit(item); }
    }
  }
  async function cancelPrompt(item: Held) {
    if (!current(item)) return;
    if (item.images.length) {
      const discard = await confirmReviewAction(item.ctx, "Discard prompt and attachments?", "The host cannot restore attachment chips. Choose No to keep editing; Yes discards this held prompt and its attachments.", item.ui.signal);
      if (!discard || !current(item)) return;
    } else {
      const newer = item.ctx.ui.getEditorText();
      if (newer && newer !== item.state.draft) {
        const replace = await confirmReviewAction(item.ctx, "Replace the newer main-input draft?", "A different draft is already in the main input. Choose No to keep editing this review; Yes replaces that draft.", item.ui.signal);
        if (!replace || !current(item)) return;
      }
      item.ctx.ui.setEditorText(item.state.draft);
    }
    close(item);
  }
  function controller(item: Held): WorkspaceController {
    return {
      view: () => ({ ...item.state, settings: { ...settings } }),
      subscribe(listener) { item.listeners.add(listener); return () => item.listeners.delete(listener); },
      setDraft(text) {
        if (!current(item) || item.state.busy || item.state.delivering || text === item.state.draft) return;
        item.state.draft = text; item.state.revision++; item.state.notice = null; emit(item);
      },
      async act(action: WorkspaceAction) {
        if (!current(item)) return;
        try {
          if (action === "review") await runReview(item);
          else if (action === "stop") {
            item.request?.abort(new Error("Review cancelled by user")); item.request = undefined;
            item.state.busy = false; item.state.notice = "Review cancelled. Your draft and previous feedback are unchanged."; emit(item);
          } else if (action === "send") await deliver(item, false);
          else if (action === "bypass") await deliver(item, true);
          else if (action === "cancel") await cancelPrompt(item);
          else if (action === "model") await changeModel(item.ctx, item.ui.signal);
          else if (action === "toggle") await updateSettings(item.ctx, { ...settings, enabled: !settings.enabled }, epoch);
        } catch (error) { if (current(item)) { item.state.error = message(error); emit(item); } }
      },
    };
  }
  async function pump() {
    if (active) return;
    await ready;
    if (active) return;
    const item = queue.shift();
    if (!item) { status(); return; }
    if (!current(item)) { void pump(); return; }
    active = item; status();
    if (!item.ctx.hasUI || item.ctx.mode !== "tui") {
      item.state.error = "Prompt held: this prototype needs an interactive terminal. Nothing sent.";
      item.ctx.ui.notify(item.state.error, "error"); return;
    }
    if (item.admissionNeedsSettings && !settings.enabled && !settingsError) {
      item.state.review = { corrections: [], suggestions: [], tone: "" }; item.state.reviewedDraft = item.state.draft;
      await deliver(item, false); active = undefined; void pump(); return;
    }
    item.admissionNeedsSettings = false;
    if (!item.state.error && !item.state.review) void runReview(item);
    try { await showReviewWorkspace(item.ctx, controller(item), item.ui.signal); }
    catch (error) { if (!item.ui.signal.aborted && current(item)) item.ctx.ui.notify(`Review UI closed unexpectedly; nothing sent. ${message(error)}`, "error"); }
    finally { if (active === item) active = undefined; status(); void pump(); }
  }

  pi.on("session_start", async (_event, ctx) => { await initialise(ctx); ctx.ui.notify("Prompt review · session settings persist; unsent drafts do not", "info"); });
  pi.on("session_switch", async (_event, ctx) => { await initialise(ctx); });
  pi.on("session_branch", async (_event, ctx) => { await initialise(ctx); });
  pi.on("session_tree", (_event, ctx) => { lastContext = ctx; status(ctx); });
  async function beforeTransition(ctx: ExtensionContext, signal?: AbortSignal) {
    if (!active && !queue.length) return;
    const abandon = await confirmReviewAction(ctx, "Abandon unfinished prompt review?", "Drafts, attachments and feedback are temporary and will be discarded. Choose No to stay; Yes to abandon.", signal);
    if (!abandon) return { cancel: true };
    discardAll();
  }
  pi.on("session_before_switch", (_event, ctx) => beforeTransition(ctx));
  pi.on("session_before_branch", (_event, ctx) => beforeTransition(ctx));
  pi.on("session_before_tree", (event, ctx) => beforeTransition(ctx, event.signal));
  pi.on("session_before_shutdown", (event, ctx) => beforeTransition(ctx, event.signal));
  pi.on("session_shutdown", () => discardAll());
  pi.registerCommand("prompt-review", {
    description: "Prototype review: on | off | status | change-model",
    handler: async (args, ctx) => {
      lastContext = ctx; await ready;
      const command = args.trim() || "status";
      try {
        if (command === "status") ctx.ui.notify(`PROTOTYPE · review ${settings.enabled ? "on" : "off"} · ${settings.provider}/${settings.modelId} · ${settings.effort}${active ? " · prompt held" : ""}${settingsError ? ` · settings error: ${settingsError}` : ""}`, "info");
        else if (command === "on" || command === "off") { await updateSettings(ctx, { ...settings, enabled: command === "on" }, epoch); ctx.ui.notify(`Future prompt review ${command}. Already held prompts are unchanged.`, "info"); }
        else if (command === "change-model") await changeModel(ctx);
        else ctx.ui.notify("Usage: /prompt-review [on|off|status|change-model]", "warning");
      } catch (error) { ctx.ui.notify(`Settings not changed: ${message(error)}`, "error"); }
    },
  });
  pi.on("input", (event, ctx) => {
    lastContext = ctx;
    if (!eligible(event.text, event.source) || (!loading && !settings.enabled && !settingsError)) return;
    const item: Held = {
      ctx, owner: ctx.sessionManager.getSessionId(), epoch, images: structuredClone(event.images ?? []), listeners: new Set(),
      ui: new AbortController(), finished: false, admissionNeedsSettings: loading,
      state: { id: crypto.randomUUID(), draft: event.text, revision: 0, reviewedDraft: null, review: null, mandatoryDraft: null,
        busy: false, delivering: false, uncertain: false, error: null, notice: null, attachmentCount: event.images?.length ?? 0, settings: { ...settings } },
    };
    queue.push(item);
    // Synchronous admission: never await the reviewer in the host's serial input hooks.
    setTimeout(() => { void pump(); }, 0);
    return { handled: true };
  });
}
